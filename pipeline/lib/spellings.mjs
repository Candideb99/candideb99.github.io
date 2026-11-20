/**
 * The house spelling table, one module for the copy desk (copydesk.mjs) and the site's search page (src/pages/search.astro,
 * which respells a reader's query with it: «ترمب» found 11 stories where «ترامب» finds 135, 2026-11-20). It imports
 * nothing, so the site's build can read it, as it reads photo-key.mjs.
 */

/**
 * Deterministic repairs, applied to every field before the model sees the draft. A wire-agency spelling is
 * not a matter of taste, and a model asked nicely still wrote «هي لفيفنغ» twice on 2026-09-22; a table
 * cannot forget. Each entry: the wrong form, the house form. The house keeps one spelling of a name
 * (2026-09-23 audit: «أمريكي» in 49 stories and «أميركي» in 26, «ترامب» in 22 and «ترمب» in 7).
 */
/** @type {[RegExp, string][]} */
export const NAME_FIXES = [
  [/هي (?:لفيفنغ|لي فنغ|ليفنغ|لي فينغ|ليفينغ)/g, "خه لي فنغ"],
  [/خه (?:لفيفنغ|ليفنغ|ليفينغ)/g, "خه لي فنغ"],
  [/أميرك/g, "أمريك"],
  [/(?<![؀-ۿ])([وفبل]?)ترمب(?![؀-ۿ])/g, "$1ترامب"],
  [/(?<![؀-ۿ])([وفبل]?)وورش(?![؀-ۿ])/g, "$1وارش"],
  // «الشرق بلومبرغ» and «بلومبرج» in one story (the Saudi market story, 2026-10-19); the outlet writes «بلومبرغ».
  [/بلومبرج|بلومبيرغ|بلومبيرج/g, "بلومبرغ"],
  // One outlet, one spelling, the one its entry in pipeline/sources.json prints in the source list (2026-10-28: AGBI ran
  // as «إيه جي بي آي» in 12 stories and «أرابيان غلف بيزنس إنسايت» in 10, under a source list saying «… بزنس …»; the FT,
  // AP, JPMorgan, Morgan Stanley and Nvidia ran two ways each).
  [/إيه جي بي آي|أرابيان غلف بيزنس إنسايت/g, "أرابيان غلف بزنس إنسايت"],
  // …and in Latin letters as the outlet's name in an Arabic sentence («يرجّح موقع AGBI أن…», «ترجّح AGBI»); a gloss in
  // brackets after the Arabic name stays.
  [/«AGBI»|(?<![(«A-Za-z])AGBI(?![A-Za-z)»])/g, "«أرابيان غلف بزنس إنسايت»"],
  // Asharq Business ran three ways in the week it joined (2026-10-29: «الشرق للأعمال»، «اقتصاد الشرق مع بلومبرغ»، «الشرق
  // بلومبرغ»), its English name and its old programme's name translated; sources.json prints «الشرق بلومبرغ».
  // and a fourth on 30 October, «منصة «اقتصاد الشرق»» (three stories): the quoted name only, since «اقتصاد الشرق الأوسط»
  // is the region's economy.
  [/الشرق للأعمال|اقتصاد الشرق مع بلومبرغ/g, "الشرق بلومبرغ"],
  [/(?:منصة\s+)?«اقتصاد الشرق»/g, "«الشرق بلومبرغ»"],
  // Google: «جوجل» in 28 stories, «غوغل» in 6 (2026-10-29).
  [/غوغل/g, "جوجل"],
  // Kevin Warsh ran two ways in fourteen stories, and «وورش» once (2026-10-30): the site's most used spelling.
  [/كيفن (?=وارش|وورش)/g, "كيفين "],
  [/(?<=كيفين )وورش/g, "وارش"],
  [/فاينانشال تايمز/g, "فايننشال تايمز"],
  [/ذا ناشونال/g, "ذا ناشيونال"],
  [/ديلي نيوز إيجبت/g, "ديلي نيوز إيجيبت"],
  [/سبايس إكس|سبيس اكس/g, "سبيس إكس"],
  [/أوبن أيه آي/g, "أوبن إيه آي"],
  [/أسوشييتد برس/g, "أسوشيتد برس"],
  [/جيه بي مورغان/g, "جي بي مورغان"],
  [/مورجان/g, "مورغان"],
  [/(?<![؀-ۿ])([وفبل]?)نفيديا/g, "$1إنفيديا"],
  // A name glossed with itself, as the AGBI respelling left «أرابيان غلف بزنس إنسايت» (أرابيان غلف بزنس إنسايت).
  [/«([^«»]+)»\s*\(\1\)/g, "«$1»"],
  // A decimal comma reads as a thousands group under the house's own comma: «2,22 مليون برميل», copied from an Arabic
  // source that writes it so (the Russian diesel story, 2026-10-18), is 2.22 million and not 222. The house writes the
  // decimal point; three digits after a comma stay a thousands group.
  [/(?<![\d.,٫])(\d{1,3}),(\d{1,2})(?!\d)(?![.,٫]\d)/g, "$1.$2"],
  // A unit of energy is a watt times an hour, «كيلوواط ساعة», never a watt per hour: «50.82 كيلووات/ساعة» and «97 يورو
  // للميغاواط/ساعة» ran in five stories, against 22 written right (a review of 2026-11-01).
  [/(واط|وات)\s*\/\s*(ساعة)/g, "$1 $2"],
];
export function fixNames(text) {
  let out = String(text ?? "");
  for (const [re, to] of NAME_FIXES) out = out.replace(re, to);
  return out;
}
