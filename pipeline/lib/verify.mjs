import { chat } from "./llm.mjs";
import { arabicRatio, phraseOverlap, suspiciousLatinWords, ungroundedNumbers, wordCount } from "./util.mjs";
import { styleIssues } from "./style.mjs";

/** The four sections every house analysis must carry, matched loosely against its "## " subheads. */
const ANALYSIS_SECTIONS = [
  { name: "ما الذي تغيّر", test: /تغي/ },
  { name: "من يربح ومن يخسر", test: /يربح|يخسر/ },
  { name: "السيناريوهات", test: /سيناريو/ },
  { name: "ما الذي نراقبه", test: /نراقب|المراقبة|نرصد/ },
];

/**
 * Deterministic checks. Returns { ok, issues[], warnings[], metrics }.
 * News and analyses are grounded: every figure must trace to `sources` (for an analysis, the paper's own
 * related stories). Explainers carry only illustrative numbers, so their figures and visuals are not checked.
 */
export function programmaticChecks(draft, sources, { recentTitles = [], explainer = false, analysis = false } = {}) {
  const issues = [];
  const warnings = [];
  const grounded = !explainer;
  const prose = [draft.title, draft.subtitle, draft.lede, draft.body, draft.whyItMatters].join("\n");
  const factsText = draft.keyFacts.map((f) => `${f.label} ${f.value}`).join("\n");
  const sourceTexts = sources.map((s) => `${s.title}\n${s.text || ""}\n${s.summary || ""}`);

  const ratio = arabicRatio(prose);
  if (ratio < 0.88) issues.push(`نسبة النص العربي منخفضة (${(ratio * 100).toFixed(0)}%): ترجم كل الجمل والاقتباسات الأجنبية إلى العربية.`);

  const ALLOWED_LATIN = /^(S&P|OPEC\+?|IMF|ECB|GDP|AI|iPhone|Nvidia|OpenAI|Meta|Google|Apple|Amazon|Microsoft|Tesla|Brent|WTI|Fed|ETF|IPO|EU|UAE|US|UK|G7|G20|CEO|NYSE|Nasdaq|Dow|FTSE|DAX|Bitcoin|X|JLR|BMW|GM|IBM|LNG|OECD|WTO|BIS|SEC|EIA|AfD|SPD|CDU|SAMA|ADNOC|PIF|QIA|KIA|CNBC|BBC|CNN|ABC|NBC|CBS|AP|AFP|Reuters|Bloomberg|Eurostat|Destatis|Sentix|ZEW|Ifo|PMI|CPI|PPI|ISM|OPEC)$/i;
  // Latin outside parentheses (parenthesised originals of names are allowed once).
  const outsideParens = prose.replace(/\([^)]*\)/g, " ");
  const latinAll = [...new Set((outsideParens.match(/\b[A-Za-z][A-Za-z'&.-]{2,}\b/g) ?? []).filter((w) => !ALLOWED_LATIN.test(w)))];
  const latin = suspiciousLatinWords(outsideParens).filter((w) => !ALLOWED_LATIN.test(w));
  if (latinAll.length > 5 || latin.length > 3) issues.push(`كلمات لاتينية غير مترجمة في النص: ${latinAll.slice(0, 8).join(", ")}. انقلها إلى العربية (الأشهر والأسماء والوحدات) أو احذفها.`);
  else if (latinAll.length) warnings.push(`latin words: ${latinAll.join(", ")}`);
  const titleLatin = (draft.title.match(/[A-Za-z][A-Za-z&+.'-]*/g) ?? []).filter((w) => !ALLOWED_LATIN.test(w));
  if (titleLatin.length) issues.push(`العنوان يحتوي كلمات لاتينية (${titleLatin.join(", ")}). اكتب العنوان بالعربية كاملاً.`);
  const headlineLatinInBody = (`${draft.subtitle}\n${draft.lede}`.replace(/\([^)]*\)/g, " ").match(/\b[A-Za-z]{3,}\b/g) ?? []).filter((w) => !ALLOWED_LATIN.test(w));
  if (headlineLatinInBody.length > 2) issues.push(`المقدمة تحتوي كلمات لاتينية غير مترجمة: ${headlineLatinInBody.slice(0, 6).join(", ")}.`);

  if (/https?:\/\/|www\./i.test(prose)) issues.push("النص يحتوي على روابط؛ احذفها.");

  // The house's Arabic: banned calques and fillers force a revision; texture faults are warnings the desk reads.
  const style = styleIssues(draft, { kind: explainer ? "explainer" : analysis ? "analysis" : "news" });
  issues.push(...style.issues);
  warnings.push(...style.warnings);

  const words = wordCount(`${draft.lede}\n${draft.body}`);
  if (analysis) {
    if (words < 550) issues.push(`التحليل قصير جداً (${words} كلمة)؛ يجب ألا يقل عن 700 كلمة. وسّع الحجة والسيناريوهات من المواد المرفقة دون اختراع أرقام.`);
    else if (words > 1100) warnings.push(`long analysis: ${words} words`);
    const subheads = (draft.body.match(/^##\s+.+$/gm) ?? []).join("\n");
    const missing = ANALYSIS_SECTIONS.filter((s) => !s.test.test(subheads)).map((s) => s.name);
    if (missing.length) issues.push(`بنية التحليل ناقصة؛ العناوين الفرعية المطلوبة (بصيغة "## ") غير موجودة: ${missing.join("، ")}. أضفها بهذا الترتيب: ما الذي تغيّر، من يربح ومن يخسر، السيناريوهات، ما الذي نراقبه.`);
  } else if (words < 200) issues.push(`المقال قصير جداً (${words} كلمة). وسّع السياق من المصادر دون اختراع معلومات، بحيث لا يقل عن 260 كلمة.`);

  // Data visuals must be built only from figures in the sources; a visual with invented numbers is dropped, not the article.
  if (draft.chart) {
    const chartNumbers = draft.chart.series.flatMap((s) => s.values).map(String).join(" ");
    const bad = grounded ? ungroundedNumbers(chartNumbers, sourceTexts, { ignoreYears: false }) : [];
    if (bad.length || !grounded) {
      warnings.push(`chart dropped: ${grounded ? `ungrounded values ${bad.join(", ")}` : "explainers carry no source data"}`);
      draft.chart = null;
    }
  }
  if (draft.table) {
    const tableNumbers = draft.table.rows.flat().join(" ");
    const bad = grounded ? ungroundedNumbers(tableNumbers, sourceTexts, { ignoreYears: false }) : [];
    if (bad.length > 1 || !grounded) {
      warnings.push(`table dropped: ${grounded ? `ungrounded values ${bad.join(", ")}` : "explainers carry no source data"}`);
      draft.table = null;
    }
  }

  if (grounded) {
    const missing = ungroundedNumbers(`${prose}\n${factsText}`, sourceTexts);
    if (missing.length > 2) {
      issues.push(`أرقام لا تظهر في المصادر: ${missing.join(", ")}. احذف كل رقم غير مذكور في المصادر أو صحّحه.`);
    } else if (missing.length) {
      warnings.push(`ungrounded numbers (tolerated): ${missing.join(", ")}`);
    }
    // Verbatim reuse of an Arabic source is plagiarism; an analysis restating the paper's own stories gets a little more room.
    const overlapLimit = analysis ? 0.2 : 0.12;
    for (const source of sources) {
      if (source.lang !== "ar") continue;
      const overlap = phraseOverlap(`${draft.lede}\n${draft.body}`, source.text || source.summary || "");
      if (overlap > overlapLimit) issues.push(`نسبة النقل الحرفي من مصدر عربي مرتفعة (${(overlap * 100).toFixed(0)}%). أعد الصياغة بأسلوبك.`);
    }
  }

  const titleNorm = draft.title.replace(/\s+/g, " ").trim();
  if (recentTitles.some((t) => t.replace(/\s+/g, " ").trim() === titleNorm)) issues.push("العنوان مكرر لمقال منشور.");

  // The dek must belong to this story: most of its content words should appear somewhere in the article.
  const stem = (w) => w.replace(/^(و|ف|ب|ك|ل)?(ال)?/, "").replace(/(ات|ون|ين|ة|ه|ها|هم)$/, "");
  const wordsOf = (t) => new Set(String(t ?? "").replace(/[\p{P}\p{S}]/gu, " ").split(/\s+/).filter((w) => w.length >= 4).map(stem).filter((w) => w.length >= 3));
  const dekWords = [...wordsOf(draft.subtitle)];
  if (dekWords.length >= 4) {
    const articleWords = wordsOf(`${draft.title}\n${draft.lede}\n${draft.body}\n${draft.whyItMatters}`);
    const hits = dekWords.filter((w) => articleWords.has(w)).length;
    if (hits / dekWords.length < 0.3) issues.push("الوصف الفرعي (subtitle) لا يتصل بموضوع المقال ولا يظهر مضمونه في النص؛ اكتب وصفاً فرعياً يلخص أهم تفصيل في هذا الخبر نفسه.");
  }

  return { ok: issues.length === 0, issues, warnings, metrics: { arabicRatio: ratio, words, latin: latin.length } };
}

const CRITIC_SYSTEM = `You are the standards editor of خازندار, an Arabic economics publication. You check a draft article against its source material with forensic care. You reward accuracy, attribution and clear Arabic; you punish invented or altered facts, unsupported numbers, misattributed quotes, speculation stated as fact, untranslated foreign text, and clumsy Arabic.
You answer with one JSON object only.`;

/** What the critic is told about the material, its first (facts) check and its third (kind-specific) check, per kind of piece. */
const FACTS_CHECK = "Every number, date, name, quote and causal claim in the draft: is it supported by the sources? List each unsupported or altered item.";
const CRITIC_RUBRIC = {
  news: {
    material: "",
    facts: FACTS_CHECK,
    check: "Does the article add anything not in the sources beyond neutral, well-known context?",
  },
  explainer: {
    material: "(explainer: no external sources; judge internal consistency, standard definitions, and that every number is labelled as an illustrative example)",
    facts: FACTS_CHECK,
    check: "Are definitions standard and correct? Are all worked-example numbers clearly labelled as illustrative?",
  },
  analysis: {
    material:
      "(analysis: the sources below are خازندار's own published stories; every figure, date, name and quotation in the draft must trace to them. Interpretation is the genre: the paper's own reading of consequences is legitimate when it is clearly framed as a reading (يرجّح، قد، من المحتمل) and stays within what the stories support; it is a fault when asserted as fact or when it contradicts the stories.)",
    facts: "Every number, date, name and quotation in the draft: does it trace to the supplied stories? List each unsupported or altered item. Causal reasoning is judged under point 3.",
    check: "Is the argument coherent from the opening to the scenarios, and does the piece answer its own question? Is every causal claim either reported by the stories or clearly framed as the paper's hedged reading, never asserted as fact? Is every forecast framed as a scenario with a stated trigger?",
  },
};

/** Critic pass. Returns { verdict: "publish"|"revise"|"reject", score, issues[], model }. */
export async function critique({ draft, sources, explainer = false, analysis = false, log }) {
  const rubric = CRITIC_RUBRIC[explainer ? "explainer" : analysis ? "analysis" : "news"];
  const material = sources.map((s, i) => `SOURCE ${i + 1}: ${s.sourceNameEn} (${s.lang}) — "${s.title}"\n${s.text || s.summary || ""}`).join("\n\n");
  const user = `SOURCE MATERIAL
${[rubric.material, material || (explainer ? "" : "(no sources supplied)")].filter(Boolean).join("\n\n")}

DRAFT ARTICLE (JSON)
${JSON.stringify({ title: draft.title, subtitle: draft.subtitle, lede: draft.lede, body: draft.body, key_facts: draft.keyFacts, why_it_matters: draft.whyItMatters }, null, 2)}

CHECK
1. ${rubric.facts}
2. Attribution: are claims attributed to the right source? Is anything presented as fact that the source presents as an estimate, forecast or opinion?
3. ${rubric.check}
4. Arabic quality. Translationese is a fault that requires "revise", never "publish": English syntax under Arabic words (an indefinite subject such as "إدارة أمريكية" where Arabic uses the definite or the name; "يعلن عن" + verbal noun; jargon rendered word for word such as "مستردات", "المعدل العقاري", "استئناف بيع", "للأضواء", "في زيارة دولة"; "من قبل"; "يقوم بـ"), wrong case endings on numbers and duals ("ألفين رحلة", "حل جزئي" as an object), a headline chaining two developments with "و", untranslated foreign words, sensational tone, repetition. Quote each offending phrase and give the idiomatic Arabic.
5. Headline: accurate, specific, not misleading.

Return JSON:
{"score": <0-10 overall publishability>, "verdict": "publish" | "revise" | "reject", "issues": ["<one concrete, actionable problem in Arabic, quoting the offending text>", "..."], "summary": "<one sentence in Arabic>"}
Use "publish" only when there are no factual problems (score >= 7). Use "reject" when the draft misrepresents the story, fabricates key facts, or cannot be fixed from the sources.`;

  // Some models wrap the answer ({"review": {...}}) or rename keys; find the object that carries the verdict.
  const unwrap = (d) => {
    if (!d || typeof d !== "object") return null;
    const hasKeys = (o) => o && typeof o === "object" && (o.verdict != null || o.decision != null || o.result != null || o.score != null);
    if (hasKeys(d)) return d;
    for (const value of Object.values(d)) if (hasKeys(value)) return value;
    return null;
  };
  const { data: raw, model } = await chat({
    role: "critic",
    system: CRITIC_SYSTEM,
    user,
    temperature: 0.1,
    maxTokens: 5000,
    log,
    validate: (d) => {
      const inner = unwrap(d);
      if (!inner) throw new Error("verdict missing");
      const verdict = String(inner.verdict ?? inner.decision ?? inner.result ?? "").toLowerCase();
      if (!["publish", "revise", "reject"].includes(verdict) && !Number.isFinite(Number(inner.score))) throw new Error("verdict missing");
    },
  });
  const data = unwrap(raw);
  const score = Number(data.score) || 0;
  let verdict = String(data.verdict ?? data.decision ?? data.result ?? "").toLowerCase();
  if (!["publish", "revise", "reject"].includes(verdict)) verdict = score >= 7 ? "publish" : score >= 4 ? "revise" : "reject";
  return {
    verdict,
    score,
    issues: Array.isArray(data.issues) ? data.issues.map(String).filter(Boolean).slice(0, 10) : [],
    summary: String(data.summary ?? ""),
    model,
  };
}
