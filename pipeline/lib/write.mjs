import { chat } from "./llm.mjs";
import { arabicRatio, truncate, wordCount } from "./util.mjs";

const HOUSE_STYLE = `HOUSE STYLE (the practice of the Arabic economics desks: الشرق الأوسط، الاقتصادية، الشرق بلومبرغ، CNBC عربية، الجزيرة)
- Write original journalism in clear Modern Standard Arabic (فصحى معاصرة). Never translate a source sentence by sentence; report the facts in your own structure and words. The reader must never feel English under the Arabic.
- When a source is itself in Arabic, rewrite it completely: never reuse any of its phrases longer than three words; copying Arabic sentences is plagiarism and the article will be rejected.
- THE LEDE: a past-tense verb of action or saying, then the named actor, then the figure, then the cause clause (بعدما، مع، وسط، في ظل). Under 45 words. No scene-setting, no "في خطوة"، no "شهد". Vary the opening verb across stories (أعلنت، خفّضت، أبقى، قرر، سجّل، تراجع، قفز، رفعت، أظهرت بيانات، كشف). Model: «خفّضت منظمة أوبك توقعاتها لنمو الطلب العالمي على النفط في 2026 للمرة الخامسة على التوالي، في مؤشر على استمرار تأثير الحرب».
- THE SECOND PARAGRAPH does one of three things: the source's own words («وقال البنك في بيان إن…»), the hard figure behind the lede, or the contrast («وفي المقابل…»). THE THIRD gives context with «وكان…» or «وجاء…».
- EVERY FIGURE in this order: value, unit, direction, benchmark, time, source («تراجع سعر الذهب 0.3% إلى 4522 دولاراً للأونصة بحلول الساعة 02:22 بتوقيت غرينتش، بحسب رويترز»). Adjectives only when quantified («أكبر زيادة منذ مايو»); never «بشكل كبير».
- ATTRIBUTION once per paragraph, in the desks' forms: «قال X في بيان/مقابلة إن» (always إن after قال), «وأضاف»، «وأوضح»، «وأشار إلى أن»، «وفق بيانات صدرت الخميس»، «بحسب رويترز»، «نقلاً عن». «أكد» takes an object, never «أكد على». «كشف» only for something that was hidden.
- EXPECTATIONS are always someone's: «يتوقع المجلس أن»، «ترجّح الأسواق»، «مرشح لـ»، «من المرجح بحسب». Never a floating forecast.
- ATTRIBUTE every claim to its source; never present a source's claim as your own knowledge.
- Keep every number, date and name exactly as in the sources. Never invent, estimate, round differently, or extrapolate. If a figure is missing, say the source did not disclose it.
- TEXTURE: one idea per sentence, no sentence over 35 words; paragraphs of one to three sentences; concrete nouns (البرميل، الأونصة، العقود الآجلة، نقطة أساس، الجلسة، الإغلاق، المكاسب الأسبوعية، المعاملات الفورية); active voice unless the agent is unknown. Vary paragraph joints: «و»، «وكان»، «وفي المقابل»، «ويأتي»، «ورغم»، «وقال».
- BANNED (a sub-editor cuts them; the checker rejects them): fillers «في هذا السياق»، «تجدر الإشارة»، «من الجدير بالذكر»، «يُذكر أن»، «لا يخفى»، «في نهاية المطاف»، «بالإضافة إلى ذلك»، «علاوة على ذلك»، «من ناحية أخرى»، «على الرغم من ذلك»؛ calques «تم + مصدر»، «من قبل»، «يقوم بـ»، «يلعب دوراً»، «بشكل كبير/ملحوظ/رئيسي»، «على صعيد»، «يعتبر»، «هناك ارتفاع في»، «شهد ارتفاعاً»؛ clichés «بمثابة»، «يسلط الضوء»، «يمهد الطريق»، «نقطة تحول»، «مما يعكس». Prefer «نحو» to «حوالي»، «في الوقت نفسه»، «مديرو»، «أسهم»، «مهم».
- CLOSE with one of the desks' endings: a sweep of related instruments, the next date to watch, the concrete why-it-matters, or an attributed quote. Never a summary, never a moral.
- Use Western digits (0-9), the pan-Arab month names (يناير… ديسمبر), and Arabic units (مليار، مليون، نقطة أساس، %). The Arabic comma (،) and «» for quotations and foreign brand names.
- Write foreign names in Arabic transliteration as Arab business media write them; for lesser-known people or companies add the Latin original in parentheses once. Keep well-known tickers and acronyms in Latin (S&P 500, OPEC+, IMF).
- HEADLINES: a nominal sentence, actor first, present-tense verb, the figure: «الذهب يتجه لثالث خسارة أسبوعية مع تصاعد رهانات رفع الفائدة»، «المركزي التركي يثبّت الفائدة عند 37% للمرة الخامسة». ONE idea, at most 12 words, never two developments chained with «و». A quote headline uses the colon: «صندوق النقد: الاقتصاد العالمي يتجه إلى نمو 3%». Never ".." or "!" or a teaser; no "تعرف على"، no question headlines for news. Definite references for institutions («الإدارة الأمريكية» or «واشنطن», never «إدارة أمريكية»); a strong verb instead of «يعلن عن» + verbal noun.
- Tone: calm, precise, authoritative. No sensationalism, no clichés, no rhetorical questions, no first person, no moralising.
- Explain context that an Arab reader needs (what the institution is, why the indicator matters) in one clause, without lecturing.
- No URLs, no markdown links, no headings other than optional "## " subheads for long pieces, no bullet lists inside the body.
- Do not mention that you are an AI or that the article was generated.

You always respond with a single JSON object and nothing else.`;

export const WRITER_SYSTEM = `You are the senior economics correspondent of خازندار (Khazendar), an Arabic-language economics and business publication for educated readers across the Arab world.

${HOUSE_STYLE}`;

const ANALYST_SYSTEM = `You are the senior analyst of خازندار (Khazendar), an Arabic-language economics and business publication for educated readers across the Arab world. You write the paper's signed house analysis (تحليل): not a news report and not an explainer, but an argued reading of what the paper's own recent reporting means, for whom, and what could happen next. You use only the facts and figures in the material supplied; you never invent numbers, quotes or sources; and every forecast is framed as a scenario with the conditions that would trigger it, never asserted as fact. The paper's voice may say "نراقب" in the watch section; otherwise no first person.

${HOUSE_STYLE}`;

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

/**
 * Arabic JSON is token-hungry and Ling's reasoning counts against the cap: at the old cap of 5000 the writer's
 * answers were regularly cut off right where "tags" sits in the schema (run reports show many "draft.tags
 * missing" failures at exactly 5000 tokens), and at 8000 a long think still left an empty answer.
 */
const NEWS_MAX_TOKENS = 12000;

function sourceBlock(source, index) {
  const text = source.text || source.summary || "";
  return `SOURCE ${index + 1}: ${source.sourceNameEn} (${source.lang}) — "${source.title}" — published ${source.publishedAt ?? "unknown"}
${text}`;
}

/** Some models return the body as paragraphs or as sections ({heading, text} or heading → text); fold it into Markdown. */
function coerceBody(body) {
  if (Array.isArray(body)) {
    return body
      .map((p) => {
        if (typeof p === "string") return p;
        if (!p || typeof p !== "object") return "";
        const heading = p.heading ?? p.title ?? p.subhead ?? "";
        const text = p.text ?? p.body ?? p.content ?? p.paragraphs ?? "";
        return [heading ? `## ${heading}` : "", Array.isArray(text) ? text.join("\n\n") : String(text)].filter(Boolean).join("\n\n");
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (body && typeof body === "object") {
    return Object.entries(body)
      .map(([heading, text]) => [/^(intro|opening|lead|lede|argument)$/i.test(heading) ? "" : `## ${heading}`, Array.isArray(text) ? text.join("\n\n") : String(text ?? "")].filter(Boolean).join("\n\n"))
      .join("\n\n");
  }
  return body;
}

/** Structural validation of a writer's answer. `minWords`/`maxWords` bound the lede plus body (news defaults; analyses are longer). */
export function validateDraft(draft, { minWords = 170, maxWords = 1100 } = {}) {
  if (!draft || typeof draft !== "object") throw new Error("draft is not an object");
  // Tolerate renamed keys and reshaped bodies from different models.
  draft.key_facts = draft.key_facts ?? draft.keyFacts ?? draft.key_figures ?? draft.facts ?? draft.numbers ?? [];
  draft.why_it_matters = draft.why_it_matters ?? draft.whyItMatters ?? draft.why ?? "";
  draft.image_queries = draft.image_queries ?? draft.imageQueries ?? draft.images ?? [];
  draft.tags = draft.tags ?? draft.keywords ?? draft.topics;
  draft.body = coerceBody(draft.body);
  const required = ["title", "subtitle", "slug", "lede", "body", "tags"];
  for (const key of required) if (draft[key] == null || draft[key] === "") throw new Error(`draft.${key} missing`);
  if (String(draft.title).length < 15 || String(draft.title).length > 95) throw new Error("title length out of range (15-95 chars); write one idea per headline");
  if (!Array.isArray(draft.key_facts)) throw new Error("key_facts must be an array");
  if (!draft.why_it_matters) throw new Error("why_it_matters missing");
  const prose = [draft.title, draft.subtitle, draft.lede, draft.body, draft.why_it_matters].join("\n");
  if (arabicRatio(prose) < 0.85) throw new Error(`Arabic ratio too low: ${arabicRatio(prose).toFixed(2)}`);
  const words = wordCount(`${draft.lede}\n${draft.body}`);
  if (words < minWords || words > maxWords) throw new Error(`body word count out of range (${minWords}-${maxWords}): ${words}`);
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
    maxTokens: NEWS_MAX_TOKENS,
    log,
    validate: validateDraft,
  });
  return { draft: normalizeDraft(data), model };
}

/** Sends critic findings back to the writer for one revision. `wordLimits` (analyses) overrides the news word bounds. */
export async function reviseArticle({ draft, sources, issues, log, wordLimits }) {
  const user = `You previously wrote this article for خازندار:
${JSON.stringify(draft, null, 2)}

SOURCE MATERIAL
${sources.map(sourceBlock).join("\n\n")}

An editor found the following problems. Fix every one of them strictly using the source material. Remove any claim or number that the sources do not support. Keep everything else intact, and keep the article at least ${wordLimits?.target ?? 260} words (lede + body) when the sources allow it; never pad with unsupported material.
PROBLEMS
${issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}

Return the complete corrected article as one JSON object with the same keys as before (title, subtitle, slug, lede, body, key_facts, why_it_matters, tags, regions, image_queries${draft.chart || draft.table ? ", chart, table" : ""}).`;
  const { data, model } = await chat({
    role: "writer",
    system: wordLimits ? ANALYST_SYSTEM : WRITER_SYSTEM,
    user,
    temperature: 0.25,
    maxTokens: wordLimits ? ANALYSIS_MAX_TOKENS : NEWS_MAX_TOKENS,
    log,
    validate: (d) => validateDraft(d, wordLimits),
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
    // 500-800 Arabic words with worked examples: Ling's answers were cut off at 6000 tokens.
    maxTokens: 9000,
    log,
    validate: validateDraft,
  });
  return { draft: normalizeDraft(data), model };
}

/** Word bounds of a house analysis (lede + body) for validateDraft: the brief asks for 700-1000; the validator tolerates a margin. */
export const ANALYSIS_WORDS = { minWords: 500, maxWords: 1500, target: 700 };
/** A 1000-word Arabic JSON answer runs to ~5000 tokens; reasoning models also think first, so leave ample room. */
const ANALYSIS_MAX_TOKENS = 12000;

const ANALYSIS_SCHEMA = `{
  "title": "Arabic title, 35-85 characters, stating the argument or the question the analysis answers (e.g. ماذا يعني نفط فوق 100 دولار لموازنات الخليج), ONE idea, no clickbait",
  "subtitle": "Arabic dek: one sentence (max 160 chars) carrying the central claim of the analysis",
  "slug": "english-kebab-case-slug-4-to-7-words",
  "lede": "Opening paragraph, 2-3 sentences: the argument stated plainly and anchored in this week's facts",
  "body": "Markdown. First one or two paragraphs (no subhead) that complete the argument; then exactly these four '## ' subheads in this order: '## ما الذي تغيّر' (what changed, from the facts of the related stories, attributed as they attribute them), '## من يربح ومن يخسر' (winners and losers, concrete: countries, sectors, companies, households), '## السيناريوهات' (two or three scenarios, each with what would trigger it and what it would mean), '## ما الذي نراقبه' (what to watch, with dates where the material gives them). Lede and body together 700-1000 words. Paragraphs separated by blank lines; no bullet lists.",
  "key_facts": [{"label": "short Arabic label (2-5 words)", "value": "a figure exactly as it appears in the supplied material, e.g. 108 دولاراً or 2.5%"}],
  "why_it_matters": "One Arabic paragraph (60-120 words): the bottom line for Arab economies, businesses or readers",
  "tags": ["3-5 Arabic tags: institutions, countries, sectors, indicators"],
  "regions": ["1-3 Arabic region tags"],
  "image_queries": ["2-3 short English search terms (2-4 words each) naming a concrete subject that exists as a photo on Wikimedia Commons: a city skyline, a port, a refinery, an institution's headquarters, a commodity; no adjectives, no abstract concepts"],
  "chart": null or {"type": "bar" | "line", "title": "Arabic chart title (what is measured)", "unit": "Arabic unit, e.g. % or مليار دولار", "source": "the publisher named in the material", "categories": ["Arabic labels, 3-12 items"], "series": [{"name": "Arabic series name", "values": [numbers, one per category, exactly as in the supplied material]}]},
  "table": null or {"title": "Arabic table title", "source": "the publisher named in the material", "columns": ["2-5 Arabic column headers"], "rows": [["cells exactly as in the supplied material"]]}
}
Data visuals: include "chart" or "table" only when the supplied material gives at least three comparable figures of the same kind; every number must appear in the material; otherwise set them to null.`;

function relatedBlock(article, index) {
  const facts = (article.keyFacts ?? []).map((f) => [f.label, f.value].filter(Boolean).join(": ")).join("؛ ");
  return `ARTICLE ${index + 1}: "${article.title}" (section ${article.section}; published ${String(article.publishedAt ?? "").slice(0, 10)})
${article.lede ?? ""}

${article.body ?? ""}
${facts ? `\nKey facts: ${facts}` : ""}${article.whyItMatters ? `\nWhy it matters: ${article.whyItMatters}` : ""}`;
}

/** Writes a house analysis that connects the paper's own related stories; every figure must come from them. */
export async function writeAnalysis({ topic, relatedArticles, log }) {
  const user = `ANALYSIS BRIEF FROM THE EDITOR
Theme: ${topic.theme_ar} (${topic.theme_en})
The question this analysis answers: ${topic.question_ar}
Hook: ${topic.hook}
Angle: ${topic.angle}
Today (UTC): ${new Date().toISOString().slice(0, 10)}

MATERIAL: خازندار's own recent reporting (use only this material; every figure, date, name and quotation must come from it)
${relatedArticles.map(relatedBlock).join("\n\n")}

TASK
Write the analysis for خازندار. State the argument in the first two paragraphs, then develop it under the four required subheads. The editor's theme and angle are direction only: where the material does not support a part of them, drop that part rather than inventing support. Attribute facts as the material attributes them (the original institution or outlet), never to vague "reports". Do not add facts, figures or quotations from memory; if the material lacks a number, say so or leave it out. Restate the facts in fresh sentences of your own; do not copy sentences from the material. Frame every forecast as a scenario with its trigger; never assert what will happen. A consequence or causal link that the material does not itself report is the paper's reading: state it hedged (يرجّح، قد يعني، من المحتمل) and in proportion to the evidence, never as established fact, and never generalise one country's figure to a whole region. The title states the question or a claim the material supports; it must not overstate.
LENGTH: 700-1000 words in the lede and body together; each of the four sections needs two or three full paragraphs. A draft under 700 words is rejected automatically.
Return one JSON object exactly in this shape:
${ANALYSIS_SCHEMA}`;
  // An analysis without tags is still an analysis: fall back to the related stories' own tags.
  const fallbackTags = [...new Set(relatedArticles.flatMap((a) => a.tags ?? []))].slice(0, 5);
  const { data, model } = await chat({
    role: "writer",
    system: ANALYST_SYSTEM,
    user,
    temperature: 0.35,
    maxTokens: ANALYSIS_MAX_TOKENS,
    log,
    validate: (d) => {
      if (d && typeof d === "object" && !(Array.isArray(d.tags) && d.tags.length) && fallbackTags.length) d.tags = fallbackTags;
      validateDraft(d, ANALYSIS_WORDS);
    },
  });
  return { draft: normalizeDraft(data), model };
}
