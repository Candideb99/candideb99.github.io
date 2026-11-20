#!/usr/bin/env node
/**
 * The news clock decides its known cases (scripts/news-clock.mjs, .github/workflows/news-clock.yml, 2026-11-20), and
 * every scheduled line of the newsroom keeps one slot a day: GitHub holds one firing of a line at a time and drops the
 * slots that pass while it waits, 8 to 9 hours in November, so a line with several slots a day loses most of them.
 *
 *   node scripts/news-clock-selftest.mjs [--script=<path>]
 *
 * `--script=` runs the decision cases against another copy of the script: the morning fill-in it replaced
 * (`git show 8b07a69:scripts/news-fill.mjs`) fails them, refusing an afternoon round 4.5 hours after the last.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLOCK_ACTOR, GAP, decide, gapAt, lastReportedRound, readRuns } from "./news-clock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.resolve(process.argv.find((a) => a.startsWith("--script="))?.slice(9) ?? path.join(ROOT, "scripts", "news-clock.mjs"));
const failures = [];
let cases = 0;
const check = (name, fn) => {
  cases++;
  try {
    fn();
  } catch (error) {
    failures.push(`${name}: ${String(error.message).split("\n")[0]}`);
  }
};
const scratchDirs = [];

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
/** The script's verdict at `at`, offline (no GitHub), from the reports in `dir`: "start" or "no round". */
function verdict(dir, at) {
  const out = execFileSync(process.execPath, [SCRIPT, "--offline", `--at=${at}`], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "", CHECK_ONLY: "" },
  });
  const line = out.trim().split(/\r?\n/).pop() ?? "";
  return line.startsWith("start a news round") ? "start" : line.startsWith("no round") ? "no round" : line;
}
const news = (startedAt) => ({ mode: "news", startedAt });

// 1. By day a round starts once four hours have passed, at any hour of the day: the fill-in it replaced started
// nothing after 10:30 UTC, so the afternoon went without news whenever GitHub's line had fired at 11:30.
{
  const dir = scratch({ "2026-11-19T10-00-00Z-news.json": news("2026-11-19T10:00:00Z") });
  check("by day, 3.5 hours after the last round: none", () => assert.equal(verdict(dir, "2026-11-19T13:30:00Z"), "no round"));
  check("by day, 4.5 hours after the last round: a round (the afternoon too)", () => assert.equal(verdict(dir, "2026-11-19T14:30:00Z"), "start"));
}
// 2. At night (19:00-04:00 UTC) the gap is seven hours.
{
  const dir = scratch({ "2026-11-19T17-30-00Z-news.json": news("2026-11-19T17:30:00Z") });
  check("19:20 is night: 1.8 hours, none", () => assert.equal(verdict(dir, "2026-11-19T19:20:00Z"), "no round"));
  check("at night, 3.5 hours after: none", () => assert.equal(verdict(dir, "2026-11-19T21:00:00Z"), "no round"));
  check("at night, 7.25 hours after: a round", () => assert.equal(verdict(dir, "2026-11-20T00:45:00Z"), "start"));
}
// 3. The morning after a night round: four hours again.
{
  const dir = scratch({ "2026-11-20T01-00-00Z-news.json": news("2026-11-20T01:00:00Z") });
  check("04:30 is day: 3.5 hours after the night round, none", () => assert.equal(verdict(dir, "2026-11-20T04:30:00Z"), "no round"));
  check("05:10, 4.2 hours after: a round", () => assert.equal(verdict(dir, "2026-11-20T05:10:00Z"), "start"));
}
// 4. No news report on record: a round, whatever the hour.
check("no report at all, 02:00 UTC: a round", () => assert.equal(verdict(scratch({}), "2026-11-20T02:00:00Z"), "start"));
// 5. Only news reports count; a damaged one says nothing.
{
  const dir = scratch({
    "2026-11-19T10-00-00Z-news.json": news("2026-11-19T10:00:00Z"),
    "2026-11-19T12-00-00Z-explainer.json": { mode: "explainer", startedAt: "2026-11-19T12:00:00Z" },
    "2026-11-19T12-30-00Z-news.json": "{ damaged",
  });
  check("an explainer is not a news round", () => assert.equal(verdict(dir, "2026-11-19T14:30:00Z"), "start"));
  check("the newest news report is read", () => assert.equal(lastReportedRound(path.join(dir, "pipeline", "runs")), Date.parse("2026-11-19T10:00:00Z")));
}

// 6. A newsroom run going or waiting stops a round: GitHub keeps one waiting run per group and cancels the older one.
check("a run waiting: none", () => {
  const v = decide({ now: Date.parse("2026-11-19T15:00:00Z"), last: Date.parse("2026-11-19T08:00:00Z"), busy: { id: 42, status: "queued" } });
  assert.equal(v.start, false);
  assert.match(v.reason, /42 is queued/);
});
// 7. The clock's own last dispatch counts as a round, whatever became of it (a run that died before committing its report
// is not started again every hour); a run by hand or by a schedule does not.
check("the clock's last dispatch counts, the owner's and a schedule's do not", () => {
  const runs = [
    { id: 3, status: "completed", event: "schedule", created_at: "2026-11-19T13:30:00Z", actor: "Candideb99" },
    { id: 2, status: "completed", event: "workflow_dispatch", created_at: "2026-11-19T13:00:00Z", actor: "Candideb99" },
    { id: 1, status: "completed", event: "workflow_dispatch", created_at: "2026-11-19T12:00:00Z", actor: CLOCK_ACTOR },
  ];
  const { busy, started } = readRuns(runs);
  assert.equal(busy, null);
  assert.equal(started, Date.parse("2026-11-19T12:00:00Z"));
  assert.equal(decide({ now: Date.parse("2026-11-19T14:30:00Z"), last: started }).start, false);
  assert.equal(decide({ now: Date.parse("2026-11-19T16:05:00Z"), last: started }).start, true);
});
check("a run still going is found among finished ones", () => {
  const { busy } = readRuns([
    { id: 9, status: "completed", event: "schedule", created_at: "2026-11-19T13:30:00Z", actor: "Candideb99" },
    { id: 8, status: "in_progress", event: "workflow_dispatch", created_at: "2026-11-19T13:00:00Z", actor: CLOCK_ACTOR },
  ]);
  assert.equal(busy?.id, 8);
});
check("day and night", () => {
  assert.equal(gapAt(Date.parse("2026-11-19T03:59:00Z")), GAP.night);
  assert.equal(gapAt(Date.parse("2026-11-19T04:00:00Z")), GAP.day);
  assert.equal(gapAt(Date.parse("2026-11-19T18:59:00Z")), GAP.day);
  assert.equal(gapAt(Date.parse("2026-11-19T19:00:00Z")), GAP.night);
});

// 8. Every scheduled line keeps one slot a day: a single minute and a single hour. A line asking for several slots gets
// one firing per wait (the three-hourly news line gave three or four a day, the fill-in's four-slot lines one each).
const cronLines = (file) => [...readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8").matchAll(/^\s*-\s*cron:\s*"([^"]+)"/gm)].map((m) => m[1]);
const oneSlot = (cron) => /^\d{1,2} \d{1,2} /.test(cron);
check("news-clock.yml: 24 one-slot lines, one for each hour", () => {
  const lines = cronLines("news-clock.yml");
  const bad = lines.filter((c) => !/^\d{1,2} \d{1,2} \* \* \*$/.test(c));
  assert.deepEqual(bad, [], `lines with more than one slot a day: ${bad.join(", ")}`);
  assert.deepEqual(lines.map((c) => Number(c.split(" ")[1])).sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i));
});
check("news-clock.yml: paused with the newsroom, starts a news round", () => {
  const text = readFileSync(path.join(ROOT, ".github", "workflows", "news-clock.yml"), "utf8");
  assert.match(text, /if: vars\.KHAZENDAR_PAUSED != '1'/);
  assert.match(text, /node scripts\/news-clock\.mjs/);
  assert.match(text, /gh workflow run newsroom\.yml [^\n]*-f mode=news/);
});
check("newsroom.yml: every line one slot a day, each naming its own mode (the news comes from the clock)", () => {
  const text = readFileSync(path.join(ROOT, ".github", "workflows", "newsroom.yml"), "utf8");
  const lines = cronLines("newsroom.yml");
  assert.ok(lines.length > 0, "no schedule found");
  const several = lines.filter((c) => !oneSlot(c));
  assert.deepEqual(several, [], `lines with more than one slot a day: ${several.join(", ")}`);
  const unnamed = lines.filter((c) => !text.includes(`"$SCHEDULE" = "${c}"`));
  assert.deepEqual(unnamed, [], `lines that fall through to a news round: ${unnamed.join(", ")}`);
});

for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
if (failures.length) {
  console.log(`news clock: ${failures.length} of ${cases} cases FAILED\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`news clock: ${cases} cases pass`);
