#!/usr/bin/env node
/**
 * How evenly the news reaches readers, day by day, to measure the morning fill-in (.github/workflows/news-fill.yml,
 * from 2026-10-25; the owner: "measure it over the next few days"). For each UTC day: the news rounds by what started
 * them (the newsroom's three-hourly line, the fill-in, a person), how often the fill-in fired, the news stories
 * published, the longest wait between news stories, and the longest wait inside the morning, 05:00-12:00 UTC
 * (08:00-15:00 in Riyadh), where the hole was. Then the days before the fill-in against the days after, and each
 * round the fill-in started with the stories it published.
 *
 * Reads the published stories (content/articles), the newsroom's own commits (a round commits once, naming its mode)
 * and the runs on GitHub (`gh api`). Pull first, or the newest rounds are missing. `--days=14` sets how far back.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO = "Candideb99/candideb99.github.io";
const H = 3_600_000;
const DAY = 24 * H;
const MORNING = [5, 12];
const days = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 14);
const now = Date.now();
const today = Math.floor(now / DAY) * DAY;
const from = today - (days - 1) * DAY;
const iso = (t) => new Date(t).toISOString();
const clock = (t) => iso(t).slice(11, 16);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

// The news stories readers saw, by when they were published.
const ARTICLES = path.join("content", "articles");
const stories = [];
for (const f of readdirSync(ARTICLES).filter((f) => f.endsWith(".md"))) {
  const head = readFileSync(path.join(ARTICLES, f), "utf8").slice(0, 4000);
  const at = Date.parse(head.match(/^publishedAt:\s*"?([^"\n]+)"?\s*$/m)?.[1] ?? "");
  if (/^kind:\s*news\s*$/m.test(head) && !/^draft:\s*true\s*$/m.test(head) && at >= from - DAY) stories.push(at);
}
stories.sort((a, b) => a - b);

// The runs on GitHub, and the mode each newsroom run had, from the commit it made.
function runsOf(workflow) {
  const query = `repos/${REPO}/actions/workflows/${workflow}/runs?per_page=100&created=${encodeURIComponent(`>=${iso(from - DAY).slice(0, 10)}`)}`;
  const jq = '.workflow_runs[] | [.id, .event, .created_at, .updated_at, (.conclusion // ""), (.triggering_actor.login // "")] | @tsv';
  let out = "";
  try {
    out = execFileSync("gh", ["api", "--paginate", query, "--jq", jq], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (!/404|Not Found/.test(String(error.stderr ?? error.message))) throw error;
  }
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const [id, event, created, updated, conclusion, actor] = line.split("\t");
    return { id, event, at: Date.parse(created), end: Date.parse(updated), conclusion, actor };
  }).sort((a, b) => a.at - b.at);
}
const commits = execFileSync("git", ["log", "--author=khazendar-newsroom", `--since=${iso(from - 2 * DAY)}`, "--format=%cI|%s"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((l) => ({ at: Date.parse(l.slice(0, l.indexOf("|"))), subject: l.slice(l.indexOf("|") + 1) }));
const modeOf = (subject) => subject.match(/new (\w+) item/)?.[1] ?? subject.match(/after an? (\w+) run/)?.[1] ?? "other";
const newsroom = runsOf("newsroom.yml").map((r) => {
  const commit = commits.find((c) => c.at >= r.at && c.at <= r.end + 2 * 60_000);
  const by = r.event === "schedule" ? "line" : r.actor === "github-actions[bot]" ? "fill" : "hand";
  return { ...r, by, mode: commit ? modeOf(commit.subject) : by === "fill" ? "news" : "?" };
});
const rounds = newsroom.filter((r) => r.mode === "news");
const fillRuns = runsOf("news-fill.yml");
const fillFrom = fillRuns[0]?.at ?? null;

/** The longest stretch inside [a, b) with no news story published. */
function longestWait(a, b) {
  const points = [a, ...stories.filter((t) => t > a && t < b), b];
  let best = 0;
  for (let i = 1; i < points.length; i++) best = Math.max(best, points[i] - points[i - 1]);
  return best / H;
}

const rows = [];
for (let d = from; d <= today; d += DAY) {
  const end = Math.min(d + DAY, now);
  const inDay = (t) => t >= d && t < d + DAY;
  const dayRounds = rounds.filter((r) => inDay(r.at));
  const count = (by) => dayRounds.filter((r) => r.by === by).length;
  rows.push({
    day: d,
    full: d + DAY <= now,
    rounds: dayRounds.length,
    line: count("line"),
    fill: count("fill"),
    hand: count("hand"),
    fired: fillRuns.filter((r) => r.event === "schedule" && inDay(r.at)).length,
    failed: newsroom.filter((r) => inDay(r.at) && r.conclusion === "failure").length,
    stories: stories.filter(inDay).length,
    wait: longestWait(d, end),
    morning: now > d + MORNING[0] * H ? longestWait(d + MORNING[0] * H, Math.min(d + MORNING[1] * H, now)) : NaN,
  });
}

const pad = (v, n) => String(v).padStart(n);
const hours = (v) => (Number.isNaN(v) ? "-" : `${v.toFixed(1)} h`);
console.log(`News cadence by UTC day; the morning is ${MORNING[0]}:00-${MORNING[1]}:00 UTC (${MORNING[0] + 3}:00-${MORNING[1] + 3}:00 in Riyadh).`);
console.log(`The fill-in ${fillFrom ? `first ran at ${iso(fillFrom).slice(0, 16).replace("T", " ")} UTC` : "has not run yet"}.\n`);
console.log("day           rounds  line  fill  hand  fill fired  failed  stories  longest wait  morning wait");
for (const r of rows) {
  const day = `${iso(r.day).slice(0, 10)}${r.full ? " " : "*"}`;
  console.log(`${day}  ${pad(r.rounds, 6)}  ${pad(r.line, 4)}  ${pad(r.fill, 4)}  ${pad(r.hand, 4)}  ${pad(r.fired, 10)}  ${pad(r.failed, 6)}  ${pad(r.stories, 7)}  ${pad(hours(r.wait), 12)}  ${pad(hours(r.morning), 12)}`);
}
console.log("* today, so far\n");

const summary = (label, set) => {
  if (!set.length) return console.log(`${label}: no full day yet`);
  console.log(`${label} (${set.length} full day${set.length === 1 ? "" : "s"}): ${mean(set.map((r) => r.rounds)).toFixed(1)} news rounds and ${mean(set.map((r) => r.stories)).toFixed(1)} stories a day; median longest wait ${hours(median(set.map((r) => r.wait)))}, median morning wait ${hours(median(set.map((r) => r.morning)))}`);
};
const full = rows.filter((r) => r.full);
if (fillFrom) {
  const changeDay = Math.floor(fillFrom / DAY) * DAY;
  // A week is the baseline: 1-17 October include days with no story at all, while Claude refused the newsroom's login.
  summary("The week before the fill-in", full.filter((r) => r.day < changeDay && r.day >= changeDay - 7 * DAY));
  summary("After", full.filter((r) => r.day > changeDay));
  const started = rounds.filter((r) => r.by === "fill");
  console.log(`\nRounds the fill-in started: ${started.length}`);
  for (const r of started) {
    const published = stories.filter((t) => t >= r.at && t <= r.end).length;
    console.log(`  ${iso(r.at).slice(0, 10)} ${clock(r.at)} UTC, ${r.conclusion || "running"}, ${published} stor${published === 1 ? "y" : "ies"}`);
  }
} else {
  summary("All", full);
}
