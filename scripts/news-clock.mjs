#!/usr/bin/env node
/**
 * The news clock's decision (.github/workflows/news-clock.yml): which newsroom run, if any, starts now. The owner,
 * 2026-11-20, on another session's remark that GitHub starts scheduled runs late and skips some: "if yes then fix it at
 * the source"; then, the same night: "move the daily pieces onto the clock too, also did you account for the fact that
 * I might manually stop publishing by pausing the news room? so nothing goes wrong".
 *
 * GitHub fires a scheduled line hours after its time (4 to 6 hours in September, 8 to 9 by 20 November) and holds one
 * firing of a line at a time: the slots that pass while it waits are dropped. So newsroom.yml's three-hourly news line
 * gave three or four rounds a day at hours that moved with the delay (by November about 02:00, 11:30 and 20:00 UTC, so
 * nothing from 12:00 to 20:00, the Arab afternoon), the morning fill-in of 2026-10-25, whose lines asked for 02:13-09:43
 * on the measure of five hours' delay, fired after its own 10:30 window, and the timed pieces came out 8-9 hours after
 * their time (the morning explainer in the afternoon, the analysis near midnight in Riyadh). A line with one slot a day
 * fires once every day whatever the delay; each of the newsroom's one-slot lines did, every day from September to
 * November. So the clock is 24 one-slot lines, one an hour; the delay moves the firings, not their spacing, and each
 * firing asks this script, which reads the time itself. In order:
 *   1. nothing while a newsroom run is running or waiting: GitHub keeps one waiting run per concurrency group and
 *      cancels the older one, which could be the day's explainer;
 *   2. a piece whose time to start ends within URGENT_H hours;
 *   3. a news round, once the last one started GAP.day hours ago or more by day (DAY_HOURS, 04:00-19:00 UTC,
 *      07:00-22:00 in Riyadh), GAP.night at night;
 *   4. the earliest piece due (PIECES): from its time until WINDOW hours later, once, the days it runs.
 * A run counts as started whatever became of it (a failed one is not tried again every hour, which would pay for it
 * again), except one cancelled or skipped, which did nothing: "Pause everything" skips every run and cancels the ones
 * going (setPaused() in scripts/desk-lib.mjs), and after Resume what they were doing is due again, in its window. A
 * piece that cannot start in its window waits for its next day: nothing missed while paused is run late, so a resume
 * never brings a burst. The pieces themselves refuse to write without material (an explainer or an analysis wants three
 * news stories of the last 72 hours, the week's review five of the week; pipeline/run.mjs), so a piece due just after a
 * long pause ends without a model call rather than invent; the news round goes first unless a piece is urgent.
 * Simulated with GitHub's delay at 4, 9 and 12 hours (the session's sim2.mjs): 4.05 news rounds a day, as many as the
 * old line and the fill-in gave (4.1 measured), the longest daytime wait 5.5 hours against 7 measured, every piece on
 * every day it is due, 1 to 2.5 hours after its time.
 * Writes `start=1|0`, `mode` and `reason` to $GITHUB_OUTPUT and one line to the step summary. A check that cannot be
 * made starts nothing and fails the run, so it shows. `--check-only` (or CHECK_ONLY=true) also proves that the
 * workflow's token may start a run, without starting one. `--at=<ISO time>` and `--offline` (no GitHub) are for trying
 * it by hand. scripts/news-clock-selftest.mjs holds the rules, the workflows and the pause.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PACES, readPace } from "../pipeline/lib/pace.mjs";

const H = 3_600_000;
const DAY_MS = 24 * H;
/** The readers' day in UTC hours: 07:00-22:00 in Riyadh, 06:00-21:00 in Cairo. */
export const DAY_HOURS = [4, 19];
/**
 * Hours from the start of the last news round to the start of the next, by day and at night: as many rounds as before.
 * The day's gap is the pace's (pipeline/lib/pace.mjs): the owner's «launch» pace, saved in site.json, shortens it.
 */
export const GAP = { day: PACES.standard.gapDay, night: 7 };
/**
 * The newsroom's timed pieces: the mode, its UTC time, and the UTC weekdays it runs on (0 = Sunday; none = every day).
 * The times are the ones newsroom.yml's own lines asked for until 2026-11-20.
 */
export const PIECES = [
  { mode: "explainer", at: "05:41" },
  { mode: "lessons-test", at: "06:13", days: [1] },
  { mode: "reports", at: "08:17" },
  { mode: "paper", at: "09:31", days: [2, 5] },
  { mode: "idea", at: "10:29", days: [3] },
  { mode: "analysis", at: "14:07" },
  { mode: "weekly", at: "15:37", days: [5] },
];
/** Hours after its time that a piece may still start: about eight chances on the hourly clock. */
export const WINDOW = 8;
/** A piece whose window ends within this many hours goes before a news round. */
export const URGENT_H = 2;
/** The account a dispatch by the workflow's own token runs as: the runs this clock (and the fill-in before it) started. */
export const CLOCK_ACTOR = "github-actions[bot]";
const REPO = process.env.GITHUB_REPOSITORY || "Candideb99/candideb99.github.io";
const clock = (t) => new Date(t).toISOString().slice(11, 16);

/** The gap, in hours, that a news round starting at `at` (ms) must keep from the last one. */
export function gapAt(at, gap = GAP) {
  const hour = (((at % DAY_MS) + DAY_MS) % DAY_MS) / H;
  return hour >= DAY_HOURS[0] && hour < DAY_HOURS[1] ? gap.day : gap.night;
}

/** The mode a newsroom run's name carries ("Newsroom: explainer", newsroom.yml `run-name`), or null for an older run. */
export const runMode = (title) => String(title ?? "").match(/^Newsroom: ([a-z-]+)$/)?.[1] ?? null;

/**
 * When a run of `mode` last started (ms or null), from the run reports in pipeline/runs ({ mode, startedAt }) and the
 * newsroom's runs on GitHub ({ status, conclusion, event, created_at, actor, title }). A run cancelled or skipped did
 * nothing and does not count; a dispatch by the clock that names no mode is the fill-in's, which started only news.
 */
export function lastStart(mode, { runs = [], reports = [] } = {}) {
  let last = null;
  const seen = (at) => {
    if (Number.isFinite(at) && (last === null || at > last)) last = at;
  };
  for (const r of reports) if (r?.mode === mode) seen(Date.parse(r.startedAt));
  for (const r of runs) {
    if (r.event !== "workflow_dispatch" || r.conclusion === "cancelled" || r.conclusion === "skipped") continue;
    const named = runMode(r.title);
    if (named === mode || (named === null && mode === "news" && r.actor === CLOCK_ACTOR)) seen(Date.parse(r.created_at));
  }
  return last;
}

/** A piece's time whose window holds `now` (today's or yesterday's, on a day it runs), or null. */
export function slotOf(piece, now) {
  const [h, m] = piece.at.split(":").map(Number);
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  for (const day of [today, today - DAY_MS]) {
    if (piece.days && !piece.days.includes(new Date(day).getUTCDay())) continue;
    const slot = day + h * H + m * 60_000;
    if (slot <= now && now < slot + WINDOW * H) return slot;
  }
  return null;
}

/** The pieces due at `now`, earliest first: inside their window and not started since their time. */
export function duePieces(now, history) {
  const due = [];
  for (const piece of PIECES) {
    const slot = slotOf(piece, now);
    if (slot === null) continue;
    const last = lastStart(piece.mode, history);
    if (last !== null && last >= slot) continue;
    due.push({ mode: piece.mode, slot, closes: slot + WINDOW * H });
  }
  return due.sort((a, b) => a.slot - b.slot);
}

/**
 * Which run starts at `now` (ms): { start, mode, reason }. `runs` are the newsroom's on GitHub, `reports` pipeline/runs,
 * `gap` the hours kept between news rounds (the pace's by day).
 */
export function decide({ now, runs = [], reports = [], gap: gaps = GAP }) {
  const busy = runs.find((r) => r.status !== "completed");
  if (busy) return { start: false, mode: null, reason: `newsroom run ${busy.id} is ${String(busy.status).replace("_", " ")}` };
  const history = { runs, reports };
  const pieces = duePieces(now, history);
  const piece = (p, why) => ({ start: true, mode: p.mode, reason: `${p.mode}, due from ${clock(p.slot)} UTC, ${why}` });
  const urgent = pieces.find((p) => p.closes - now <= URGENT_H * H);
  if (urgent) return piece(urgent, `may start only until ${clock(urgent.closes)}`);
  const last = lastStart("news", history);
  const gap = gapAt(now, gaps);
  const since = last === null ? Infinity : (now - last) / H;
  if (since >= gap) {
    return { start: true, mode: "news", reason: `${clock(now)} UTC; the last news round started ${last === null ? "before any record" : `at ${clock(last)} UTC, ${since.toFixed(1)} hours ago`}` };
  }
  if (pieces.length) return piece(pieces[0], "not started since");
  return { start: false, mode: null, reason: `the last news round started at ${clock(last)} UTC, ${since.toFixed(1)} hours ago, under the ${gap} hours kept ${gap === gaps.day ? "by day" : "at night"}; no piece is due` };
}

/** The run reports the newsroom commits (it keeps the newest 24 of every mode): { mode, startedAt }. */
export function readReports(dir = path.join("pipeline", "runs")) {
  const out = [];
  for (const f of readdirSync(dir).filter((f) => /^\d{4}-.*\.json$/.test(f))) {
    try {
      const report = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      if (report?.mode && report.startedAt) out.push({ mode: report.mode, startedAt: report.startedAt });
    } catch {
      /* a damaged report says nothing about when a run began */
    }
  }
  return out;
}

/** When the newsroom was last seen paused: the newest run of the clock that GitHub skipped (its job reads the pause). */
export function lastPausedAt(clockRuns = []) {
  let at = null;
  for (const r of clockRuns) {
    const t = Date.parse(r.createdAt ?? r.created_at);
    if (r.conclusion === "skipped" && Number.isFinite(t) && (at === null || t > at)) at = t;
  }
  return at;
}

/**
 * Hours without a news story while the newsroom could publish, for the morning round's "day without news"
 * (scripts/editor-precheck.mjs): from the later of the newest story and the end of the last pause. Counted from the
 * story alone, a resume after a day's pause read as a stall and woke the paid editor to look for a fault that was not
 * there. { hours, afterPause }.
 */
export function quietHours({ now, newestNewsAt = null, clockRuns = [] }) {
  const paused = lastPausedAt(clockRuns);
  const from = Math.max(newestNewsAt ?? -Infinity, paused ?? -Infinity);
  return { hours: Number.isFinite(from) ? (now - from) / H : Infinity, afterPause: paused !== null && paused > (newestNewsAt ?? -Infinity) };
}

function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const now = arg("at") ? Date.parse(arg("at")) : Date.now();
  const offline = process.argv.includes("--offline");
  const checkOnly = process.argv.includes("--check-only") || process.env.CHECK_ONLY === "true";
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  const finish = (start, mode, reason) => {
    console.log(`${start ? `${checkOnly ? "would start" : "start"} ${mode === "news" ? "a news round" : mode}` : "no round"}: ${reason}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `start=${start ? 1 : 0}\nmode=${start ? mode : ""}\nreason=${reason}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const verdict = start ? `${checkOnly ? "Would start" : "Started"} ${mode === "news" ? "a news round" : mode}${checkOnly ? " (check only)" : ""}` : "No round";
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verdict}: ${reason}\n`);
    }
  };
  try {
    if (!Number.isFinite(now)) throw new Error(`--at=${arg("at")} is not a time`);
    const runs = offline
      ? []
      : JSON.parse(gh(["api", `repos/${REPO}/actions/workflows/newsroom.yml/runs?per_page=40`, "--jq", "[.workflow_runs[] | {id, status, conclusion, event, created_at, actor: .triggering_actor.login, title: .display_title}]"]));
    const verdict = decide({ now, runs, reports: readReports(), gap: { ...GAP, day: readPace().gapDay } });
    finish(verdict.start, verdict.mode, verdict.reason);
    if (checkOnly && !offline) {
      // Enabling a workflow that is already enabled changes nothing, and needs the same `actions: write` that starting a
      // run needs, so it proves the token without starting a round.
      gh(["api", "-X", "PUT", `repos/${REPO}/actions/workflows/news-clock.yml/enable`]);
      console.log("check only: the token may start a newsroom run");
    }
  } catch (error) {
    finish(false, null, `the check failed: ${String(error.message).split("\n")[0]}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
