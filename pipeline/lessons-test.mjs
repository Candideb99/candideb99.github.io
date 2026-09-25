#!/usr/bin/env node
/**
 * The weekly decision on the newsroom's lessons (2026-09-25, the owner: "how can we make sure that this self-improving
 * loop really gets better?"; his yes to a weekly keep-or-revert test). It decides from evidence that accumulates, not
 * from one week: the evidence pairs run.mjs records as it writes (two stories a day also written privately with the
 * reference lessons, pipeline/state/pairs.json), counted since the kept version was set, with the rule and thresholds
 * of lib/evidence.mjs fixed in advance:
 *   promote (the live lessons become the kept version) when the evidence that they make fewer proved errors reaches 20
 *     and the text the writer reads now has held up in six pairs of its own or more;
 *   revert (the kept version comes back) when the evidence of more errors reaches 10 over all pairs since the kept
 *     version, or 20 in the newest text's own pairs, or the evidence of stories that say less reaches 20;
 *   otherwise keep the live lessons as "unproven", and the evidence carries into next week.
 * Before any decision the fact-check is tested itself (the canary): up to three errors of different kinds are planted
 * by code in a published story it had found clean, and it must find them without flagging the rest. If it found 7 or
 * fewer of the last 12, or raised 4 false alarms in the last three, nothing is promoted or learned until it is trusted
 * again; a revert still acts.
 * The same report answers the owner's question in full: do the lessons beat no lessons at all?
 *
 *   node pipeline/lessons-test.mjs [--dry-run]
 *
 * Tokens: one call a week (the canary); the pairs are paid for as the news is written.
 */
import "./lib/env.mjs";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { ARTICLES_DIR } from "./lib/article.mjs";
import { activeLessons, lessonsBlock, lessonsHash, loadLessons, promote, revert, saveLessons } from "./lib/lessons.mjs";
import { JUDGE_VERSION, canary, plantErrors, sourcesOf } from "./lib/paired.mjs";
import { CHECKER_VERSION } from "./lib/factcheck.mjs";
import { GUARD_AT, HARM_AT, PROMOTE_AT, canaryAlarm, decide, tally } from "./lib/evidence.mjs";
import { usage as llmUsage } from "./lib/llm.mjs";

const DRY = process.argv.includes("--dry-run");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** The newest of Claude's published news stories whose sources can be read again: the canary's host. */
async function canaryHost() {
  const out = [];
  for (const file of (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md"))) {
    const raw = (await readFile(path.join(ARTICLES_DIR, file), "utf8")).replace(/\r\n/g, "\n");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) continue;
    try {
      const d = YAML.parse(m[1]);
      if (d && !d.draft && (d.kind ?? "news") === "news" && /claude/.test(String(d.models?.writer ?? ""))) out.push({ ...d, body: m[2].trim() });
    } catch {
      /* not this one */
    }
  }
  out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  // A story the second look found clean first: its untouched sentences are then known good, so a contradiction the
  // fact-check finds among them is a false alarm. Then the most errors to plant: three give the canary its full weight.
  const ledger = (await readJson(path.join(process.cwd(), "pipeline", "state", "factcheck.json"), { stories: {} })).stories;
  const clean = (a) => (ledger[a.slug]?.outcome === "clean" ? 1 : 0);
  const ranked = [...out.slice(0, 30)].sort((a, b) => clean(b) - clean(a) || plantErrors(b).planted.length - plantErrors(a).planted.length);
  for (const article of ranked) {
    const sources = await sourcesOf(article);
    if (sources.check.length) return { article, sources, clean: clean(article) === 1 };
  }
  return null;
}

async function main() {
  const state = await loadLessons();
  if (state.damaged) {
    log(`${state.damaged} cannot be read: no decision this week, and the file is left for a person to look at`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "published=0\ndecision=none\n");
    return;
  }
  const pairs = (await readJson(path.join(process.cwd(), "pipeline", "state", "pairs.json"), { pairs: [] })).pairs;

  // 1. The canary: is the fact-check still finding what it should?
  state.canary ??= [];
  const host = await canaryHost();
  if (host) {
    try {
      const c = await canary({ draft: host.article, checkSources: host.sources.check, log: () => {} });
      if (c) {
        state.canary = [...state.canary, { at: new Date().toISOString(), checker: CHECKER_VERSION, slug: host.article.slug, knownClean: host.clean, ...c }].slice(-52);
        log(`canary: the fact-check found ${c.found} of ${c.seeded} planted errors (${c.kinds.join(", ")}) in "${host.article.title}"; ${c.falseFlags} contradiction(s) among the untouched sentences${host.clean ? " of a story it had found clean" : ""}`);
      }
    } catch (error) {
      log(`canary failed: ${String(error.message).split("\n")[0].slice(0, 160)}`);
    }
  }
  const alarm = canaryAlarm(state.canary.filter((c) => c.checker === CHECKER_VERSION));

  // 2. The evidence since the kept version, judged by this checker only.
  const since = state.kept?.at ?? null;
  const keptVersion = state.kept?.version ?? 0;
  const sinceKept = pairs.filter((p) => (p.keptVersion ?? 0) === keptVersion);
  const vsKept = tally(sinceKept, "kept", { checker: JUDGE_VERSION, since });
  // The text the writer reads now, on its own pairs: the pooled record proves the process, not the newest version.
  const nowHash = lessonsHash(lessonsBlock(state));
  const own = tally(sinceKept.filter((p) => p.lessonsHash === nowHash), "kept", { checker: JUDGE_VERSION, since });
  const vsNone = tally(pairs, "none", { checker: JUDGE_VERSION });
  const { decision, reason } = decide(vsKept, own, { frozen: alarm.alarm });
  const live = state.version;
  log(`live lessons v${live} against the kept v${keptVersion}: ${decision} — ${reason}`);
  log(`lessons against none so far: better in ${vsNone.better} pairs, worse in ${vsNone.worse}, tied in ${vsNone.tied} (evidence ×${vsNone.e.toFixed(1)} of ${PROMOTE_AT}; harm ×${vsNone.harm.toFixed(1)})`);

  const test = { at: new Date().toISOString(), checker: CHECKER_VERSION, live, liveHash: nowHash, kept: keptVersion, decision, reason, vsKept, own, vsNone, canary: alarm, calls: llmUsage.calls };
  if (!DRY) {
    if (decision === "promote") promote(state);
    if (decision === "revert") revert(state);
    state.tests = [...(state.tests ?? []), test].slice(-104);
    await saveLessons(state);
  }
  await report(test, activeLessons(state).length);
}

async function report(t, active) {
  const verdicts = { promote: "promoted: the live lessons are now the kept version", revert: "reverted to the kept version", keep: "kept, unproven", frozen: "frozen: the fact-check itself is in doubt" };
  const md = `## خازندار lessons: the weekly decision — ${verdicts[t.decision] ?? t.decision}

${t.reason}.

| question | better | worse | tied | evidence (decides at) |
|---|---|---|---|---|
| live v${t.live} against kept v${t.kept} | ${t.vsKept.better} | ${t.vsKept.worse} | ${t.vsKept.tied} | ×${t.vsKept.e.toFixed(1)} (${PROMOTE_AT}); harm ×${t.vsKept.harm.toFixed(1)} (${HARM_AT}); says less ×${t.vsKept.saysLess.toFixed(1)} (${GUARD_AT}) |
| the lessons against none | ${t.vsNone.better} | ${t.vsNone.worse} | ${t.vsNone.tied} | ×${t.vsNone.e.toFixed(1)} (${PROMOTE_AT} proves they help); harm ×${t.vsNone.harm.toFixed(1)} |

The fact-check's canary: ${t.canary.found} of the last ${t.canary.seeded} planted errors found; ${t.canary.falseFlags} false alarm(s) in the last three${t.canary.alarm ? " — ALARM: nothing is promoted or learned until it is trusted again" : ""}. ${active} lessons active. Claude calls this week for the decision: ${t.calls}.
`;
  console.log(`\n${md}`);
  if (!DRY) {
    const runs = path.join(process.cwd(), "pipeline", "runs");
    await mkdir(runs, { recursive: true });
    await writeFile(path.join(runs, `lessons-test-${t.at.replace(/[:.]/g, "-")}.json`), `${JSON.stringify(t, null, 2)}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=0\ndecision=${t.decision}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
