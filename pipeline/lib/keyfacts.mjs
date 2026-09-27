/**
 * What the key-facts box may hold. A news story, analysis, paper reading, week's review or «في العمق» prints its key
 * facts under the heading «الأرقام», so each value must be a figure. The owner, 2026-09-27, on a story about US sanctions
 * on Iranian aviation whose box listed «بغداد ومسقط», «النجف» and «الإقصاء من نظام الدولار» under «الأرقام»: every
 * writer had been told "the figure exactly as sourced", but nothing refused a value that was not one (style.mjs only
 * warned on a label beginning «تاريخ/موعد»), and that day 34 published boxes held 36 values with no figure in them
 * (places, companies, outlets, weekdays, verdicts, «لم تُعلن») and 18 dates; nine boxes held nothing else. The newest,
 * written by Claude the night before, was among them. So code decides: a value with no quantity in it, or a date,
 * leaves the box; the fact itself stays in the story's text.
 * An explainer's box is its key terms with their definitions, printed under «مفاهيم أساسية», and is left as it is.
 *
 * Applied where a draft is normalised (lib/write.mjs), where an article is written (lib/article.mjs), by the
 * corrections editor (correct.mjs), and to published stories by `node pipeline/tidy.mjs`; the gate's
 * site-check refuses a published «الأرقام» box that breaks it, and scripts/pipeline-selftest.mjs pins its cases.
 */

// Arabic letters and marks, the edges of a word: not the whole Unicode block, whose «،» «؛» «؟» end a word.
const AR = "ء-ٟٮ-ۓۺ-ۿ";
const TASHKEEL = /[ً-ٰٟـ]/g; // harakat, the dagger alef, the tatweel
const toLatinDigits = (s) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
const norm = (s) => toLatinDigits(String(s ?? "").replace(TASHKEEL, "")).replace(/\s+/g, " ").trim();

// Numbers written in letters, as the desks write small counts, fractions and ordinals («سبعة أيام»، «نحو الثلث»،
// «ربع نقطة مئوية»، «الثانية»), and the duals that are counts on their own («شهران»، «ساعتان»، «رفعان»، «جزآن»).
const NUMBER_WORDS = [
  "صفر", "واحد", "واحدة", "اثنان", "اثنين", "اثنتان", "اثنتين",
  "ثلاث", "ثلاثة", "ثلاثون", "ثلاثين", "أربع", "أربعة", "أربعون", "أربعين", "خمس", "خمسة", "خمسون", "خمسين",
  "ست", "ستة", "ستون", "ستين", "سبع", "سبعة", "سبعون", "سبعين", "ثمان", "ثماني", "ثمانية", "ثمانون", "ثمانين",
  "تسع", "تسعة", "تسعون", "تسعين", "عشر", "عشرة", "عشرون", "عشرين", "عشرات", "بضع", "بضعة",
  "مئة", "مائة", "مئات", "مئتان", "مئتين", "مائتان", "مائتين", "ألف", "آلاف", "ألفان", "ألفين",
  "مليون", "ملايين", "مليونان", "مليونين", "مليار", "مليارات", "ملياران", "مليارين", "تريليون", "تريليونات",
  "نصف", "ثلث", "ثلثا", "ثلثي", "ثلثان", "ثلثين", "ربع", "أضعاف", "ضعفا", "ضعفي", "ضعفان", "ضعفين",
  "الأول", "الأولى", "الثاني", "الثانية", "الثالث", "الثالثة", "الرابع", "الرابعة", "الخامس", "الخامسة",
  "السادس", "السادسة", "السابع", "السابعة", "الثامن", "الثامنة", "التاسع", "التاسعة", "العاشر", "العاشرة",
  "ساعتان", "ساعتين", "يومان", "يومين", "أسبوعان", "أسبوعين", "شهران", "شهرين", "عامان", "عامين", "سنتان", "سنتين",
  "عقدان", "عقدين", "قرنان", "قرنين", "دقيقتان", "دقيقتين", "مرتان", "مرتين", "نقطتان", "نقطتين", "رفعان", "رفعين",
  "خفضان", "خفضين", "دولاران", "دولارين", "جزآن", "جزأين", "جزءان", "جزءين", "جولتان", "جولتين", "صفقتان", "صفقتين",
  "شركتان", "شركتين", "دولتان", "دولتين", "سفينتان", "سفينتين", "ناقلتان", "ناقلتين", "طائرتان", "طائرتين",
  "مصنعان", "مصنعين", "محطتان", "محطتين",
];
const NUMBER_WORD = new RegExp(`(?<![${AR}])[وفبلك]?(?:ال|لل)?(?:${NUMBER_WORDS.join("|")})(?![${AR}])`);
// «ضعف» alone is also "weakness" (ضَعف الطلب); it counts only after a word of measure («أكثر من ضعف»، «نحو ضعف»).
const DOUBLE = new RegExp(`(?<![${AR}])(?:أكثر من|أقل من|نحو|قرابة|حوالي|زهاء|إلى)\\s+(?:ال)?ضعف(?![${AR}])`);
// A credit rating is the figure of a rating story (BBB-, A+, Aa3), in Latin letters or as the desks spell it (إيه+).
const RATING = /(?<![A-Za-z])(?:AAA|AA[+-]?|A-[1-3]\+?|A[+-]|BBB[+-]?|BB[+-]?|B[+-]|CCC[+-]?|Aaa|Aa[1-3]|A[1-3]|Baa[1-3]|Ba[1-3]|B[1-3]|Caa[1-3])(?![A-Za-z0-9+-])/;
const RATING_AR = /^(?:(?:إيه|بي|سي)\s?){1,3}[+\-−]?(?=\d|\/|\s|$)/;

/** Whether a text carries a quantity: a digit, a number in letters, a fraction, a dual count or a credit rating. */
function hasQuantity(text) {
  return /\d/.test(text) || NUMBER_WORD.test(text) || DOUBLE.test(text) || RATING.test(text) || RATING_AR.test(text);
}

const MONTHS = "يناير|فبراير|مارس|أبريل|إبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|كانون الثاني|كانون الأول|شباط|آذار|نيسان|أيار|حزيران|تموز|آب|أيلول|تشرين الأول|تشرين الثاني";
const WEEKDAYS = "الأحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت";
const DATE_PARTS = [
  // A day or a span of days with its month, and the year when given: «23 سبتمبر»، «من 14 إلى 16 سبتمبر 2026»، «7-9 سبتمبر».
  new RegExp(`(?:(?:من|بين)\\s+)?\\d{1,2}(?:\\s*(?:[-–]|إلى|حتى|و)\\s*\\d{1,2})?\\s+(?:${MONTHS})(?:\\s+\\d{4})?`, "g"),
  // A month, or two, with the year: «يناير 2005»، «يناير وأبريل 2027».
  new RegExp(`(?:${MONTHS})(?:\\s*(?:و|[-–]|إلى)\\s*(?:${MONTHS}))?\\s+\\d{4}`, "g"),
  // A weekday: «الخميس»، «يوم الجمعة».
  new RegExp(`(?<![${AR}])(?:يوم\\s+)?[وف]?(?:${WEEKDAYS})(?![${AR}])`, "g"),
  // A year after a word of time: «منذ عام 1972»، «في 2018»، «مطلع 2026».
  new RegExp(`(?<![${AR}\\d])(?:[وف]?(?:في|منذ|حتى|مطلع|أوائل|أواخر|نهاية|بداية|منتصف|عام|العام|سنة|لعام)\\s+)+(?:19|20)\\d{2}(?!\\d)`, "g"),
  // A time of day: «02:22».
  /(?<!\d)\d{1,2}:\d{2}(?!\d)/g,
  // An ISO date: «2026-09-17».
  /(?<!\d)(?:19|20)\d{2}-\d{2}-\d{2}(?!\d)/g,
  // Years listed, or a year left open: «2022 و2024»، «2030 على الأقل».
  new RegExp(`(?<![\\d${AR}])(?:19|20)\\d{2}(?:(?:\\s*(?:و|،|[-–])\\s*(?:19|20)\\d{2})+|\\s+(?:على الأقل|فصاعدا|فما بعد))(?![\\d${AR}])`, "g"),
];

/**
 * Whether a value is a date rather than a figure: once its dates (and anything in brackets) are taken out, no quantity
 * is left. «23 سبتمبر», «الخميس», «2018» and «منذ عام 1972» are dates; «9 أيام (13-22 سبتمبر)» and «171 دولاراً للبرميل
 * للأسبوع المنتهي في 4 سبتمبر» are figures with a date beside them. A bare year is a count only when the label says so
 * («عدد الموظفين: 2000»).
 */
export function isDateValue(value, label = "") {
  let rest = norm(value).replace(/\([^)]*\)/g, " ");
  let dated = false;
  for (const re of DATE_PARTS) {
    rest = rest.replace(re, () => {
      dated = true;
      return " ";
    });
  }
  rest = rest.trim();
  if (/^(?:19|20)\d{2}$/.test(rest) && !/^(?:ال)?عدد/.test(norm(label))) return true;
  return dated && !hasQuantity(rest);
}

// What a figure may open with: its number, a number in letters, a word of measure before a number («نحو 70%»، «حتى
// 7%»، «أعلى 12 مرة»، «من ستة إلى ثمانية أسابيع»), a change stated as a noun before its size («ارتفاع بأكثر من 40%»),
// a counted noun with «واحد» («عام واحد»), or a rating («BBB-»، «إيه+/إيه-1»). A value that opens with anything else is a
// sentence about a figure, not the figure: «تجاوزت 100 دولار للبرميل هذا الأسبوع»، «أعلنت 2023 لترخيص…»، «أدنى مستوى في
// 13 عاماً»، «يضاعف قيمة الشركة لتصل إلى 1.5 تريليون دولار» (the second audit of 2026-09-27 found 14 such values).
// Longest first: an alternation stops at the first word that fits, and «أعلى» must not take «أعلى من 126 دولاراً».
const MEASURE_WORDS = ["نحو", "حوالي", "حوالى", "قرابة", "زهاء", "أكثر من", "أقل من", "ما يزيد على", "ما يزيد عن", "ما يقارب", "ما لا يقل عن", "قريب من", "قرب", "دون", "فوق", "تحت", "حتى", "من", "بين", "ما بين", "أعلى من", "أدنى من", "أعلى", "أدنى", "بأكثر من", "بنحو", "بما يزيد على"]
  .sort((a, b) => b.length - a.length)
  .join("|");
const CHANGE_NOUNS = "ارتفاع|تراجع|انخفاض|زيادة|نمو|هبوط|صعود|قفزة|خفض|رفع|تقلص|انكماش|توسع|تضاعف";
const LEADS = [
  /^[+\-−±~≈]?[$€£¥]?\d/,
  new RegExp(`^[وفبلك]?(?:ال|لل)?(?:${NUMBER_WORDS.join("|")})(?![${AR}])`),
  /^(?:AAA|AA|A|BBB|BB|B|CCC|Aaa|Aa\d|A\d|Baa\d|Ba\d|B\d|Caa\d)[+-]?(?![A-Za-z])/,
  RATING_AR,
  new RegExp(`^[^\\s]+\\s+(?:واحد|واحدة)(?![${AR}])`),
  // A vote's tally: «إجماع 12 عضواً».
  /^ب?إجماع\s+\d/,
];
const LEAD_WORD = new RegExp(`^(?:(?:${MEASURE_WORDS})|(?:${CHANGE_NOUNS})(?:\\s+(?:ب(?:نسبة)?|بأكثر من|بنحو|بما يزيد على|إلى|من))?)\\s+(.*)$`);

/** Whether a value opens with its quantity (see above), not with a verb or a description. */
function leadsWithQuantity(v) {
  if (LEADS.some((re) => re.test(v))) return true;
  const m = v.match(LEAD_WORD);
  const rest = m ? m[1].trim() : "";
  return Boolean(m) && (LEADS.some((re) => re.test(rest)) || new RegExp(`^(?:ال)?ضعف(?![${AR}])`).test(rest));
}

/** Whether a value is written mostly in Latin letters (an untranslated «18-year high» or «£150m»), a rating aside. */
function untranslated(v) {
  const latin = (v.match(/[A-Za-z]/g) ?? []).length;
  const arabic = (v.match(/[ء-ي]/g) ?? []).length;
  return latin > 0 && latin >= arabic && !RATING.test(v);
}

/** Whether a key fact's value is a figure the «الأرقام» box may print. */
export function isFigure(value, label = "") {
  const v = norm(value).replace(/^[«"'(]+/, "");
  return Boolean(v) && hasQuantity(v) && !isDateValue(v, label) && leadsWithQuantity(v) && !untranslated(v);
}

/**
 * The facts a piece's box keeps. For every kind but an explainer, the figures only (see above); an explainer's box is
 * its glossary and keeps every entry with a value. Order is kept.
 */
export function boxFacts(facts, kind = "news") {
  const list = (Array.isArray(facts) ? facts : []).filter((f) => f && String(f.value ?? "").trim());
  return kind === "explainer" ? list : list.filter((f) => isFigure(f.value, f.label));
}

/** The writers' instruction for the box (one sentence of the schema notes). */
export const FIGURES_RULE = "The key facts print under the heading «الأرقام», so every value is a figure: a number with its unit (an amount, a rate, a price, a count, a share, a duration), or a credit rating, opening with the number or its measure word («نحو 70%»، «أكثر من 4,000 وظيفة»، «حتى 7%»), in Arabic. A name, a place, a company, a date, a weekday, a decision, a description or a sentence about a figure («تجاوزت 100 دولار هذا الأسبوع»، «أدنى مستوى في 13 عاماً») is not a key fact however important it is: it stays in the text, and code drops it from the box. The label says exactly what the figure measures, and every figure in the box belongs to the headline's event. Give only as many key facts as the material has figures, at most six, and none when it has none.";
