/**
 * Two headlines of one event. The newsroom uses it before it writes (run.mjs: a working headline that repeats a story
 * of the last four days is not written, since "oil above 107" and "Brent above 108" once ran on the same day and the
 * Fed's hike three times), and the learner uses it to count two stories of one event as one (lib/lessons.mjs). Moved
 * here from run.mjs on 2026-09-26 so that one rule serves both and a test can reach it (scripts/pipeline-selftest.mjs).
 */
import { normalizeDigits } from "./util.mjs";

export const TITLE_STOPWORDS = new Set(["على", "إلى", "بعد", "قبل", "خلال", "بسبب", "بنسبة", "مليار", "مليون", "دولار", "دولارات", "الولايات", "المتحدة", "أسعار", "الاقتصاد", "الأسواق", "النفط", "الفائدة", "ارتفاع", "تراجع", "2026", "سبتمبر", "أغسطس", "أكتوبر", "الأول", "الثاني", "الأمريكي", "الأمريكية", "الأميركي", "الأميركية", "العالمي", "العالمية", "الشرق", "الأوسط", "نقطة", "أساس", "مستوى", "أعلى", "أدنى", "منذ"]);

/** A headline's distinctive words: longer than three letters, and not the words every economics headline has. */
export const distinctiveWords = (title) => new Set(String(title ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3 && !TITLE_STOPWORDS.has(w)));

/** Where a headline's cause or setting begins («… مع هجمات الحوثيين على السعودية»). */
const CAUSE = /(?:^|\s)(?:مع|بعد|بعدما|بسبب|وسط|إثر|عقب|جراء|جرّاء|على خلفية|في ظل)\s/;
const causeWords = (title) => {
  const text = String(title ?? "");
  const at = text.search(CAUSE);
  return at < 0 ? new Set() : distinctiveWords(text.slice(at));
};
/** A headline's figures, years left out (a forecast for 2027 is not a figure of the event). */
const figuresOf = (title) => new Set((normalizeDigits(String(title ?? "")).match(/\d+(?:[.,]\d+)?/g) ?? []).filter((n) => !/^(?:19|20)\d\d$/.test(n)));
/** A headline's leading subject, its first word; oil goes by several names («برنت يقفز…»، «النفط يقفز…»). */
const SUBJECT_ALIAS = new Map([["برنت", "النفط"], ["خام", "النفط"], ["الخام", "النفط"]]);
const subjectOf = (title) => {
  const first = String(title ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).find(Boolean) ?? "";
  return SUBJECT_ALIAS.get(first) ?? first;
};

/**
 * One event: at least three distinctive words shared, and at least half of the shorter headline's. Two headlines about
 * different subjects do not share an event through their cause clause alone (2026-10-22: «برنت عند أعلى مستوى في 5 أشهر
 * … مع هجمات الحوثيين على السعودية» was held as a repeat of «السعودية تؤجل مؤتمر مبادرة مستقبل الاستثمار … مع تصاعد
 * هجمات الحوثيين»: a running war names itself in every story it causes). When the leading subjects differ, the words of
 * either cause clause do not count; one subject's repeats (Brent above 107, Brent above 108) are matched as before.
 */
export function sameEvent(a, b) {
  const x = distinctiveWords(a);
  const y = distinctiveWords(b);
  const sameSubject = subjectOf(a) === subjectOf(b);
  // Two actors with two different figures are two events, however alike their verbs (2026-10-22: the IMF's Gulf outlook,
  // «صندوق النقد يتوقع انكماش اقتصادات الخليج 4.8%…», was skipped twice as a repeat of the World Bank's 4.3%).
  if (!sameSubject) {
    const fa = figuresOf(a);
    const fb = figuresOf(b);
    if (fa.size && fb.size && ![...fa].some((n) => fb.has(n))) return false;
  }
  const running = sameSubject ? new Set() : new Set([...causeWords(a), ...causeWords(b)]);
  let shared = 0;
  for (const w of x) if (y.has(w) && !running.has(w)) shared += 1;
  return shared >= 3 && shared / Math.max(1, Math.min(x.size, y.size)) >= 0.5;
}

/** The recent headline a working headline repeats, or null. */
export const repeatsRecent = (headline, recentTitles) => recentTitles.find((title) => sameEvent(headline, title)) ?? null;
