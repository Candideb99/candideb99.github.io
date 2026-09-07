import { chat } from "./llm.mjs";
import { arabicRatio, phraseOverlap, suspiciousLatinWords, ungroundedNumbers, wordCount } from "./util.mjs";

/** Deterministic checks. Returns { ok, issues[], warnings[], metrics }. */
export function programmaticChecks(draft, sources, { recentTitles = [], explainer = false } = {}) {
  const issues = [];
  const warnings = [];
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

  const words = wordCount(`${draft.lede}\n${draft.body}`);
  if (words < 200) issues.push(`المقال قصير جداً (${words} كلمة). وسّع السياق من المصادر دون اختراع معلومات، بحيث لا يقل عن 260 كلمة.`);

  if (!explainer) {
    const missing = ungroundedNumbers(`${prose}\n${factsText}`, sourceTexts);
    if (missing.length > 2) {
      issues.push(`أرقام لا تظهر في المصادر: ${missing.join(", ")}. احذف كل رقم غير مذكور في المصادر أو صحّحه.`);
    } else if (missing.length) {
      warnings.push(`ungrounded numbers (tolerated): ${missing.join(", ")}`);
    }
    for (const source of sources) {
      if (source.lang !== "ar") continue;
      const overlap = phraseOverlap(`${draft.lede}\n${draft.body}`, source.text || source.summary || "");
      if (overlap > 0.12) issues.push(`نسبة النقل الحرفي من مصدر عربي مرتفعة (${(overlap * 100).toFixed(0)}%). أعد الصياغة بأسلوبك.`);
    }
  }

  const titleNorm = draft.title.replace(/\s+/g, " ").trim();
  if (recentTitles.some((t) => t.replace(/\s+/g, " ").trim() === titleNorm)) issues.push("العنوان مكرر لمقال منشور.");

  return { ok: issues.length === 0, issues, warnings, metrics: { arabicRatio: ratio, words, latin: latin.length } };
}

const CRITIC_SYSTEM = `You are the standards editor of خازندار, an Arabic economics publication. You check a draft article against its source material with forensic care. You reward accuracy, attribution and clear Arabic; you punish invented or altered facts, unsupported numbers, misattributed quotes, speculation stated as fact, untranslated foreign text, and clumsy Arabic.
You answer with one JSON object only.`;

/** Critic pass. Returns { verdict: "publish"|"revise"|"reject", score, issues[], model }. */
export async function critique({ draft, sources, explainer = false, log }) {
  const user = `SOURCE MATERIAL
${sources.map((s, i) => `SOURCE ${i + 1}: ${s.sourceNameEn} (${s.lang}) — "${s.title}"\n${s.text || s.summary || ""}`).join("\n\n") || "(explainer: no external sources; judge internal consistency, standard definitions, and that every number is labelled as an illustrative example)"}

DRAFT ARTICLE (JSON)
${JSON.stringify({ title: draft.title, subtitle: draft.subtitle, lede: draft.lede, body: draft.body, key_facts: draft.keyFacts, why_it_matters: draft.whyItMatters }, null, 2)}

CHECK
1. Every number, date, name, quote and causal claim in the draft: is it supported by the sources? List each unsupported or altered item.
2. Attribution: are claims attributed to the right source? Is anything presented as fact that the source presents as an estimate, forecast or opinion?
3. ${explainer ? "Are definitions standard and correct? Are all worked-example numbers clearly labelled as illustrative?" : "Does the article add anything not in the sources beyond neutral, well-known context?"}
4. Arabic quality: grammar, untranslated foreign words, awkward calques, sensational tone, repetition.
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
