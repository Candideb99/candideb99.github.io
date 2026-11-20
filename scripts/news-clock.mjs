#!/usr/bin/env node
/**
 * The news clock's decision (.github/workflows/news-clock.yml): whether a news round starts now. The owner, 2026-11-20,
 * on another session's remark that GitHub starts scheduled runs late and skips some: "if yes then fix it at the source".
 *
 * GitHub fires a scheduled line hours after its time (4 to 6 hours in September, 8 to 9 by 20 November) and holds one
 * firing of a line at a time: the slots that pass while it waits are dropped. So newsroom.yml's three-hourly news line
 * gave three or four rounds a day at hours that moved with the delay (by November about 02:00, 11:30 and 20:00 UTC, so
 * nothing from 12:00 to 20:00, the Arab afternoon), and the morning fill-in of 2026-10-25, whose lines asked for
 * 02:13-09:43 on the measure of five hours' delay, fired at 09:30-12:30, after its own 10:30 window or just before the
 * line's 11:30 round. A line with one slot a day fires once every day whatever the delay; each of the newsroom's
 * one-slot lines did, every day from September to November. So the clock is 24 one-slot lines, one an hour, and each
 * firing asks this script. A news round (newsroom.yml, mode news) starts only when both hold:
 *   1. no newsroom run is running or waiting: GitHub keeps one waiting run per concurrency group and cancels the older
 *      one, which could be the day's explainer;
 *   2. the last news round started GAP.day hours ago or more by day (DAY_HOURS, 04:00-19:00 UTC, 07:00-22:00 in Riyadh),
 *      GAP.night at night. The last round is the later of the newest news report in pipeline/runs and the newest round
 *      this clock started, whatever became of it, so a round that died before committing its report is not started
 *      again every hour.
 * About four or five rounds a day, as many as the old line gave, three in four of them by day (simulated with GitHub's
 * delay at 4, 6, 9 and 12 hours: 4.3 a day each time, the longest daytime wait about 5 hours against 8 to 9 measured).
 * Writes `start=1|0` and `reason` to $GITHUB_OUTPUT and one line to the step summary. A check that cannot be made starts
 * nothing and fails the run, so it shows. `--check-only` (or CHECK_ONLY=true) also proves that the workflow's token may
 * start a run, without starting one. `--at=<ISO time>` and `--offline` (no GitHub) are for trying it by hand.
 * scripts/news-clock-selftest.mjs holds the rule and the one-slot lines.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const H = 3_600_000;
const DAY_MS = 24 * H;
/** The readers' day in UTC hours: 07:00-22:00 in Riyadh, 06:00-21:00 in Cairo. */
export const DAY_HOURS = [4, 19];
/** Hours from the start of the last news round to the start of the next, by day and at night. */
export const GAP = { day: 4, night: 7 };
/** The account a dispatch by the workflow's own token runs as: the rounds this clock (and the fill-in before it) started. */
export const CLOCK_ACTOR = "github-actions[bot]";
const REPO = process.env.GITHUB_REPOSITORY || "Candideb99/candideb99.github.io";
const clock = (t) => new Date(t).toISOString().slice(11, 16);

/** The gap, in hours, that a round starting at `at` (ms) must keep from the last one. */
export function gapAt(at) {
  const hour = (((at % DAY_MS) + DAY_MS) % DAY_MS) / H;
  return hour >= DAY_HOURS[0] && hour < DAY_HOURS[1] ? GAP.day : GAP.night;
}

/** Whether a news round starts at `now` (ms): `last` is when the last one started (ms or null), `busy` a run not finished. */
export function decide({ now, last, busy = null }) {
  if (busy) return { start: false, reason: `newsroom run ${busy.id} is ${String(busy.status).replace("_", " ")}` };
  const gap = gapAt(now);
  const since = last === null ? Infinity : (now - last) / H;
  if (since < gap) {
    return { start: false, reason: `the last news round started at ${clock(last)} UTC, ${since.toFixed(1)} hours ago, under the ${gap} hours kept ${gap === GAP.day ? "by day" : "at night"}` };
  }
  return { start: true, reason: `${clock(now)} UTC; the last news round started ${last === null ? "before any report on record" : `at ${clock(last)} UTC, ${since.toFixed(1)} hours ago`}` };
}

/** When the newest news round began, from the reports the newsroom commits (it keeps the newest 24 of every mode). */
export function lastReportedRound(dir = path.join("pipeline", "runs")) {
  let newest = null;
  for (const f of readdirSync(dir).filter((f) => /^\d{4}-.*\.json$/.test(f))) {
    let report;
    try {
      report = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue; // a damaged report says nothing about when the last round ran
    }
    const at = report?.mode === "news" ? Date.parse(report.startedAt) : NaN;
    if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

/**
 * From the newsroom's recent runs ({ id, status, event, created_at, actor }): a run still going or waiting, and when this
 * clock last started a round. A run by hand or by a schedule is never counted as the clock's.
 */
export function readRuns(runs) {
  const busy = runs.find((r) => r.status !== "completed") ?? null;
  let started = null;
  for (const r of runs) {
    const at = Date.parse(r.created_at);
    if (r.event === "workflow_dispatch" && r.actor === CLOCK_ACTOR && Number.isFinite(at) && (started === null || at > started)) started = at;
  }
  return { busy, started };
}

function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const now = arg("at") ? Date.parse(arg("at")) : Date.now();
  const offline = process.argv.includes("--offline");
  const checkOnly = process.argv.includes("--check-only") || process.env.CHECK_ONLY === "true";
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  const finish = (start, reason) => {
    console.log(`${start ? (checkOnly ? "would start a news round" : "start a news round") : "no round"}: ${reason}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `start=${start ? 1 : 0}\nreason=${reason}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const verdict = start ? (checkOnly ? "Would start a news round (check only)" : "Started a news round") : "No round";
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verdict}: ${reason}\n`);
    }
  };
  try {
    if (!Number.isFinite(now)) throw new Error(`--at=${arg("at")} is not a time`);
    const runs = offline
      ? []
      : JSON.parse(gh(["api", `repos/${REPO}/actions/workflows/newsroom.yml/runs?per_page=30`, "--jq", "[.workflow_runs[] | {id, status, event, created_at, actor: .triggering_actor.login}]"]));
    const { busy, started } = readRuns(runs);
    const known = [lastReportedRound(), started].filter((t) => t !== null);
    const verdict = decide({ now, last: known.length ? Math.max(...known) : null, busy });
    finish(verdict.start, verdict.reason);
    if (checkOnly && !offline) {
      // Enabling a workflow that is already enabled changes nothing, and needs the same `actions: write` that starting a
      // run needs, so it proves the token without starting a round.
      gh(["api", "-X", "PUT", `repos/${REPO}/actions/workflows/news-clock.yml/enable`]);
      console.log("check only: the token may start a newsroom run");
    }
  } catch (error) {
    finish(false, `the check failed: ${String(error.message).split("\n")[0]}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
