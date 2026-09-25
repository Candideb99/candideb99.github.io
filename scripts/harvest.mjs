#!/usr/bin/env node
/**
 * The week's numbers (2026-09-25): does the paper need less correcting this week than last? No model call; it reads
 * what the pipeline already writes:
 *   - the second look's ledger (pipeline/state/factcheck.json): stories read, errors confirmed by class, corrections,
 *     and the flags the corrections editor overruled ("stands"), which is how often the checker is wrong;
 *   - the stories themselves: their dated corrections, and the style checker (pipeline/lib/style.mjs) run over them
 *     again, for the translationese and structure faults the owner has asked about most;
 *   - the newsroom's run reports (pipeline/runs/*.json): stories written, refused and why, Claude calls per story.
 * It writes pipeline/state/quality.json (one line a day, kept 90 days, and this week against last), which the
 * control room shows, and the table to the run summary.
 *
 * Why: the research on self-improving agents found that a loop is worth only what measures it, that the measure must
 * come from outside the model (the critic's score never counts: the stories the 23 Sept audit corrected had scored the
 * same median 9 as the clean ones), and that lessons a model writes for itself do not help while checks written as
 * code do. So faults that recur (in two stories or more in a week) are listed as the work to do, with examples, for a
 * person to turn into a rule in style.mjs or verify.mjs: the loop drafts, a person commits.
 *
 *   node scripts/harvest.mjs            write quality.json and print the week
 *   node scripts/harvest.mjs --print    print only
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { styleIssues } from "../pipeline/lib/style.mjs";

const DAY = 86_400_000;
const now = Date.now();
const PRINT = process.argv.includes("--print");
const OUT = path.join("pipeline", "state", "quality.json");
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const within = (iso, from, to) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > now - from * DAY && t <= now - to * DAY;
};

// The stories.
const stories = [];
for (const file of readdirSync(path.join("content", "articles")).filter((f) => f.endsWith(".md"))) {
  const raw = readFileSync(path.join("content", "articles", file), "utf8").replace(/\r\n/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) continue;
  let d;
  try {
    d = YAML.parse(m[1]);
  } catch {
    continue;
  }
  if (!d || d.draft) continue;
  stories.push({ ...d, kind: d.kind ?? "news", body: m[2].trim() });
}

/** A style fault's name without its counts, so the same fault in two stories is counted as one kind. */
const faultKey = (text) => String(text).split("؛")[0].replace(/\d+/g, "#").replace(/«([^»]{0,40})[^»]*»/g, "«$1»").slice(0, 90).trim();
const ledger = readJson(path.join("pipeline", "state", "factcheck.json"))?.stories ?? {};
const reports = readdirSync(path.join("pipeline", "runs")).filter((f) => /^\d{4}-.*\.json$/.test(f)).map((f) => readJson(path.join("pipeline", "runs", f))).filter(Boolean);

/** The numbers of one window, `from` to `to` days ago. */
function windowOf(from, to) {
  const published = stories.filter((s) => within(s.publishedAt, from, to));
  const news = published.filter((s) => s.kind === "news");
  const style = { issues: 0, warnings: 0, kinds: new Map() };
  for (const s of news) {
    const names = (s.sources ?? []).flatMap((x) => [x.name, x.nameEn]).filter(Boolean);
    const { issues, warnings } = styleIssues(s, { kind: "news", sources: names });
    style.issues += issues.length;
    style.warnings += warnings.length;
    for (const text of issues) {
      const key = faultKey(text);
      if (!style.kinds.has(key)) style.kinds.set(key, new Set());
      style.kinds.get(key).add(s.slug);
    }
  }
  const corrections = stories.flatMap((s) => (s.corrections ?? []).filter((c) => within(c.date, from, to)).map(() => s.slug));
  const read = Object.entries(ledger).filter(([, e]) => within(e.at, from, to) && e.outcome !== "audited");
  const outcome = (o) => read.filter(([, e]) => e.outcome === o).length;
  const classes = new Map();
  for (const [slug, e] of read) for (const c of e.confirmed ?? []) {
    if (!classes.has(c.class)) classes.set(c.class, { stories: new Set(), examples: [] });
    classes.get(c.class).stories.add(slug);
    if (classes.get(c.class).examples.length < 3 && c.sentence) classes.get(c.class).examples.push(`${slug}: ${c.sentence.slice(0, 120)}`);
  }
  const confirmed = read.reduce((n, [, e]) => n + (e.confirmed?.length ?? 0), 0);
  // The live test of the lessons: proved errors per story read, for stories written with them and without them.
  const rate = (list) => (list.length ? Number((list.reduce((n, [, e]) => n + (e.confirmed?.length ?? 0), 0) / list.length).toFixed(2)) : null);
  // "control": the one story in five run.mjs writes without the lessons; before the lessons existed, every Claude story was.
  const judged = read.filter(([, e]) => e.outcome !== "unverifiable" && e.outcome !== "failed" && /claude/.test(String(e.writer ?? "")));
  const withLessons = judged.filter(([, e]) => e.lessons && e.lessons !== "control");
  const without = judged.filter(([, e]) => !e.lessons || e.lessons === "control");
  const runs = reports.filter((r) => within(r.startedAt, from, to));
  const refusals = new Map();
  for (const r of runs) for (const e of r.report ?? []) {
    if (!/^rejected|^skipped/.test(e.outcome ?? "")) continue;
    const key = String(e.outcome).replace(/«[^»]*»/g, "«…»").replace(/\(\d+\)/g, "").replace(/\d+/g, "#").split(/[|:]/).slice(0, 2).join(":").slice(0, 90).trim();
    refusals.set(key, (refusals.get(key) ?? 0) + 1);
  }
  const written = runs.reduce((n, r) => n + (r.published ?? 0), 0);
  const calls = runs.reduce((n, r) => n + (r.llm?.calls ?? 0), 0);
  return {
    published: published.length,
    news: news.length,
    revisedShare: news.length ? Number((news.filter((s) => s.quality?.revised).length / news.length).toFixed(2)) : null,
    styleFaultsPerStory: news.length ? Number((style.issues / news.length).toFixed(2)) : null,
    styleWarningsPerStory: news.length ? Number((style.warnings / news.length).toFixed(2)) : null,
    corrections: corrections.length,
    // "listed": stories left with something for a person (the website's own reasoning contradicted, a changed page, a
    // quote code could not find, or a confirmed error not corrected in a listing-only run).
    usefulness: (() => {
      const claude = news.filter((s) => /claude/.test(String(s.models?.writer ?? "")));
      const words = (list) => (list.length ? Math.round(list.reduce((n, s) => n + `${s.lede ?? ""} ${s.body ?? ""}`.split(/\s+/).filter(Boolean).length, 0) / list.length) : null);
      const facts = (list) => (list.length ? Number((list.reduce((n, s) => n + (s.keyFacts?.length ?? 0), 0) / list.length).toFixed(1)) : null);
      const withL = claude.filter((s) => s.models?.lessons && s.models.lessons !== "control");
      const control = claude.filter((s) => s.models?.lessons === "control");
      return { withLessons: { stories: withL.length, words: words(withL), keyFacts: facts(withL) }, control: { stories: control.length, words: words(control), keyFacts: facts(control) } };
    })(),
    secondLook: { read: read.length, clean: outcome("clean"), corrected: outcome("corrected"), stands: outcome("stands"), refused: outcome("refused"), listed: outcome("listed") + outcome("flagged"), unverifiable: outcome("unverifiable"), confirmedPerStory: read.length ? Number((confirmed / read.length).toFixed(2)) : null, withLessons: { read: withLessons.length, confirmedPerStory: rate(withLessons) }, claudeWithout: { read: without.length, confirmedPerStory: rate(without) } },
    runs: { count: runs.length, written, refused: [...refusals.values()].reduce((a, b) => a + b, 0), callsPerStory: written ? Number((calls / written).toFixed(1)) : null, note: "from the run reports kept (the newest 24)" },
    recurring: [
      ...[...classes].filter(([, v]) => v.stories.size >= 2).map(([k, v]) => ({ what: `second look: ${k} errors`, stories: v.stories.size, examples: v.examples })),
      ...[...style.kinds].filter(([, v]) => v.size >= 2).sort((a, b) => b[1].size - a[1].size).slice(0, 8).map(([k, v]) => ({ what: `style: ${k}`, stories: v.size, examples: [...v].slice(0, 3) })),
      ...[...refusals].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => ({ what: `newsroom: ${k}`, stories: n, examples: [] })),
    ],
  };
}

const lessonsState = readJson(path.join("pipeline", "state", "lessons.json"));
const lessonsNow = { version: lessonsState?.version ?? 0, active: (lessonsState?.lessons ?? []).filter((l) => l.status === "active").length, learnedFrom: (lessonsState?.used ?? []).length };
const week = windowOf(7, 0);
const before = windowOf(14, 7);
const today = windowOf(1, 0);
const health = readJson(path.join("pipeline", "state", "health.json"));
const quality = readJson(OUT) ?? { version: 1, days: [] };
const date = new Date(now).toISOString().slice(0, 10);
quality.days = [...quality.days.filter((d) => d.date !== date), { date, published: today.published, news: today.news, styleFaultsPerStory: today.styleFaultsPerStory, corrections: today.corrections, read: today.secondLook.read, confirmedPerStory: today.secondLook.confirmedPerStory, photosPending: health?.last?.photos?.pending ?? null }].slice(-90);
quality.updatedAt = new Date(now).toISOString();
quality.lessons = lessonsNow;
quality.week = week;
quality.weekBefore = before;

const arrow = (a, b, lowerIsBetter = true) => (a == null || b == null ? "" : a === b ? " (=)" : (a < b) === lowerIsBetter ? " (better)" : " (worse)");
const md = [
  "## The week's numbers (free: no model call)",
  "",
  "| | this week | the week before |",
  "|---|---|---|",
  `| stories published (news) | ${week.published} (${week.news}) | ${before.published} (${before.news}) |`,
  `| style faults per news story | ${week.styleFaultsPerStory ?? "–"}${arrow(week.styleFaultsPerStory, before.styleFaultsPerStory)} | ${before.styleFaultsPerStory ?? "–"} |`,
  `| news stories that needed the revision round | ${week.revisedShare == null ? "–" : `${Math.round(week.revisedShare * 100)}%`}${arrow(week.revisedShare, before.revisedShare)} | ${before.revisedShare == null ? "–" : `${Math.round(before.revisedShare * 100)}%`} |`,
  `| second look: stories read · clean · corrected · overruled | ${week.secondLook.read} · ${week.secondLook.clean} · ${week.secondLook.corrected} · ${week.secondLook.stands} | ${before.secondLook.read} · ${before.secondLook.clean} · ${before.secondLook.corrected} · ${before.secondLook.stands} |`,
  `| confirmed errors per story read | ${week.secondLook.confirmedPerStory ?? "–"}${arrow(week.secondLook.confirmedPerStory, before.secondLook.confirmedPerStory)} | ${before.secondLook.confirmedPerStory ?? "–"} |`,
  `| … Claude's stories written with the lessons (read) | ${week.secondLook.withLessons.confirmedPerStory ?? "–"} (${week.secondLook.withLessons.read}) | ${before.secondLook.withLessons.confirmedPerStory ?? "–"} (${before.secondLook.withLessons.read}) |`,
  `| … Claude's stories written without them: the control group and before (read) | ${week.secondLook.claudeWithout.confirmedPerStory ?? "–"} (${week.secondLook.claudeWithout.read}) | ${before.secondLook.claudeWithout.confirmedPerStory ?? "–"} (${before.secondLook.claudeWithout.read}) |`,
  `| words · key facts a story, with the lessons / control group (fewer errors must not mean saying less) | ${week.usefulness.withLessons.words ?? "–"} · ${week.usefulness.withLessons.keyFacts ?? "–"} / ${week.usefulness.control.words ?? "–"} · ${week.usefulness.control.keyFacts ?? "–"} | |`,
  `| lessons the writer reads (learned from proved mistakes) | ${lessonsNow.active} (${lessonsNow.learnedFrom}) | |`,
  `| corrections printed | ${week.corrections} | ${before.corrections} |`,
  `| Claude calls per story written (runs kept) | ${week.runs.callsPerStory ?? "–"} | ${before.runs.callsPerStory ?? "–"} |`,
  "",
  week.recurring.length ? "**Recurring this week (two stories or more): the work to turn into a rule**" : "Nothing recurred in two stories or more this week.",
  "",
  ...week.recurring.map((r) => `- ${r.what}: ${r.stories} ${r.examples.length ? `— ${r.examples.join("; ")}` : ""}`),
  "",
].join("\n");
console.log(md);
if (!PRINT) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(quality, null, 2)}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
