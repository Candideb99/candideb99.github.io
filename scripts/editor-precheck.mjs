#!/usr/bin/env node
/**
 * The editor's round, done first without Claude. The owner, 2026-09-23: "make sure the editor does not
 * run continuously and edit already edited articles so that my claude tokens do not get wasted. It
 * should be smart editor." Until then the daily round woke Claude every morning for 45 to 80 turns to
 * look for work that is usually not there. These checks cost nothing; Claude is called only when one of
 * them finds something, and then only for what it found.
 *
 *   1. the newsroom and the deploy: a run that failed in the last day;
 *   2. pictures: a news story of the last two days without one (filled by a plain workflow step, never
 *      by Claude; older ones were tried and run as text);
 *   3. the same event told twice in the last two days (the site's own rule, src/lib/articles.ts);
 *   4. soundness: `npm run check` and `npm run build`.
 *
 * Writes editor-findings.md (what it found and what is fine; the run summary when Claude is not needed)
 * and, on GitHub, `work=1|0` (Claude is needed) and `pictures=<slugs>` to $GITHUB_OUTPUT. `--no-build`
 * skips step 4 for a quick look.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const DAY = 86_400_000;
const now = Date.now();
const findings = [];
const fine = [];

// 1. The newsroom and the deploy in the last day.
for (const workflow of ["newsroom.yml", "deploy.yml"]) {
  let runs;
  try {
    runs = JSON.parse(execFileSync("gh", ["run", "list", "--workflow", workflow, "--limit", "30", "--json", "databaseId,conclusion,status,createdAt"], { encoding: "utf8" }));
  } catch (error) {
    findings.push(`Could not read the runs of ${workflow} (${String(error.message).split("\n")[0]}).`);
    continue;
  }
  const lastDay = runs.filter((r) => now - Date.parse(r.createdAt) < DAY && r.status === "completed");
  const failed = lastDay.filter((r) => r.conclusion === "failure");
  if (failed.length) findings.push(`${workflow}: ${failed.length} of ${lastDay.length} runs in the last day failed (${failed.map((r) => r.databaseId).join(", ")}). Read each with \`gh run view <id> --log-failed\` and fix the cause.`);
  else fine.push(`${workflow}: ${lastDay.length} runs in the last day, none failed.`);
}

// The published stories.
const dir = path.join("content", "articles");
const stories = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
  const raw = readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
  const front = raw.match(/^---\n([\s\S]*?)\n---/);
  let data;
  try {
    data = YAML.parse(front?.[1] ?? "");
  } catch {
    findings.push(`${file}: its frontmatter does not parse.`);
    continue;
  }
  if (!data || data.draft) continue;
  stories.push({ slug: String(data.slug ?? file.replace(/\.md$/, "")), title: String(data.title ?? ""), at: Date.parse(data.publishedAt), kind: data.kind ?? "news", image: data.image ?? null });
}
const lastDay = stories.filter((s) => now - s.at < DAY);
const lastTwo = stories.filter((s) => now - s.at < 2 * DAY);
fine.push(`${lastDay.length} stories published in the last day, ${stories.length} in all.`);

// 2. Pictures: a news story of the last two days without one. Filling it is mechanical (the pipeline's
// own picture search, on the free models), so the workflow does it in a plain step and it never wakes
// Claude; a story with no fitting photograph runs as text, and after two days it is left alone.
const bare = lastTwo.filter((s) => s.kind === "news" && !s.image && /^[a-z0-9-]+$/.test(s.slug));
if (bare.length) fine.push(`${bare.length} news story(ies) of the last two days had no picture; the workflow searches for one without Claude: ${bare.map((s) => s.slug).join(", ")}.`);
else fine.push("Every news story of the last two days has a picture.");

// 3. The same event twice in the last two days: four shared headline words and 60% of the shorter
// headline's, as src/lib/articles.ts decides it for the front page.
const STOP = new Set(["علي", "بعد", "قبل", "حول", "دون", "منذ", "بين", "عبر", "خلال", "وسط", "امام", "عند", "حتي", "التي", "الذي", "هذا", "هذه", "اول", "اكثر", "اقل", "مع"]);
function headlineWords(title) {
  const text = title.replace(/[ً-ٰٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ترامب/g, "ترمب").replace(/اميرك/g, "امريك");
  const words = text.split(/[^\p{L}\p{N}]+/u).map((w) => {
    let word = w.replace(/^(وال|بال|فال|كال|لل|ال)/, "");
    if (word.length > 4) word = word.replace(/^[ول]/, "");
    return word.replace(/يه$/, "ي");
  });
  return new Set(words.filter((w) => w.length > 2 && !STOP.has(w)));
}
const pairs = [];
for (let i = 0; i < lastTwo.length; i++) {
  for (let j = i + 1; j < lastTwo.length; j++) {
    const a = headlineWords(lastTwo[i].title);
    const b = headlineWords(lastTwo[j].title);
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    if (shared >= 4 && shared / Math.min(a.size, b.size) >= 0.6) pairs.push(`«${lastTwo[i].title}» / «${lastTwo[j].title}»`);
  }
}
if (pairs.length) findings.push(`The same event was filed twice in the last two days: ${pairs.join("; ")}. That is a de-duplication weakness in pipeline/lib/select.mjs: tighten the rule; do not delete or edit the articles.`);
else fine.push("No event was filed twice in the last two days.");

// 4. Soundness.
if (!process.argv.includes("--no-build")) {
  for (const script of ["check", "build"]) {
    const run = spawnSync("npm", ["run", script], { encoding: "utf8", shell: true, maxBuffer: 1 << 26 });
    if (run.status !== 0) findings.push(`\`npm run ${script}\` fails:\n\n\`\`\`\n${`${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n")}\n\`\`\``);
    else fine.push(`\`npm run ${script}\` passes.`);
  }
}

const report = [
  "## The editor's round",
  "",
  findings.length ? `The free checks found ${findings.length} thing(s) for the editor:` : "Nothing needed the editor today, so Claude was not called and no tokens were spent.",
  "",
  ...findings.map((f) => `- ${f}`),
  ...(findings.length ? [""] : []),
  "What is fine:",
  "",
  ...fine.map((f) => `- ${f}`),
  "",
].join("\n");
writeFileSync("editor-findings.md", report);
console.log(report);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `work=${findings.length ? 1 : 0}\npictures=${bare.map((s) => s.slug).join(",")}\n`);
