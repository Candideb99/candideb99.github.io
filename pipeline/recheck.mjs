#!/usr/bin/env node
/**
 * The second look, run as a loop (2026-09-25). Every published news story, analysis, week's review and في العمق
 * piece is read again against its own sources once, a day or so after it went out, by the checker in
 * lib/factcheck.mjs; the stories published before this loop existed are worked through a few a run, the free
 * models' first (the 23 Sept audit found errors in ten of the seventeen they wrote that it read, against one of
 * ten of Claude's). What code confirms goes to the corrections editor (correct.mjs), which corrects the story with
 * a dated note as /methodology/ promises, or finds that it stands; everything else is listed in the run's report
 * and the ledger, for the weekly numbers (scripts/harvest.mjs) and for whoever reads them.
 *
 *   node pipeline/recheck.mjs                    stories 18 hours to 7 days old, then a few from the backlog
 *   node pipeline/recheck.mjs --limit=10 --backlog=6
 *   node pipeline/recheck.mjs --min-age=2 --limit=6 --backlog=2 --budget=12
 *                                                what every news round runs first: the rounds before it
 *   node pipeline/recheck.mjs --slugs=a,b        these stories only (add --redo for one already checked)
 *   node pipeline/recheck.mjs --dry-run          check and print; correct nothing, record nothing
 *   node pipeline/recheck.mjs --no-correct       check and record; list the confirmed errors, correct none
 *                                                (the cloud passes it when the owner reviews before publishing)
 *
 * Tokens: one Claude call per story checked and one per story corrected, and never twice for the same story: the
 * ledger, pipeline/state/factcheck.json, remembers every story read (the owner, 2026-09-23: no Claude tokens spent
 * twice on the same article). A story none of whose sources can be read again costs nothing.
 */
import "./lib/env.mjs";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { ARTICLES_DIR } from "./lib/article.mjs";
import { CHECKABLE_KINDS, CHECKER_VERSION, correctionIssue, loadSources, verifyStory } from "./lib/factcheck.mjs";
import { usage as llmUsage } from "./lib/llm.mjs";
import { fingerprint, hoursSince, isoNow, writeJsonAtomic } from "./lib/util.mjs";

const root = process.cwd();
const LEDGER = path.join(root, "pipeline", "state", "factcheck.json");
const RUNS = path.join(root, "pipeline", "runs");
const args = process.argv.slice(2);
const option = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const DRY = args.includes("--dry-run");
const NO_CORRECT = args.includes("--no-correct");
const REDO = args.includes("--redo");
const LIMIT = Math.max(0, Number(option("limit", 10)) || 0);
const BACKLOG = Math.max(0, Number(option("backlog", 6)) || 0);
const SLUGS = new Set(option("slugs", "").split(",").map((s) => s.trim()).filter(Boolean));
/**
 * A story is due this many hours after it went out. Every news round reads the stories of the rounds before it
 * (`--min-age=2`, 2026-09-25: the owner wants the newsroom to learn each round, and it learns only from what the
 * second look has proved); run by hand without it, a story waits a day.
 */
const MIN_AGE_H = Math.max(0, Number(option("min-age", 18)) || 0);
const MAX_AGE_H = 7 * 24;
/** No new check starts after this many minutes, so the job's own limit never cuts a correction short. */
const BUDGET_MS = (Number(option("budget", 28)) || 28) * 60 * 1000;
/** A check that failed (Claude down, a limit reached) is tried again in a later run, twice at most. */
const MAX_FAILURES = 2;
const started = Date.now();
const lines = [];
const log = (m) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`;
  lines.push(line);
  console.log(line);
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function stories() {
  const out = [];
  for (const file of (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md"))) {
    const raw = (await readFile(path.join(ARTICLES_DIR, file), "utf8")).replace(/\r\n/g, "\n");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) continue;
    let d;
    try {
      d = YAML.parse(m[1]);
    } catch {
      continue;
    }
    if (!d || d.draft) continue;
    out.push({ ...d, slug: String(d.slug ?? file.replace(/\.md$/, "")), kind: d.kind ?? "news", body: m[2].trim(), writer: String(d.models?.writer ?? "") });
  }
  return out;
}

/**
 * Which stories this run reads: the named ones; else the due ones, newest first, then the backlog, the free models' first
 * and the newest first. Newest first since 2026-09-25: oldest first had spent every round on the free models' archive
 * (all 33 stories of the first rounds), so the lessons learned nothing yet from the writer the newsroom has now.
 */
/**
 * A story the check before publication read clean (quality.precheck, lib/precheck.mjs) was read against these same
 * sources hours ago: reading it again is the same call twice (the owner, 2026-09-23: never twice for nothing). One in
 * three is read anyway, chosen by its slug, to catch what the first reading missed and pages corrected since; a story
 * that needed a repair is always read again.
 */
const auditSample = (s) => s.quality?.precheck !== "clean" || parseInt(fingerprint(`audit:${s.slug}`).slice(0, 8), 16) % 3 === 0;

function choose(all, ledger) {
  const open = (s) => REDO || !ledger.stories[s.slug] || (ledger.stories[s.slug].outcome === "failed" && (ledger.stories[s.slug].failures ?? 1) < MAX_FAILURES);
  if (SLUGS.size) return all.filter((s) => SLUGS.has(s.slug) && CHECKABLE_KINDS.has(s.kind) && open(s));
  const checkable = all.filter((s) => CHECKABLE_KINDS.has(s.kind) && (s.sources ?? []).length && open(s) && auditSample(s));
  const age = (s) => hoursSince(s.publishedAt);
  const due = checkable.filter((s) => age(s) >= MIN_AGE_H && age(s) <= MAX_AGE_H).sort((a, b) => age(a) - age(b)).slice(0, LIMIT);
  const free = (s) => !/claude/i.test(s.writer);
  const backlog = checkable
    .filter((s) => age(s) > MAX_AGE_H)
    .sort((a, b) => Number(free(b)) - Number(free(a)) || String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, BACKLOG);
  return [...due, ...backlog];
}

/** The ledger keeps every story it has read, so none is paid for twice; after 45 days an entry keeps its outcome and counts only. */
function trim(ledger) {
  for (const entry of Object.values(ledger.stories)) {
    if (hoursSince(entry.at) > 45 * 24) {
      delete entry.notFound;
      delete entry.weak;
      delete entry.listed;
      if (entry.confirmed) entry.confirmed = entry.confirmed.map((c) => ({ class: c.class, field: c.field }));
    }
  }
}

async function check(story, ledger, report, corrections) {
  // `lessons`: the version of the newsroom's lessons the story was written with, so the week's numbers can compare.
  const entry = { at: isoNow(), kind: story.kind, writer: story.writer.split("→").pop().trim() || null, lessons: story.models?.lessons ?? null, checker: CHECKER_VERSION, publishedAt: story.publishedAt };
  const sources = await loadSources(story, { log: (m) => log(`${story.slug}: ${m}`) });
  entry.sourcesRead = sources.filter((s) => s.text).length;
  entry.sourcesAll = sources.length;
  if (!entry.sourcesRead) {
    entry.outcome = "unverifiable";
    log(`${story.slug}: none of ${sources.length} source(s) could be read again; nothing spent`);
  } else {
    try {
      const result = await verifyStory({ story, sources, log });
      const confirmed = result.checks.filter((c) => c.status === "confirmed");
      // For a person, never corrected: the website's own reasoning contradicted, a figure whose page has changed,
      // sources that disagree with each other, and a contradiction whose quote code could not find.
      const listed = result.checks.filter((c) => ["listed", "drift", "conflict", "unverified"].includes(c.status));
      Object.assign(entry, {
        model: result.model,
        counts: result.counts,
        confirmed,
        listed: listed.map((c) => ({ status: c.status, class: c.class, field: c.field, sentence: c.sentence, quote: c.quote, source: c.sourceName, correction: c.correction })),
        notFound: result.checks.filter((c) => c.status === "not_found" || c.status === "no-evidence").map((c) => c.sentence).slice(0, 8),
        weak: result.checks.filter((c) => c.status === "weak").map((c) => ({ sentence: c.sentence, quote: c.quote })).slice(0, 5),
        outcome: confirmed.length ? "flagged" : listed.length ? "listed" : "clean",
      });
      log(`${story.slug}: ${result.counts.checked} of ${result.counts.sentences} sentences checked · ${result.counts.supported} supported · ${result.counts.notFound + result.counts.noEvidence} without a source · ${confirmed.length} confirmed error(s)${listed.length ? ` · ${listed.length} listed for a person` : ""}`);
      for (const c of confirmed) log(`  ✗ [${c.class}] ${c.sentence.slice(0, 110)} — ${c.correction?.slice(0, 160)}`);
      if (confirmed.length) corrections.push({ slug: story.slug, issue: correctionIssue(confirmed) });
    } catch (error) {
      const prior = ledger.stories[story.slug];
      entry.outcome = "failed";
      entry.failures = (prior?.outcome === "failed" ? prior.failures ?? 1 : 0) + 1;
      entry.error = String(error.message).split("\n")[0].slice(0, 200);
      log(`${story.slug}: the check failed (${entry.error})`);
    }
  }
  ledger.stories[story.slug] = entry;
  report.push({ slug: story.slug, title: story.title, kind: story.kind, outcome: entry.outcome, counts: entry.counts ?? null, confirmed: (entry.confirmed ?? []).map((c) => ({ class: c.class, sentence: c.sentence, quote: c.quote, source: c.sourceName, correction: c.correction })) });
}

/** The corrections editor, as its own process: it fetches the sources again and may find that a story stands. */
async function correct(items) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const list = path.join(os.tmpdir(), `khazendar-recheck-${stamp}.json`);
  const out = path.join(RUNS, `corrections-${stamp}.json`);
  await writeFile(list, JSON.stringify(items, null, 2));
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, "pipeline", "correct.mjs"), `--file=${list}`, `--report=${out}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => log(l)));
    child.stderr.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => log(l)));
    child.on("close", resolve);
  });
  await unlink(list).catch(() => {});
  const report = await readJson(out, null);
  if (!report) log(`the corrections editor wrote no report (exit ${code})`);
  return report?.items ?? [];
}

async function main() {
  // A ledger that exists but cannot be read is left for a person (a stress test, 2026-09-26): read as empty, it would
  // send every published story to be read and paid for again, and then be overwritten.
  const rawLedger = await readFile(LEDGER, "utf8").catch(() => null);
  if (rawLedger !== null) {
    try {
      JSON.parse(rawLedger);
    } catch {
      log("pipeline/state/factcheck.json cannot be read: the second look stops, and the file is left for a person to look at");
      process.exitCode = 1;
      return;
    }
  }
  const ledger = await readJson(LEDGER, { version: 1, stories: {} });
  const all = await stories();
  const chosen = choose(all, ledger);
  const open = all.filter((s) => CHECKABLE_KINDS.has(s.kind) && (s.sources ?? []).length && !ledger.stories[s.slug] && auditSample(s)).length;
  const prechecked = all.filter((s) => !auditSample(s)).length;
  log(`second look: ${chosen.length} to read now (${open} published pieces not yet read; ${prechecked} read clean before publication and left out of the audit sample)${DRY ? " — dry run" : ""}`);
  const report = [];
  const corrections = [];
  const queue = [...chosen];
  // Two at a time, as the newsroom calls Claude; no new check starts once the budget is spent.
  await Promise.all([0, 1].map(async () => {
    while (queue.length && Date.now() - started < BUDGET_MS) await check(queue.shift(), ledger, report, corrections);
  }));
  if (queue.length) log(`${queue.length} left for the next run (time budget spent)`);

  let corrected = 0;
  let editorCalls = 0;
  if (corrections.length && !DRY && !NO_CORRECT) {
    log(`corrections: ${corrections.length} stor${corrections.length === 1 ? "y" : "ies"} to the corrections editor`);
    const items = await correct(corrections);
    // One call each, in the corrections editor's own process (its calls are not in this process's count).
    editorCalls = items.filter((i) => i.model).length;
    for (const item of items) {
      const entry = ledger.stories[item.slug];
      if (!entry) continue;
      entry.outcome = { corrected: "corrected", stands: "stands", refused: "refused", failed: "correction-failed", missing: "correction-failed" }[item.outcome] ?? entry.outcome;
      if (item.note) entry.note = item.note;
      if (item.reason) entry.reason = String(item.reason).slice(0, 300);
      if (item.problems?.length) entry.problems = item.problems;
      const row = report.find((r) => r.slug === item.slug);
      if (row) row.outcome = entry.outcome;
      if (item.outcome === "corrected") corrected += 1;
    }
    // A correction is read once more against its sources (2026-09-26, the owner's go to a review that asked whether a
    // correction really resolved the problem). An error still standing in the sentences the correction wrote is
    // recorded and shown for a person, never corrected again by another guess; an error in a sentence the correction
    // did not touch is a new finding (the first reading missed it) and is corrected once, like any other.
    const fixed = items.filter((i) => i.outcome === "corrected");
    const again = [];
    const brief = (c) => ({ class: c.class, field: c.field, sentence: c.sentence, quote: c.quote, correction: c.correction });
    if (fixed.length) {
      const now = (await stories()).filter((s) => fixed.some((i) => i.slug === s.slug));
      for (const story of now) {
        const entry = ledger.stories[story.slug];
        const written = (fixed.find((i) => i.slug === story.slug)?.newSentences ?? []).map((s) => s.trim());
        const inWritten = (c) => written.some((s) => s === c.sentence.trim() || s.includes(c.sentence.trim().slice(0, 40)) || c.sentence.includes(s.slice(0, 40)));
        try {
          const sources = await loadSources(story, { log: (m) => log(`${story.slug}: ${m}`) });
          if (!sources.some((s) => s.text)) continue;
          const v = await verifyStory({ story, sources, log });
          const left = v.checks.filter((c) => c.status === "confirmed");
          const standing = left.filter(inWritten);
          const found = left.filter((c) => !inWritten(c));
          entry.verified = { at: isoNow(), resolved: !standing.length, remaining: standing.map(brief), newFound: found.map(brief) };
          log(`${story.slug}: the correction ${standing.length ? `left ${standing.length} error(s) in what it wrote: listed for a person` : "reads clean where it wrote"}${found.length ? `; ${found.length} other error(s) found, corrected once more` : ""}`);
          if (found.length) again.push({ slug: story.slug, issue: correctionIssue(found) });
        } catch (error) {
          entry.verified = { at: isoNow(), error: String(error.message).split("\n")[0].slice(0, 200) };
        }
      }
    }
    if (again.length) {
      for (const item of await correct(again)) {
        const entry = ledger.stories[item.slug];
        if (entry?.verified) entry.verified.secondCorrection = item.outcome;
        if (item.outcome === "corrected") corrected += 1;
      }
    }
  } else if (corrections.length) log(`${corrections.length} confirmed error(s) listed, not corrected (${DRY ? "dry run" : "--no-correct"})`);

  const summary = {
    mode: "recheck",
    startedAt: new Date(started).toISOString(),
    durationSec: Math.round((Date.now() - started) / 1000),
    read: report.length,
    corrected,
    report,
    llm: { ...llmUsage, correctionsEditorCalls: editorCalls },
    log: lines.slice(-200),
  };
  if (!DRY) {
    trim(ledger);
    await writeJsonAtomic(LEDGER, ledger);
    await mkdir(RUNS, { recursive: true });
    await writeFile(path.join(RUNS, `recheck-${summary.startedAt.replace(/[:.]/g, "-")}.json`), `${JSON.stringify(summary, null, 2)}\n`);
    const old = (await readdir(RUNS)).filter((f) => /^recheck-\d{4}-.*\.json$/.test(f)).sort();
    for (const stale of old.slice(0, Math.max(0, old.length - 30))) await unlink(path.join(RUNS, stale));
  }
  const rows = report.map((r) => `| ${r.kind} | ${(r.title ?? r.slug).replace(/\|/g, "/")} | ${r.counts ? `${r.counts.supported}/${r.counts.checked}` : ""} | ${r.confirmed.length || ""} | ${r.outcome} |`).join("\n");
  const md = `## خازندار second look (${report.length} read, ${corrected} corrected)\n\n| kind | story | supported / checked | confirmed errors | outcome |\n|---|---|---|---|---|\n${rows || "| | (nothing due) | | | |"}\n\nClaude calls: ${llmUsage.calls} for the checker (${llmUsage.failures} failed), ${editorCalls} for the corrections editor.\n`;
  console.log(`\n${md}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=${corrected}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
