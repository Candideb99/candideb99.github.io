#!/usr/bin/env node
/**
 * Corrects a published story, as /methodology/ promises: «إذا تبيّن خطأ في مقال منشور، نصحّح المقال نفسه
 * ونثبّت في أسفله تاريخ التصحيح وما تغيّر، ولا نحذف المقال بصمت».
 *
 *   node pipeline/correct.mjs --slug=a-b-c --issue="…"          one story
 *   node pipeline/correct.mjs --file=pipeline/corrections.json   a list of { "slug", "issue" }
 *   add --dry-run to see each correction without writing it
 *   add --max-change=0.8 when the correction itself removes a whole second story merged into this one
 *   node pipeline/correct.mjs --slug=a-b-c --drop-tags=الهند,طاقة   only takes away tags whose subject a
 *   correction removed from the story (no model, no note: a tag is filing, not content)
 *   (the default holds a correction to 45% of the sentences)
 *
 * The corrections editor sees the story, its sources fetched again and the error as reported. It checks the
 * report against the sources (a story that is right stays as it is) and changes only what the error names,
 * wherever it appears: headline, dek, lede, key facts, «لماذا يهمّ», body. Code then holds it to that: a
 * figure the correction brings in must stand in the sources or in the report, the subheads stay, and a
 * rewrite that touches more than a correction needs is refused. The story gains a dated note in
 * `corrections` (printed at its foot by the article page) and `updatedAt`. Nothing is edited by hand.
 */
import "./lib/env.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { chat } from "./lib/llm.mjs";
import { extractArticle } from "./lib/extract.mjs";
import { WRITER_SYSTEM } from "./lib/write.mjs";
import { arabicRatio, normalizeDigits, ungroundedNumbers } from "./lib/util.mjs";
import { ARTICLES_DIR } from "./lib/article.mjs";
import { fixNames } from "./lib/copydesk.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const DRY = args.includes("--dry-run");
const MAX_CHANGE = Math.min(0.9, Number(option("max-change")) || 0.45);
const log = (line) => console.log(`[correct] ${line}`);

let items = [];
if (option("file")) items = JSON.parse(await readFile(option("file"), "utf8"));
else if (option("slug") && option("issue")) items = [{ slug: option("slug"), issue: option("issue") }];

// Filing only: take away tags whose subject has left the story, and nothing else.
if (option("slug") && option("drop-tags")) {
  const drop = new Set(option("drop-tags").split(",").map((t) => t.trim()).filter(Boolean));
  const file = path.join(ARTICLES_DIR, `${option("slug")}.md`);
  const raw = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const doc = YAML.parseDocument(match[1]);
  const tags = (doc.toJS().tags ?? []).map(String);
  const kept = tags.filter((t) => !drop.has(t));
  log(`${option("slug")}: tags ${tags.join("، ")} → ${kept.join("، ")}${DRY ? " (dry run)" : ""}`);
  if (!DRY && kept.length !== tags.length) {
    doc.set("tags", doc.createNode(kept));
    await writeFile(file, `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n\n${match[2].trim()}\n`);
  }
  process.exit(0);
}
if (!items.length) {
  console.error("usage: node pipeline/correct.mjs --slug=… --issue=\"…\" | --file=list.json [--dry-run]");
  process.exit(2);
}

const SYSTEM = `${WRITER_SYSTEM}

You are now the corrections editor. A reader or an audit has reported an error in a published story. You check the report against the source material and, if it holds, correct the story the way an Arabic newspaper corrects: the error is fixed wherever it appears, every other sentence stays word for word, and a short note says what was wrong.`;

const FIELDS = ["title", "subtitle", "lede", "whyItMatters", "body"];
const sentencesOf = (t) => String(t ?? "").split(/(?<=[.؟!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const numbersOf = (t) => (normalizeDigits(String(t ?? "")).match(/\d[\d.,]*\d|\d/g) ?? []).map((n) => n.replace(/[.,]+$/, "").replace(/,(?=\d{3}(?!\d))/g, ""));

async function sourcesOf(story) {
  const out = [];
  for (const s of story.sources ?? []) {
    if (!s.url || s.url.startsWith("/")) continue;
    const fetched = await extractArticle(s.url, { log });
    out.push({ name: s.name ?? s.nameEn ?? "", title: s.title ?? "", url: s.url, text: fetched.ok ? fetched.text : "" });
    if (!fetched.ok) log(`  source ${s.url.slice(0, 70)}: ${fetched.reason}`);
  }
  return out;
}

const report = { startedAt: new Date().toISOString(), dryRun: DRY, items: [] };
for (const { slug, issue } of items) {
  const file = path.join(ARTICLES_DIR, `${slug}.md`);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    log(`${slug}: no such story`);
    report.items.push({ slug, outcome: "missing" });
    continue;
  }
  const match = raw.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const doc = YAML.parseDocument(match[1]);
  const data = doc.toJS();
  const before = { title: data.title ?? "", subtitle: data.subtitle ?? "", lede: data.lede ?? "", whyItMatters: data.whyItMatters ?? "", body: match[2].trim(), keyFacts: data.keyFacts ?? [] };
  log(`${slug}: fetching ${data.sources?.length ?? 0} source(s)`);
  const sources = await sourcesOf(data);
  const material = sources.length
    ? sources.map((s, i) => `[${i + 1}] ${s.name} — ${s.title}\n${s.text ? s.text.slice(0, 7000) : "(the page could not be fetched again; its headline is above)"}`).join("\n\n")
    : "(this piece has no outside sources: it is an explainer; judge the report by the arithmetic or the established fact it states)";

  const user = `THE STORY (JSON)
${JSON.stringify(before, null, 2)}

SOURCE MATERIAL (fetched again)
${material}

THE ERROR, AS REPORTED
${issue}

TASK
Check the report against the source material. If the story is right after all, answer {"correct": true, "reason": "<one sentence>"}.
Otherwise correct the error wherever it appears (title, subtitle, lede, keyFacts, whyItMatters, body) and change nothing else: every other sentence stays word for word, the body keeps its paragraphs and "## " subheads. Bring in no fact beyond what the correction needs; a figure you add must come from the source material or from the report. Then write the note printed at the foot of the story: one or two Arabic sentences in the desks' form, saying what an earlier version said and what is correct (for example «ذكرت نسخة سابقة من هذا الخبر أن … والصحيح أن …»).
Answer with one JSON object: {"correct": false, "title": "...", "subtitle": "...", "lede": "...", "whyItMatters": "...", "keyFacts": [{"label": "...", "value": "..."}], "body": "...", "note": "..."}`;

  let answer;
  let model;
  try {
    ({ data: answer, model } = await chat({
      role: "writer",
      system: SYSTEM,
      user,
      temperature: 0.1,
      maxTokens: 9000,
      timeoutMs: 480000,
      log,
      validate: (d) => {
        if (!d || typeof d !== "object") throw new Error("not an object");
        if (d.correct === true) return;
        for (const f of [...FIELDS, "note"]) if (typeof d[f] !== "string") throw new Error(`lacks ${f}`);
        if (!Array.isArray(d.keyFacts)) throw new Error("lacks keyFacts");
      },
    }));
  } catch (error) {
    log(`${slug}: failed (${String(error.message).split("\n")[0]})`);
    report.items.push({ slug, issue, outcome: "failed", error: String(error.message).slice(0, 200) });
    continue;
  }
  if (answer.correct === true) {
    log(`${slug}: the story stands (${answer.reason})`);
    report.items.push({ slug, issue, outcome: "stands", reason: answer.reason, model });
    continue;
  }

  // The house spelling table (أمريكي، ترامب، خه لي فنغ…) applies to a correction as to every rewrite.
  const after = { ...before, ...Object.fromEntries(FIELDS.map((f) => [f, fixNames(String(answer[f]).trim())])), keyFacts: answer.keyFacts.map((k) => ({ label: String(k.label ?? "").trim(), value: String(k.value ?? "").trim() })).filter((k) => k.value) };
  const note = fixNames(String(answer.note).trim());
  // Code holds the correction to what a correction is.
  const problems = [];
  const text = (d) => [...FIELDS.map((f) => d[f]), ...d.keyFacts.map((k) => `${k.label} ${k.value}`)].join("\n");
  const had = new Set(numbersOf(text(before)));
  const added = [...new Set(numbersOf(text(after)).filter((n) => !had.has(n)))];
  const ungrounded = added.length ? ungroundedNumbers(added.join(" "), [...sources.map((s) => `${s.title}\n${s.text}`), issue]) : [];
  if (ungrounded.length) problems.push(`figures neither in the sources nor in the report: ${ungrounded.join(", ")}`);
  const heads = (t) => (String(t).match(/^## .*$/gm) ?? []).length;
  if (heads(before.body) !== heads(after.body)) problems.push("the subheads changed");
  if (!note || arabicRatio(note) < 0.6) problems.push("no Arabic correction note");
  if (arabicRatio(after.body) < 0.5) problems.push("the body is not Arabic");
  const was = sentencesOf(text(before));
  const now = new Set(sentencesOf(text(after)));
  const changed = was.filter((s) => !now.has(s)).length;
  if (changed > Math.max(8, Math.ceil(was.length * MAX_CHANGE))) problems.push(`${changed} of ${was.length} sentences changed: more than a correction needs`);

  const diff = FIELDS.filter((f) => before[f].trim() !== after[f].trim());
  if (JSON.stringify(before.keyFacts) !== JSON.stringify(after.keyFacts)) diff.push("keyFacts");
  const item = { slug, issue, outcome: problems.length ? "refused" : DRY ? "would correct" : "corrected", problems, fields: diff, note, model, before: Object.fromEntries(diff.filter((f) => f !== "body" && f !== "keyFacts").map((f) => [f, before[f]])), after: Object.fromEntries(diff.filter((f) => f !== "body" && f !== "keyFacts").map((f) => [f, after[f]])), changedSentences: was.filter((s) => !now.has(s)).slice(0, 12), newSentences: sentencesOf(text(after)).filter((s) => !new Set(was).has(s)).slice(0, 12) };
  report.items.push(item);
  log(`${slug}: ${item.outcome}${problems.length ? ` (${problems.join("; ")})` : ""}; fields ${diff.join(", ") || "none"}\n    note: ${note}`);
  if (problems.length || DRY || !diff.length) continue;

  for (const f of ["title", "subtitle", "lede", "whyItMatters"]) if (diff.includes(f)) doc.set(f, after[f]);
  if (diff.includes("keyFacts")) doc.set("keyFacts", doc.createNode(after.keyFacts));
  const stamp = new Date().toISOString();
  const corrections = [...(data.corrections ?? []), { date: stamp, note }];
  doc.set("corrections", doc.createNode(corrections));
  doc.set("updatedAt", stamp);
  const front = doc.toString({ lineWidth: 0 }).trimEnd();
  await writeFile(file, `---\n${front}\n---\n\n${diff.includes("body") ? after.body : before.body}\n`);
}

const runs = path.join(process.cwd(), "pipeline", "runs");
await mkdir(runs, { recursive: true });
const out = path.join(runs, `corrections-${report.startedAt.replace(/[:.]/g, "-")}.json`);
await writeFile(out, JSON.stringify(report, null, 2));
log(`done: ${report.items.filter((i) => i.outcome === "corrected").length} corrected, ${report.items.filter((i) => i.outcome === "stands").length} stand, ${report.items.filter((i) => i.outcome === "refused" || i.outcome === "failed").length} refused or failed${DRY ? " (dry run)" : ""}; report ${path.relative(process.cwd(), out)}`);
