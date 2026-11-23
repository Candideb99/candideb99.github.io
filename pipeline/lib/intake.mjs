/**
 * What the newsroom leaves out of the editor's list before any model reads it (run.mjs gatherCandidates()).
 * Price-service items: the Egyptian and Gulf sites post the day's gold, dollar and share prices many times a day
 * («تحديث لحظى.. ثبات سعر الدولار مقابل الجنيه اليوم»، «أسعار الذهب فى مصر اليوم الأربعاء»): tables, not news.
 */
const SERVICE_ITEM = /(?:سعر|أسعار)\s+(?:الذهب|الدولار|اليورو|الريال|الدرهم|الجنيه|العملات|الحديد|الأسمنت|الفضة|الخضروات|الخضار|الفاكهة|الدواجن|الفراخ|اللحوم|الأسماك|الأسهم|البنزين)[^.؟]{0,70}?(?:اليوم|الآن|لحظ|مساء|صباح)|تحديث لحظ[يى]|حصاد الـ?\s?\d+ دقيقة|آخر تحديث لسعر|(?:التعاملات|تعاملات) (?:الصباحية|المسائية)/;
// Never a headline that reports a change by its size, or a decision or a deal: «مصر ترفع سعر البنزين اليوم 15% بعد قرار
// لجنة التسعير» and «سهم … يهوي 20% في التعاملات الصباحية بعد إلغاء الاندماج» were left out as price tables (2026-11-23).
const SERVICE_NEWS = /\d\s*(?:%|٪|في المئة|بالمئة)|قرار|لجنة التسعير|إلغاء|صفقة|استحواذ|اندماج/;

/** Whether a feed item's headline is a price table and not news. */
export const serviceItem = (title) => SERVICE_ITEM.test(String(title ?? "")) && !SERVICE_NEWS.test(String(title ?? ""));
