import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A state file written whole or not at all: the text goes to a temporary file that then replaces the old one, so a
 * crash or a cancelled job can never leave half a file for the next run to read (2026-09-26: a stress test showed a
 * truncated lessons.json read as empty and overwritten, losing every lesson).
 */
export async function writeJsonAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, file);
}

export const USER_AGENT =
  "Mozilla/5.0 (compatible; KhazendarBot/1.0; +https://candideb99.github.io/about; editorial research)";

export function sha1(input) {
  return createHash("sha1").update(String(input)).digest("hex");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  // The deadline stays armed while the caller reads the body, not only until the headers arrive.
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetch(url, { ...options, signal });
}

const TRACKING_PARAMS = /^(utm_|at_|fbclid|gclid|mc_|ref$|source$|traffic_source$|cmpid|ocid|ns_|_ga)/i;

export function canonicalUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    url.hash = "";
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    if (url.searchParams.toString() === "") url.search = "";
    return url.toString();
  } catch {
    return String(raw).trim();
  }
}

export function fingerprint(url) {
  return sha1(canonicalUrl(url).toLowerCase()).slice(0, 16);
}

export function stripHtml(html) {
  return String(html ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeDigits(text) {
  return String(text ?? "").replace(/[٠-٩۰-۹]/g, (d) => {
    const index = ARABIC_INDIC.indexOf(d) >= 0 ? ARABIC_INDIC.indexOf(d) : EXTENDED_INDIC.indexOf(d);
    return String(index);
  });
}

export function arabicRatio(text) {
  const clean = String(text ?? "").replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (!clean.length) return 0;
  const arabic = clean.match(/[؀-ۿݐ-ݿ]/g)?.length ?? 0;
  return arabic / clean.length;
}

/** Lowercase Latin words that are probably untranslated prose (not acronyms or names). */
export function suspiciousLatinWords(text) {
  const words = String(text ?? "").match(/\b[a-z]{3,}\b/g) ?? [];
  const allow = new Set(["www", "com", "org", "net"]);
  return [...new Set(words.filter((w) => !allow.has(w)))];
}

/**
 * Extracts numeric tokens (normalized) for grounding checks.
 * "1,700" -> "1700"; "1.7" -> "1.7"; "22.9%" -> "22.9"; "4,000" -> "4000".
 */
export function extractNumbers(text) {
  const normalized = normalizeDigits(text).replace(/٫/g, ".").replace(/٬/g, ",");
  const matches = normalized.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const out = new Set();
  for (const raw of matches) {
    const token = raw.replace(/,/g, "");
    if (!token) continue;
    out.add(token);
    if (token.includes(".")) out.add(token.replace(/\.?0+$/, ""));
  }
  return out;
}

/**
 * Figures a revision took out of a story that a later pass puts back: in `before`, gone from `revised`, back in `after`.
 * Counted are percentages, decimals and whole numbers of 10 or more that are not years; a bare small number recurs for
 * too many reasons. The mend after the second review had put back a gold story's October loss of 3.8%, cut for a later
 * price, and Exxon's and Chevron's share moves of 2% and 1%, corrected to 1.6% and 1.5% (2026-10-30, the audit of 31
 * October).
 */
export function restoredFigures(before, revised, after, asked = "") {
  const text = (d) => [d?.title, d?.subtitle, d?.lede, d?.body, d?.whyItMatters, ...(d?.keyFacts ?? d?.key_facts ?? []).map((f) => `${f?.label ?? ""} ${f?.value ?? ""}`)].join(" ");
  const figures = (d) => {
    const out = new Set();
    for (const m of normalizeDigits(text(d)).replace(/٫/g, ".").replace(/٬/g, ",").matchAll(/(\d[\d,]*(?:\.\d+)?)(\s?[%٪])?/g)) {
      const n = m[1].replace(/,/g, "");
      const v = Number(n);
      if (m[2]) out.add(`${n}%`);
      else if (n.includes(".") || (v >= 10 && !(Number.isInteger(v) && v >= 1900 && v <= 2100))) out.add(n);
    }
    return out;
  };
  const had = figures(before);
  const kept = figures(revised);
  // A figure the later findings themselves name (`asked`: «ينقص التقرير: …») was asked back, not undone.
  const wanted = figures({ body: asked });
  return [...figures(after)].filter((n) => had.has(n) && !kept.has(n) && !wanted.has(n));
}

/**
 * A source's figures, as extractNumbers reads them and as its own language writes them (2026-10-25, when the Turkish
 * and Persian press joined): a decimal comma («4,2 milyar» is 4.2), thousands set off by dots («4.500 kişi» is 4500),
 * Turkish thousands in words («4 bin 500» is 4500) and, in Persian, a decimal slash («۳/۵ درصد» is 3.5). Read only on
 * the source side: the Audi story of that day failed its notes and its writer three times each, because «4,2» counted
 * as 42 and «4 bin 500» as 4 and 500, so the story's 4.2 and 4500 stood in no source.
 */
export function sourceNumbers(text) {
  const out = extractNumbers(text);
  const normalized = normalizeDigits(text).replace(/٫/g, ".").replace(/٬/g, ",");
  const add = (value) => {
    if (!Number.isFinite(value)) return;
    const token = String(Number(value.toFixed(6)));
    out.add(token);
  };
  for (const m of normalized.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d{3})+),(\d+)(?![\d.,])/g)) add(Number(`${m[1].replace(/\./g, "")}.${m[2]}`));
  for (const m of normalized.matchAll(/(?<![\d.,])(\d+),(\d{1,2})(?![\d.,])/g)) add(Number(`${m[1]}.${m[2]}`));
  for (const m of normalized.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d{3})+)(?![\d.,])/g)) add(Number(m[1].replace(/\./g, "")));
  for (const m of normalized.matchAll(/(?<![\d.,])(\d{1,3})\s+bin\s+(\d{1,3})(?![\d.,])/gi)) add(Number(m[1]) * 1000 + Number(m[2]));
  const persian = /[پچژگکی]/.test(normalized);
  if (persian) for (const m of normalized.matchAll(/(?<![\d/])(\d+)\/(\d{1,2})(?![\d/])/g)) add(Number(`${m[1]}.${m[2]}`));
  // A count in words of scale («4 bin», «1,2 milyar», «۲ هزار»), so a story's 4000 or 1200 million stands in it.
  const SCALE = { bin: 1e3, milyon: 1e6, milyar: 1e9, trilyon: 1e12, "هزار": 1e3, "میلیون": 1e6, "میلیارد": 1e9 };
  for (const m of normalized.matchAll(/(?<![\d.,/])(\d+(?:[.,/]\d+)?)\s*(bin|milyon|milyar|trilyon|هزار|میلیون|میلیارد)(?![\p{L}])/giu)) {
    const [whole, fraction] = m[1].split(/[.,/]/);
    const decimal = fraction != null && (fraction.length <= 2 || m[1].includes("/") || (m[1].includes(",") && fraction.length !== 3));
    const value = decimal ? Number(`${whole}.${fraction}`) : Number(m[1].replace(/[.,/]/g, ""));
    add(value * SCALE[m[2].toLowerCase()]);
  }
  return out;
}

/** A figure followed by one of these is a figure, never a day, an ordinal or a year: "12%", "25 نقطة أساس", "2,000 دولار". */
const UNIT_AFTER = /(\d[\d,]*(?:\.\d+)?)\s*(?:%|٪|في المئة|في المائة|بالمئة|بالمائة|نقطة|نقاط|مليار|مليون|ألف|آلاف|دولار|ريال|جنيه|يورو|درهم|دينار)/g;

/** The numeric tokens of `text` that carry a unit, normalized as extractNumbers normalizes them. */
function unitBoundNumbers(text) {
  const normalized = normalizeDigits(text).replace(/٫/g, ".").replace(/٬/g, ",");
  const out = new Set();
  for (const m of normalized.matchAll(UNIT_AFTER)) {
    const token = m[1].replace(/,/g, "");
    out.add(token);
    if (token.includes(".")) out.add(token.replace(/\.?0+$/, ""));
  }
  return out;
}

/** Numbers in `text` that do not appear in any of the `sources` texts, ignoring trivial values. */
export function ungroundedNumbers(text, sources, { ignoreYears = true } = {}) {
  const pool = new Set();
  for (const source of sources) for (const n of sourceNumbers(source)) pool.add(n);
  const expanded = new Set(pool);
  for (const n of pool) {
    const value = Number(n);
    if (!Number.isFinite(value)) continue;
    // Allow common unit conversions: 4,000 -> "4" (آلاف), 1,700,000,000 -> 1.7 (مليار); and, for a count of
    // 10,000 or more, the desks' own rounding in thousands or millions (455,758 -> «نحو 456 ألف», 455.8 ألف).
    for (const divisor of [1e3, 1e6, 1e9, 1e12]) {
      const scaled = value / divisor;
      if (scaled < 1) continue;
      if (Number.isInteger(scaled * 100)) expanded.add(String(Number(scaled.toFixed(2))));
      if (Math.abs(value) >= 10000) for (const digits of [0, 1, 2]) expanded.add(String(Number(scaled.toFixed(digits))));
    }
    if (Number.isInteger(value * 10)) expanded.add(String(value));
    // Rounding to a whole or to one decimal is reporting, not alteration (108.44 -> 108 or 108.4).
    expanded.add(String(Math.round(value)));
    expanded.add(String(Number(value.toFixed(1))));
  }
  const unitBound = unitBoundNumbers(text);
  // A threshold the desks write, «فوق 108 دولارات» for 108.68, «دون 100 دولار» for 97.5: the figure after "above"
  // may sit up to 15% under a source's value, the one after "below" up to 15% over it. Rounding alone accepted
  // «فوق 109» (false, the peak was 108.68) and refused the true «فوق 108» that replaced it («في العمق», 2026-09-24).
  const values = [...pool].map(Number).filter((v) => Number.isFinite(v) && v > 0);
  const thresholds = new Set();
  const normalized = normalizeDigits(String(text ?? "")).replace(/٫/g, ".").replace(/٬/g, ",");
  for (const m of normalized.matchAll(/(?<![؀-ۿ])(?:و|ف)?(?:فوق|أكثر من|أعلى من|يتجاوز|تتجاوز|تجاوز|تجاوزت|متجاوز[اًة]*|يتخطى|تتخطى|تخطى|تخطت|يفوق|تفوق|يزيد على|تزيد على)\s+(?:مستوى\s+|حاجز\s+|عتبة\s+)?(\d[\d,]*(?:\.\d+)?)/g)) {
    const t = Number(m[1].replace(/,/g, ""));
    if (values.some((v) => t < v && v <= t * 1.15)) thresholds.add(m[1].replace(/,/g, ""));
  }
  for (const m of normalized.matchAll(/(?<![؀-ۿ])(?:و|ف)?(?:دون|أقل من|أدنى من|تحت|ما دون)\s+(?:مستوى\s+|حاجز\s+|عتبة\s+)?(\d[\d,]*(?:\.\d+)?)/g)) {
    const t = Number(m[1].replace(/,/g, ""));
    if (values.some((v) => t > v && t <= v * 1.15)) thresholds.add(m[1].replace(/,/g, ""));
  }
  const missing = [];
  for (const n of extractNumbers(text)) {
    const value = Number(n);
    if (!Number.isFinite(value)) continue;
    const yearLike = ignoreYears && value >= 1900 && value <= 2100 && Number.isInteger(value);
    const small = value >= 0 && value <= 31 && Number.isInteger(value); // days, small counts, ordinals
    // A year or a small count is trivial only when no unit follows it: "12%" and "2,000 دولار" are figures.
    if ((yearLike || small) && !unitBound.has(n)) continue;
    if (expanded.has(n) || expanded.has(String(value)) || thresholds.has(n)) continue;
    // Half a percent of drift covers a source's own rounding; anything more is a different number.
    const tolerant = [...expanded].some((p) => {
      const pv = Number(p);
      return Number.isFinite(pv) && pv !== 0 && Math.abs(pv - value) / Math.abs(pv) < 0.005;
    });
    if (!tolerant) missing.push(n);
  }
  return [...new Set(missing)];
}

export function wordCount(text) {
  return String(text ?? "").split(/\s+/).filter(Boolean).length;
}

// A demonstrative or «كذلك» among a sentence's first four words, with its attached و/ف/ب/ل/ك: «وهذه الخطوة…»، «ومع
// ذلك…»، «وكانت قيود الاستخدام هذه…». Deeper in («وارتفع المؤشر 2% في هذه الجلسة») it is the sentence's own business.
const BACK_REFERENCE = /^(?:[وفبلك]{0,2})(?:هذا|هذه|ذلك|تلك|هؤلاء|أولئك|هذان|هاتان|هذين|هاتين|ذاك|كذلك)$/;
// A demonstrative before a word of time names the time, not the sentence before: «وتتوقع الشركة هذا العام نمواً…»,
// «في هذه الأثناء» (the review of 2026-10-30: the last cut took a sourced forecast with the unsourced figure before it).
const TIME_WORD = /^(?:ال)?(?:عام|أسبوع|شهر|يوم|ربع|فصل|موسم|أثناء|سنة|صباح|مساء|ليلة|أيام|أسابيع|أشهر|شهور)$/;
// A pronoun opening that takes up the sentence before: «وهو ما يعني…»، «وهي أعلى نسبة…»، «مما يرفع…».
const PRONOUN_OPENING = /^(?:[وف]?(?:هو|هي|هما|هم)\s|مما\s|ما يعني\s)/;
/**
 * Whether a sentence points back at the one before it. A cut that takes out the sentence before one of these leaves the
 * reference hanging: «وكانت قيود الاستخدام هذه قد أوقعت الشركة في خلاف…» stood in the Anthropic story of 27 October with
 * no restrictions named before it, and both of the newsroom's sentence cutters (the last cut and the trim of what no
 * source bears on) read sentence by sentence.
 */
export function refersBack(sentence) {
  const text = String(sentence ?? "").trim();
  if (PRONOUN_OPENING.test(text)) return true;
  const words = text.split(/\s+/).slice(0, 5).map((w) => w.replace(/[^\p{L}]/gu, ""));
  return words.slice(0, 4).some((w, i) => BACK_REFERENCE.test(w) && !TIME_WORD.test(words[i + 1] ?? ""));
}

/**
 * A line's sentences, a quotation that runs over several kept as one unit: «قال الوزير «سنرفع الإنتاج. وسنخفض
 * الأسعار» في مؤتمر صحفي.» is one, so neither cutter can take half a quotation and leave its marks unbalanced (the
 * review of 2026-10-30). A fact-check sentence that is half of one matches no unit, and stays.
 */
export function sentenceUnits(line) {
  const units = [];
  let open = 0;
  for (const part of String(line ?? "").split(/(?<=[.؟!])\s+/)) {
    if (open > 0 && units.length) units[units.length - 1] += ` ${part}`;
    else units.push(part);
    open = Math.max(0, open + (part.match(/«/g) ?? []).length - (part.match(/»/g) ?? []).length);
  }
  return units;
}

/** Share of 6-word shingles of `text` that appear verbatim in `source`. */
export function phraseOverlap(text, source, size = 6) {
  const tokens = (t) => normalizeDigits(t).toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").split(/\s+/).filter(Boolean);
  const a = tokens(text);
  const b = tokens(source);
  if (a.length < size || b.length < size) return 0;
  const shingles = new Set();
  for (let i = 0; i + size <= b.length; i += 1) shingles.add(b.slice(i, i + size).join(" "));
  let hits = 0;
  let total = 0;
  for (let i = 0; i + size <= a.length; i += 1) {
    total += 1;
    if (shingles.has(a.slice(i, i + size).join(" "))) hits += 1;
  }
  return total ? hits / total : 0;
}

/** The longest runs of the text that appear verbatim in the source (six-word shingles merged), in the text's own words, for the reviser to rewrite. */
export function overlappingPhrases(text, source, size = 6, max = 3) {
  const norm = (w) => normalizeDigits(w).toLowerCase().replace(/[\p{P}\p{S}]/gu, "");
  const words = (t) => String(t).split(/\s+/).filter(Boolean).map((raw) => ({ raw, key: norm(raw) })).filter((w) => w.key);
  const a = words(text);
  const b = words(source);
  if (a.length < size || b.length < size) return [];
  const shingles = new Set();
  for (let i = 0; i + size <= b.length; i += 1) shingles.add(b.slice(i, i + size).map((w) => w.key).join(" "));
  const runs = [];
  let start = -1;
  for (let i = 0; i + size <= a.length; i += 1) {
    const hit = shingles.has(a.slice(i, i + size).map((w) => w.key).join(" "));
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      runs.push(a.slice(start, i - 1 + size).map((w) => w.raw).join(" "));
      start = -1;
    }
  }
  if (start >= 0) runs.push(a.slice(start).map((w) => w.raw).join(" "));
  return runs.sort((x, y) => y.length - x.length).slice(0, max).map((r) => (r.length > 120 ? r.slice(0, 117) + "…" : r));
}

export function slugifyLatin(input) {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export function isoNow() {
  return new Date().toISOString();
}

export function hoursSince(dateLike) {
  if (dateLike == null || dateLike === "") return Infinity;
  const t = new Date(dateLike).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 36e5;
}

export function truncate(text, max) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function safeIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
