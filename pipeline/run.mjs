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
 *
 * Reads OPENROUTER_API_KEY from the environment or from .env (see lib/env.mjs).
 */
import "./lib/env.mjs";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fetchFeed } from "./lib/feeds.mjs";
import { extractArticle } from "./lib/extract.mjs";
import { newsSectionsOf, selectAnalysisTopic, selectExplainerTopic, selectPaper, selectStories } from "./lib/select.mjs";
import { ANALYSIS_WORDS, PAPER_WORDS, WEEKLY_WORDS, deskNotes, reviseArticle, writeAnalysis, writeArticle, writeExplainer, writePaperReading, writeWeekly } from "./lib/write.mjs";
import { critique, programmaticChecks } from "./lib/verify.mjs";
import { copyEdit } from "./lib/copydesk.mjs";
import { pickImage } from "./lib/images.mjs";
import { ARTICLES_DIR, buildSlug, loadExistingArticles, serializeArticle } from "./lib/article.mjs";
import { usage as llmUsage } from "./lib/llm.mjs";
import { fingerprint, hoursSince, isoNow, sleep } from "./lib/util.mjs";

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
const MODE = option("mode", "news");
const LIMIT = Math.max(1, Math.min(Number(option("limit", 4)) || 4, 10));
/** A day's paper is edited, not filled: at most this many news stories in any 24 hours. */
const DAILY_CAP = Number(process.env.KHAZENDAR_DAILY_CAP) || 10;
const ONLY_SOURCE = option("source", null);
const MIN_IMPORTANCE = (() => {
  const n = Number(option("min-importance", 6));
  return Number.isFinite(n) ? n : 6;
})();
/** A news run stops taking new stories after this long, so the job's own timeout never discards finished work. */
const RUN_STARTED = Date.now();
const RUN_BUDGET_MS = 35 * 60 * 1000;
/** A first rejection expires after this long (the item may be tried once more); a second one is final for the state's 21 days. */
const REJECT_RETRY_HOURS = 12;
/** `--sections=defense,energy`: an analysis drawn only from these sections' stories (the defence and geopolitics reading). */
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
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
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
  for (const item of all) {
    const fp = fingerprint(item.url);
    if (blocks(state.items[fp]) || usedUrls.has(fp)) continue;
    const titleKey = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 90);
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    candidates.push(item);
  }
  candidates.sort((a, b) => hoursSince(a.publishedAt) - hoursSince(b.publishedAt));
  const capped = candidates.slice(0, 260);
  capped.forEach((c, i) => {
    c.id = `c${i + 1}`;
  });
  return capped;
}

async function collectEvidence(story, candidates) {
  const items = story.ids.map((id) => candidates.find((c) => c.id === id)).filter(Boolean);
  // Prefer official and tier-A sources, then freshness; fetch at most three bodies.
  items.sort((a, b) => b.reliability - a.reliability || hoursSince(a.publishedAt) - hoursSince(b.publishedAt));
  const sources = [];
  for (const item of items.slice(0, 5)) {
    let text = "";
    let fetched = null;
    if (!item.paywalled && sources.filter((s) => s.text).length < 3) {
      fetched = await extractArticle(item.url, { log });
      if (fetched.ok) text = fetched.text;
      else log(`evidence ${item.sourceId}: ${fetched.reason}`);
    }
    sources.push({
      id: item.id,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      sourceNameEn: item.sourceNameEn,
      title: item.title,
      url: item.url,
      lang: item.lang,
      publishedAt: item.publishedAt,
      summary: item.summary,
      text,
      ogImage: fetched?.ogImage ?? "",
    });
    if (sources.length >= 4) break;
  }
  const evidenceChars = sources.reduce((n, s) => n + (s.text || s.summary || "").length, 0);
  return { items, sources, evidenceChars };
}

/** Pictures already printed on the site; a new story never repeats one. */
const usedImages = (existing) => new Set(existing.map((a) => a.imageUrl).filter(Boolean));

/**
 * The Arabic copy desk runs on every draft before the critic sees it: it rewrites translationese
 * (the owner's rule: no literal translations) and its guard keeps every figure and name intact. A
 * desk failure never blocks a story; the draft simply goes on as written.
 */
async function copyDeskPass(draft, { includeBody = true } = {}) {
  try {
    const desk = await copyEdit({ draft, includeBody, role: "desk", log });
    if (desk.changed) log(`desk "${desk.draft.title}": rewrote ${desk.applied.join(", ")}${desk.rejected.length ? `; refused ${desk.rejected.map((r) => `${r.field} (${r.reason})`).join(", ")}` : ""}`);
    return desk;
  } catch (error) {
    log(`desk skipped: ${String(error.message).slice(0, 140)}`);
    return { draft, changed: false, model: null };
  }
}

async function produceStory({ story, candidates, existing, recentTitles, models, report }) {
  const { items, sources, evidenceChars } = await collectEvidence(story, candidates);
  const entry = { headline: story.headlineHint, section: story.section, importance: story.importance, sources: sources.map((s) => s.url) };
  // A story is written from at least one fetched article body, never from feed summaries alone: a writer asked
  // for 300 words out of 100 invents the rest. The items take the short "rejected" mark, so a page that was
  // down is tried once more next run.
  if (!sources.some((s) => s.text)) {
    entry.outcome = `skipped: no source body could be fetched (${evidenceChars} chars of feed summaries only)`;
    report.push(entry);
    log(`skip "${story.headlineHint}": no source body could be fetched (${evidenceChars} chars of summaries); items marked for one retry`);
    return { rejected: true, items };
  }

  // Stage one: the desk notes, the checked facts of the one event; stage two: the story written from them.
  const notesResult = await deskNotes({ story, sources, log });
  const notes = notesResult?.notes ?? null;
  if (notes) log(`desk notes: ${notes.facts.length} facts, ${notes.quotes.length} quotes (${notesResult.model})`);
  let { draft, model: writerModel } = await writeArticle({ story, sources, notes, log });
  const desk = await copyDeskPass(draft);
  draft = desk.draft;
  const deskModel = desk.model;
  let checks = programmaticChecks(draft, sources, { recentTitles });
  let review = await critique({ draft, sources, log });
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
    const revision = await reviseArticle({ draft, sources, issues, log, notes });
    draft = (await copyDeskPass(revision.draft, { includeBody: true })).draft;
    writerModel = `${writerModel} → ${revision.model}`;
    revised = true;
    checks = programmaticChecks(draft, sources, { recentTitles });
    if (!checks.ok) {
      entry.outcome = `rejected after revision: ${checks.issues.join(" | ")}`;
      report.push(entry);
      log(`reject "${draft.title}" after revision: ${checks.issues.join(" | ")}`);
      return { rejected: true, items };
    }
    // Every revised draft faces the critic again and is published only with a second-pass score of 6 or more.
    const floor = 6;
    review = await critique({ draft, sources, previousIssues: issues, log });
    log(`critic (second pass) "${draft.title}": ${review.verdict} score=${review.score} issues=${review.issues.length}`);
    if (review.verdict === "reject" || review.score < floor) {
      entry.outcome = `rejected by critic after revision (${review.score}): ${review.summary}`;
      report.push(entry);
      return { rejected: true, items };
    }
  }

  const image = await pickImage({ draft, story, log, exclude: usedImages(existing) });
  const slug = buildSlug(draft, story);
  const markdown = serializeArticle({
    draft,
    slug,
    section: story.section,
    sources,
    image,
    models: { editor: models.editor, writer: writerModel, critic: review.model, vision: image?.model ?? null, desk: deskModel },
    quality: {
      score: review.score,
      verdict: review.verdict,
      revised,
      importance: story.importance,
      warnings: checks.warnings,
      criticSummary: review.summary,
    },
  });
  entry.outcome = "published";
  entry.slug = slug;
  entry.title = draft.title;
  entry.score = review.score;
  entry.image = image ? "photo" : "cover-art";
  report.push(entry);
  if (!DRY_RUN) {
    await mkdir(ARTICLES_DIR, { recursive: true });
    await writeFile(path.join(ARTICLES_DIR, `${slug}.md`), markdown);
  }
  log(`published "${draft.title}" -> ${slug}${DRY_RUN ? " (dry-run)" : ""}`);
  return { slug, items, title: draft.title };
}

async function runNews(report) {
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
  const chosen = stories.filter((s) => s.importance >= MIN_IMPORTANCE).slice(0, runLimit);
  // Section balance: a section with nothing in three days takes its best candidate (one point under
  // the threshold is enough) in place of the weakest chosen story from a section already served, so
  // no section runs empty while another fills up: الدفاع stayed empty for a week this way, its
  // stories scoring 6 and deferred behind the economy's every run.
  const sectionIds = sections.map((x) => (typeof x === "string" ? x : x.id));
  const starved = sectionIds.filter((sec) => !existing.some((a) => a.kind === "news" && a.section === sec && hoursSince(a.publishedAt) < 72) && !chosen.some((x) => x.section === sec));
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
      }
      await saveState(state);
    } catch (error) {
      log(`story failed "${story.headlineHint}": ${String(error.message).split("\n")[0]}`);
      report.push({ headline: story.headlineHint, section: story.section, outcome: `error: ${String(error.message).split("\n")[0]}` });
      await sleep(3000);
    }
  }
  return { report, published };
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
  const desk = await copyDeskPass(firstDraft);
  let draft = desk.draft;
  const deskModel = desk.model;
  const flags = { [kind]: true };
  let checks = programmaticChecks(draft, checkSources, { ...flags, recentTitles });
  log(`checks ${kind} "${draft.title}": ${checks.metrics.words} words, ${checks.issues.length} issues, ${checks.warnings.length} warnings`);
  const review = await critique({ draft, sources: checkSources, ...flags, log });
  log(`critic ${kind}: ${review.verdict} score=${review.score} issues=${review.issues.length}`);
  for (const issue of [...checks.issues, ...review.issues].slice(0, 4)) log(`  · ${String(issue).slice(0, 160)}`);
  const entry = { headline, section, outcome: "" };
  // A first pass under 5 is not worth a revision, except for the week's review, whose length and
  // many sources draw a 4 with a "revise" list from the free critic; it gets its round like any piece.
  if (review.verdict === "reject" || (review.score < 5 && kind !== "weekly")) {
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
    draft = (await copyDeskPass(revision.draft, { includeBody: false })).draft;
    writerModel = `${writerModel} → ${revision.model}`;
    revised = true;
    checks = programmaticChecks(draft, checkSources, { ...flags, recentTitles });
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
  const image = await pickImage({ draft, story, log, exclude: usedImages(existing) });
  const slug = buildSlug(draft, { headlineHint });
  const markdown = serializeArticle({
    draft,
    slug,
    section,
    kind,
    sources,
    image,
    models: { editor: models.editor, writer: writerModel, critic: finalReview.model, vision: image?.model ?? null, desk: deskModel },
    quality: { score: finalReview.score, verdict: finalReview.verdict, revised, warnings: checks.warnings, criticSummary: finalReview.summary },
  });
  if (!DRY_RUN) {
    await mkdir(ARTICLES_DIR, { recursive: true });
    await writeFile(path.join(ARTICLES_DIR, `${slug}.md`), markdown);
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

/** News runs through runHub like the hub modes: an editor that fails outright still leaves a report and the outputs. */
const RUNNERS = { news: () => runHub("news", "news", runNews), explainer: runExplainer, analysis: runAnalysis, paper: runPaper, weekly: runWeekly };

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
