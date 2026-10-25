#!/usr/bin/env node
/**
 * The morning fill-in's decision (.github/workflows/news-fill.yml). The owner, 2026-10-25, after a morning without
 * news: "add the extra morning news triggers with the 2.5-hour guard, and measure it over the next few days".
 *
 * GitHub fires each cron line about four times a day, three to five hours late, whatever the line asks for, and fires
 * separate lines independently. The newsroom's three-hourly line therefore left the same hole every morning: no news
 * story from about 05:30 to 12:00 UTC in the week to 2026-10-25. Each time one of the fill-in's own lines fires, a news
 * round starts only when all three hold:
 *   1. it is the morning, 06:00-10:30 UTC, whenever GitHub actually fired the line;
 *   2. the last news round started 2.5 hours ago or more (the newest news report in pipeline/runs);
 *   3. no newsroom run is running or waiting: GitHub keeps one waiting run per concurrency group and cancels the older
 *      one, which could be the day's explainer.
 * Writes `start=1|0` and `reason` to $GITHUB_OUTPUT and one line to the step summary. A check that cannot be made
 * starts nothing and fails the run, so it shows. `--check-only` (or CHECK_ONLY=true) also proves that the workflow's
 * token may start a run, without starting one. `--at=<ISO time>` and `--offline` (no GitHub) are for trying it by hand.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** The morning, in UTC hours: 09:00-13:30 in Riyadh. */
const WINDOW = [6, 10.5];
/** A round starts only this long after the last one started. */
const MIN_HOURS = 2.5;
const RUNS_DIR = path.join("pipeline", "runs");
const REPO = process.env.GITHUB_REPOSITORY || "Candideb99/candideb99.github.io";
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = arg("at") ? Date.parse(arg("at")) : Date.now();
const OFFLINE = process.argv.includes("--offline");
const CHECK_ONLY = process.argv.includes("--check-only") || process.env.CHECK_ONLY === "true";
const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
const clock = (t) => new Date(t).toISOString().slice(11, 16);

function finish(start, reason) {
  console.log(`${start ? (CHECK_ONLY ? "would start a news round" : "start a news round") : "no round"}: ${reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `start=${start ? 1 : 0}\nreason=${reason}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const verdict = start ? (CHECK_ONLY ? "Would start a news round (check only)" : "Started a news round") : "No round";
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verdict}: ${reason}\n`);
  }
}

/** When the newest news round began, from the reports the newsroom commits (it keeps the newest 24 of every mode). */
function lastNewsRound() {
  const files = readdirSync(RUNS_DIR).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort().reverse();
  for (const f of files) {
    let report;
    try {
      report = JSON.parse(readFileSync(path.join(RUNS_DIR, f), "utf8"));
    } catch {
      continue; // a damaged report says nothing about when the last round ran
    }
    if (report.mode === "news" && report.startedAt) return Date.parse(report.startedAt);
  }
  return null;
}

try {
  const hour = (now % 86_400_000) / 3_600_000;
  if (hour < WINDOW[0] || hour >= WINDOW[1]) {
    finish(false, `${clock(now)} UTC is outside the morning (06:00-10:30 UTC)`);
  } else {
    const last = lastNewsRound();
    const since = last === null ? Infinity : (now - last) / 36e5;
    const runs = OFFLINE ? [] : JSON.parse(gh(["run", "list", "--repo", REPO, "--workflow", "newsroom.yml", "--limit", "10", "--json", "databaseId,status"]));
    const busy = runs.filter((r) => r.status !== "completed");
    if (busy.length) finish(false, `newsroom run ${busy[0].databaseId} is ${busy[0].status.replace("_", " ")}`);
    else if (since < MIN_HOURS) finish(false, `the last news round started at ${clock(last)} UTC, ${since.toFixed(1)} hours ago, under ${MIN_HOURS}`);
    else finish(true, `${clock(now)} UTC; the last news round started ${last === null ? "more than a day ago" : `at ${clock(last)} UTC, ${since.toFixed(1)} hours ago`}`);
  }
  if (CHECK_ONLY && !OFFLINE) {
    // Enabling a workflow that is already enabled changes nothing, and needs the same `actions: write` that starting a
    // run needs, so it proves the token without starting a round.
    gh(["api", "-X", "PUT", `repos/${REPO}/actions/workflows/news-fill.yml/enable`]);
    console.log("check only: the token may start a newsroom run");
  }
} catch (error) {
  finish(false, `the check failed: ${String(error.message).split("\n")[0]}`);
  process.exit(1);
}
