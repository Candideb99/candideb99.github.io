#!/usr/bin/env node
/**
 * خازندار newsroom pipeline.
 *
 *   node pipeline/run.mjs                 # select, write, verify and publish news stories
 *   node pipeline/run.mjs --dry-run       # everything except writing files/state
 *   node pipeline/run.mjs --limit=4       # cap the number of stories
 *   node pipeline/run.mjs --source=ecb    # restrict to one feed
 *   node pipeline/run.mjs --mode=explainer
 */
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fetchFeed } from "./lib/feeds.mjs";
import { extractArticle } from "./lib/extract.mjs";
import { selectExplainerTopic, selectStories } from "./lib/select.mjs";
import { reviseArticle, writeArticle, writeExplainer } from "./lib/write.mjs";
import { critique, programmaticChecks } from "./lib/verify.mjs";
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
const LIMIT = Math.max(1, Math.min(Number(option("limit", 6)) || 6, 10));
const ONLY_SOURCE = option("source", null);
const MIN_IMPORTANCE = Number(option("min-importance", 5));

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
  let checks = programmaticChecks(draft, sources, { recentTitles });
  let review = await critique({ draft, sources, log });
  log(`critic "${draft.title}": ${review.verdict} score=${review.score} issues=${review.issues.length}`);
  for (const issue of [...checks.issues, ...review.issues].slice(0, 4)) log(`  · ${String(issue).slice(0, 160)}`);

  let revised = false;
  const rejected = review.verdict === "reject" || review.score < 4;
  const issues = [...checks.issues, ...(review.verdict !== "publish" ? review.issues : [])];
  if (issues.length) {
    // One revision round. A rejected draft gets a second critic pass; a "revise" verdict is trusted after the fix.
    const revision = await reviseArticle({ draft, sources, issues, log });
    draft = revision.draft;
    writerModel = `${writerModel} → ${revision.model}`;
    revised = true;
    checks = programmaticChecks(draft, sources, { recentTitles });
    if (!checks.ok) {
      entry.outcome = `rejected after revision: ${checks.issues.join(" | ")}`;
      report.push(entry);
      log(`reject "${draft.title}" after revision: ${checks.issues.join(" | ")}`);
      return { rejected: true, items };
    }
    // Every revised draft faces the critic again; nothing is published on a "revise" verdict alone.
    const floor = rejected ? 6 : 5;
    review = await critique({ draft, sources, log });
    log(`critic (second pass) "${draft.title}": ${review.verdict} score=${review.score} issues=${review.issues.length}`);
    if (review.verdict === "reject" || review.score < floor) {
      entry.outcome = `rejected by critic after revision (${review.score}): ${review.summary}`;
      report.push(entry);
      return { rejected: true, items };
    }
  }

  const image = await pickImage({ draft, story, log });
  const slug = buildSlug(draft, story);
  const markdown = serializeArticle({
    draft,
    slug,
    section: story.section,
    sources,
    image,
    models: { editor: models.editor, writer: writerModel, critic: review.model, vision: image?.model ?? null },
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
  const sections = await readJson(path.join(root, "src", "data", "sections.json"), []);
  const state = await loadState();
  const existing = await loadExistingArticles();
  const recentTitles = existing.filter((a) => hoursSince(a.publishedAt) < 96).map((a) => a.title);
  const report = [];

  const candidates = await gatherCandidates(config.sources, state, existing);
  log(`candidates: ${candidates.length} fresh unseen items`);
  if (candidates.length < 3) {
    log("too few candidates; nothing to do");
    return { report, published: 0 };
  }

  const { stories, model: editorModel } = await selectStories({ candidates, recentTitles, sections, limit: LIMIT, log });
  log(`editor (${editorModel}) selected ${stories.length} stories`);
  const chosen = stories.filter((s) => s.importance >= MIN_IMPORTANCE).slice(0, LIMIT);
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

async function runExplainer() {
  const existing = await loadExistingArticles();
  const recent = existing.filter((a) => a.kind === "news" && hoursSince(a.publishedAt) < 72).slice(0, 25);
  const explainers = existing.filter((a) => a.kind === "explainer").map((a) => a.title);
  const report = [];
  if (recent.length < 3) {
    log("not enough recent coverage to anchor an explainer");
    return { report, published: 0 };
  }
  const { topic, model: editorModel } = await selectExplainerTopic({ recentArticles: recent, existingExplainers: explainers, log });
  log(`explainer topic: ${topic.concept_ar} (${topic.concept_en})`);
  const related = recent.filter((a) => (topic.related_titles ?? []).includes(a.title)).slice(0, 4);
  const { draft: firstDraft, model: writerModel } = await writeExplainer({ topic, relatedArticles: related, log });
  let draft = firstDraft;
  let checks = programmaticChecks(draft, [], { explainer: true, recentTitles: explainers });
  const review = await critique({ draft, sources: [], explainer: true, log });
  log(`critic explainer: ${review.verdict} score=${review.score}`);
  const entry = { headline: topic.concept_ar, section: "explainers", outcome: "" };
  if (review.verdict === "reject" || review.score < 5) {
    entry.outcome = `rejected (${review.score}): ${review.summary}`;
    report.push(entry);
    return { report, published: 0 };
  }
  let revised = false;
  const issues = [...checks.issues, ...(review.verdict === "revise" ? review.issues : [])];
  if (issues.length) {
    const revision = await reviseArticle({ draft, sources: [], issues, log });
    draft = revision.draft;
    revised = true;
    checks = programmaticChecks(draft, [], { explainer: true, recentTitles: explainers });
    if (!checks.ok) {
      entry.outcome = `rejected after revision: ${checks.issues.join(" | ")}`;
      report.push(entry);
      return { report, published: 0 };
    }
  }
  const image = await pickImage({ draft, story: { angle: topic.hook }, log });
  const slug = buildSlug(draft, { headlineHint: topic.concept_en });
  const markdown = serializeArticle({
    draft,
    slug,
    section: "explainers",
    explainer: true,
    sources: related.map((a) => ({ sourceName: "خازندار", sourceNameEn: "Khazendar", title: a.title, url: `/articles/${a.slug}/`, lang: "ar", publishedAt: a.publishedAt })),
    image,
    models: { editor: editorModel, writer: writerModel, critic: review.model, vision: image?.model ?? null },
    quality: { score: review.score, verdict: review.verdict, revised, warnings: checks.warnings, criticSummary: review.summary },
  });
  if (!DRY_RUN) {
    await mkdir(ARTICLES_DIR, { recursive: true });
    await writeFile(path.join(ARTICLES_DIR, `${slug}.md`), markdown);
  }
  entry.outcome = "published";
  entry.slug = slug;
  entry.title = draft.title;
  entry.score = review.score;
  report.push(entry);
  log(`published explainer "${draft.title}" -> ${slug}`);
  return { report, published: 1 };
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

async function main() {
  const started = Date.now();
  log(`newsroom start mode=${MODE} limit=${LIMIT} dry-run=${DRY_RUN}`);
  const outcome = MODE === "explainer" ? await runExplainer() : await runNews();
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
