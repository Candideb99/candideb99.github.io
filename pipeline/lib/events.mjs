/**
 * Two headlines of one event. The newsroom uses it before it writes (run.mjs: a working headline that repeats a story
 * of the last four days is not written, since "oil above 107" and "Brent above 108" once ran on the same day and the
 * Fed's hike three times), and the learner uses it to count two stories of one event as one (lib/lessons.mjs). Moved
 * here from run.mjs on 2026-09-26 so that one rule serves both and a test can reach it (scripts/pipeline-selftest.mjs).
 */
export const TITLE_STOPWORDS = new Set(["على", "إلى", "بعد", "قبل", "خلال", "بسبب", "بنسبة", "مليار", "مليون", "دولار", "دولارات", "الولايات", "المتحدة", "أسعار", "الاقتصاد", "الأسواق", "النفط", "الفائدة", "ارتفاع", "تراجع", "2026", "سبتمبر", "أغسطس", "أكتوبر", "الأول", "الثاني", "الأمريكي", "الأمريكية", "الأميركي", "الأميركية", "العالمي", "العالمية", "الشرق", "الأوسط", "نقطة", "أساس", "مستوى", "أعلى", "أدنى", "منذ"]);

/** A headline's distinctive words: longer than three letters, and not the words every economics headline has. */
export const distinctiveWords = (title) => new Set(String(title ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3 && !TITLE_STOPWORDS.has(w)));

/** One event: at least three distinctive words shared, and at least half of the shorter headline's. */
export function sameEvent(a, b) {
  const x = distinctiveWords(a);
  const y = distinctiveWords(b);
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared >= 3 && shared / Math.max(1, Math.min(x.size, y.size)) >= 0.5;
}

/** The recent headline a working headline repeats, or null. */
export const repeatsRecent = (headline, recentTitles) => recentTitles.find((title) => sameEvent(headline, title)) ?? null;
