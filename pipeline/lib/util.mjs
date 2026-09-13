import { createHash } from "node:crypto";

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
  for (const source of sources) for (const n of extractNumbers(source)) pool.add(n);
  const expanded = new Set(pool);
  for (const n of pool) {
    const value = Number(n);
    if (!Number.isFinite(value)) continue;
    // Allow common unit conversions: 4,000 -> "4" (آلاف), 1,700,000,000 -> 1.7 (مليار)
    for (const divisor of [1e3, 1e6, 1e9, 1e12]) {
      const scaled = value / divisor;
      if (scaled >= 1 && Number.isInteger(scaled * 100)) expanded.add(String(Number(scaled.toFixed(2))));
    }
    if (Number.isInteger(value * 10)) expanded.add(String(value));
    // Rounding to a whole or to one decimal is reporting, not alteration (108.44 -> 108 or 108.4).
    expanded.add(String(Math.round(value)));
    expanded.add(String(Number(value.toFixed(1))));
  }
  const unitBound = unitBoundNumbers(text);
  const missing = [];
  for (const n of extractNumbers(text)) {
    const value = Number(n);
    if (!Number.isFinite(value)) continue;
    const yearLike = ignoreYears && value >= 1900 && value <= 2100 && Number.isInteger(value);
    const small = value >= 0 && value <= 31 && Number.isInteger(value); // days, small counts, ordinals
    // A year or a small count is trivial only when no unit follows it: "12%" and "2,000 دولار" are figures.
    if ((yearLike || small) && !unitBound.has(n)) continue;
    if (expanded.has(n) || expanded.has(String(value))) continue;
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
