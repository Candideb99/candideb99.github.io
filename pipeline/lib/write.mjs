import { chat } from "./llm.mjs";
import { arabicRatio, truncate, wordCount } from "./util.mjs";

export const WRITER_SYSTEM = `You are the senior economics correspondent of خازندار (Khazendar), an Arabic-language economics and business publication for educated readers across the Arab world.

HOUSE STYLE
- Write original journalism in clear Modern Standard Arabic (فصحى معاصرة). Never translate a source sentence by sentence; report the facts in your own structure and words.
- When a source is itself in Arabic, rewrite it completely: never reuse any of its phrases longer than three words; copying Arabic sentences is plagiarism and the article will be rejected.
- Attribute every claim to its source in the text ("وفقاً لبيانات يوروستات"، "قال البنك المركزي الأوروبي في بيان"، "بحسب تقرير بي بي سي"). Never present a source's claim as your own knowledge.
- Keep every number, date and name exactly as in the sources. Never invent, estimate, round differently, or extrapolate figures. If a figure is missing, say the source did not disclose it.
- Use Western digits (0-9), the pan-Arab month names (يناير، فبراير، مارس، أبريل، مايو، يونيو، يوليو، أغسطس، سبتمبر، أكتوبر، نوفمبر، ديسمبر), and Arabic units (مليار، مليون، نقطة أساس، %).
- Write foreign names in Arabic transliteration; for lesser-known people or companies add the Latin original in parentheses once. Keep well-known tickers and acronyms in Latin (S&P 500, OPEC+, IMF) when that is how Arab business media write them.
- Headlines: one clear sentence with the key fact; never use ".." or "!" or a colon-teaser; no "تعرف على" or question headlines for news.
- Tone: calm, precise, authoritative. No sensationalism, no clichés, no rhetorical questions, no first person, no moralising, no filler like "في هذا السياق" more than once.
- Explain context that an Arab reader needs (what the institution is, why the indicator matters) in one clause, without lecturing.
- No URLs, no markdown links, no headings other than optional "## " subheads for long pieces, no bullet lists inside the body.
- Do not mention that you are an AI or that the article was generated.

You always respond with a single JSON object and nothing else.`;

const SCHEMA_TEXT = `{
  "title": "Arabic headline, 35-80 characters, ONE idea (never chain two or three developments with و), specific, contains the key fact or number, no colon-tricks, no clickbait",
  "subtitle": "Arabic dek: one sentence (max 160 chars) adding the most important detail not in the headline",
  "slug": "english-kebab-case-slug-4-to-7-words",
  "lede": "Opening paragraph: 2-3 sentences with the core news, the who/what/when, and the main number",
  "body": "The rest of the article in Markdown: 4-7 paragraphs separated by blank lines, 300-550 words total, with attribution and context. May include one or two '## ' subheads if the piece is long.",
  "key_facts": [{"label": "short Arabic label (2-5 words)", "value": "the figure exactly as sourced, e.g. 4,000 or 1.7 مليار جنيه or 2.25%"}],
  "why_it_matters": "One Arabic paragraph (60-120 words) explaining concretely what this means for Arab economies, businesses or readers. Grounded in the sources; no speculation presented as fact.",
  "tags": ["3-5 Arabic tags: institutions, countries, sectors, indicators"],
  "regions": ["1-3 Arabic region tags"],
  "image_queries": ["2-3 short English search terms (2-4 words each) naming a concrete subject that exists as a photo on Wikimedia Commons: an institution's headquarters, a city, a port, a plant, a product, a commodity (e.g. 'Bundesbank Frankfurt', 'Ras Laffan', 'oil tanker', 'Riyadh skyline'); no adjectives, no abstract concepts"],
  "chart": null or {"type": "bar" | "line", "title": "Arabic chart title (what is measured)", "unit": "Arabic unit, e.g. % or مليار دولار", "source": "publisher name", "categories": ["Arabic x-axis labels, 3-12 items, in the sources' order"], "series": [{"name": "Arabic series name", "values": [numbers, one per category, exactly as in the sources]}]},
  "table": null or {"title": "Arabic table title", "source": "publisher name", "columns": ["2-5 Arabic column headers"], "rows": [["cells as Arabic text or numbers exactly as in the sources"]]}
}
Data visuals: include "chart" only when the sources give at least three comparable figures of the same kind (a time series, or the same indicator across countries/companies); use "line" for time series and "bar" for comparisons; at most 3 series. Include "table" only when the sources list comparable figures for several entities (max 12 rows). Every number in a chart or table must appear in the sources; translate all labels to Arabic; otherwise set them to null.`;

function sourceBlock(source, index) {
  const text = source.text || source.summary || "";
  return `SOURCE ${index + 1}: ${source.sourceNameEn} (${source.lang}) — "${source.title}" — published ${source.publishedAt ?? "unknown"}
${text}`;
}

export function validateDraft(draft) {
  if (!draft || typeof draft !== "object") throw new Error("draft is not an object");
  // Tolerate renamed keys from different models.
  draft.key_facts = draft.key_facts ?? draft.keyFacts ?? draft.key_figures ?? draft.facts ?? draft.numbers ?? [];
  draft.why_it_matters = draft.why_it_matters ?? draft.whyItMatters ?? draft.why ?? "";
  draft.image_queries = draft.image_queries ?? draft.imageQueries ?? draft.images ?? [];
  const required = ["title", "subtitle", "slug", "lede", "body", "tags"];
  for (const key of required) if (draft[key] == null || draft[key] === "") throw new Error(`draft.${key} missing`);
  if (String(draft.title).length < 15 || String(draft.title).length > 95) throw new Error("title length out of range (15-95 chars); write one idea per headline");
  if (!Array.isArray(draft.key_facts)) throw new Error("key_facts must be an array");
  if (!draft.why_it_matters) throw new Error("why_it_matters missing");
  const prose = [draft.title, draft.subtitle, draft.lede, draft.body, draft.why_it_matters].join("\n");
  if (arabicRatio(prose) < 0.85) throw new Error(`Arabic ratio too low: ${arabicRatio(prose).toFixed(2)}`);
  const words = wordCount(`${draft.lede}\n${draft.body}`);
  if (words < 170 || words > 1100) throw new Error(`body word count out of range: ${words}`);
  if (/https?:\/\//i.test(prose)) throw new Error("draft contains a URL");
}

/** Writes an original Arabic article from a story cluster. */
export async function writeArticle({ story, sources, log }) {
  const user = `STORY BRIEF FROM THE EDITOR
Angle: ${story.angle}
Working headline: ${story.headlineHint}
Section: ${story.section}
Today (UTC): ${new Date().toISOString().slice(0, 10)}

SOURCE MATERIAL (use only this material; do not add facts from memory)
${sources.map(sourceBlock).join("\n\n")}

TASK
Write the article for خازندار following the house style. Return one JSON object exactly in this shape:
${SCHEMA_TEXT}`;

  const { data, model } = await chat({
    role: "writer",
    system: WRITER_SYSTEM,
    user,
    temperature: 0.35,
    maxTokens: 5000,
    log,
    validate: validateDraft,
  });
  return { draft: normalizeDraft(data), model };
}

/** Sends critic findings back to the writer for one revision. */
export async function reviseArticle({ draft, sources, issues, log }) {
  const user = `You previously wrote this article for خازندار:
${JSON.stringify(draft, null, 2)}

SOURCE MATERIAL
${sources.map(sourceBlock).join("\n\n")}

An editor found the following problems. Fix every one of them strictly using the source material. Remove any claim or number that the sources do not support. Keep everything else intact, and keep the article at least 260 words (lede + body) when the sources allow it; never pad with unsupported material.
PROBLEMS
${issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}

Return the complete corrected article as one JSON object with the same keys as before (title, subtitle, slug, lede, body, key_facts, why_it_matters, tags, regions, image_queries).`;
  const { data, model } = await chat({
    role: "writer",
    system: WRITER_SYSTEM,
    user,
    temperature: 0.25,
    maxTokens: 5000,
    log,
    validate: validateDraft,
  });
  return { draft: normalizeDraft(data), model };
}

export function normalizeDraft(d) {
  const keyFacts = (Array.isArray(d.key_facts) ? d.key_facts : [])
    .map((f) => (typeof f === "string" ? { label: "", value: f } : { label: String(f.label ?? "").trim(), value: String(f.value ?? "").trim() }))
    .filter((f) => f.value)
    .slice(0, 6);
  return {
    title: String(d.title).trim(),
    subtitle: truncate(String(d.subtitle ?? "").trim(), 220),
    slug: String(d.slug ?? "").trim(),
    lede: String(d.lede ?? "").trim(),
    body: String(d.body ?? "").trim(),
    keyFacts,
    whyItMatters: String(d.why_it_matters ?? "").trim(),
    tags: [...new Set((Array.isArray(d.tags) ? d.tags : []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 6),
    regions: [...new Set((Array.isArray(d.regions) ? d.regions : []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 3),
    imageQueries: (Array.isArray(d.image_queries) ? d.image_queries : []).map((q) => String(q).trim()).filter(Boolean).slice(0, 3),
    chart: normalizeChart(d.chart),
    table: normalizeTable(d.table),
  };
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value ?? "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/[,\s%]/g, "").replace(/٫/g, "."));
  return Number.isFinite(n) ? n : null;
}

/** Keeps a chart only when it is structurally sound: 3-12 categories, 1-3 series of matching numeric length. */
export function normalizeChart(chart) {
  if (!chart || typeof chart !== "object") return null;
  const categories = (Array.isArray(chart.categories) ? chart.categories : []).map((c) => String(c ?? "").trim()).filter(Boolean).slice(0, 12);
  const series = (Array.isArray(chart.series) ? chart.series : [])
    .map((s) => ({ name: String(s?.name ?? "").trim(), values: (Array.isArray(s?.values) ? s.values : []).map(toNumber) }))
    .filter((s) => s.name && s.values.length === categories.length && s.values.every((v) => v !== null))
    .slice(0, 3);
  if (categories.length < 3 || !series.length) return null;
  return {
    type: chart.type === "line" ? "line" : "bar",
    title: String(chart.title ?? "").trim() || null,
    unit: String(chart.unit ?? "").trim(),
    source: String(chart.source ?? "").trim(),
    categories,
    series,
  };
}

/** Keeps a table only when every row has the column count and there are at least two rows. */
export function normalizeTable(table) {
  if (!table || typeof table !== "object") return null;
  const columns = (Array.isArray(table.columns) ? table.columns : []).map((c) => String(c ?? "").trim()).filter(Boolean).slice(0, 5);
  const rows = (Array.isArray(table.rows) ? table.rows : [])
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").trim()) : []))
    .filter((r) => r.length === columns.length && r.some(Boolean))
    .slice(0, 12);
  if (columns.length < 2 || rows.length < 2) return null;
  return { title: String(table.title ?? "").trim() || null, source: String(table.source ?? "").trim(), columns, rows };
}

const EXPLAINER_SCHEMA = `{
  "title": "Arabic title in the form of a clear question or statement (35-80 chars), e.g. ما هو منحنى العائد ولماذا يخيف الأسواق عندما ينقلب؟",
  "subtitle": "One Arabic sentence stating what the reader will understand",
  "slug": "english-kebab-case-slug",
  "lede": "2-3 sentences: the concept in plain words and why it is in the news now",
  "body": "500-800 words in Markdown with 2-4 '## ' subheads: definition, mechanism, a worked example with illustrative numbers explicitly labelled as an example (مثال توضيحي), common misunderstandings, and what to watch. No bullet lists.",
  "key_facts": [{"label": "term or rule of thumb", "value": "short definition or formula"}],
  "why_it_matters": "One paragraph on why Arab readers, businesses or policymakers should care",
  "tags": ["3-5 Arabic tags"],
  "regions": ["عالمي"],
  "image_queries": ["2 concrete English photo search phrases"]
}`;

export async function writeExplainer({ topic, relatedArticles, log }) {
  const user = `Write an evergreen explainer for خازندار about: ${topic.concept_ar} (${topic.concept_en}).
Current hook: ${topic.hook}
Related خازندار coverage you may reference by title (no links): ${relatedArticles.map((a) => a.title).join(" | ") || "none"}

Rules: explain like a patient, precise teacher; use standard economic definitions; every number in the worked example must be explicitly introduced as an illustrative example (مثال توضيحي), never as a real current statistic; do not cite specific current statistics unless they appear in the related coverage titles.
Return one JSON object exactly in this shape:
${EXPLAINER_SCHEMA}`;
  const { data, model } = await chat({
    role: "writer",
    system: WRITER_SYSTEM,
    user,
    temperature: 0.4,
    maxTokens: 6000,
    log,
    validate: validateDraft,
  });
  return { draft: normalizeDraft(data), model };
}
