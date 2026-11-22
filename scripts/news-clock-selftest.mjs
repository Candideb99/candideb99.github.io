#!/usr/bin/env node
/**
 * The news clock decides its known cases (scripts/news-clock.mjs, .github/workflows/news-clock.yml, 2026-11-20): the
 * news rounds' gap, the timed pieces once a day inside their window, the pause in both directions ("Pause everything"
 * stops the runs going, setPaused() in scripts/desk-lib.mjs; nothing missed while paused is written late; the morning
 * round's day-without-news counts from the end of a pause), and the workflows: one slot per clock line, and no
 * schedule of the newsroom's own, which would write a piece beside the clock's. GitHub holds one firing of a line at a
 * time and drops the slots that pass while it waits, 8 to 9 hours in November.
 *
 *   node scripts/news-clock-selftest.mjs [--script=<path>]
 *
 * `--script=` runs the offline news cases against another copy of the script: the morning fill-in it replaced
 * (`git show 8b07a69:scripts/news-fill.mjs`) fails them, refusing an afternoon round hours after the last.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAUSED_WORKFLOWS, setPaused } from "./desk-lib.mjs";
import { CLOCK_ACTOR, GAP, PIECES, WINDOW, decide, gapAt, lastStart, quietHours, readReports } from "./news-clock.mjs";
import { PACES, paceName } from "../pipeline/lib/pace.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.resolve(process.argv.find((a) => a.startsWith("--script="))?.slice(9) ?? path.join(ROOT, "scripts", "news-clock.mjs"));
const failures = [];
let cases = 0;
const check = async (name, fn) => {
  cases++;
  try {
    await fn();
  } catch (error) {
    failures.push(`${name}: ${String(error.message).split("\n")[0]}`);
  }
};
const scratchDirs = [];
const T = (iso) => Date.parse(iso);
/** Reports of every timed piece started a minute after its time on `day` and the day before: isolates the news rule. */
const piecesDone = (day) => {
  const out = {};
  for (const d of [day, new Date(T(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)]) {
    for (const p of PIECES) {
      const at = new Date(T(`${d}T${p.at}:00Z`) + 60_000).toISOString();
      out[`${at.replace(/[:.]/g, "-")}-${p.mode}.json`] = { mode: p.mode, startedAt: at };
    }
  }
  return out;
};

/** A scratch newsroom holding these run reports, where the script reads them (pipeline/runs). */
function scratch(reports) {
  const dir = mkdtempSync(path.join(tmpdir(), "news-clock-"));
  scratchDirs.push(dir);
  mkdirSync(path.join(dir, "pipeline", "runs"), { recursive: true });
  for (const [name, body] of Object.entries(reports)) {
    writeFileSync(path.join(dir, "pipeline", "runs", name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}
/** The script's verdict at `at`, offline (no GitHub), from the reports in `dir`: "news", a piece's mode, or "none". */
function verdict(dir, at) {
  const out = execFileSync(process.execPath, [SCRIPT, "--offline", `--at=${at}`], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "", CHECK_ONLY: "" },
  });
  const line = out.trim().split(/\r?\n/).pop() ?? "";
  if (line.startsWith("start a news round")) return "news";
  if (line.startsWith("no round")) return "none";
  return line.match(/^start ([a-z-]+):/)?.[1] ?? line;
}
const news = (startedAt) => ({ mode: "news", startedAt });

// 1. News, offline as the script runs: by day a round once 4.5 hours have passed, at any hour (the fill-in it replaced
// started nothing after 10:30 UTC, so the afternoon went without news whenever GitHub's line had fired at 11:30).
{
  const dir = scratch({ ...piecesDone("2026-11-19"), "2026-11-19T10-00-00Z-news.json": news("2026-11-19T10:00:00Z") });
  await check("by day, 4 hours after the last round: none", () => assert.equal(verdict(dir, "2026-11-19T14:00:00Z"), "none"));
  await check("by day, 4.6 hours after the last round: a round (the afternoon too)", () => assert.equal(verdict(dir, "2026-11-19T14:36:00Z"), "news"));
}
{
  const dir = scratch({ ...piecesDone("2026-11-19"), ...piecesDone("2026-11-20"), "2026-11-19T17-30-00Z-news.json": news("2026-11-19T17:30:00Z") });
  await check("19:20 is night: 1.8 hours, none", () => assert.equal(verdict(dir, "2026-11-19T19:20:00Z"), "none"));
  await check("at night, 5 hours after: none", () => assert.equal(verdict(dir, "2026-11-19T22:30:00Z"), "none"));
  await check("at night, 7.25 hours after: a round", () => assert.equal(verdict(dir, "2026-11-20T00:45:00Z"), "news"));
}
{
  const dir = scratch({ ...piecesDone("2026-11-20"), "2026-11-20T01-00-00Z-news.json": news("2026-11-20T01:00:00Z") });
  await check("04:30 is day: 3.5 hours after the night round, none", () => assert.equal(verdict(dir, "2026-11-20T04:30:00Z"), "none"));
  await check("05:40, 4.7 hours after: a round", () => assert.equal(verdict(dir, "2026-11-20T05:40:00Z"), "news"));
}
// 1b. The pace (pipeline/lib/pace.mjs; the owner, 2026-11-22: 15 stories a day spread through the day, his to switch on at
// launch): the gap by day is the pace saved in the checkout's site.json, the night's is the same, and a file that names
// no pace, or one that does not exist, is the standard one.
{
  const files = { ...piecesDone("2026-11-19"), ...piecesDone("2026-11-20"), "2026-11-19T10-00-00Z-news.json": news("2026-11-19T10:00:00Z") };
  const withPace = (pace) => { const dir = scratch(files); mkdirSync(path.join(dir, "src", "data"), { recursive: true }); writeFileSync(path.join(dir, "src", "data", "site.json"), JSON.stringify(pace === undefined ? { private: true } : { pace, private: true })); return dir; };
  await check("at the launch pace, 2.6 hours after the last round by day: a round; at the standard pace, none", () =>
    assert.deepEqual([verdict(withPace("launch"), "2026-11-19T12:36:00Z"), verdict(withPace("standard"), "2026-11-19T12:36:00Z"), verdict(withPace(undefined), "2026-11-19T12:36:00Z"), verdict(withPace("frantic"), "2026-11-19T12:36:00Z")], ["news", "none", "none", "none"]));
  await check("at the launch pace, 2.4 hours after: none yet", () => assert.equal(verdict(withPace("launch"), "2026-11-19T12:24:00Z"), "none"));
  const night = (pace) => { const dir = withPace(pace); writeFileSync(path.join(dir, "pipeline", "runs", "2026-11-19T17-30-00Z-news.json"), JSON.stringify(news("2026-11-19T17:30:00Z"))); return dir; };
  await check("the night's gap is the same at either pace: 5 hours after, none", () => assert.deepEqual([verdict(night("launch"), "2026-11-19T22:30:00Z"), verdict(night("standard"), "2026-11-19T22:30:00Z")], ["none", "none"]));
  await check("the launch pace is more news by day, capped; the standard one is November's", () => {
    assert.ok(PACES.launch.gapDay < PACES.standard.gapDay && PACES.launch.dailyCap === 15 && PACES.standard.gapDay === GAP.day && PACES.standard.dailyCap === 20);
    assert.deepEqual([paceName({ pace: "launch" }), paceName({ pace: "x" }), paceName({}), paceName(null)], ["launch", "standard", "standard", "standard"]);
    assert.equal(paceName(JSON.parse(readFileSync(path.join(ROOT, "src", "data", "site.json"), "utf8"))) in PACES, true);
  });
}
await check("no report at all, 02:00 UTC: a round", () => assert.equal(verdict(scratch({}), "2026-11-20T02:00:00Z"), "news"));
{
  const dir = scratch({ ...piecesDone("2026-11-19"), "2026-11-19T10-00-00Z-news.json": news("2026-11-19T10:00:00Z"), "2026-11-19T12-30-00Z-news.json": "{ damaged" });
  await check("a damaged report says nothing; an explainer is not a news round", () => assert.equal(verdict(dir, "2026-11-19T14:36:00Z"), "news"));
  await check("the reports are read with their modes", () => assert.ok(readReports(path.join(dir, "pipeline", "runs")).some((r) => r.mode === "explainer")));
}

// 2. The timed pieces (pure: runs from GitHub, reports from pipeline/runs). 2026-11-16 was a Monday, 2026-11-20 a Friday.
const dispatched = (mode, at, conclusion = "success", actor = CLOCK_ACTOR) => ({ id: at, status: "completed", conclusion, event: "workflow_dispatch", created_at: at, actor, title: `Newsroom: ${mode}` });
const pick = (now, runs, reports) => decide({ now: T(now), runs, reports }).mode;
await check("a piece goes at its time when no news round is due, the earliest first", () => {
  const reports = [news("2026-11-16T03:00:00Z")];
  assert.equal(pick("2026-11-16T06:30:00Z", [], reports), "explainer");
  assert.equal(pick("2026-11-16T06:30:00Z", [dispatched("explainer", "2026-11-16T05:50:00Z")], reports), "lessons-test");
});
await check("a news round that is due goes before a piece with time to spare", () => {
  assert.equal(pick("2026-11-16T06:30:00Z", [], [news("2026-11-16T00:30:00Z")]), "news");
});
await check("a piece whose window closes within two hours goes before a news round", () => {
  assert.equal(pick("2026-11-16T12:00:00Z", [], [news("2026-11-16T05:00:00Z"), { mode: "lessons-test", startedAt: "2026-11-16T06:20:00Z" }, { mode: "reports", startedAt: "2026-11-16T08:20:00Z" }]), "explainer");
});
await check("once a day: a piece started since its time is not started again", () => {
  const runs = [dispatched("explainer", "2026-11-17T05:50:00Z"), dispatched("reports", "2026-11-17T08:30:00Z")];
  assert.equal(pick("2026-11-17T09:00:00Z", runs, [news("2026-11-17T08:00:00Z")]), null);
  assert.equal(pick("2026-11-18T05:50:00Z", runs, [news("2026-11-18T03:00:00Z")]), "explainer");
});
await check("a failed piece is not tried again every hour (it would be paid for again)", () => {
  assert.equal(pick("2026-11-17T07:00:00Z", [dispatched("explainer", "2026-11-17T05:50:00Z", "failure")], [news("2026-11-17T05:00:00Z")]), null);
});
await check("a piece stopped by the pause is due again after Resume, inside its window", () => {
  assert.equal(pick("2026-11-17T07:00:00Z", [dispatched("explainer", "2026-11-17T05:50:00Z", "cancelled")], [news("2026-11-17T05:00:00Z")]), "explainer");
});
await check("nothing missed while paused is written late: past its window a piece waits for its next day", () => {
  // Resumed at 18:00 on a Friday after a day's pause: the explainer (05:41), the reports (08:17) and the paper (09:31)
  // had eight hours each and are closed; the analysis (14:07) and the week's review (15:37) are still today's.
  const reports = [news("2026-11-20T16:00:00Z")];
  assert.equal(pick("2026-11-20T18:00:00Z", [], reports), "analysis");
  assert.equal(pick("2026-11-20T19:10:00Z", [dispatched("analysis", "2026-11-20T18:05:00Z")], reports), "weekly");
  assert.equal(pick("2026-11-20T23:40:00Z", [dispatched("analysis", "2026-11-20T18:05:00Z")], [news("2026-11-20T21:00:00Z")]), null);
});
await check("a piece runs only on its days", () => {
  const done = (day, modes) => modes.map((mode) => ({ mode, startedAt: `${day}T${PIECES.find((p) => p.mode === mode).at}:30Z` }));
  // Thursday 16:00, the day's pieces done: no week's review, no paper.
  assert.equal(pick("2026-11-19T16:00:00Z", [], [news("2026-11-19T15:00:00Z"), ...done("2026-11-19", ["explainer", "reports", "analysis"])]), null);
  // Friday 16:00, the same done and the paper: the week's review.
  assert.equal(pick("2026-11-20T16:00:00Z", [], [news("2026-11-20T15:00:00Z"), ...done("2026-11-20", ["explainer", "reports", "paper", "analysis"])]), "weekly");
});
await check("yesterday's piece is still due past midnight inside its window", () => {
  assert.equal(pick("2026-11-17T21:40:00Z", [], [news("2026-11-17T19:00:00Z")]), "analysis");
  assert.equal(pick("2026-11-17T22:10:00Z", [], [news("2026-11-17T19:00:00Z")]), null);
});
await check("a run going or waiting: none", () => {
  const v = decide({ now: T("2026-11-19T15:00:00Z"), runs: [{ id: 42, status: "queued", event: "workflow_dispatch", created_at: "2026-11-19T14:59:00Z", actor: CLOCK_ACTOR, title: "Newsroom: news" }], reports: [] });
  assert.equal(v.start, false);
  assert.match(v.reason, /42 is queued/);
});
await check("which runs count as the last news round", () => {
  const runs = [
    { id: 4, status: "completed", conclusion: "success", event: "schedule", created_at: "2026-11-19T14:00:00Z", actor: "Candideb99", title: "Newsroom" },
    { id: 3, status: "completed", conclusion: "skipped", event: "workflow_dispatch", created_at: "2026-11-19T13:30:00Z", actor: CLOCK_ACTOR, title: "Newsroom: news" },
    { id: 2, status: "completed", conclusion: "success", event: "workflow_dispatch", created_at: "2026-11-19T11:00:00Z", actor: "Candideb99", title: "Newsroom: news" },
    { id: 1, status: "completed", conclusion: "success", event: "workflow_dispatch", created_at: "2026-11-19T09:00:00Z", actor: CLOCK_ACTOR, title: "Newsroom" },
  ];
  // the owner's dispatch counts, a skipped one and a schedule's do not, and the fill-in's unnamed dispatch was news
  assert.equal(lastStart("news", { runs }), T("2026-11-19T11:00:00Z"));
  assert.equal(lastStart("news", { runs: runs.slice(3) }), T("2026-11-19T09:00:00Z"));
  assert.equal(lastStart("explainer", { runs: runs.slice(3) }), null);
});
await check("day and night", () => {
  assert.equal(gapAt(T("2026-11-19T03:59:00Z")), GAP.night);
  assert.equal(gapAt(T("2026-11-19T04:00:00Z")), GAP.day);
  assert.equal(gapAt(T("2026-11-19T18:59:00Z")), GAP.day);
  assert.equal(gapAt(T("2026-11-19T19:00:00Z")), GAP.night);
  assert.ok(WINDOW >= 6, "a piece needs several firings to find the newsroom free");
});

// 3. The morning round's day without news counts from the end of a pause, which the clock's skipped runs mark.
await check("a resume after a day's pause is not a stall; a real stall still is", () => {
  const now = T("2026-11-22T12:00:00Z");
  const newestNewsAt = T("2026-11-20T11:00:00Z");
  const clockRuns = [
    { createdAt: "2026-11-22T10:50:00Z", conclusion: "success" },
    { createdAt: "2026-11-22T09:50:00Z", conclusion: "skipped" },
    { createdAt: "2026-11-21T09:50:00Z", conclusion: "skipped" },
  ];
  const resumed = quietHours({ now, newestNewsAt, clockRuns });
  assert.ok(resumed.hours < 3 && resumed.afterPause, `hours ${resumed.hours}`);
  const stalled = quietHours({ now, newestNewsAt, clockRuns: clockRuns.map((r) => ({ ...r, conclusion: "success" })) });
  assert.ok(stalled.hours > 48 && !stalled.afterPause, `hours ${stalled.hours}`);
  assert.equal(quietHours({ now, newestNewsAt: null, clockRuns: [] }).hours, Infinity);
});

// 4. "Pause everything" and "Resume" (scripts/desk-lib.mjs), against a stand-in for gh.
function fakeGh(answers = {}) {
  const calls = [];
  const run = async (command, args) => {
    calls.push(args.join(" "));
    for (const [pattern, answer] of Object.entries(answers)) if (args.join(" ").includes(pattern)) return answer;
    return { ok: true, out: "" };
  };
  return { calls, run };
}
const listing = (runs) => ({ ok: true, out: JSON.stringify(runs) });
await check("Pause sets the switch first, then stops every run still going, and says so", async () => {
  const gh = fakeGh({
    "--workflow newsroom.yml": listing([{ databaseId: 11, status: "in_progress" }, { databaseId: 10, status: "completed" }]),
    "--workflow news-clock.yml": listing([{ databaseId: 21, status: "queued" }]),
    "--workflow editor.yml": listing([]),
  });
  const said = await setPaused(true, { run: gh.run, repo: "o/r" });
  assert.match(gh.calls[0], /variable set KHAZENDAR_PAUSED --repo o\/r --body=1/);
  assert.deepEqual(gh.calls.filter((c) => c.startsWith("run cancel")), ["run cancel 11 --repo o/r", "run cancel 21 --repo o/r"]);
  assert.deepEqual(PAUSED_WORKFLOWS.filter((w) => !gh.calls.some((c) => c.includes(`--workflow ${w}`))), []);
  assert.match(said, /^Paused/);
  assert.match(said, /2 runs were still going and were stopped \(11, 21\)/);
});
await check("a pause GitHub refused stops nothing and says the cloud runs as before", async () => {
  const gh = fakeGh({ "variable set": { ok: false, out: "HTTP 401" } });
  const said = await setPaused(true, { run: gh.run, repo: "o/r" });
  assert.equal(gh.calls.length, 1);
  assert.match(said, /^Could not pause.*runs as before/);
});
await check("a pause that cannot read the runs going says one may still publish", async () => {
  const gh = fakeGh({ "--workflow newsroom.yml": { ok: false, out: "timeout" } });
  assert.match(await setPaused(true, { run: gh.run, repo: "o/r" }), /may still publish/);
});
await check("Resume clears the switch and switches the scheduled workflows on, stopping nothing", async () => {
  const gh = fakeGh();
  const said = await setPaused(false, { run: gh.run, repo: "o/r" });
  assert.match(gh.calls[0], /--body=0/);
  assert.deepEqual(gh.calls.slice(1), ["api -X PUT repos/o/r/actions/workflows/news-clock.yml/enable", "api -X PUT repos/o/r/actions/workflows/editor.yml/enable"]);
  assert.match(said, /^Resumed/);
});

// 5. The workflows.
const workflow = (file) => readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8");
const cronLines = (text) => [...text.matchAll(/^\s*-\s*cron:\s*"([^"]+)"/gm)].map((m) => m[1]);
await check("news-clock.yml: 24 one-slot lines, one for each hour", () => {
  const lines = cronLines(workflow("news-clock.yml"));
  const bad = lines.filter((c) => !/^\d{1,2} \d{1,2} \* \* \*$/.test(c));
  assert.deepEqual(bad, [], `lines with more than one slot a day: ${bad.join(", ")}`);
  assert.deepEqual(lines.map((c) => Number(c.split(" ")[1])).sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i));
});
await check("news-clock.yml: paused with the newsroom, starts the mode decided, and only a mode the clock knows", () => {
  const text = workflow("news-clock.yml");
  assert.match(text, /if: vars\.KHAZENDAR_PAUSED != '1'/);
  assert.match(text, /node scripts\/news-clock\.mjs/);
  assert.match(text, /MODE: \$\{\{ steps\.decide\.outputs\.mode \}\}/);
  assert.match(text, /gh workflow run newsroom\.yml [^\n]*-f mode="\$MODE"/);
  const allowed = text.match(/case "\$MODE" in ([a-z|-]+)\)/)?.[1].split("|") ?? [];
  assert.deepEqual([...allowed].sort(), ["news", ...PIECES.map((p) => p.mode)].sort());
});
await check("newsroom.yml: no schedule of its own, its runs named by mode, paused, every piece a mode it offers", () => {
  const text = workflow("newsroom.yml");
  assert.deepEqual(cronLines(text), [], "a scheduled line would write a piece beside the clock's");
  assert.doesNotMatch(text, /^\s*schedule:/m);
  assert.match(text, /^run-name: "Newsroom: \$\{\{ inputs\.mode \|\| 'news' \}\}"$/m);
  assert.match(text, /if: vars\.KHAZENDAR_PAUSED != '1'/);
  const options = text.match(/options: \[([^\]]+)\]/)?.[1].split(",").map((s) => s.trim()) ?? [];
  assert.deepEqual(PIECES.map((p) => p.mode).filter((m) => !options.includes(m)), []);
});
await check("editor.yml: paused with the newsroom", () => assert.match(workflow("editor.yml"), /vars\.KHAZENDAR_PAUSED != '1'/));

for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
if (failures.length) {
  console.log(`news clock: ${failures.length} of ${cases} cases FAILED\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`news clock: ${cases} cases pass`);
