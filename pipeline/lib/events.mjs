/**
 * Two headlines of one event. The newsroom uses it before it writes (run.mjs: a working headline that repeats a story
 * of the last four days is not written, since "oil above 107" and "Brent above 108" once ran on the same day and the
 * Fed's hike three times), and the learner uses it to count two stories of one event as one (lib/lessons.mjs). Moved
 * here from run.mjs on 2026-09-26 so that one rule serves both and a test can reach it (scripts/pipeline-selftest.mjs).
 */
import { normalizeDigits } from "./util.mjs";
import { countriesNamed } from "./regions.mjs";

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
/**
 * A headline's figures, years left out (a forecast for 2027 is not a figure of the event), and a period's length too:
 * «في 9 أشهر» is in every nine-month result of the season, and Bahri's 587% shared it with Aldar's 19% (2026-10-28).
 */
const figuresOf = (title) => new Set((normalizeDigits(String(title ?? "")).match(/\d+(?:[.,]\d+)?(?!\d|[.,]\d)(?!\s*(?:أشهر|شهراً|شهرا|شهور|أسابيع|أسبوعاً|أيام|يوماً|سنوات|أعوام|عاماً))/g) ?? []).filter((n) => !/^(?:19|20)\d\d$/.test(n)));
/**
 * A headline's leading subject, its first word; oil goes by several names («برنت يقفز…»، «النفط يقفز…»). A word that
 * names the kind of story, not its actor, is passed over for the next («أرباح «اتصالات» ترتفع…» is Etisalat's, «أرباح
 * الدار ترتفع…» Aldar's): in the earnings season of October 2026 Etisalat's results were skipped twice and Bahri's once
 * as repeats of Aldar's, each led by «أرباح».
 */
const SUBJECT_ALIAS = new Map([["برنت", "النفط"], ["خام", "النفط"], ["الخام", "النفط"]]);
const KIND_WORDS = new Set(["أرباح", "إيرادات", "صافي", "خسائر", "مبيعات", "نتائج", "توزيعات", "سهم", "أسهم", "طرح", "تصنيف", "ديون", "صادرات", "واردات", "عائد", "عوائد", "ربح", "الربح", "الأرباح"]);
// A move named before its subject («ارتفاع أرباح سابك…», «قفزة في أرباح…») is passed over too: «ارتفاع أرباح سابك 30%»
// and «أرباح سابك ترتفع 30%» had two subjects, and every bank's «ارتفاع أرباح…» one (the review of 2026-10-30).
const MOVE_WORDS = new Set(["ارتفاع", "تراجع", "انخفاض", "هبوط", "صعود", "قفزة", "قفز", "نمو", "زيادة", "تضاعف", "انكماش", "تحسن", "في"]);
const subjectOf = (title) => {
  const words = String(title ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const first = words.find((w) => !KIND_WORDS.has(w) && !MOVE_WORDS.has(w)) ?? words[0] ?? "";
  return SUBJECT_ALIAS.get(first) ?? first;
};
/** A headline before its cause or setting: the countries of «… مع تراجع صادرات العراق» are the cause's, not the event's. */
const mainClause = (title) => {
  const text = String(title ?? "");
  const at = text.search(CAUSE);
  return at < 0 ? text : text.slice(0, at);
};

/**
 * One event: at least three distinctive words shared, and at least half of the shorter headline's. Two headlines about
 * different subjects do not share an event through their cause clause alone (2026-10-22: «برنت عند أعلى مستوى في 5 أشهر
 * … مع هجمات الحوثيين على السعودية» was held as a repeat of «السعودية تؤجل مؤتمر مبادرة مستقبل الاستثمار … مع تصاعد
 * هجمات الحوثيين»: a running war names itself in every story it causes). When the leading subjects differ, the words of
 * either cause clause do not count; one subject's repeats (Brent above 107, Brent above 108) are matched as before.
 */
export function sameEvent(a, b) {
  // Two countries' decisions are two events, however alike their words (2026-10-29: «المركزي المصري يرفع الفائدة 1% في
  // أول زيادة منذ مارس 2024», Egypt's first rise in two and a half years, was skipped as a repeat of «المركزي الباكستاني
  // يرفع الفائدة إلى 12% في أول زيادة منذ أبريل»: «المركزي» led both, and no story of it ran). Headlines that each name a
  // country, and no country in common, never match. Read in the main clause only: «… مع تراجع صادرات العراق» and «… وسط
  // مخاوف حرب إيران» had split Aramco's and the Fed's own repeats (the review of 2026-10-30).
  const ca = countriesNamed(mainClause(a));
  const cb = countriesNamed(mainClause(b));
  if (ca.size && cb.size && ![...ca].some((c) => cb.has(c))) return false;
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
  // Two subjects never share an event through their cause clause, nor through the word naming the kind of story.
  const running = sameSubject ? new Set() : new Set([...causeWords(a), ...causeWords(b), ...KIND_WORDS, ...MOVE_WORDS]);
  let shared = 0;
  for (const w of x) if (y.has(w) && !running.has(w)) shared += 1;
  return shared >= 3 && shared / Math.max(1, Math.min(x.size, y.size)) >= 0.5;
}

/** The recent headline a working headline repeats, or null. */
export const repeatsRecent = (headline, recentTitles) => recentTitles.find((title) => sameEvent(headline, title)) ?? null;
