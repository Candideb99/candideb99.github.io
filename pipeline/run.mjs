#!/usr/bin/env node
/**
 * خازندار newsroom pipeline.
 *
 *   node pipeline/run.mjs                 # select, write, verify and publish news stories
 *   node pipeline/run.mjs --dry-run       # everything except writing files/state
 *   node pipeline/run.mjs --limit=4       # cap the number of stories
 *   node pipeline/run.mjs --source=ecb    # restrict to one feed
 *   node pipeline/run.mjs --mode=explainer  # one evergreen explainer tied to recent coverage
 *   node pipeline/run.mjs --mode=analysis   # one house analysis connecting recent stories
 *   node pipeline/run.mjs --mode=paper      # one plain-Arabic reading of a recent open-access research paper
 *   node pipeline/run.mjs --mode=weekly     # the week's review from the paper's own stories (Fridays)
 *   node pipeline/run.mjs --mode=feature    # «في العمق», the in-depth piece on one running file (Sundays)
 *
 * Every model call goes to Claude on the owner's subscription: CLAUDE_CODE_OAUTH_TOKEN from the environment
 * or from .env (see lib/env.mjs and lib/llm.mjs).
 */
import "./lib/env.mjs";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import YAML from "yaml";
import { fetchFeed } from "./lib/feeds.mjs";
import { extractArticle } from "./lib/extract.mjs";
import { collectNewsEvidence, eventSourcesOf, independentOutletCount } from "./lib/news-evidence.mjs";
import { marketData, repeatsInstrument } from "./lib/context.mjs";
import { MARKET_QUOTE_URL } from "./lib/quotes.mjs";
import { newsSectionsOf, selectAnalysisTopic, selectExplainerTopic, selectFeatureTopic, selectPaper, selectStories } from "./lib/select.mjs";
import { ANALYSIS_WORDS, FEATURE_WORDS, PAPER_WORDS, WEEKLY_WORDS, deskNotes, newsFloor, reviseArticle, substantiveFacts, writeAnalysis, writeArticle, writeExplainer, writeFeature, writePaperReading, writeWeekly } from "./lib/write.mjs";
import { NEWS_FLOOR, NEWS_MIN_FACTS, SHORT_DAILY_CAP, SHORT_WORDS } from "./lib/editorial.mjs";
import { critique, CUTTABLE, cutToSources, programmaticChecks } from "./lib/verify.mjs";
import { copyEdit } from "./lib/copydesk.mjs";
import { keptBlock, lessonsBlock, lessonsHash, loadLessons } from "./lib/lessons.mjs";
import { JUDGE_VERSION, draftWith, judge } from "./lib/paired.mjs";
import { checkSourcesOf, precheck, writeJsonAtomic } from "./lib/precheck.mjs";
import { repeatsRecent } from "./lib/events.mjs";
import { saveSnapshot } from "./lib/snapshots.mjs";
import { pickImage } from "./lib/images.mjs";
import { ARTICLES_DIR, buildSlug, loadExistingArticles, mergeNewsRefresh, serializeArticle } from "./lib/article.mjs";
import { usage as llmUsage } from "./lib/llm.mjs";
import { fingerprint, hoursSince, isoNow, sleep } from "./lib/util.mjs";
import { pickDataChart } from "./lib/datacharts.mjs";
import { latestEdition, loadRegistry, monthKey, readEdition, releaseStory, reportStory } from "./lib/reports.mjs";

const root = process.cwd();
const STATE_PATH = path.join(root, "pipeline", "state", "seen.json");
const RUNS_DIR = path.join(root, "pipeline", "runs");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DRY_RUN = flag("dry-run");
/** `--dry-run --preview=DIR`: what the run would publish is written to DIR instead, to be read first. */
const PREVIEW_DIR = DRY_RUN ? option("preview", null) : null;
/** Where a handout photograph is kept (lib/images.mjs handoutTier()): on the site, or beside a preview, or nowhere in a bare dry run. */
const HANDOUT_DIR = DRY_RUN ? (PREVIEW_DIR ? path.join(PREVIEW_DIR, "photos", "handouts") : null) : path.join(root, "public", "photos", "handouts");
/** Private writing evaluation only: never change scheduled publishing or save source bodies in the repository. */
const TEXT_ONLY = DRY_RUN && flag("text-only");
const WRITING_AUDIT = DRY_RUN && PREVIEW_DIR && flag("writing-audit");
if (WRITING_AUDIT) {
  const relative = path.relative(os.tmpdir(), path.resolve(PREVIEW_DIR));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--writing-audit requires a preview subdirectory inside the system temp directory");
}
/** `--draft`: write every article with `draft: true`, so nothing reaches the site until the editor publishes it from the desk. */
const DRAFT = flag("draft");
const MODE = option("mode", "news");
/** Explicit single-story editorial refresh; never enabled by the schedule. */
const REFRESH = option("refresh", null);
const REFRESH_NOTE = option("refresh-note", "");
const LIMIT = Math.max(1, Math.min(Number(option("limit", 4)) || 4, 10));
/**
 * A day's news is edited, not filled: at most this many news stories in any 24 hours. Raised from 10 to 20 on
 * 2026-09-24 with the owner's yes, after الشرق الأوسط's economy desk filed about 30 stories on a day Khazendar
 * filed 7 in all sections; he accepted the larger use of his Claude subscription that it costs.
 */
const DAILY_CAP = Number(process.env.KHAZENDAR_DAILY_CAP) || 20;
const ONLY_SOURCE = option("source", null);
/** `--report=<id>`: the reports desk looks at that report alone (lib/reports.mjs, pipeline/reports.json). */
const ONLY_REPORT = option("report", null);
const MIN_IMPORTANCE = (() => {
  const n = Number(option("min-importance", 6));
  return Number.isFinite(n) ? n : 6;
})();
/** A news run stops taking new stories after this long, so the job's own timeout never discards finished work. */
const RUN_STARTED = Date.now();
const RUN_BUDGET_MS = 35 * 60 * 1000;
/** A first rejection expires after this long (the item may be tried once more); a second one is final for the state's 21 days. */
const REJECT_RETRY_HOURS = 12;
/**
 * The editor reads at most this many candidates a run (260 until 2026-09-24, when ten Gulf and Egyptian feeds joined;
 * 300 until 2026-10-22, when the region's news desks joined for politics that moves money: the feeds then held about
 * 620 fresh items, and 300 gave each feed only its nine freshest). With the eight sources added the same evening the
 * feeds hold about 810 items over 36 hours; 450 still gives every feed its eleven freshest, about what the busiest
 * publishes between two runs.
 */
const CANDIDATE_CAP = 450;
/** The regional desks that are our readers' own economies (src/data/regions.json), and how many of their stories a day the region balance aims for. */
const ARAB_REGIONS = ["الخليج", "مصر والمغرب العربي"];
const ARAB_DAILY = 8;
/**
 * Price-service items: the Egyptian and Gulf sites post the day's gold, dollar and share prices many times a
 * day («تحديث لحظى.. ثبات سعر الدولار مقابل الجنيه اليوم»، «أسعار الذهب فى مصر اليوم الأربعاء»). They are
 * tables, not news, and would fill the editor's list; the market pages carry the prices.
 */
const SERVICE_ITEM = /(?:سعر|أسعار)\s+(?:الذهب|الدولار|اليورو|الريال|الدرهم|الجنيه|العملات|الحديد|الأسمنت|الفضة|الخضروات|الخضار|الفاكهة|الدواجن|الفراخ|اللحوم|الأسماك|الأسهم|البنزين)[^.؟]{0,70}?(?:اليوم|الآن|لحظ|مساء|صباح)|تحديث لحظ[يى]|حصاد الـ?\s?\d+ دقيقة|آخر تحديث لسعر|(?:التعاملات|تعاملات) (?:الصباحية|المسائية)/;
/** Words too common in this paper's headlines to tell two stories apart. */
// The same-event rule and its stopwords live in lib/events.mjs (shared with the learner since 2026-09-26).
/** `--sections=energy,markets`: an analysis drawn only from these sections' stories (the Saturday defence reading used it until the defence section was folded, 2026-10-19). */
const SECTIONS = (option("sections", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

const logLines = [];
function log(message) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
  logLines.push(line);
  console.log(line);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function loadState() {
  const state = await readJson(STATE_PATH, { version: 1, items: {} });
  const cutoff = Date.now() - 21 * 24 * 3600 * 1000;
  for (const [key, value] of Object.entries(state.items)) {
    if (new Date(value.at).getTime() < cutoff) delete state.items[key];
  }
  return state;
}

async function saveState(state) {
  if (DRY_RUN) return;
  await writeJsonAtomic(STATE_PATH, state);
}

/** Records a decision on each item; a repeated rejection counts its strikes, and two strikes are final. */
function markItems(state, items, decision, slug) {
  for (const item of items) {
    const fp = fingerprint(item.url);
    const prior = state.items[fp];
    const strikes = decision === "rejected" ? (prior?.decision === "rejected" ? (prior.strikes ?? 1) + 1 : 1) : 0;
    state.items[fp] = { at: isoNow(), decision, slug, title: item.title, ...(strikes ? { strikes } : {}) };
  }
}

/** Whether a state entry still keeps its item out of the candidates: everything does, except a single rejection older than REJECT_RETRY_HOURS. */
function blocks(entry) {
  if (!entry) return false;
  if (entry.decision !== "rejected" || (entry.strikes ?? 1) >= 2) return true;
  return hoursSince(entry.at) < REJECT_RETRY_HOURS;
}

async function gatherCandidates(sources, state, existing) {
  const enabled = sources.filter((s) => !s.disabled && (!ONLY_SOURCE || s.id === ONLY_SOURCE));
  const queue = [...enabled];
  const all = [];
  async function worker() {
    while (queue.length) {
      const source = queue.shift();
      const items = await fetchFeed(source, { log });
      for (const item of items) {
        all.push({
          ...item,
          sourceName: source.name,
          sourceNameEn: source.nameEn,
          reliability: source.reliability,
          kind: source.kind,
          lang: source.lang,
          paywalled: Boolean(source.paywalled),
          defaultSection: source.defaultSection,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  const usedUrls = new Set(existing.flatMap((a) => a.sourceUrls).map((u) => fingerprint(u)));
  const seenTitles = new Set();
  const candidates = [];
  let service = 0;
  for (const item of all) {
    const fp = fingerprint(item.url);
    if (blocks(state.items[fp]) || usedUrls.has(fp)) continue;
    if (SERVICE_ITEM.test(item.title)) {
      service += 1;
      continue;
    }
    const titleKey = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 90);
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    candidates.push(item);
  }
  if (service) log(`candidates: ${service} price-service items left out (gold, dollar and share price tables)`);
  // Every feed takes its turn: the freshest item of each first, then each one's second, and so on up to the cap.
  // By freshness alone the busiest feeds (five CNBC feeds, forty Sky News items) filled the list, and a quiet
  // Gulf or Egyptian source's one story of the day could be cut before the editor saw it.
  const fresher = (a, b) => hoursSince(a.publishedAt) - hoursSince(b.publishedAt);
  const byFeed = new Map();
  for (const c of candidates.sort(fresher)) {
    if (!byFeed.has(c.sourceId)) byFeed.set(c.sourceId, []);
    byFeed.get(c.sourceId).push(c);
  }
  const capped = [];
  for (let round = 0; capped.length < CANDIDATE_CAP && [...byFeed.values()].some((list) => list.length > round); round++) {
    for (const list of byFeed.values()) if (list[round] && capped.length < CANDIDATE_CAP) capped.push(list[round]);
  }
  capped.sort(fresher);
  capped.forEach((c, i) => {
    c.id = `c${i + 1}`;
  });
  return capped;
}

async function collectEvidence(story, candidates) {
  return collectNewsEvidence(story, candidates, { log });
}

/** Pictures already printed on the site; a new story never repeats one. */
const usedImages = (existing) => new Set(existing.map((a) => a.imageUrl).filter(Boolean));

/**
 * The Arabic copy desk runs on every draft before the critic sees it: it rewrites translationese
 * (the owner's rule: no literal translations) and its guard keeps every figure and name intact. A
 * desk failure never blocks a story; the draft simply goes on as written.
 */
async function copyDeskPass(draft, { includeBody = true, kind = "news", sources = [], problems = [], minWords = kind === "news" ? NEWS_FLOOR : 0 } = {}) {
  try {
    // The names the sources go by, so the checker can count a source named in sentence after sentence.
    const names = sources.flatMap((s) => [s.sourceName ?? s.name, s.sourceNameEn ?? s.nameEn]).filter(Boolean);
    const desk = await copyEdit({ draft, includeBody, role: "desk", kind, sources: names, problems, minWords, log });
    if (desk.changed) log(`desk "${desk.draft.title}": rewrote ${desk.applied.join(", ")}${desk.rejected.length ? `; refused ${desk.rejected.map((r) => `${r.field} (${r.reason})`).join(", ")}` : ""}`);
    return desk;
  } catch (error) {
    log(`desk skipped: ${String(error.message).slice(0, 140)}`);
    return { draft, changed: false, model: null };
  }
}

/**
 * What only a writer can mend: a figure the sources do not carry, a missing structure, too little story, a
 * repeat of a published one. Every other fault still blocking a finished draft is the copy desk's trade (a
 * stock phrase, a lede over 45 words, an English word left behind, a passage too close to its Arabic source),
 * and a desk mends the sentence; it does not throw the story away. In the 24 runs before 2026-09-24, 19
 * drafts were rejected at this point against 30 published, most for one phrase («من قبل»، «يُعتبر») or a
 * lede a few words too long, each after the writer, the desk and the critic had already been paid for.
 */
const WRITERS_FAULT = /أرقام لا تظهر في المصادر|نسبة النص العربي منخفضة|قصير جداً|ناقصة؛ العناوين الفرعية|العنوان مكرر لمقال|تكرر مقالاً منشوراً|يقارن بين ما أوردته المصادر|بلا جدول زمني/;

/**
 * The last cut (lib/verify.mjs cutToSources): a revised draft still carrying a figure no source has, or a second event
 * stitched in, loses those sentences instead of the whole story (2026-10-22: two of the three Houthi stories chosen on
 * 20-22 October were thrown away for one sentence each). Runs before the last desk pass, which waits for the writer's
 * faults to be gone; the checks run again after it, and the critic's second pass reads the cut draft.
 */
function lastCut(draft, checks, { sources, recheck }) {
  if (checks.ok || !checks.issues.some((i) => CUTTABLE.test(i))) return { draft, checks };
  const cut = cutToSources(draft, sources);
  if (!cut) {
    log("last cut: nothing that can be cut (a figure in the headline, the dek or a subhead, or a stitch in the lede)");
    return { draft, checks };
  }
  const again = recheck(cut.draft);
  log(`last cut: ${cut.cut.length} sentence(s) removed (${cut.cut.map((s) => `«${s.slice(0, 50)}…»`).join(" ")}); ${again.ok ? "clean" : `still ${again.issues.length} fault(s)`}`);
  return { draft: cut.draft, checks: again, removed: cut.cut.length };
}

/** One more desk pass on a revised draft whose remaining faults are all the desk's trade; the checks run again after it. */
async function lastDeskPass(draft, checks, { sources, kind = "news", recheck, minWords }) {
  if (checks.ok || checks.issues.some((i) => WRITERS_FAULT.test(i))) return { draft, checks };
  log(`last desk pass for ${checks.issues.length} fault(s): ${checks.issues.map((i) => i.slice(0, 60)).join(" | ")}`);
  const desk = await copyDeskPass(draft, { includeBody: true, kind, sources, problems: checks.issues, ...(minWords != null ? { minWords } : {}) });
  const again = recheck(desk.draft);
  log(`last desk pass: ${again.ok ? "clean" : `still ${again.issues.length} fault(s)`}`);
  return { draft: desk.draft, checks: again };
}

/**
 * The newsroom's lessons (lib/lessons.mjs), learned from the mistakes the second look proved and the corrections editor
 * corrected: read once a news run, handed to the desk notes, the writer and the reviser, and named in each story's
 * `models.lessons`, so the second look can tell the stories written with them from the rest (2026-09-25).
 */
let LESSONS = "";
let LESSONS_VERSION = null;
/**
 * The control group: one story in five is written without the lessons, chosen by its working headline, and named
 * "control" in `models.lessons`. The first test (2026-09-25, 16 of Claude's stories written twice from the same
 * sources, read by the blind fact-check) found 7 proved errors without the lessons and 3 with them, better on 3
 * stories and worse on none: the right direction, too few errors to be sure. The control group keeps the answer
 * coming from every day's news, and the second look corrects its stories like any other.
 */
/** Short stories published in this run, added to the last 24 hours' count for SHORT_DAILY_CAP. */
let SHORT_PUBLISHED = 0;
const CONTROL_SHARE = 5;
const inControlGroup = (story) => parseInt(fingerprint(String(story.headlineHint ?? "")).slice(0, 8), 16) % CONTROL_SHARE === 0;
/**
 * The evidence on the lessons (2026-09-25: the owner's yes to a weekly test of lesson changes and to private
 * side-by-side drafts after the launch; the design is a statistics review's, simulated at this newsroom's error rates).
 * Stories chosen by a hash of their working headline, two a day at most, are also written privately from the same
 * sources and brief with the reference lessons, and every draft goes to the blind fact-check. The published first
 * draft is the live side, so a pair costs four calls. Before the launch the reference is the kept version (no lessons
 * until the first promotion); from the launch (site.json `private: false`), when the published control group stops,
 * each chosen story is written three ways: live, kept and none. No reference draft is ever published. The record is
 * pipeline/state/pairs.json; pipeline/lessons-test.mjs decides from it every Monday (lib/evidence.mjs).
 */
let LAUNCHED = false;
let KEPT = "";
let KEPT_VERSION = 0;
const PAIRS_PER_DAY = 2;
const PAIRS_PATH = path.join(root, "pipeline", "state", "pairs.json");
const PRECHECK_PATH = path.join(root, "pipeline", "state", "precheck.json");

/**
 * What the check before publication found, story by story, and the stories it held (lib/precheck.mjs). The learner
 * reads the repaired errors as the current writer's own proved mistakes; the second look reads which stories were
 * checked clean; the week's numbers count all of it. A record that exists but cannot be read is left for a person.
 */
async function recordPrecheck({ slug, title, pre, writer, lessons, held }) {
  if (DRY_RUN) return;
  const raw = await readFile(PRECHECK_PATH, "utf8").catch(() => null);
  let record = { version: 1, stories: {}, held: [] };
  if (raw !== null) {
    try {
      record = JSON.parse(raw);
    } catch {
      log("pipeline/state/precheck.json cannot be read; this story's check is not recorded, and the file is left for a person");
      return;
    }
  }
  const entry = { at: isoNow(), title, writer, lessons, ok: pre.ok, repairs: pre.repairs, rounds: pre.rounds };
  if (held) record.held = [...(record.held ?? []), { slug, ...entry, held: pre.held, unresolved: pre.unresolved ?? [] }].slice(-200);
  else {
    record.stories[slug] = entry;
    const slugs = Object.keys(record.stories);
    if (slugs.length > 600) for (const old of slugs.sort((a, b) => String(record.stories[a].at).localeCompare(String(record.stories[b].at))).slice(0, slugs.length - 600)) delete record.stories[old];
  }
  await mkdir(path.dirname(PRECHECK_PATH), { recursive: true });
  await writeJsonAtomic(PRECHECK_PATH, record);
}
/** About one story in three is eligible, chosen by hash (not the day's first two, which would favour one hour's news). */
const inPairSample = (story) => parseInt(fingerprint(`pair:${story.headlineHint ?? ""}`).slice(0, 8), 16) % 3 === 0;

async function produceStory({ story, candidates, existing, recentTitles, models, report, refresh = null, preset = null }) {
  // `preset`: sources already read (the reports desk, lib/reports.mjs: a flagship report's own pages), not feed items.
  const { items, sources, evidenceChars } = preset ? { items: [], sources: preset.sources, evidenceChars: 0 } : await collectEvidence(story, candidates);
  const eventSources = eventSourcesOf(sources);
  const entry = { headline: story.headlineHint, section: story.section, importance: story.importance, sources: sources.map((s) => s.url) };
  const audit = { story, sources };
  const checkpoint = async (stage, details = {}) => {
    if (!WRITING_AUDIT) return;
    Object.assign(audit, details, { stage });
    await mkdir(PREVIEW_DIR, { recursive: true });
    await writeFile(path.join(PREVIEW_DIR, `${fingerprint(story.headlineHint)}.writing-audit.json`), JSON.stringify(audit, null, 2));
  };
  // A story is written from at least one fetched article body, never from feed summaries alone: a writer asked
  // for 300 words out of 100 invents the rest. The items take the short "rejected" mark, so a page that was
  // down is tried once more next run.
  if (!eventSources.some((s) => s.text)) {
    entry.outcome = `skipped: no source body could be fetched (${evidenceChars} chars of feed summaries only)`;
    report.push(entry);
    log(`skip "${story.headlineHint}": no source body could be fetched (${evidenceChars} chars of summaries); items marked for one retry`);
    return { rejected: true, items };
  }
  // Two independent outlets, or one official institution speaking for itself. A story told by a single
  // news outlet cannot be cross-checked and would be that outlet's report in Arabic, which is the one
  // thing this paper must never publish (copyright, and Google's "scaled, unoriginal content"). The items
  // take the short mark, so the story is tried again when a second outlet has picked it up.
  const outlets = independentOutletCount(eventSources);
  // A publisher's own flagship report (the reports desk) speaks for itself, as an official institution does.
  if (outlets < 2 && !eventSources.some((s) => Number(s.reliability) === 3 && (s.kind === "official" || s.kind === "report"))) {
    entry.outcome = "skipped: a single independent non-official reporting origin (needs a second independently reported outlet, or an official primary source)";
    report.push(entry);
    log(`skip "${story.headlineHint}": fewer than two independent non-official reporting origins; items marked for one retry`);
    return { rejected: true, items };
  }
  // The same event twice: the editor is told not to repeat a recent story, yet "oil above 107" and
  // "Brent above 108" ran on the same day and the Fed's hike ran three times. When the working headline
  // shares most of its distinctive words with a story of the last four days, the story is not written.
  const repeated = repeatsRecent(story.headlineHint, recentTitles);
  if (repeated) {
    entry.outcome = `skipped: repeats a recent story («${repeated}»)`;
    report.push(entry);
    log(`skip "${story.headlineHint}": repeats "${repeated}"; items marked as seen`);
    return { rejected: true, items };
  }
  // One story per instrument within eight hours, unless it sets a record or reverses (lib/context.mjs; the owner's go,
  // 2026-10-19: an ordinary day's move is on the market board). The items take the short mark, as a held story's do.
  const sameInstrument = refresh ? null : repeatsInstrument(story, existing);
  if (sameInstrument) {
    entry.outcome = `skipped: a second move of the same instrument within eight hours («${sameInstrument}»)`;
    report.push(entry);
    log(`skip "${story.headlineHint}": the same instrument's move already ran within eight hours ("${sameInstrument}"); items marked for one retry`);
    return { rejected: true, items };
  }

  // The latest price of what the story is about (lib/context.mjs; the owner, 2026-10-19), read just before writing: the
  // oil story of that morning printed a price six hours old. Not for a flagship report, which is about its own figures.
  if (!preset) {
    const market = await marketData({ story, sources: eventSources, log });
    if (market) {
      sources.push(market);
      log(`market data: ${market.title}`);
    }
  }

  // Stage one: the desk notes, the checked facts of the one event; stage two: the story written from them.
  // Keep early failures visible in private writing audits, including a provider stopping before its first draft.
  await checkpoint("evidence");
  const control = !LAUNCHED && Boolean(LESSONS) && inControlGroup(story);
  const lessons = control ? "" : LESSONS;
  if (control) log(`control group: "${story.headlineHint}" is written without the lessons`);
  const notesResult = await deskNotes({ story, sources, log, lessons });
  const notes = notesResult?.notes ?? null;
  if (notes) {
    const jobs = Object.entries(notes.facts.reduce((n, f) => ({ ...n, [f.job || "?"]: (n[f.job || "?"] ?? 0) + 1 }), {})).map(([j, c]) => `${j} ${c}`).join(", ");
    log(`desk notes: ${notes.facts.length} facts (${jobs}), ${notes.quotes.length} quotes (${notesResult.model})`);
  }
  await checkpoint("notes", { notes, notesModel: notesResult?.model });
  // Too little checked material for a developed report (the owner, 2026-10-18: "too short"): no developed report is
  // forced out of it. The event runs as a short story instead (lib/editorial.mjs SHORT_STORY; the owner, the same day,
  // on al-aalem.com's 200-word item), through the same desk, critic and check, at most SHORT_DAILY_CAP in 24 hours. Past
  // the cap, or for a refresh, it is not written and its items take the short mark, so the event is tried again when
  // more outlets have reported it.
  let short = false;
  // Remarks (calls, emphasis, praise) are kept for the writer but never count toward a developed report.
  const substantive = substantiveFacts(notes);
  if (story.format === "short") {
    // An official data release (lib/reports.mjs releaseStory) is told short, however many figures its release carries.
    short = true;
    entry.format = "short";
    log(`short story: "${story.headlineHint}" is a data release`);
  } else if (notes && substantive < NEWS_MIN_FACTS) {
    const shortToday = existing.filter((a) => a.kind === "news" && a.format === "short" && hoursSince(a.publishedAt) < 24).length + SHORT_PUBLISHED;
    if (refresh || shortToday >= SHORT_DAILY_CAP) {
      entry.outcome = `skipped: too little material for a developed report (${substantive} substantive facts (remarks not counted), ${NEWS_MIN_FACTS} needed)${refresh ? "" : `; ${SHORT_DAILY_CAP} short stories already in 24 hours`}`;
      report.push(entry);
      log(`skip "${story.headlineHint}": ${substantive} substantive facts (remarks not counted), fewer than ${NEWS_MIN_FACTS}; items marked for one retry`);
      return { rejected: true, items };
    }
    short = true;
    entry.format = "short";
    log(`short story: "${story.headlineHint}" has ${substantive} substantive facts (remarks not counted), fewer than ${NEWS_MIN_FACTS} (${shortToday + 1} of ${SHORT_DAILY_CAP} short stories in 24 hours)`);
  }
  let { draft, model: writerModel } = await writeArticle({ story, sources, notes, log, lessons, short });
  // The writer's own draft, before the desk and the critic touch it: what a private pair compares.
  const firstDraft = draft;
  await checkpoint("written", { notes, firstDraft, writerModel });
  const desk = await copyDeskPass(draft, { sources, minWords: short ? SHORT_WORDS.minWords : NEWS_FLOOR });
  draft = desk.draft;
  const deskModel = desk.model;
  // A news story is a developed report or it is not published (NEWS_FLOOR in lib/editorial.mjs, the owner, 2026-10-18).
  const minWords = short ? SHORT_WORDS.minWords : newsFloor(notes);
  let checks = programmaticChecks(draft, sources, { recentTitles, minWords });
  let review = await critique({ draft, sources, log, short });
  await checkpoint("first-review", { deskDraft: draft, firstReview: review, checks });
  entry.editorialReviews = [{ pass: 1, verdict: review.verdict, readerCheck: review.readerCheck }];
  log(`critic "${draft.title}": ${review.verdict} score=${review.score} issues=${review.issues.length}`);
  for (const issue of [...checks.issues, ...review.issues].slice(0, 4)) log(`  · ${String(issue).slice(0, 160)}`);

  let revised = false;
  // The gate: a draft goes out untouched only on a "publish" verdict with a score of 6 or more and clean
  // programmatic checks. Anything else takes the one revision round against the critic's list and faces the
  // critic again; the post-revision threshold (not "reject", 6 or more) is the owner's and does not change.
  const straightOut = review.verdict === "publish" && review.score >= 6 && checks.ok;
  if (!straightOut) {
    const issues = [...checks.issues, ...review.issues];
    if (!issues.length) issues.push(`المحرر أعطى المسودة ${review.score}/10 (${review.verdict})${review.summary ? `: ${review.summary}` : ""}؛ راجع الدقة والعزو والعربية.`);
    const revision = await reviseArticle({ draft, sources, issues, log, notes, lessons, short });
    draft = (await copyDeskPass(revision.draft, { includeBody: true, sources, minWords })).draft;
    writerModel = `${writerModel} → ${revision.model}`;
    revised = true;
    checks = programmaticChecks(draft, sources, { recentTitles, minWords });
    const cut = lastCut(draft, checks, { sources, recheck: (d) => programmaticChecks(d, sources, { recentTitles, minWords }) });
    if (cut.removed) entry.lastCut = cut.removed;
    ({ draft, checks } = cut);
    ({ draft, checks } = await lastDeskPass(draft, checks, { sources, minWords, recheck: (d) => programmaticChecks(d, sources, { recentTitles, minWords }) }));
    if (!checks.ok) {
      await checkpoint("rejected-checks", { finalDraft: draft, checks });
      entry.outcome = `rejected after revision: ${checks.issues.join(" | ")}`;
      report.push(entry);
      log(`reject "${draft.title}" after revision: ${checks.issues.join(" | ")}`);
      return { rejected: true, items };
    }
    // Every revised draft faces the critic again and is published only with a second-pass score of 6 or more.
    const floor = 6;
    review = await critique({ draft, sources, previousIssues: issues, log, short });
    await checkpoint("second-review", { finalDraft: draft, finalReview: review, checks });
    entry.editorialReviews.push({ pass: 2, verdict: review.verdict, readerCheck: review.readerCheck });
    log(`critic (second pass) "${draft.title}": ${review.verdict} score=${review.score} issues=${review.issues.length}`);
    if (review.verdict === "reject" || review.score < floor) {
      entry.outcome = `rejected by critic after revision (${review.score}): ${review.summary}`;
      report.push(entry);
      return { rejected: true, items };
    }
    // Passed, yet still "revise": the critic's remaining findings are mended before the check, not printed (2026-10-18:
    // Claude's second pass at 8 still named a forecast stated as certain and a sequence no source gives, and the blind
    // fact-check passed both). The thresholds above are unchanged; a repair the checks refuse leaves the reviewed draft.
    if (review.verdict === "revise" && review.issues.length) {
      try {
        const mend = await reviseArticle({ draft, sources, issues: review.issues, log, notes, lessons, short });
        const mended = (await copyDeskPass(mend.draft, { includeBody: true, sources, minWords })).draft;
        const mendedChecks = programmaticChecks(mended, sources, { recentTitles, minWords });
        if (mendedChecks.ok) {
          draft = mended;
          checks = mendedChecks;
          writerModel = `${writerModel} → ${mend.model}`;
          entry.mendedAfterReview = review.issues.length;
          log(`mended "${draft.title}": the second pass's ${review.issues.length} finding(s) sent back once more`);
        } else log(`mend refused by the checks (${mendedChecks.issues.map((i) => i.slice(0, 60)).join(" | ")}); the reviewed draft goes on`);
      } catch (error) {
        if (error.meta?.quota) throw error;
        log(`mend failed (${String(error.message).split("\n")[0].slice(0, 120)}); the reviewed draft goes on`);
      }
    }
  }

  // The check before publication (the owner, 2026-09-26: "check, repair, hold"; lib/precheck.mjs). The final text is
  // read against its sources by the blind fact-check; what the sources disprove is repaired and read again, at most
  // three times. A story still wrong, or one the check could not read, is held: not published, tried again later.
  const lessonsTag = control ? "control" : LESSONS_VERSION ? `v${LESSONS_VERSION}` : null;
  const pre = await precheck({ draft, sources, log, validate: (d) => programmaticChecks(d, sources, { recentTitles, minWords }) });
  const found = pre.rounds.reduce((n, r) => n + r.found.length, 0);
  entry.precheck = { ok: pre.ok, repairs: pre.repairs, rounds: pre.rounds.length, found };
  await checkpoint(pre.ok ? "checked" : "held", { finalDraft: pre.ok ? pre.draft ?? draft : draft, finalReview: review, precheck: entry.precheck });
  if (!pre.ok) {
    entry.outcome = `held by the check before publication: ${pre.held}`;
    report.push(entry);
    log(`held "${draft.title}": ${pre.held}`);
    for (const f of pre.unresolved ?? []) log(`  ✗ [${f.class}] ${f.sentence.slice(0, 140)}`);
    await recordPrecheck({ slug: buildSlug(draft, story), title: draft.title, pre, writer: writerModel, lessons: lessonsTag, held: true });
    return { rejected: true, items };
  }
  if (pre.repairs) {
    // A repair rewrites the fields it was shown; a short story still carries no boxes.
    draft = short ? { ...pre.draft, keyFacts: [], whyItMatters: "", whyBasis: [] } : pre.draft;
    checks = programmaticChecks(draft, sources, { recentTitles, minWords });
    log(`precheck "${draft.title}": ${found} proved error(s) repaired (${pre.repairs} repair(s)); the repaired text checked clean`);
  } else log(`precheck "${draft.title}": clean`);

  // The whole story and its sources' own lead photographs go to the picture desk: the cascade's place and the
  // subject of the sources' photographs come before the writer's searches (lib/images.mjs findImage()).
  const image = refresh ? refresh.data.image : TEXT_ONLY ? null : await pickImage({ draft, story, log, exclude: usedImages(existing), sources, photoDir: HANDOUT_DIR });
  const slug = refresh ? refresh.data.slug : buildSlug(draft, story);
  let markdown = serializeArticle({
    pending: DRAFT,
    format: short ? "short" : "full",
    draft,
    slug,
    section: story.section,
    sources,
    image,
    // The copy desk edited the story on its way in; later sweeps skip it (no tokens spent twice).
    deskedAt: deskModel ? isoNow() : null,
    models: { editor: models.editor, writer: writerModel, critic: review.model, vision: image?.model ?? null, desk: deskModel, lessons: lessonsTag },
    quality: {
      score: review.score,
      verdict: review.verdict,
      revised,
      // "clean" or "repaired": the second look audits a sample of the clean ones and every repaired one.
      precheck: pre.repairs ? "repaired" : "clean",
      importance: story.importance,
      warnings: checks.warnings,
      criticSummary: review.summary,
    },
  });
  if (refresh) markdown = mergeNewsRefresh(refresh.original, markdown, { note: REFRESH_NOTE });
  entry.outcome = refresh ? "refreshed" : "published";
  if (refresh) entry.editorialRefresh = { reason: REFRESH_NOTE, at: isoNow() };
  entry.whyBasis = draft.whyBasis ?? [];
  entry.slug = slug;
  entry.title = draft.title;
  entry.score = review.score;
  entry.image = image ? "photo" : "cover-art";
  await checkpoint("accepted", { finalDraft: draft, finalReview: review, outcome: entry.outcome });
  report.push(entry);
  if (!DRY_RUN || PREVIEW_DIR) {
    const dir = PREVIEW_DIR ?? ARTICLES_DIR;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${slug}.md`), markdown);
  }
  log(`${refresh ? "refreshed" : DRAFT ? "drafted" : "published"} "${draft.title}" -> ${slug}${DRY_RUN ? " (dry-run)" : ""}`);
  await recordPrecheck({ slug, title: draft.title, pre, writer: writerModel, lessons: lessonsTag, held: false });
  // The evidence the story rests on, as its sources read at publication (lib/snapshots.mjs: the passages and the check's
  // verdicts, never the pages), committed with the story. From the same numbered list the check read, so each quote
  // stays with its own source. A failure to save never stops a story.
  const storyText = [draft.title, draft.subtitle, draft.lede, draft.body, draft.whyItMatters, ...(draft.keyFacts ?? []).map((k) => `${k.label} ${k.value}`)].join("\n");
  if (!DRY_RUN) await saveSnapshot({ slug: refresh ? `${slug}-refresh-${Date.now()}` : slug, title: draft.title, publishedAt: refresh?.data.publishedAt ?? isoNow(), kind: refresh ? "editorial-refresh" : "publication", sources: checkSourcesOf(sources), checks: pre.checks ?? [], storyText }).catch((error) => log(`evidence for ${slug} not saved: ${String(error.message).slice(0, 120)}`));
  if (short && !refresh) SHORT_PUBLISHED += 1;
  // The evidence pairs measure the lessons on developed reports; a short story is not paired.
  return { slug, items, title: draft.title, pairing: !control && LESSONS && !short ? { story, sources, firstDraft, firstNotes: notes, slug, title: draft.title } : null };
}

/** One published story written again privately with the reference lessons; every draft judged blind; nothing published. */
async function evidencePair(pairing) {
  // A record that exists but cannot be read is left for a person: rewriting it would lose the evidence gathered so far.
  const raw = await readFile(PAIRS_PATH, "utf8").catch(() => null);
  let record = { version: 1, pairs: [] };
  if (raw !== null) {
    try {
      record = JSON.parse(raw);
    } catch {
      log("evidence pair skipped: pipeline/state/pairs.json cannot be read; it is left as it is for a person to look at");
      return;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  if (record.pairs.filter((p) => String(p.at).startsWith(today)).length >= PAIRS_PER_DAY) return;
  // The references: the kept version (no lessons until the first promotion), and from the launch no lessons as well.
  // When the live lessons are the kept ones, a live-vs-kept pair says nothing about a change and is not paid for.
  const refs = [];
  if (KEPT !== LESSONS) refs.push({ key: "kept", lessons: KEPT });
  if (LAUNCHED && KEPT) refs.push({ key: "none", lessons: "" });
  const writer = pairing.sources.filter((s) => s.text);
  if (!refs.length || !writer.length) return;
  const check = writer.map((s, i) => ({ n: i + 1, name: s.sourceNameEn ?? s.sourceName ?? "", title: s.title ?? "", url: s.url, publishedAt: s.publishedAt ?? null, text: s.text, reason: "" }));
  const stats = (j) => ({ errors: j.errors, drift: j.drift, severity: j.severity, supported: j.supported, notFound: j.notFound, checked: j.checked, words: j.words, keyFacts: j.keyFacts, classes: j.classes, programmatic: j.programmatic });
  try {
    const out = { at: new Date().toISOString(), slug: pairing.slug, checker: JUDGE_VERSION, lessons: `v${LESSONS_VERSION}`, lessonsHash: lessonsHash(LESSONS), keptVersion: KEPT_VERSION };
    out.live = stats(await judge({ draft: pairing.firstDraft, notes: pairing.firstNotes, writerSources: writer, checkSources: check, log }));
    for (const ref of refs) {
      // The private drafts read exactly what the published first draft read, feed summaries included (a stress test,
      // 2026-09-26: they had been given only the fetched texts, so the two sides of a pair differed by more than the
      // lessons). The fact-check reads the fetched texts for both.
      const { draft, notes } = await draftWith({ story: pairing.story, sources: pairing.sources, lessons: ref.lessons, log });
      out[ref.key] = stats(await judge({ draft, notes, writerSources: writer, checkSources: check, log }));
    }
    // With no kept version yet, the kept version is no lessons: the same draft answers both questions.
    if (!KEPT && out.kept) out.none = out.kept;
    record.pairs = [...record.pairs, out].slice(-1000);
    if (!DRY_RUN) {
      await writeJsonAtomic(PAIRS_PATH, record);
    }
    log(`evidence pair "${pairing.title}": ${out.live.errors} proved error(s) live (v${LESSONS_VERSION})${out.kept ? `, ${out.kept.errors} with the kept lessons (v${KEPT_VERSION})` : ""}${out.none && out.none !== out.kept ? `, ${out.none.errors} with none` : ""}; the private drafts are not published`);
  } catch (error) {
    log(`evidence pair failed: ${String(error.message).split("\n")[0].slice(0, 160)}`);
  }
}

async function runNews(report) {
  LAUNCHED = (await readJson(path.join(root, "src", "data", "site.json"), {})).private === false;
  const lessons = await loadLessons();
  if (lessons.damaged) log(`lessons: ${lessons.damaged} cannot be read; this round writes without lessons, and the file is left for a person`);
  LESSONS = lessonsBlock(lessons);
  LESSONS_VERSION = LESSONS ? lessons.version : null;
  KEPT = keptBlock(lessons);
  KEPT_VERSION = lessons.kept?.version ?? 0;
  if (LESSONS) log(`lessons: version ${lessons.version}, ${lessons.lessons.filter((l) => l.status === "active").length} active, read by the desk notes and the writer`);
  if (REFRESH) return runNewsRefresh(report);
  const config = await readJson(path.join(root, "pipeline", "sources.json"), { sources: [] });
  // News is filed only into the news sections; the analysis and explainers hubs hold the paper's own pieces.
  const sections = newsSectionsOf(await readJson(path.join(root, "src", "data", "sections.json"), []));
  const state = await loadState();
  const existing = await loadExistingArticles();
  const recentTitles = existing.filter((a) => hoursSince(a.publishedAt) < 96).map((a) => a.title);
  // Stories per section in the last 24 hours, so the editor can favour a quiet section over a crowded one.
  const coverage24h = {};
  for (const a of existing) if (a.kind === "news" && hoursSince(a.publishedAt) < 24) coverage24h[a.section] = (coverage24h[a.section] ?? 0) + 1;

  const candidates = await gatherCandidates(config.sources, state, existing);
  log(`candidates: ${candidates.length} fresh unseen items`);
  if (candidates.length < 3) {
    log("too few candidates; nothing to do");
    return { report, published: 0 };
  }

  const publishedToday = Object.values(coverage24h).reduce((n, v) => n + v, 0);
  const room = Math.max(0, DAILY_CAP - publishedToday);
  if (room === 0) {
    log(`daily budget spent: ${publishedToday} news stories in the last 24 hours (cap ${DAILY_CAP}); nothing more today`);
    return { report, published: 0 };
  }
  const runLimit = Math.min(LIMIT, room);
  const { stories, model: editorModel } = await selectStories({ candidates, recentTitles, sections, coverage24h, limit: runLimit, log });
  log(`editor (${editorModel}) selected ${stories.length} stories`);
  let chosen = stories.filter((s) => s.importance >= MIN_IMPORTANCE).slice(0, runLimit);
  // `--sections=energy,markets` on a news run: the desk asked for one part of the paper. Keep only those
  // stories (a point under the threshold is allowed, as for a starved section) and skip the balancing,
  // which exists to spread a general run across sections, not to override a deliberate choice.
  if (SECTIONS.length) {
    chosen = stories.filter((s) => SECTIONS.includes(s.section) && s.importance >= MIN_IMPORTANCE - 1).slice(0, runLimit);
    log(`news restricted to ${SECTIONS.join(", ")}: ${chosen.length} of ${stories.length} selected stories qualify`);
  }
  // Section balance: a section with nothing in three days takes its best candidate (one point under
  // the threshold is enough) in place of the weakest chosen story from a section already served, so
  // no section runs empty while another fills up: الدفاع stayed empty for a week this way, its
  // stories scoring 6 and deferred behind the economy's every run.
  const sectionIds = sections.map((x) => (typeof x === "string" ? x : x.id));
  const starved = SECTIONS.length ? [] : sectionIds.filter((sec) => !existing.some((a) => a.kind === "news" && a.section === sec && hoursSince(a.publishedAt) < 72) && !chosen.some((x) => x.section === sec));
  for (const sec of starved) {
    const pick = stories.find((x) => x.section === sec && !chosen.includes(x) && x.importance >= MIN_IMPORTANCE - 1);
    if (!pick) continue;
    if (chosen.length >= runLimit) {
      const served = chosen.filter((x) => chosen.filter((y) => y.section === x.section).length > 1 || (coverage24h[x.section] ?? 0) > 0).sort((x, y) => x.importance - y.importance)[0];
      if (!served || served.importance > pick.importance + 1) continue;
      chosen.splice(chosen.indexOf(served), 1);
      log(`section balance: "${served.headlineHint}" (${served.section}, ${served.importance}) gives way`);
    }
    chosen.push(pick);
    log(`section balance: ${sec} has had nothing for three days; "${pick.headlineHint}" [${pick.importance}] added`);
  }
  // Region balance: our readers live in the Gulf, Egypt and the Maghreb, and their own economies come first
  // (2026-09-24: beside الشرق الأوسط, whose economy file ran about 40% Saudi, Gulf and Egyptian stories, ours
  // carried 8% from Egypt and the Maghreb). Each run takes at least one worthy story from there, one point under
  // the threshold being enough, until the last 24 hours hold ARAB_DAILY of them; it replaces the weakest chosen
  // story from elsewhere only when that one is not clearly stronger.
  const arabWorld = (regions) => (regions ?? []).some((r) => ARAB_REGIONS.includes(r));
  const arabToday = existing.filter((a) => a.kind === "news" && hoursSince(a.publishedAt) < 24 && arabWorld(a.regions)).length;
  if (!SECTIONS.length && arabToday < ARAB_DAILY && !chosen.some((s) => arabWorld(s.regions))) {
    const pick = stories.find((s) => arabWorld(s.regions) && !chosen.includes(s) && s.importance >= MIN_IMPORTANCE - 1);
    if (pick) {
      const elsewhere = chosen.filter((s) => !arabWorld(s.regions)).sort((x, y) => x.importance - y.importance)[0];
      if (chosen.length < runLimit) chosen.push(pick);
      else if (elsewhere && elsewhere.importance <= pick.importance + 1) {
        chosen.splice(chosen.indexOf(elsewhere), 1, pick);
        log(`region balance: "${elsewhere.headlineHint}" (${elsewhere.importance}) gives way`);
      }
      if (chosen.includes(pick)) log(`region balance: ${arabToday} Gulf, Egyptian or Maghreb stories in 24 hours; "${pick.headlineHint}" [${pick.importance}] added`);
    }
  }
  for (const s of stories) log(`  [${s.importance}] ${s.section} — ${s.headlineHint} (${s.ids.join(",")})${chosen.includes(s) ? "" : s.importance < MIN_IMPORTANCE ? " (below threshold)" : " (deferred: over limit)"}`);

  let published = 0;
  const publishedTitles = [...recentTitles];
  for (const story of chosen) {
    if (Date.now() - RUN_STARTED > RUN_BUDGET_MS) {
      log(`run budget of ${RUN_BUDGET_MS / 60000} minutes spent; "${story.headlineHint}" waits for the next run`);
      report.push({ headline: story.headlineHint, section: story.section, importance: story.importance, outcome: "deferred: run budget spent" });
      continue;
    }
    try {
      const result = await produceStory({ story, candidates, existing, recentTitles: publishedTitles, models: { editor: editorModel }, report });
      if (!result) continue;
      if (result.rejected) {
        markItems(state, result.items, "rejected");
      } else {
        markItems(state, result.items, "published", result.slug);
        publishedTitles.push(result.title);
        published += 1;
        if (result.pairing && inPairSample(result.pairing.story)) await evidencePair(result.pairing);
      }
      await saveState(state);
    } catch (error) {
      if (error.meta?.quota) {
        log(`desk paused for ChatGPT allowance: ${error.message}`);
        report.push({ headline: story.headlineHint, section: story.section, outcome: "deferred: ChatGPT allowance exhausted", retryAt: error.meta.retryAt });
        break;
      }
      log(`story failed "${story.headlineHint}": ${String(error.message).split("\n")[0]}`);
      report.push({ headline: story.headlineHint, section: story.section, outcome: `error: ${String(error.message).split("\n")[0]}` });
      // A story that failed outright takes the rejection mark like a rejected one (another try after twelve
      // hours, then no more): unmarked, the editor chose the same failing story run after run (2026-09-24).
      markItems(state, story.ids.map((id) => candidates.find((c) => c.id === id)).filter(Boolean), "rejected");
      await saveState(state);
      await sleep(3000);
    }
  }
  return { report, published };
}

/** Re-report exactly one owner-selected event through the normal gate, preserving its address/date. */
async function runNewsRefresh(report) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(REFRESH) || !REFRESH_NOTE.trim()) throw new Error("--refresh requires a single valid slug and --refresh-note");
  const original = await readFile(path.join(ARTICLES_DIR, `${REFRESH}.md`), "utf8");
  const parts = original.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n/);
  const data = parts ? YAML.parse(parts[1]) : null;
  if (data?.kind !== "news" || data.slug !== REFRESH || data.draft || !data.sources?.length) throw new Error("refresh requires an existing published news article with sources");
  const registry = await readJson(path.join(root, "pipeline", "sources.json"), { sources: [] });
  // A market quote of the first writing is read afresh by the refresh itself (lib/context.mjs), never fetched as a report.
  const candidates = data.sources.filter((s) => !/fidelity.com\/learning-center/.test(s.url) && !MARKET_QUOTE_URL.test(s.url)).slice(0, 4).map((s, i) => {
    const configured = registry.sources.find((r) => r.nameEn === s.nameEn);
    return { ...s, id: `refresh-${i}`, sourceId: configured?.id ?? s.nameEn, sourceName: s.name, sourceNameEn: s.nameEn,
      reliability: configured?.reliability ?? 2, kind: configured?.kind ?? "news", paywalled: Boolean(configured?.paywalled) };
  });
  const existing = await loadExistingArticles();
  const result = await produceStory({ story: { ids: candidates.map((s) => s.id), headlineHint: data.title, section: data.section,
    importance: data.quality?.importance ?? 6, regions: data.regions ?? [], angle: "إعادة تحرير الخبر نفسه بشرح اقتصادي وافٍ ومسنَد: تعريف المصطلحات الأساسية، موقع الأرقام في سياقها، آلية الأثر وحدوده، والتعريف بأصحاب الآراء. لا تطور جديد ولا حشو." },
    candidates, existing, recentTitles: existing.filter((a) => a.slug !== REFRESH && hoursSince(a.publishedAt) < 96).map((a) => a.title),
    models: { editor: data.models?.editor ?? null }, report, refresh: { original, data } });
  if (!result?.slug) throw new Error("editorial refresh did not pass; the published article was left intact");
  return { report, published: 0, refreshed: 1 };
}

/** News stories of the last 72 hours, newest first: the coverage a hub piece (explainer, analysis) is anchored in. */
const recentNews = (existing, max) => existing.filter((a) => a.kind === "news" && hoursSince(a.publishedAt) < 72).slice(0, max);

/** The full text of a published story, as the material an analysis may cite and is checked against. */
function articleText(a) {
  const facts = (a.keyFacts ?? []).map((f) => `${f.label} ${f.value}`).join("\n");
  return [a.title, a.subtitle, a.lede, a.body, facts, a.whyItMatters].filter(Boolean).join("\n\n");
}

/**
 * The paper's own stories as source entries: the site's Sources component renders internal urls as
 * "مواد ذات صلة". With `withText` they also carry the story text for the checks and the critic.
 */
function internalSources(articles, { withText = false } = {}) {
  return articles.map((a) => ({
    sourceName: "خازندار",
    sourceNameEn: "Khazendar",
    title: a.title,
    url: `/articles/${a.slug}/`,
    lang: "ar",
    publishedAt: a.publishedAt,
    ...(withText ? { text: articleText(a), summary: a.lede } : {}),
  }));
}

/**
 * Shared tail of the explainer, analysis and paper modes: programmatic checks, the critic, one revision round
 * with a second critic pass, the photo, and the file. `checkSources` is what the draft is checked
 * against (nothing for an explainer, the related stories for an analysis, the research paper's text for a
 * paper reading); `sources` is what is filed.
 */
async function finishHubPiece({ kind, section, draft: firstDraft, sources, checkSources, recentTitles, wordLimits, story, headlineHint, headline, models, existing, report }) {
  const deskKind = kind === "explainer" ? "explainer" : kind === "paper" ? "paper" : "analysis";
  const desk = await copyDeskPass(firstDraft, { kind: deskKind, sources: checkSources ?? [] });
  let draft = desk.draft;
  const deskModel = desk.model;
  // A reading's headline is held against the last four days' news too, never only against its own kind's.
  const newsTitles = (existing ?? []).filter((a) => a.kind === "news" && hoursSince(a.publishedAt) < 96).map((a) => a.title);
  const flags = { [kind]: true, newsTitles };
  let checks = programmaticChecks(draft, checkSources, { ...flags, recentTitles });
  log(`checks ${kind} "${draft.title}": ${checks.metrics.words} words, ${checks.issues.length} issues, ${checks.warnings.length} warnings`);
  const review = await critique({ draft, sources: checkSources, ...flags, log });
  log(`critic ${kind}: ${review.verdict} score=${review.score} issues=${review.issues.length}`);
  for (const issue of [...checks.issues, ...review.issues].slice(0, 4)) log(`  · ${String(issue).slice(0, 160)}`);
  const entry = { headline, section, outcome: "" };
  // A first pass under 5 is not worth a revision, except for the week's review, whose length and
  // many sources draw a 4 with a "revise" list from the free critic; it gets its round like any piece.
  // The long pieces (the week's review, «في العمق») draw a low first score from a few fixable slips; they get their revision.
  if (review.verdict === "reject" || (review.score < 5 && kind !== "weekly" && kind !== "feature")) {
    entry.outcome = `rejected (${review.score}): ${review.summary}`;
    report.push(entry);
    return { report, published: 0 };
  }
  let revised = false;
  let finalReview = review;
  let writerModel = models.writer;
  // The same gate as a news story: out untouched only on "publish" at 6 or more with clean checks.
  const straightOut = review.verdict === "publish" && review.score >= 6 && checks.ok;
  if (!straightOut) {
    const issues = [...checks.issues, ...review.issues];
    if (!issues.length) issues.push(`المحرر أعطى المسودة ${review.score}/10 (${review.verdict})${review.summary ? `: ${review.summary}` : ""}؛ راجع الدقة والعزو والعربية.`);
    const revision = await reviseArticle({ draft, sources: checkSources, issues, log, wordLimits, kind });
    draft = (await copyDeskPass(revision.draft, { includeBody: false, kind: deskKind, sources: checkSources ?? [] })).draft;
    writerModel = `${writerModel} → ${revision.model}`;
    revised = true;
    checks = programmaticChecks(draft, checkSources, { ...flags, recentTitles });
    ({ draft, checks } = await lastDeskPass(draft, checks, { sources: checkSources ?? [], kind: deskKind, recheck: (d) => programmaticChecks(d, checkSources, { ...flags, recentTitles }) }));
    if (!checks.ok) {
      entry.outcome = `rejected after revision: ${checks.issues.join(" | ")}`;
      report.push(entry);
      log(`reject ${kind} "${draft.title}" after revision: ${checks.issues.join(" | ")}`);
      return { report, published: 0 };
    }
    finalReview = await critique({ draft, sources: checkSources, ...flags, previousIssues: issues, log });
    log(`critic (second pass) ${kind}: ${finalReview.verdict} score=${finalReview.score}`);
    if (finalReview.verdict === "reject" || finalReview.score < 6) {
      entry.outcome = `rejected by critic after revision (${finalReview.score}): ${finalReview.summary}`;
      report.push(entry);
      return { report, published: 0 };
    }
  }
  // The piece's kind tells the picture desk it explains or analyses: its subject at work, never a facade.
  const image = await pickImage({ draft: { ...draft, kind }, story, log, exclude: usedImages(existing) });
  const slug = buildSlug(draft, { headlineHint });
  const markdown = serializeArticle({
    pending: DRAFT,
    draft,
    slug,
    section,
    kind,
    sources,
    image,
    deskedAt: deskModel ? isoNow() : null,
    models: { editor: models.editor, writer: writerModel, critic: finalReview.model, vision: image?.model ?? null, desk: deskModel },
    quality: { score: finalReview.score, verdict: finalReview.verdict, revised, warnings: checks.warnings, criticSummary: finalReview.summary },
  });
  if (!DRY_RUN || PREVIEW_DIR) {
    const dir = PREVIEW_DIR ?? ARTICLES_DIR;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${slug}.md`), markdown);
  }
  entry.outcome = "published";
  entry.slug = slug;
  entry.title = draft.title;
  entry.score = finalReview.score;
  entry.image = image ? "photo" : "none";
  report.push(entry);
  log(`published ${kind} "${draft.title}" -> ${slug}${DRY_RUN ? " (dry-run)" : ""}`);
  return { report, published: 1 };
}

/**
 * Runs a hub mode. A model failure (every free model down or answering badly) is reported like a failed
 * news story instead of crashing the run, so the run report still lands and the next schedule tries again.
 */
async function runHub(kind, section, produce) {
  const report = [];
  try {
    return await produce(report);
  } catch (error) {
    const message = String(error.message).split("\n")[0];
    log(`${kind} failed: ${message}`);
    report.push({ headline: "", section, outcome: `error: ${message}` });
    return { report, published: 0 };
  }
}

function runExplainer() {
  return runHub("explainer", "explainers", async (report) => {
    const existing = await loadExistingArticles();
    const recent = recentNews(existing, 25);
    const explainers = existing.filter((a) => a.kind === "explainer").map((a) => a.title);
    if (recent.length < 3) {
      log("not enough recent coverage to anchor an explainer");
      return { report, published: 0 };
    }
    const { topic, model: editorModel } = await selectExplainerTopic({ recentArticles: recent, existingExplainers: explainers, log });
    log(`explainer topic: ${topic.concept_ar} (${topic.concept_en})`);
    const related = recent.filter((a) => (topic.related_titles ?? []).includes(a.title)).slice(0, 4);
    const { draft, model: writerModel } = await writeExplainer({ topic, relatedArticles: related, log });
    // A chart of official data when one shows what the piece explains (the owner, 2026-09-24: "explainers usually add
    // graphs"); Claude chooses from a menu, code fetches the figures from the IMF or the World Bank.
    const { chart: dataChart } = await pickDataChart({ draft, log });
    if (dataChart) Object.assign(draft, { chart: dataChart, dataChart: true });
    return finishHubPiece({
      kind: "explainer",
      section: "explainers",
      draft,
      sources: internalSources(related),
      checkSources: [],
      recentTitles: explainers,
      story: { angle: topic.hook },
      headlineHint: topic.concept_en,
      headline: topic.concept_ar,
      models: { editor: editorModel, writer: writerModel },
      existing,
      report,
    });
  });
}

/** One house analysis a day: a theme connecting at least two recent stories, written only from their facts. */
function runAnalysis() {
  return runHub("analysis", "analysis", async (report) => {
    const existing = await loadExistingArticles();
    // With `--sections`, the reading draws on those sections alone and looks back a week, since a
    // section like الدفاع does not fill in three days.
    const recent = SECTIONS.length
      ? existing.filter((a) => a.kind === "news" && SECTIONS.includes(a.section) && hoursSince(a.publishedAt) < 24 * 7).slice(0, 40)
      : recentNews(existing, 40);
    if (SECTIONS.length) log(`analysis restricted to ${SECTIONS.join(", ")}: ${recent.length} stories of the week`);
    const analyses = existing.filter((a) => a.kind === "analysis").map((a) => a.title);
    if (recent.length < 3) {
      log("not enough recent coverage to anchor an analysis");
      return { report, published: 0 };
    }
    const { topic, related, model: editorModel } = await selectAnalysisTopic({ recentArticles: recent, existingAnalyses: analyses, log });
    log(`analysis theme: ${topic.theme_ar} (${topic.theme_en}); question: ${topic.question_ar}`);
    for (const a of related) log(`  related: ${a.title}`);
    const sources = internalSources(related, { withText: true });
    const { draft, model: writerModel } = await writeAnalysis({ topic, relatedArticles: related, log });
    return finishHubPiece({
      kind: "analysis",
      section: "analysis",
      draft,
      sources,
      checkSources: sources,
      recentTitles: analyses,
      wordLimits: ANALYSIS_WORDS,
      story: { angle: topic.angle || topic.hook },
      headlineHint: topic.theme_en,
      headline: topic.theme_ar,
      models: { editor: editorModel, writer: writerModel },
      existing,
      report,
    });
  });
}

/** The paper mode reads research up to this old (the editor is told to prefer the last 60 days). */
const PAPER_MAX_AGE_HOURS = 24 * 90;
/** A reading needs at least this much of the paper's own text (abstract plus free page text). */
const PAPER_MIN_CHARS = 3000;
/** How much of a free full text is read: enough for the abstract, the introduction and the main results. */
const PAPER_MAX_CHARS = 24000;

/**
 * Recent items of the research feeds (`papers` in sources.json), newest first, minus what the paper already read
 * or the state already judged. The news editor never sees these; the research editor sees only these.
 */
async function gatherPapers(sources, state, existing) {
  const enabled = sources.filter((s) => !s.disabled && (!ONLY_SOURCE || s.id === ONLY_SOURCE));
  const all = [];
  await Promise.all(
    enabled.map(async (source) => {
      const items = await fetchFeed(source, { maxAgeHours: PAPER_MAX_AGE_HOURS, log });
      for (const item of items) {
        all.push({
          ...item,
          sourceName: source.name,
          sourceNameEn: source.nameEn,
          reliability: source.reliability,
          kind: source.kind,
          lang: source.lang,
          abstractOnly: Boolean(source.abstractOnly),
          note: source.note ?? "",
        });
      }
    }),
  );
  const usedUrls = new Set(existing.flatMap((a) => a.sourceUrls).map((u) => fingerprint(u)));
  const seenTitles = new Set();
  const candidates = [];
  for (const item of all) {
    const fp = fingerprint(item.url);
    if (blocks(state.items[fp]) || usedUrls.has(fp)) continue;
    // The World Bank repository lists items still being catalogued under a placeholder title.
    if (/^notitle$/i.test(item.title.trim()) || !item.summary) continue;
    const titleKey = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 90);
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    candidates.push(item);
  }
  candidates.sort((a, b) => hoursSince(a.publishedAt) - hoursSince(b.publishedAt));
  const capped = candidates.slice(0, 120);
  capped.forEach((c, i) => {
    c.id = `p${i + 1}`;
  });
  return capped;
}

/** Whether a fetched page is about this paper: a repository page that yields only "related items" is not. */
function looksLikeThePaper(text, item) {
  const lower = text.toLowerCase();
  const head = String(item.summary ?? "").replace(/^\s*dc\.[\w.]+:\s*/gm, "").trim().slice(0, 80).toLowerCase();
  if (head.length >= 40 && lower.includes(head)) return true;
  const words = [...new Set(item.title.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) ?? [])];
  if (!words.length) return false;
  const hits = words.filter((w) => lower.includes(w)).length;
  return hits / words.length >= 0.5;
}

/**
 * Reads one paper: the abstract the feed carried, plus the free text of its page (and, for arXiv, of the HTML
 * version of the paper) when the series offers one. Returns { text, pageUrl, ogImage }.
 */
async function readPaper(item) {
  const abstract = String(item.summary ?? "").replace(/^\s*dc\.[\w.]+:\s*/gm, "").trim();
  const pages = [item.url];
  // arXiv renders an HTML full text for most recent papers, sometimes only under the unversioned id.
  const arxiv = item.url.match(/arxiv\.org\/abs\/([\w./-]+?)(v\d+)?$/i);
  if (arxiv) pages.unshift(`https://arxiv.org/html/${arxiv[1]}${arxiv[2] ?? ""}`, `https://arxiv.org/html/${arxiv[1]}`);
  let pageText = "";
  let pageUrl = "";
  let ogImage = "";
  if (!item.abstractOnly) {
    for (const url of pages) {
      const fetched = await extractArticle(url, { maxChars: PAPER_MAX_CHARS, log });
      if (!fetched.ok) {
        log(`paper page ${url}: ${fetched.reason}`);
        continue;
      }
      if (!looksLikeThePaper(fetched.text, item)) {
        log(`paper page ${url}: text is not this paper's; ignored`);
        continue;
      }
      pageText = fetched.text;
      pageUrl = url;
      ogImage = fetched.ogImage;
      break;
    }
  }
  // The page text stands alone when it already carries the abstract; otherwise the abstract leads it.
  const text = pageText && pageText.includes(abstract.slice(0, 100)) ? pageText : [abstract, pageText].filter(Boolean).join("\n\n");
  return { text, pageUrl, ogImage };
}

/**
 * Twice a week: one plain-Arabic reading of a recent open-access research paper (kind "paper", filed in the
 * explainers hub). The research editor picks the paper; the paper's own text is the only material and the
 * only source the reading is checked against; a paper whose free text is too thin is passed over, up to three times.
 */
function runPaper() {
  return runHub("paper", "explainers", async (report) => {
    const config = await readJson(path.join(root, "pipeline", "sources.json"), { papers: [] });
    const state = await loadState();
    const existing = await loadExistingArticles();
    const existingPapers = existing.filter((a) => a.kind === "paper").map((a) => a.title);
    let candidates = await gatherPapers(config.papers ?? [], state, existing);
    log(`paper candidates: ${candidates.length} recent research items`);
    if (candidates.length < 3) {
      log("too few paper candidates; nothing to do");
      return { report, published: 0 };
    }

    let chosen = null;
    for (let attempt = 1; attempt <= 3 && candidates.length; attempt += 1) {
      const { choice, model: editorModel } = await selectPaper({ candidates, existingPapers, log });
      const item = candidates.find((c) => c.id === choice.id);
      log(`research editor (${editorModel}) chose [${choice.id}] ${item.sourceId}: ${choice.title_en}${choice.open_access.ok ? "" : " (editor doubts open access)"}`);
      log(`  why: ${choice.why_it_matters_ar}`);
      const read = await readPaper(item);
      log(`paper [${choice.id}]: ${read.text.length} chars of text${read.pageUrl ? ` (abstract + ${read.pageUrl})` : " (abstract only)"}`);
      if (read.text.length >= PAPER_MIN_CHARS) {
        chosen = { item, choice, editorModel, ...read };
        break;
      }
      log(`  too little text (${read.text.length} < ${PAPER_MIN_CHARS}); passing over this paper${attempt < 3 ? " and asking the editor again" : ""}`);
      markItems(state, [item], "skipped");
      candidates = candidates.filter((c) => c.id !== item.id);
    }
    if (!chosen) {
      report.push({ headline: "", section: "explainers", outcome: "skipped: too little free text in three candidates" });
      await saveState(state);
      return { report, published: 0 };
    }

    const { item, choice, editorModel, text } = chosen;
    // The paper itself is the single source: filed as read, and checked against as text.
    const source = {
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      sourceNameEn: item.sourceNameEn,
      title: item.title,
      url: item.url,
      lang: "en",
      publishedAt: item.publishedAt ?? undefined,
      summary: item.summary,
      text,
    };
    const brief = {
      ...choice,
      title_en: item.title,
      institutionEn: item.sourceNameEn,
      institutionAr: item.sourceName,
      publishedAt: item.publishedAt,
    };
    const { draft, model: writerModel } = await writePaperReading({ paper: brief, text, log });
    const result = await finishHubPiece({
      kind: "paper",
      section: "explainers",
      draft,
      sources: [source],
      checkSources: [source],
      recentTitles: existingPapers,
      wordLimits: PAPER_WORDS,
      story: { angle: choice.reading_angle_ar },
      headlineHint: item.title,
      headline: item.title,
      models: { editor: editorModel, writer: writerModel },
      existing,
      report,
    });
    markItems(state, [item], result.published ? "published" : "rejected", report.at(-1)?.slug);
    await saveState(state);
    return result;
  });
}

async function writeRunReport(summary) {
  if (DRY_RUN) return;
  await mkdir(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(path.join(RUNS_DIR, `${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(RUNS_DIR, "latest.json"), `${JSON.stringify(summary, null, 2)}\n`);
  // Keep the repository small: only the most recent run reports survive, and the copy desk's reports likewise.
  const { readdir, unlink } = await import("node:fs/promises");
  const all = await readdir(RUNS_DIR);
  for (const prefix of ["", "copydesk-"]) {
    const files = all.filter((f) => new RegExp(`^${prefix}\\d{4}-.*\\.json$`).test(f)).sort();
    for (const stale of files.slice(0, Math.max(0, files.length - 24))) await unlink(path.join(RUNS_DIR, stale));
  }
}

function markdownSummary(summary) {
  const rows = summary.report
    .map((r) => `| ${r.section ?? ""} | ${(r.title ?? r.headline ?? "").replace(/\|/g, "/")} | ${r.score ?? ""} | ${r.image ?? ""} | ${r.outcome} |`)
    .join("\n");
  return `## خازندار newsroom — ${summary.mode} (${summary.published} published)\n\n| section | story | score | image | outcome |\n|---|---|---|---|---|\n${rows || "| | (nothing) | | | |"}\n\nLLM calls: ${summary.llm.calls} ok, ${summary.llm.failures} failed; models: ${Object.entries(summary.llm.byModel).map(([m, n]) => `${m}×${n}`).join(", ") || "none"}\n`;
}

/** The week's stories, strongest first: news and analyses of the last seven days, the top fourteen. */
function weekStories(existing) {
  const importance = (a) => (a.quality?.importance ?? 5) + (a.kind === "analysis" ? 0.5 : 0);
  return existing
    .filter((a) => (a.kind === "news" || a.kind === "analysis") && hoursSince(a.publishedAt) < 24 * 7)
    .sort((x, y) => importance(y) - importance(x))
    .slice(0, 14);
}

/** The coming ten days of the calendar as plain text, and as a source the checks can ground dates against. */
async function calendarForWeek() {
  try {
    const { events } = JSON.parse(await readFile(path.join(process.cwd(), "src", "data", "calendar.json"), "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const coming = events.filter((e) => e.date >= today && e.date <= end);
    const text = coming.map((e) => `${e.date}: ${e.title} (${e.org})${e.note ? `؛ ${e.note}` : ""}`).join("\n");
    return { text, source: { sourceName: "الأجندة الاقتصادية", sourceNameEn: "Khazendar calendar", title: "الأجندة الاقتصادية", url: "/calendar/", lang: "ar", publishedAt: new Date().toISOString(), text, summary: text } };
  } catch {
    return { text: "", source: null };
  }
}

function runWeekly() {
  return runHub("weekly", "analysis", async (report) => {
    const existing = await loadExistingArticles();
    const stories = weekStories(existing);
    const past = existing.filter((a) => a.kind === "weekly").map((a) => a.title);
    if (stories.length < 5) {
      log("not enough coverage this week for a review");
      return { report, published: 0 };
    }
    const date = new Date().toISOString().slice(0, 10);
    const calendar = await calendarForWeek();
    log(`weekly: ${stories.length} stories of the week, ${calendar.text ? calendar.text.split("\n").length : 0} calendar events`);
    for (const a of stories.slice(0, 8)) log(`  story: ${a.title}`);
    const sources = internalSources(stories, { withText: true });
    const checkSources = calendar.source ? [...sources, calendar.source] : sources;
    const { draft, model: writerModel } = await writeWeekly({ articles: stories, calendarText: calendar.text, date, log });
    return finishHubPiece({
      kind: "weekly",
      section: "analysis",
      draft,
      sources: internalSources(stories),
      checkSources,
      recentTitles: past,
      wordLimits: WEEKLY_WORDS,
      story: { angle: "حصاد الأسبوع: ما يعنيه أسبوع الأخبار للقارئ العربي" },
      headlineHint: `week-in-review-${date}`,
      headline: draft.title,
      models: { editor: writerModel, writer: writerModel },
      existing,
      report,
    });
  });
}

/** «في العمق» reads a file's stories of this many days; a file it told in the last three weeks waits. */
const FEATURE_DAYS = 45;
const FEATURE_REST_DAYS = 21;
/** The regional desks are shelves, not files: too broad to tell as one story. */
const REGION_TAGS = new Set(["الخليج", "مصر والمغرب العربي", "الشرق الأوسط", "أوروبا", "الأمريكتان", "آسيا", "أفريقيا", "عالمي"]);

/**
 * «في العمق», the weekly in-depth piece (the owner's Task 5, 2026-09-24, after reading الشرق الأوسط beside
 * Khazendar): the running files are the tags of the last 45 days' news with five stories or more, less the regional
 * desks and any file told in the last three weeks; the features editor picks one and the question it answers,
 * and the piece is written from the file's own stories, oldest first, every figure traceable to them.
 */
function runFeature() {
  return runHub("feature", "analysis", async (report) => {
    const existing = await loadExistingArticles();
    const news = existing.filter((a) => a.kind === "news" && hoursSince(a.publishedAt) < 24 * FEATURE_DAYS);
    const features = existing.filter((a) => a.kind === "feature");
    const told = new Set(features.filter((a) => hoursSince(a.publishedAt) < 24 * FEATURE_REST_DAYS).flatMap((a) => (a.tags ?? []).slice(0, 1)));
    const byTag = new Map();
    for (const a of news) for (const t of a.tags ?? []) {
      if (REGION_TAGS.has(t) || told.has(t)) continue;
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t).push(a);
    }
    const files = [...byTag.entries()]
      .filter(([, list]) => list.length >= 5)
      .map(([tag, list]) => ({ tag, stories: list.slice(0, 14) }))
      .sort((a, b) => b.stories.length - a.stories.length || String(b.stories[0].publishedAt).localeCompare(String(a.stories[0].publishedAt)))
      .slice(0, 8);
    if (!files.length) {
      log("no running file with five stories or more in the last 45 days");
      return { report, published: 0 };
    }
    log(`feature: ${files.length} running files: ${files.map((f) => `${f.tag} (${f.stories.length})`).join(", ")}`);
    const { topic, stories, model: editorModel } = await selectFeatureTopic({ files, existingFeatures: features.map((a) => a.title), log });
    // The file told in order: its stories oldest first.
    const ordered = [...stories].sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
    log(`feature file: ${topic.file}; theme: ${topic.theme_ar}; question: ${topic.question_ar}; ${ordered.length} stories`);
    for (const a of ordered) log(`  story: ${String(a.publishedAt).slice(0, 10)} ${a.title}`);
    const sources = internalSources(ordered, { withText: true });
    const { draft, model: writerModel } = await writeFeature({ topic, stories: ordered, log });
    // The file's own tag leads the piece's tags, so the rest period above can find it.
    draft.tags = [topic.file, ...(draft.tags ?? []).filter((t) => t !== topic.file)].slice(0, 6);
    return finishHubPiece({
      kind: "feature",
      section: "analysis",
      draft,
      sources,
      checkSources: sources,
      recentTitles: features.map((a) => a.title),
      wordLimits: FEATURE_WORDS,
      story: { angle: topic.angle || topic.question_ar },
      headlineHint: topic.theme_ar,
      headline: topic.theme_ar,
      models: { editor: editorModel, writer: writerModel },
      existing,
      report,
    });
  });
}

/**
 * The reports desk (lib/reports.mjs; the owner, 2026-10-18: "yes build it, however although arab world is in focus (not
 * only gulf states), but important developed economies are also important like germany, france etc"). Each report of
 * pipeline/reports.json is looked at; a new edition is read from its publisher's own pages and written through the
 * newsroom's ordinary path (notes, writer, desk, critic, check before publication, picture desk), the report counting
 * as a primary source. The first sight of a report records its edition as the starting point, unless that edition is
 * this month's. An edition that fails is tried on the next day once more, then left. At most two a run.
 * State: pipeline/state/reports.json, { reports: { id: { edition, label, url, at, outcome, tries } } }.
 */
const REPORTS_STATE = path.join(root, "pipeline", "state", "reports.json");
function runReports() {
  return runHub("reports", "economy", async (report) => {
    const raw = await readFile(REPORTS_STATE, "utf8").catch(() => null);
    let state = { reports: {} };
    if (raw !== null) {
      try {
        state = JSON.parse(raw);
      } catch {
        log("reports: pipeline/state/reports.json cannot be read; it is left as it is for a person, and nothing is written");
        return { report, published: 0 };
      }
    }
    state.reports ??= {};
    const save = async () => {
      if (!DRY_RUN) await writeJsonAtomic(REPORTS_STATE, state);
    };
    const registry = (await loadRegistry()).filter((r) => !ONLY_REPORT || r.id === ONLY_REPORT);
    const existing = await loadExistingArticles();
    const recentTitles = existing.filter((a) => hoursSince(a.publishedAt) < 96).map((a) => a.title);
    const current = monthKey();
    const fresh = [];
    for (const r of registry) {
      let edition = null;
      try {
        edition = await latestEdition(r, { log });
      } catch (error) {
        log(`report ${r.id}: ${String(error.message).slice(0, 120)}`);
      }
      if (!edition) continue;
      const seen = state.reports[r.id];
      if (!seen) {
        // An official release describes a month or a quarter already past (September's prices come out in mid-October):
        // it is news on first sight while its period ended within the last 45 days.
        const now = edition.key >= (r.kind === "release" ? monthKey(new Date(Date.now() - 45 * 86400000)) : current);
        state.reports[r.id] = { edition: edition.key, label: edition.label, url: edition.url, at: isoNow(), outcome: now ? "new" : "starting point", tries: 0 };
        if (!now) {
          log(`report ${r.id}: «${edition.label}» recorded as the starting point`);
          continue;
        }
      } else if (edition.key < seen.edition || (edition.key === seen.edition && !["new", "retry"].includes(seen.outcome))) continue;
      fresh.push({ r, edition });
    }
    log(`reports: ${fresh.length} new edition(s)${fresh.length ? `: ${fresh.map((f) => `${f.r.id} «${f.edition.label}»`).join(", ")}` : ""}`);
    let published = 0;
    for (const { r, edition } of fresh.slice(0, Math.min(LIMIT, 2))) {
      const prior = state.reports[r.id];
      const tries = prior?.edition === edition.key ? prior.tries ?? 0 : 0;
      const mark = (outcome, extra = {}) => (state.reports[r.id] = { edition: edition.key, label: edition.label, url: edition.url, at: isoNow(), outcome, tries, ...extra });
      if (tries >= 2) {
        mark("left after two tries");
        log(`report ${r.id}: «${edition.label}» failed twice; left`);
        continue;
      }
      // The same edition told already, by the news file or by an earlier run: once is enough.
      // A monthly release's name recurs every month: only a story of the last ten days can be this edition's.
      const window = r.kind === "release" ? 24 * 10 : 24 * 21;
      const covered = existing.find((a) => hoursSince(a.publishedAt) < window &&((a.sourceUrls ?? []).includes(edition.url) || String(a.title).includes(r.name)));
      if (covered) {
        mark(`covered by ${covered.slug}`);
        log(`report ${r.id}: «${edition.label}» already told in ${covered.slug}`);
        continue;
      }
      const { sources } = await readEdition(r, edition, { log });
      if (!sources.length) {
        mark("retry", { tries: tries + 1 });
        report.push({ headline: `${r.nameEn} ${edition.label}`, section: r.section, outcome: "skipped: nothing readable in the report's pages" });
        await save();
        continue;
      }
      const story = r.kind === "release" ? releaseStory(r, edition) : reportStory(r, edition);
      let result = null;
      try {
        result = await produceStory({ story, candidates: [], existing, recentTitles, models: { editor: "reports-desk" }, report, preset: { sources } });
      } catch (error) {
        if (error.meta?.quota) throw error;
        log(`report ${r.id}: ${String(error.message).split("\n")[0]}`);
        report.push({ headline: story.headlineHint, section: r.section, outcome: `error: ${String(error.message).split("\n")[0]}` });
      }
      if (result?.slug) {
        mark(`published ${result.slug}`, { tries: 0 });
        published += 1;
      } else mark("retry", { tries: tries + 1 });
      await save();
    }
    await save();
    return { report, published };
  });
}

/** News runs through runHub like the hub modes: an editor that fails outright still leaves a report and the outputs. */
const RUNNERS = { news: () => runHub("news", "news", runNews), explainer: runExplainer, analysis: runAnalysis, paper: runPaper, weekly: runWeekly, feature: runFeature, reports: runReports };

async function main() {
  const started = Date.now();
  const run = RUNNERS[MODE];
  if (!run) throw new Error(`unknown mode "${MODE}" (${Object.keys(RUNNERS).join(", ")})`);
  log(`newsroom start mode=${MODE} limit=${LIMIT} dry-run=${DRY_RUN}`);
  const outcome = await run();
  const summary = {
    mode: MODE,
    startedAt: new Date(started).toISOString(),
    durationSec: Math.round((Date.now() - started) / 1000),
    published: outcome.published,
    refreshed: outcome.refreshed ?? 0,
    report: outcome.report,
    llm: llmUsage,
    log: logLines.filter((l) => !/\] feed /.test(l)).slice(-150),
  };
  await writeRunReport(summary);
  const md = markdownSummary(summary);
  console.log(`\n${md}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=${outcome.published}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
