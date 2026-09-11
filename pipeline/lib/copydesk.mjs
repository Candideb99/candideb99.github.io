/**
 * The Arabic copy desk (محرر الصياغة).
 *
 * The free models think in English and it shows: "إدارة أمريكية تعلن عن مستردات" is English syntax
 * in Arabic letters. The desk rewrites a draft's headline, dek and lede (and the body when asked) into
 * the idiom of an Arabic daily, and a guard throws any rewrite away that touches a fact: the numbers,
 * dates and Latin tokens of every field must come back exactly as they went in, the length must stay
 * in range, and the text must stay Arabic. The owner's rule, 2026-09-11: no literal translations.
 */
import { chat } from "./llm.mjs";
import { arabicRatio, normalizeDigits } from "./util.mjs";

export const DESK_SYSTEM = `You are the Arabic copy desk (محرر الصياغة) of خازندار, an Arabic economics daily for educated readers across the Arab world. A correspondent who thinks in English wrote the draft; you make it read as if a native Arabic newspaper editor wrote it, in clear Modern Standard Arabic (فصحى معاصرة) in the register of الشرق الأوسط and الاقتصادية.

WHAT YOU CHANGE
- Calques of English syntax and idiom. Indefinite subjects where Arabic uses the definite or the name: "إدارة أمريكية" → "الإدارة الأمريكية" or better "واشنطن" / "البيت الأبيض" / "إدارة ترامب". "يعلن عن" + verbal noun where a strong verb serves: "تعلن عن مستردات" → "تعيد" / "تصرف شيكات". English financial jargon rendered word for word: "مستردات" → "استرداد" or "شيكات بقيمة"; "مستخدمو أوباماكير" → "المشتركون في «أوباماكير»"; "المعدل العقاري" → "فائدة الرهن العقاري"; "استئناف بيع السندات" → "موجة بيع جديدة في السندات"; "يعيد كذا للأضواء" → "يعيد كذا إلى الواجهة"; "في زيارة دولة" → "خلال زيارة الدولة". Passive-agent calques ("من قبل"), "يقوم بـ" + verbal noun, and paragraphs that open with "و" as English opens with "And".
- Grammar. Case endings on numbers and duals ("ألفي رحلة" not "ألفين رحلة"; "تعلن حلاً جزئياً" not "تعلن حل جزئي"), agreement, and prepositions ("تصل إلى 50%", "إلى أعلى مستوى").
- Headline discipline. ONE idea carrying the key fact or number, 35 to 80 characters, verb-led where natural, no two developments chained with "و", no colon teaser, no question. When a headline chains two stories, keep the more important one and let the dek carry the other, without dropping any fact from the pair.
- Names and marks. Foreign names transliterated the way Arab business media write them; foreign programme and brand names in «» (e.g. «أوباماكير», «ناتس»); the Arabic comma (،) and «» quotation marks; Western digits; pan-Arab month names.

WHAT YOU NEVER CHANGE
- Facts. Every number, date, name, attribution ("بحسب", "وفقاً لـ", "قال"), quotation and causal claim stays exactly as it is; an expectation stays an expectation ("يتجه لرفع" never becomes "يرفع"; "يعد بـ" never becomes "يعلن"; "قد" and "من المتوقع" stay), and so does every count written in letters ("جزأين من أربعة" means two of four and must stay two of four; "ثلاث شركات" stays three). You add no context, no adjectives, no interpretation. A sentence that is already idiomatic stays as it is.
- Latin tokens (tickers, acronyms, Latin names in parentheses) stay verbatim.
- Length and structure. Roughly the same length; the lede stays two or three sentences; the body keeps its paragraphs, blank lines and any "## " subheads; no markdown links, no URLs.

You answer with one JSON object and nothing else.`;

const EXAMPLES = `EXAMPLES (before → after)
- إدارة أمريكية تعلن عن مستردات بقيمة 500 دولار لمستخدمي أوباماكير قبل الانتخابات → واشنطن تعيد 500 دولار للمشتركين في «أوباماكير» قبل الانتخابات
- عطل تقني في نظام ناتس يُلغي أكثر من ألفين رحلة ويكشف عن هشاشة النظام الجوي البريطاني → عطل في نظام «ناتس» يلغي أكثر من ألفي رحلة في بريطانيا
- وظائف أميركا القوية تعيد رفع الفائدة للأضواء وسيتي تعدل مسار الخفض إلى 2027 → قوة سوق العمل الأمريكية تعيد رفع الفائدة إلى الواجهة (the dek then carries: «سيتي» ترجّح تأجيل خفض الفائدة إلى 2027)
- أسعار الغاز الأوروبي ترتفع إلى 93 دولاراً والمعدل العقاري الأميركي يتجاوز 6.85% → أسعار الغاز في أوروبا ترتفع إلى 93 دولاراً (the dek then carries: فائدة الرهن العقاري في أمريكا تتجاوز 6.85%)`;

/** Quantities written in letters: a rewrite that turns "جزأين من أربعة" into "جزئي" has changed a fact. */
const NUMBER_WORDS = /(?<![؀-ۿ])(?:ال)?(?:واحد|واحدة|اثنان|اثنين|اثنتان|اثنتين|ثلاث|ثلاثة|أربع|أربعة|خمس|خمسة|ست|ستة|سبع|سبعة|ثماني|ثمانية|تسع|تسعة|عشر|عشرة|عشرون|عشرين|ثلاثون|ثلاثين|أربعون|أربعين|خمسون|خمسين|ستون|ستين|سبعون|سبعين|ثمانون|ثمانين|تسعون|تسعين|مئة|مائة|مئتان|مئتين|ألف|ألفا|ألفي|ألفان|ألفين|آلاف|مليون|مليونا|مليوني|مليونان|مليونين|ملايين|مليار|مليارا|ملياري|ملياران|مليارين|مليارات|تريليون|تريليونا|تريليوني|تريليونات|نصف|ربع|ثلث|ثلثي|ثلثين|ضعف|ضعفي|ضعفين|أضعاف)(?![؀-ۿ])/g;
/** Count-bearing duals (جزأين، شركتين، عامين): a curated list, because the plural suffix ين looks the same. */
const DUALS = /(?<![؀-ۿ])(?:ال)?(?:جزأين|جزءان|جزءين|شركتين|شركتان|عامين|عامان|يومين|يومان|شهرين|شهران|أسبوعين|أسبوعان|ساعتين|ساعتان|سنتين|سنتان|مرتين|مرتان|ضعفين|ضعفان|نقطتين|نقطتان|بلدين|بلدان|دولتين|دولتان|ولايتين|ولايتان|مدينتين|مدينتان|قطاعين|قطاعان|مصنعين|مصنعان|بنكين|بنكان|طرفين|طرفان|جانبين|جانبان|مرحلتين|مرحلتان|جولتين|جولتان|صفقتين|صفقتان|اتفاقيتين|اتفاقيتان|خطوتين|خطوتان|حزمتين|حزمتان|سفينتين|سفينتان|ناقلتين|ناقلتان|محطتين|محطتان|مشروعين|مشروعان|عقدين|عقدان|فصلين|فصلان|ربعين|ربعان|نصفين|نصفان|ثلثين|ثلثان|رقمين|رقمان|سهمين|سهمان|منتجين|منتجان|مصدرين|مصدران|وزيرين|وزيران|رئيسين|رئيسان|قرارين|قراران|تقريرين|تقريران|حالتين|حالتان|سيناريوهين|سيناريوهان)(?![؀-ۿ])/g;

/** Digits, number words and Latin tokens of a text, as sortable fingerprints; a rewrite must reproduce them. */
function numberFingerprint(text, { unique = false } = {}) {
  const t = normalizeDigits(String(text ?? ""));
  const digits = (t.match(/\d[\d.,]*\d|\d/g) ?? []).map((n) => n.replace(/[.,]+$/, ""));
  const words = (t.match(NUMBER_WORDS) ?? []).map((w) => w.replace(/^ال/, ""));
  const all = [...digits, ...words].sort();
  return (unique ? [...new Set(all)] : all).join("|");
}
/** Every count-bearing dual of the original must still be in the rewrite (it may add, never drop). */
function dualsKept(before, after) {
  const had = (String(before ?? "").match(DUALS) ?? []).map((w) => w.replace(/^ال/, ""));
  const has = new Set((String(after ?? "").match(DUALS) ?? []).map((w) => w.replace(/^ال/, "")));
  return had.every((w) => has.has(w));
}
/** The house writes tanween on the alef (اً), not before it (ًا); models mix the two. */
function houseTanween(text) {
  return String(text ?? "").replace(/ًا/g, "اً");
}
function latinFingerprint(text) {
  return (String(text ?? "").match(/[A-Za-z][A-Za-z0-9&+.-]*[A-Za-z0-9]|[A-Za-z]/g) ?? []).map((w) => w.toLowerCase()).sort().join("|");
}

/**
 * Judges one rewritten field against its original. Returns { ok, reason }.
 * The bounds are generous on purpose: the desk changes phrasing, not substance.
 */
export function fieldGuard(field, before, after) {
  const a = String(before ?? "").trim();
  const b = String(after ?? "").trim();
  if (!b) return { ok: false, reason: "empty" };
  if (b === a) return { ok: false, reason: "unchanged" };
  // Headline and dek are one pair: a figure both carry is one fact and may move between them.
  const unique = field === "pair";
  if (numberFingerprint(a, { unique }) !== numberFingerprint(b, { unique })) return { ok: false, reason: "numbers changed" };
  if (!dualsKept(a, b)) return { ok: false, reason: "a count written as a dual was dropped" };
  if (latinFingerprint(a) !== latinFingerprint(b)) return { ok: false, reason: "latin tokens changed" };
  if (/https?:\/\/|\]\(/.test(b)) return { ok: false, reason: "link introduced" };
  // A word repeated back to back ("يتوسعون يتوسعون") is a model stutter, never Arabic.
  if (/(?<![؀-ۿ])([؀-ۿ]{3,})\s+(?![؀-ۿ])/.test(b) && !/(?<![؀-ۿ])([؀-ۿ]{3,})\s+(?![؀-ۿ])/.test(a)) return { ok: false, reason: "a word was doubled" };
  // An expectation must stay an expectation: the hedges of the original must survive the rewrite.
  const HEDGES = /(?<![؀-ۿ])(?:يتجه|تتجه|قد|من المتوقع|المتوقع|متوقع|مرشح|مرشحة|محتمل|يُرجَّح|يرجح|ترجح|ربما|يتوقع|تتوقع|توقعات|توقع|تعهد|تعهدت|يعد|تعد|وعد|وعدت|يعتزم|تعتزم|يخطط|تخطط|قريباً|قريبا)(?![؀-ۿ])/g;
  const hedgesBefore = new Set((a.match(HEDGES) ?? []));
  const hedgesAfter = new Set((b.match(HEDGES) ?? []));
  if ([...hedgesBefore].some((h) => !hedgesAfter.has(h))) return { ok: false, reason: `a hedge was dropped (${[...hedgesBefore].filter((h) => !hedgesAfter.has(h)).join("، ")})` };
  const [lo, hi] = field === "title" ? [0.45, 1.6] : field === "body" ? [0.8, 1.25] : field === "pair" ? [0.7, 1.4] : [0.6, 1.5];
  const ratio = b.length / Math.max(1, a.length);
  if (ratio < lo || ratio > hi) return { ok: false, reason: `length ${ratio.toFixed(2)}x` };
  if (arabicRatio(a) > 0.5 && arabicRatio(b) < 0.55) return { ok: false, reason: "not Arabic enough" };
  if (field === "body") {
    const heads = (t) => (t.match(/^## .*$/gm) ?? []).length;
    if (heads(a) !== heads(b)) return { ok: false, reason: "subheads changed" };
  }
  return { ok: true };
}

function validateDeskAnswer(includeBody) {
  return (d) => {
    if (!d || typeof d !== "object") throw new Error("desk answer is not an object");
    for (const k of ["title", "subtitle", "lede"]) if (typeof d[k] !== "string") throw new Error(`desk answer lacks ${k}`);
    if (includeBody && typeof d.body !== "string") throw new Error("desk answer lacks body");
  };
}

/**
 * Runs the desk over a draft. Returns { draft, changed, applied, rejected, changes, model }.
 * `draft` has title, subtitle, lede and body (Markdown); only the fields the guard accepts change.
 */
export async function copyEdit({ draft, includeBody = false, role = "critic", log = () => {} }) {
  const fields = includeBody ? ["title", "subtitle", "lede", "body"] : ["title", "subtitle", "lede"];
  const input = Object.fromEntries(fields.map((f) => [f, draft[f] ?? ""]));
  const user = `${EXAMPLES}

DRAFT (JSON)
${JSON.stringify(input, null, 2)}

TASK
Rewrite only what reads as translation, poor grammar or a chained headline; keep every fact exactly as it is. Return one JSON object in this shape:
{${fields.map((f) => `"${f}": "..."`).join(", ")}, "changes": ["<one short note in Arabic per change: what was wrong and what you did>"]}
If nothing needs changing, return the fields unchanged and an empty "changes" list.`;

  const { data, model } = await chat({
    role,
    system: DESK_SYSTEM,
    user,
    temperature: 0.2,
    maxTokens: includeBody ? 7000 : 1800,
    log,
    validate: validateDeskAnswer(includeBody),
  });

  const out = { ...draft };
  const applied = [];
  const rejected = [];
  for (const k of Object.keys(data)) if (typeof data[k] === "string") data[k] = houseTanween(data[k]);

  // Headline and dek travel together: the desk may move a figure from one to the other, so the
  // fingerprints are compared over the pair, and the pair is accepted or refused as one.
  const pairBefore = `${draft.title}
${draft.subtitle}`;
  const pairAfter = `${data.title}
${data.subtitle}`;
  const pairChanged = String(data.title).trim() !== String(draft.title ?? "").trim() || String(data.subtitle).trim() !== String(draft.subtitle ?? "").trim();
  if (pairChanged) {
    const pairGuard = fieldGuard("pair", pairBefore, pairAfter);
    const titleGuard = fieldGuard("title", draft.title, data.title);
    const titleOk = titleGuard.ok || titleGuard.reason === "unchanged" || titleGuard.reason === "numbers changed" || titleGuard.reason === "latin tokens changed";
    if (pairGuard.ok && titleOk) {
      for (const f of ["title", "subtitle"]) {
        if (String(data[f]).trim() !== String(draft[f] ?? "").trim()) {
          out[f] = String(data[f]).trim();
          applied.push(f);
        }
      }
    } else {
      rejected.push({ field: "title+subtitle", reason: pairGuard.ok ? titleGuard.reason : pairGuard.reason, proposal: { title: data.title, subtitle: data.subtitle } });
    }
  }
  for (const f of fields.filter((x) => x !== "title" && x !== "subtitle")) {
    const guard = fieldGuard(f, draft[f], data[f]);
    if (guard.ok) {
      out[f] = String(data[f]).trim();
      applied.push(f);
    } else if (guard.reason !== "unchanged") {
      rejected.push({ field: f, reason: guard.reason, proposal: f === "body" ? undefined : data[f] });
    }
  }
  const changes = Array.isArray(data.changes) ? data.changes.filter((c) => typeof c === "string").slice(0, 8) : [];
  log(`desk model=${model} applied=[${applied.join(",")}] rejected=[${rejected.map((r) => `${r.field}:${r.reason}`).join(",")}]`);
  return { draft: out, changed: applied.length > 0, applied, rejected, changes, model };
}
