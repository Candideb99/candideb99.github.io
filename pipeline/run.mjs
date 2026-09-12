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
 *
 * Reads OPENROUTER_API_KEY from the environment or from .env (see lib/env.mjs).
 */
import "./lib/env.mjs";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fetchFeed } from "./lib/feeds.mjs";
import { extractArticle } from "./lib/extract.mjs";
import { newsSectionsOf, selectAnalysisTopic, selectExplainerTopic, selectStories } from "./lib/select.mjs";
import { ANALYSIS_WORDS, reviseArticle, writeAnalysis, writeArticle, writeExplainer } from "./lib/write.mjs";
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
const MIN_IMPORTANCE = Number(option("min-importance", 6));

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

function markItems(state, items, decision, slug) {
  for (const item of items) state.items[fingerprint(item.url)] = { at: isoNow(), decision, slug, title: item.title };
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
    if (state.items[fp] || usedUrls.has(fp)) continue;
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
  if (!sources.some((s) => s.text) && evidenceChars < 700) {
    entry.outcome = "skipped: insufficient evidence";
    report.push(entry);
    log(`skip "${story.headlineHint}": insufficient evidence (${evidenceChars} chars)`);
    return null;
  }

  let { draft, model: writerModel } = await writeArticle({ story, sources, log });
  const desk = await copyDeskPass(draft);
  draft = desk.draft;
  const deskModel = desk.model;
  let checks = programmaticChecks(draft, sources, { recentTitles });
  let review = await critique({ draft, sources, log });
  log(`critic "${draft.title}": ${review.verdict} score=${review.score} issues=${review.issues.length}`);
  for (const issue of [...checks.issues, ...review.issues].slice(0, 4)) log(`  · ${String(issue).slice(0, 160)}`);

  let revised = false;
  const issues = [...checks.issues, ...(review.verdict !== "publish" ? review.issues : [])];
  if (issues.length) {
    // One revision round. A rejected draft gets a second critic pass; a "revise" verdict is trusted after the fix.
    const revision = await reviseArticle({ draft, sources, issues, log });
    draft = (await copyDeskPass(revision.draft, { includeBody: false })).draft;
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
    review = await critique({ draft, sources, log });
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

async function runNews() {
  const config = await readJson(path.join(root, "pipeline", "sources.json"), { sources: [] });
  // News is filed only into the news sections; the analysis and explainers hubs hold the paper's own pieces.
  const sections = newsSectionsOf(await readJson(path.join(root, "src", "data", "sections.json"), []));
  const state = await loadState();
  const existing = await loadExistingArticles();
  const recentTitles = existing.filter((a) => hoursSince(a.publishedAt) < 96).map((a) => a.title);
  // Stories per section in the last 24 hours, so the editor can favour a quiet section over a crowded one.
  const coverage24h = {};
  for (const a of existing) if (a.kind === "news" && hoursSince(a.publishedAt) < 24) coverage24h[a.section] = (coverage24h[a.section] ?? 0) + 1;
  const report = [];

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
    return { report: [], published: 0 };
  }
  const runLimit = Math.min(LIMIT, room);
  const { stories, model: editorModel } = await selectStories({ candidates, recentTitles, sections, coverage24h, limit: runLimit, log });
  log(`editor (${editorModel}) selected ${stories.length} stories`);
  const chosen = stories.filter((s) => s.importance >= MIN_IMPORTANCE).slice(0, runLimit);
  for (const s of stories) log(`  [${s.importance}] ${s.section} — ${s.headlineHint} (${s.ids.join(",")})${chosen.includes(s) ? "" : s.importance < MIN_IMPORTANCE ? " (below threshold)" : " (deferred: over limit)"}`);

  let published = 0;
  const publishedTitles = [...recentTitles];
  for (const story of chosen) {
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
 * Shared tail of the explainer and analysis modes: programmatic checks, the critic, one revision round
 * with a second critic pass, the photo, and the file. `checkSources` is what the draft is checked
 * against (nothing for an explainer, the related stories for an analysis); `sources` is what is filed.
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
  if (review.verdict === "reject" || review.score < 5) {
    entry.outcome = `rejected (${review.score}): ${review.summary}`;
    report.push(entry);
    return { report, published: 0 };
  }
  let revised = false;
  let finalReview = review;
  let writerModel = models.writer;
  const issues = [...checks.issues, ...(review.verdict === "revise" ? review.issues : [])];
  if (issues.length) {
    const revision = await reviseArticle({ draft, sources: checkSources, issues, log, wordLimits });
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
    finalReview = await critique({ draft, sources: checkSources, ...flags, log });
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
    const recent = recentNews(existing, 40);
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

async function writeRunReport(summary) {
  if (DRY_RUN) return;
  await mkdir(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(path.join(RUNS_DIR, `${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(RUNS_DIR, "latest.json"), `${JSON.stringify(summary, null, 2)}\n`);
  // Keep the repository small: only the most recent run reports survive.
  const { readdir, unlink } = await import("node:fs/promises");
  const files = (await readdir(RUNS_DIR)).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort();
  for (const stale of files.slice(0, Math.max(0, files.length - 24))) await unlink(path.join(RUNS_DIR, stale));
}

function markdownSummary(summary) {
  const rows = summary.report
    .map((r) => `| ${r.section ?? ""} | ${(r.title ?? r.headline ?? "").replace(/\|/g, "/")} | ${r.score ?? ""} | ${r.image ?? ""} | ${r.outcome} |`)
    .join("\n");
  return `## خازندار newsroom — ${summary.mode} (${summary.published} published)\n\n| section | story | score | image | outcome |\n|---|---|---|---|---|\n${rows || "| | (nothing) | | | |"}\n\nLLM calls: ${summary.llm.calls} ok, ${summary.llm.failures} failed; models: ${Object.entries(summary.llm.byModel).map(([m, n]) => `${m}×${n}`).join(", ") || "none"}\n`;
}

const RUNNERS = { news: runNews, explainer: runExplainer, analysis: runAnalysis };

async function main() {
  const started = Date.now();
  const run = RUNNERS[MODE];
  if (!run) throw new Error(`unknown mode "${MODE}" (news, explainer or analysis)`);
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
