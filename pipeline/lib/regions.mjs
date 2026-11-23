/**
 * The regional desks, shared with the site (`src/data/regions.json`): the writer's free-form
 * region tags are mapped to the desk names before an article is saved.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const DESKS = JSON.parse(readFileSync(path.join(process.cwd(), "src", "data", "regions.json"), "utf8"));
const byTag = new Map();
for (const d of DESKS) {
  byTag.set(d.name, d);
  for (const m of d.match) byTag.set(m, d);
}

export const DESK_NAMES = DESKS.map((d) => d.name);

/**
 * A desk that was split, read as every desk it became: «مصر والمغرب العربي» was Egypt's and the Maghreb's until
 * 2026-11-19 (the owner: "then make egypt away from maghreb?"; 48 of its 57 stories that month were Egypt's). A story
 * filed under it by a run that checked out the code before the split, or published before it, goes to both, and
 * groundedRegions() keeps the one its headline, dek or lede names.
 */
const SPLIT_DESKS = new Map([["مصر والمغرب العربي", ["مصر", "المغرب العربي"]]]);

/** An alias must stand as a whole word in the tag (a nisba ending is allowed: المصرية, الإماراتي); "مصرف" is not "مصر". */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = new Map(DESKS.flatMap((d) => d.match.map((m) => [m, new RegExp(`(?<!\\p{L})${escapeRe(m)}(?:ي|ية)?(?!\\p{L})`, "u")])));

/**
 * Canonical desk names for a list of region tags, in the writer's order (the first is the story's main region), each
 * once; unknown tags are dropped. `cap` is three; groundedRegions() caps after grounding, since a split desk's two
 * names had pushed a story's third region out before either was grounded (the dry run of 2026-11-19).
 */
export function canonicalRegions(tags, { cap = 3 } = {}) {
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw).trim();
    const names = SPLIT_DESKS.get(tag) ?? [(byTag.get(tag) || DESKS.find((x) => x.match.some((m) => wholeWord.get(m).test(tag))))?.name];
    for (const name of names) if (name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, cap);
}

/**
 * The places that put a story on an Arab desk, beyond the desk's own names in regions.json: the adjectives, cities,
 * ports, waters and companies a story names them by. A story's regions are where its event happens, never where its
 * effects might be felt: the audit of 2026-09-27 found the US jobs report and US inflation on the Gulf desk, and the
 * Bank of England, UK inflation and EU gas on the Middle East desk, because the writer had tagged the war as a cause or
 * the Gulf as the reader's interest.
 *
 * One place, one desk (2026-10-19, the owner's check of the whole site): the third Arab desk had been «الشرق الأوسط», the
 * region the Gulf and Egypt desks beside it belong to, and half its stories were Gulf stories tagged with the wider
 * region too. It is «المشرق وإيران وتركيا», what the other two do not hold; the region as a whole names no desk, and
 * Hormuz, the mouth of the Gulf, is the Gulf desk's. Egypt and the Maghreb were one desk until 2026-11-19 (SPLIT_DESKS).
 */
const PLACES = {
  // Not «تداول» or «مبادلة»: they are also the words for trading and swapping.
  "الخليج": ["خليجي", "سعودي", "إماراتي", "قطري", "كويتي", "بحريني", "عماني", "الرياض", "جدة", "الدمام", "أبوظبي", "أبو ظبي", "دبي", "الشارقة", "الفجيرة", "عجمان", "الدوحة", "المنامة", "مسقط", "أرامكو", "أدنوك", "سابك", "ينبع", "هرمز", "رأس تنورة", "رأس لفان", "جازان", "الخفجي", "نيوم", "مجلس التعاون", "صندوق الاستثمارات العامة", "جهاز قطر للاستثمار", "قطر للطاقة"],
  "مصر": ["مصري", "القاهرة", "الإسكندرية", "السويس", "بورسعيد", "السخنة", "العلمين", "الغردقة", "أسوان", "الجيزة", "شرم الشيخ", "العاصمة الإدارية"],
  // Not «طرابلس»: Lebanon has one too.
  "المغرب العربي": ["مغاربي", "مغربي", "جزائري", "تونسي", "ليبي", "موريتاني", "الدار البيضاء", "الرباط", "طنجة", "مراكش", "وهران", "صفاقس", "بنغازي", "مصراتة", "نواكشوط"],
  "المشرق وإيران وتركيا": ["إيراني", "عراقي", "تركي", "إسرائيلي", "أردني", "لبناني", "سوري", "يمني", "فلسطيني", "طهران", "بغداد", "البصرة", "كردستان", "الحوثي", "البحر الأحمر", "باب المندب", "غزة", "الضفة الغربية", "القدس", "المستوطنات", "أنقرة", "إسطنبول", "بيروت", "دمشق", "تل أبيب"],
};
const normalizePlace = (s) => String(s ?? "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
// A place as a whole word, through the letters Arabic joins to it («وبالسعودية»، «للرياض») and the endings of its
// adjective and plural («السعوديين»، «الحوثيون») and its accusative («مقترحاً إيرانياً», 2026-10-19), never inside another
// word («الرياضة» is not «الرياض»).
// Arabic letters and marks only: the Arabic comma, semicolon and question mark sit in the same Unicode block and end
// a word («مضيق هرمز؟»).
const LETTER = "\\u0621-\\u065F\\u066E-\\u06D3\\u06FA-\\u06FF";
// «ه» ends only a nisba's «ي» (السعودية، الروسية): after a city it makes another word, and «الرياضة» had read as «الرياض»
// (the review of 2026-10-30). A country's name may also end «يا» (`country`: «تركيا» from «ترك»).
export const placeRe = (w, { country = false } = {}) => {
  const n = escapeRe(normalizePlace(w));
  const forms = n.startsWith("ال") ? `[وفبك]?(?:${n}|لل${n.slice(2)})` : `[وفبلك]?(?:ال|لل)?${n}`;
  const ends = [...(n.endsWith("ي") ? ["ه"] : []), "ي", "يه", "ين", "يون", "يين", "ون", ...(country ? ["يا"] : ["ات"]), "ا"];
  return new RegExp(`(?<![${LETTER}])${forms}(?:${ends.join("|")})?(?![${LETTER}])`);
};
const DESK_PLACES = new Map(DESKS.filter((d) => PLACES[d.name]).map((d) => [d.name, [d.name, ...d.match, ...PLACES[d.name]].map(placeRe)]));

// The war named as a cause («جراء الحرب في الشرق الأوسط»، «وسط تحذيرات من تأثير حرب إيران») does not put a European rate
// decision on the Middle East desk (the Bank of England, the ECB and UK growth were there on 2026-09-27); a story
// about the region names it outside such a phrase («إيران تعلن…»، «مضيق هرمز»).
const CONFLICT_CAUSE = /(?:ال)?(?:حرب|صراع|نزاع|توترات|تصعيد|ازمه)(?:\s+(?:في|علي|مع|ضد))?\s+(?:منطقه\s+)?(?:الشرق الاوسط|ايران|الايرانيه|الخليج)/g;

/**
 * The United States has a desk of its own since 2026-11-20 (the owner: "shouldd we add dedicated USA and China
 * categories?", then "Yes, add US desk"): about 1.3 news stories a day named it in the headline, where China named
 * about 2 a week. Until then it was part of «الأمريكتان», which the site folds into «العالم». A story filed under the
 * Americas, by a writer's habit or before the desk existed, stays there only when its headline, dek or lede names
 * another country of the Americas and not the US; it is on both when it names both, and otherwise on the US desk:
 * of the 190 published stories filed under the Americas that day, about 40 named no country of the Americas in their
 * headline, dek or lede, nearly all American companies (Apple, Nvidia, Anthropic, OpenAI) or prices in dollars. Under
 * this rule 186 moved to the US desk (4 of them, the US with Canada or Mexico, on both) and 4 stayed: Brazil's
 * election markets twice, the UAE–Canada agreement and Venezuela's oil.
 */
const US_DESK = "الولايات المتحدة";
const AMERICAS_DESK = "الأمريكتان";
const US_PLACES = ["الولايات المتحدة", "أمريكي", "أميركي", "أمريكيتان", "أميركيتان", "أمريكيتين", "أميركيتين", "أمريكا", "أميركا", "واشنطن", "نيويورك", "وول ستريت", "تكساس", "كاليفورنيا", "البيت الأبيض", "ترامب", "ترمب", "الاحتياطي الفيدرالي", "الفيدرالي", "ناسداك", "داو جونز", "إس آند بي"].map((w) => placeRe(w));
const OTHER_AMERICAS = ["كندا", "كندي", "المكسيك", "مكسيكي", "البرازيل", "برازيلي", "الأرجنتين", "أرجنتيني", "تشيلي", "كولومبيا", "كولومبي", "بيرو", "بيروفي", "فنزويلا", "فنزويلي", "أمريكا اللاتينية", "أميركا اللاتينية", "لاتيني"].map((w) => placeRe(w));
// «أمريكا اللاتينية» is not the US, and the dollar's name («الدولار الأمريكي») places nothing: both are taken out
// before the US is looked for. «مقاطعة كولومبيا» is Washington's district, not Colombia.
const NOT_US = /امريكا اللاتينيه|اميركا اللاتينيه|امريكا الجنوبيه|اميركا الجنوبيه|امريكا الوسطي|اميركا الوسطي|امريكا الشماليه|اميركا الشماليه|الدولار الامريكي|الدولار الاميركي/g;
const NOT_AMERICAS = /مقاطعه كولومبيا/g;
function toUsDesk(canon, text) {
  if (!canon.includes(AMERICAS_DESK)) return canon;
  const hay = normalizePlace(text);
  const us = US_PLACES.some((re) => re.test(hay.replace(NOT_US, " ")));
  const others = OTHER_AMERICAS.some((re) => re.test(hay.replace(NOT_AMERICAS, " ")));
  if (others && !us) return canon;
  const out = [];
  for (const r of canon) {
    if (r === AMERICAS_DESK) {
      if (!out.includes(US_DESK)) out.push(US_DESK);
      if (others) out.push(r);
    } else if (!out.includes(r)) out.push(r);
  }
  return out;
}

/** Whether a text names a place of an Arab desk. */
function namesDesk(desk, text) {
  const hay = normalizePlace(text).replace(CONFLICT_CAUSE, " ");
  return (DESK_PLACES.get(desk) ?? []).some((re) => re.test(hay));
}

/**
 * Who the headline's actors are (the owner, 2026-10-29, on «أكوا» و«إي آي جي» تؤسسان منصة كهرباء أمريكية…: "confusing
 * … no keywords for the location"). A desk gives a company, fund or bank its reader may not place its country in the
 * headline: «"جي إي فيرنوفا" الأميركية تضخ 9 مليارات دولار بشركة معدات كهرباء ألمانية» (الشرق بلومبرغ), «أرباح "البحري"
 * السعودية» (الاقتصادية), "Oman's Asyad Group", "Saudi dairy giant Almarai" (Reuters, on Zawya), all of 28 October.
 * Code sees one case for certain: the story itself gives a name its nationality («أكوا» السعودية, «إي آي جي» (EIG)
 * الأمريكية) and the headline carries the name while neither it nor the dek says the country (3 of 144 news stories of
 * 18-29 October: ACWA, Scatec, SK Hynix). Each nationality, with the words that place it in a headline.
 */
// Each a whole word (placeRe()), so a country's main cities, ports and fields are listed by name: «معادن» السعودية under a
// headline ending «في ينبع» was flagged as unplaced (the review of 2026-10-30). Not the seats of world bodies (Vienna,
// Geneva): an OPEC meeting there is no Austrian event.
const NATIONALITIES = {
  "سعودي": ["سعودي", "المملكة", "الرياض", "جدة", "مكة", "المدينة المنورة", "الدمام", "نيوم", "ينبع", "الجبيل", "رأس تنورة", "تبوك", "العلا", "جازان", "الخفجي", "الطائف"],
  "إماراتي": ["إمارات", "أبوظبي", "أبو ظبي", "دبي", "الشارقة", "رأس الخيمة", "الفجيرة", "عجمان", "جبل علي", "الرويس"], "قطري": ["قطر", "الدوحة", "رأس لفان"], "كويتي": ["كويت"],
  "بحريني": ["بحرين", "المنامة"], "عماني": ["عمان", "مسقط", "الدقم", "صلالة", "صحار"], "مصري": ["مصر", "القاهرة", "الإسكندرية", "السويس", "بورسعيد", "السخنة", "العلمين", "الغردقة", "أسوان", "الجيزة", "شرم الشيخ"], "مغربي": ["مغرب", "الدار البيضاء", "الرباط", "طنجة", "مراكش"], "جزائري": ["جزائر", "وهران"], "تونسي": ["تونس", "صفاقس"],
  "ليبي": ["ليبي", "بنغازي", "مصراتة"], "إيراني": ["إيران", "طهران", "بندر عباس"], "عراقي": ["عراق", "بغداد", "البصرة", "أربيل", "كركوك", "الموصل", "كردستان"], "تركي": ["ترك", "إسطنبول", "أنقرة", "إزمير"], "إسرائيلي": ["إسرائيل", "تل أبيب"], "أردني": ["أردن", "العقبة"],
  "لبناني": ["لبنان", "بيروت"], "سوري": ["سوري", "دمشق", "حلب", "بانياس"], "يمني": ["يمن", "صنعاء", "عدن", "الحديدة"], "فلسطيني": ["فلسطين", "غزة", "الضفة الغربية"], "أمريكي": ["أمريك", "أميرك", "الولايات المتحدة", "واشنطن", "نيويورك", "وول ستريت", "تكساس", "كاليفورنيا"],
  "أميركي": ["أمريك", "أميرك", "الولايات المتحدة", "واشنطن", "نيويورك", "وول ستريت", "تكساس", "كاليفورنيا"], "كندي": ["كند"], "مكسيكي": ["مكسيك"], "برازيلي": ["برازيل"],
  "صيني": ["صين", "بكين", "شنغهاي", "شنتشن", "هونغ كونغ"], "ياباني": ["يابان", "طوكيو"], "هندي": ["هند", "مومباي", "نيودلهي"], "كوري": ["كوري", "سيول"], "تايواني": ["تايوان", "تايبيه"],
  // South Asia's own press joined the sources on 2026-11-20 (Pakistan, Bangladesh, Sri Lanka).
  "بنغلاديشي": ["بنغلاديش", "بنغلاديشي", "دكا", "شيتاغونغ"], "سريلانكي": ["سريلانكا", "سري لانكا", "سريلانكي", "كولومبو"],
  // «سنغافورة» ends in «ة», which placeRe() takes only after a nisba's «ي», so the country is listed whole (2026-11-19).
  "سنغافوري": ["سنغافور", "سنغافورة"],
  "إندونيسي": ["إندونيسي", "جاكرتا"], "ماليزي": ["ماليزي", "كوالالمبور"], "باكستاني": ["باكستان", "كراتشي", "إسلام آباد", "لاهور"], "أسترالي": ["أسترالي", "كانبرا"], "روسي": ["روسي", "موسكو"],
  // The world's other regions, read since their own press joined the sources on 2026-11-19: two central banks' rate
  // decisions there must stay two events (events.mjs), as Egypt's and Pakistan's did not on 29 October.
  "كازاخستاني": ["كازاخستان", "كازاخ", "أستانا", "ألماتي"], "أوزبكي": ["أوزبكستان", "أوزبك", "طشقند"], "تركمانستاني": ["تركمانستان", "عشق آباد"],
  "قيرغيزي": ["قيرغيزستان", "قرغيزستان", "بيشكك"], "طاجيكي": ["طاجيكستان", "دوشنبه"], "أذربيجاني": ["أذربيجان", "باكو"],
  "فلبيني": ["الفلبين", "مانيلا"], "فيتنامي": ["فيتنام", "هانوي"], "تايلاندي": ["تايلاند", "بانكوك"],
  "أرجنتيني": ["الأرجنتين", "بوينس آيرس"], "تشيلي": ["تشيلي", "سانتياغو"], "كولومبي": ["كولومبي", "بوغوتا"], "بيروفي": ["بيرو", "بيروفي", "ليما"],
  // Africa south of the Sahara, the same day (Kenya, Ghana, South Africa and West Africa's markets joined the sources).
  "جنوب أفريقي": ["جنوب أفريقي", "جنوب إفريقي", "جوهانسبرغ", "بريتوريا", "كيب تاون"], "كيني": ["كيني", "نيروبي", "مومباسا"], "غاني": ["غانا", "غاني", "أكرا"],
  "إثيوبي": ["إثيوبي", "أديس أبابا"], "تنزاني": ["تنزاني"], "أوغندي": ["أوغندا", "أوغندي", "كمبالا"], "رواندي": ["رواندا", "رواندي", "كيغالي"], "أنغولي": ["أنغولا", "أنغولي", "لواندا"],
  "زامبي": ["زامبي", "لوساكا"], "سنغالي": ["السنغال", "داكار"], "إيفواري": ["ساحل العاج", "كوت ديفوار", "إيفواري", "أبيدجان"], "موريتاني": ["موريتاني", "نواكشوط"],
  "موزمبيقي": ["موزمبيق", "مابوتو"], "زيمبابوي": ["زيمبابوي", "هراري"], "كونغولي": ["الكونغو", "كونغولي", "كينشاسا"], "كاميروني": ["الكاميرون", "ياوندي", "دوالا"],
  "بوتسواني": ["بوتسوانا", "بوتسواني", "غابورون"], "ناميبي": ["ناميبي", "ويندهوك"],
  // 2026-11-21: Serbia, Croatia, Greece and Romania, Sudan and Somalia, whose own press joined the sources that day, and
  // Ukraine's capital and port. «السودان» reads its adjective too, «السوداني», which is also the Iraqi prime minister's
  // family name: countryText() reads «شياع السوداني» as Iraq's, and the family name alone is still read as Sudan.
  "صربي": ["صربي", "بلغراد"], "كرواتي": ["كرواتي", "زغرب"], "يوناني": ["يونان", "أثينا", "بيرايوس"], "روماني": ["روماني", "بوخارست"],
  "سوداني": ["سودان", "الخرطوم", "بورتسودان"], "صومالي": ["صومال", "مقديشو"],
  // 2026-11-23: Portugal, whose own press joined the sources that day, and Armenia, the other party of much Azerbaijani
  // economic news. Unread, a Portuguese and a Spanish budget passed by parliament were one event to sameEvent(), and so
  // were Armenia's and Azerbaijan's opening of the same corridor. «لشبونة» ends in «ة» and is listed whole, as
  // «سنغافورة» is. Georgia is not listed: «جورجيا» is also the American state.
  "برتغالي": ["البرتغال", "برتغالي", "لشبونة", "بورتو"], "أرميني": ["أرمينيا", "أرميني", "أرمني", "يريفان"],
  // The same day, the second batch: Ireland, the Baltic states, South Sudan and the Sahel, whose own press joined the
  // sources, and the Nordic capitals. «جنوب السودان» is its own country: countryText() joins it into one word, so it is
  // never also Sudan. Mali is read by its capital alone and keyed by no adjective: «مالي» is also «financial» («دعم
  // مالي»), and unplacedActors() looks a nisba up by its key, so «X» المالية would have read as a Malian company.
  "أيرلندي": ["أيرلند", "إيرلند", "دبلن"], "إستوني": ["إستوني", "استوني", "تالين"], "لاتفي": ["لاتفي", "ريغا"], "ليتواني": ["ليتواني", "فيلنيوس"],
  "جنوب سوداني": ["جنوبسودان", "جوبا"], "بوركيني": ["بوركينا فاسو", "بوركيني", "واغادوغو"], "مالي (البلد)": ["باماكو"], "نيجري": ["النيجر", "نيامي"], "تشادي": ["تشاد", "نجامينا", "إنجامينا"],
  "أوكراني": ["أوكراني", "كييف", "أوديسا"], "بريطاني": ["بريطاني", "المملكة المتحدة", "لندن"], "ألماني": ["ألماني", "الألماني", "برلين", "فرانكفورت"], "فرنسي": ["فرنس", "باريس"],
  "إيطالي": ["إيطالي", "روما", "ميلانو"], "إسباني": ["إسباني", "مدريد"], "هولندي": ["هولند", "أمستردام", "روتردام"], "سويسري": ["سويسر", "زيورخ"], "سويدي": ["سويد", "ستوكهولم"], "نرويجي": ["نرويج", "أوسلو"],
  "دنماركي": ["دنمارك", "كوبنهاغن"], "بولندي": ["بولند", "وارسو"], "فنلندي": ["فنلند", "هلسنكي"], "بلجيكي": ["بلجيك"], "نمساوي": ["نمسا", "نمساو"], "نيجيري": ["نيجيري"], "فنزويلي": ["فنزويل"],
};
// Household names, whose country no Arab reader needs told (the writer's rule says the same; «مصر تبحث مع «بي بي»…»
// was the one other hit of the first calibration).
// The rating agencies and OpenAI joined with the trade check below (2026-11-01): «فيتش» needs no «للتصنيف الائتماني».
const HOUSEHOLD = new Set(["بي بي", "شل", "توتال إنرجيز", "إكسون موبيل", "شيفرون", "أرامكو", "أدنوك", "أبل", "مايكروسوفت", "ألفابت",
  "غوغل", "جوجل", "أمازون", "ميتا", "إنفيديا", "تسلا", "سامسونغ", "تويوتا", "بوينغ", "إيرباص", "أوبن إيه آي", "فيتش", "موديز",
  "ستاندرد آند بورز"].map(normalizePlace));
const nationalityKey = (word) => normalizePlace(word).replace(/(?:يه|يين|يون|ين|ي)$/, "");
const NATIONALITY_BY_KEY = new Map(Object.entries(NATIONALITIES).map(([nisba, places]) => [nationalityKey(nisba), places.map((p) => placeRe(p, { country: true }))]));
/** Text as the country readers read it: «المملكة المتحدة» is Britain, never also «المملكة»; «عمّان» with its shadda is
 *  Amman, never Oman; «محمد شياع السوداني» is Iraq's prime minister, never Sudan. */
export const countryText = (text) => normalizePlace(String(text ?? "").replace(/عمّان/g, "الأردن")).replace(/المملكه المتحده/g, "بريطانيا").replace(/شياع السوداني/g, "شياع العراقي").replace(/جنوب (?:ال)?سودان/g, "جنوبسودان").replace(/ايرلندا الشماليه/g, "بريطانيا");
// A name in «», a Latin gloss in brackets allowed, then its nisba: «أكوا» السعودية، «إي آي جي» (EIG) الأمريكية.
const NAMED_NATIONALITY = /«([^»]{2,40})»(?:\s*\([^)]{1,60}\))?\s+(ال[ء-ي]+)/g;

/** The names the headline carries without the nationality the story itself gives them: [{ name, nisba }]. */
export function unplacedActors({ title = "", subtitle = "", lede = "", body = "" } = {}) {
  const head = normalizePlace(title);
  // Each place as a whole word: «ترك» inside «مشتركة» had placed a Turkish company (the review of 2026-10-30).
  const shown = countryText(`${title}\n${subtitle}`);
  const out = [];
  for (const m of `${lede}\n${body}`.matchAll(NAMED_NATIONALITY)) {
    const [, name, nisba] = m;
    const places = NATIONALITY_BY_KEY.get(nationalityKey(nisba.slice(2)));
    if (!places || HOUSEHOLD.has(normalizePlace(name)) || !head.includes(normalizePlace(name)) || out.some((o) => o.name === name)) continue;
    if (places.some((re) => re.test(shown))) continue;
    out.push({ name, nisba });
  }
  return out;
}

/**
 * And what it does (the owner, 2026-11-01, on «أرامكو تكمل الاستحواذ على 49% من «هيوماين» السعودية…»: the headline and
 * the dek "do not give any hint to what type of company is هيوماين"). Reuters headlined the deal "Saudi Aramco to take
 * minority stake in PIF-owned AI firm Humain" (2025-10-28); Asharq Business «… بشركة معدات كهرباء ألمانية». Code sees the
 * case the story itself settles: it says what the company does after its name («هيوماين» للذكاء الاصطناعي، «X» المتخصصة
 * في …) or before it (شركة الذكاء الاصطناعي «هيوماين»), and the headline carries the name while neither it nor the dek
 * carries a word of that. Over the 405 news stories of 21 September to 1 November: HUMAIN, Arada, Rua Al Haram, Anthropic,
 * Binance and Solidigm; Fitch (household), «أوبن إيه آي» للحصول على… (a purpose, not a trade) and the East-West
 * pipeline (a facility, not a company) were the false alarms of the first wording.
 */
// Whole words (a word may not end inside another: «للرقائ» before «ق في» slipped past the lookahead), and a phrase
// followed by «على»، «إلى»، «من» is a purpose («للحصول على تمويل»), never a trade; «في» may follow a trade
// («للرقائق في أمريكا»).
const AR_WORD = "[\\u0621-\\u064A]+(?![\\u0621-\\u064A])";
const TRADE_AFTER = new RegExp(`«([^»]{2,40})»(?:\\s*\\([^)]{1,60}\\))?(?:\\s+ال${AR_WORD})?\\s+((?:لل|المتخصصة في |المتخصصه في |العاملة في |العامله في )${AR_WORD}(?:\\s+ال${AR_WORD})?)(?!\\s+(?:على|من|إلى|الى|عن|مع|بين)(?![\\u0621-\\u064A]))`, "g");
const TRADE_BEFORE = new RegExp(`(?<![\\u0621-\\u064A])(?:شركة|شركه|مجموعة|منصة|مطور|مطوّر|مشغل|مشغّل|مصنع|مصنّع|مصرف|بنك|عملاق)\\s+((?:ال${AR_WORD}\\s+){1,3})«([^»]{2,40})»`, "g");
// A facility, a project or a deal named in «» is no company: «خط «شرق - غرب» للخام».
const NOT_A_COMPANY = /(?:خط|مشروع|حقل|ميناء|منشأة|مصفاة|محطة|برنامج|مبادرة|منتدى|مؤتمر|اتفاق|اتفاقية|صفقة|مؤشر|صندوق|قناة|سفينة|ناقلة|مضيق)\s*$/;
const TRADE_STOP = new Set(["شركه", "تابعه", "مملوكه", "مدرجه", "حكوميه", "عالميه", "دوليه", "كبري", "قابضه", "محدوده"].map(normalizePlace));
/** The words of a trade a headline or a dek may carry: content words, a nisba left to unplacedActors(). */
const tradeWords = (text) => (normalizePlace(text).match(/[ء-ي]{3,}/g) ?? [])
  .map((w) => w.replace(/^(?:وال|فال|بال|كال|لل|ال)/, ""))
  .filter((w) => w.length >= 3 && !TRADE_STOP.has(w) && !NATIONALITY_BY_KEY.has(nationalityKey(w)));

/** The names the headline carries without what the story itself says they do: [{ name, trade }]. */
export function untradedActors({ title = "", subtitle = "", lede = "", body = "" } = {}) {
  const head = normalizePlace(title);
  const shown = normalizePlace(`${title}\n${subtitle}`);
  const story = `${lede}\n${body}`;
  const found = [];
  for (const m of story.matchAll(TRADE_AFTER)) if (!NOT_A_COMPANY.test(story.slice(Math.max(0, m.index - 14), m.index))) found.push({ name: m[1], trade: m[2], shown: `«${m[1]}» ${m[2]}` });
  for (const m of story.matchAll(TRADE_BEFORE)) found.push({ name: m[2], trade: m[1].trim(), shown: m[0] });
  const out = [];
  for (const { name, trade, shown: phrase } of found) {
    const key = normalizePlace(name);
    if (HOUSEHOLD.has(key) || !head.includes(key) || out.some((o) => o.name === name)) continue;
    const words = tradeWords(trade);
    if (!words.length || words.some((w) => shown.includes(w))) continue;
    out.push({ name, trade, phrase });
  }
  return out;
}

/**
 * The countries a headline names, by a place or a nisba, as NATIONALITIES lists them («مصري» for «المركزي المصري» and
 * «القاهرة»). Each as a whole word through its clitics and endings (placeRe()): «تركيا» and «التركي» are Turkish,
 * «مشتركة» and «التركيز» are not, nor is «مصرف» Egypt or «يمنح» Yemen; «للسعودية» is Saudi. Read from a word's start
 * until the review of 2026-10-30, which found all of those wrong: «مصرف البحرين المركزي» and «المركزي المصري» were one
 * country. lib/events.mjs reads it to keep two countries' decisions two events.
 */
export function countriesNamed(text) {
  const hay = countryText(text);
  return new Set([...NATIONALITY_BY_KEY].filter(([, res]) => res.some((re) => re.test(hay))).map(([key]) => key));
}

/**
 * The world outside the Arab desks as the editor weighs it (the owner, 2026-11-21: "organize weights when it comes to
 * news publishing so we can cover everything, but yet the most important stuff (for the arabic reader)"). In the 28
 * days to that day the 291 news stories named Central Asia once, sub-Saharan Africa once, Russia and Eastern Europe
 * twice, Southeast Asia three times and the Americas outside the US five times, while the Gulf's desk held 122. Each
 * part is read from the countries a headline names (countriesNamed()); `rotates: false` marks the parts the day's news
 * never leaves alone (the US, China, Iran, Turkey and Israel), which the rotation of select.mjs never asks for.
 * Sudan and Somalia, Arab League members with no desk of their own, are a part with Ethiopia (the Nile, the Red Sea).
 */
export const WORLD_AREAS = [
  { name: "الولايات المتحدة", nisbas: ["أمريكي", "أميركي"], rotates: false },
  { name: "الصين", nisbas: ["صيني"], rotates: false },
  { name: "إيران وتركيا وإسرائيل", nisbas: ["إيراني", "تركي", "إسرائيلي"], rotates: false },
  { name: "أوروبا الغربية والشمالية", nisbas: ["بريطاني", "ألماني", "فرنسي", "إيطالي", "إسباني", "هولندي", "سويسري", "سويدي", "نرويجي", "دنماركي", "فنلندي", "بلجيكي", "نمساوي", "برتغالي", "أيرلندي", "إستوني", "لاتفي", "ليتواني"], rotates: true },
  { name: "روسيا وأوروبا الشرقية والبلقان", nisbas: ["روسي", "أوكراني", "بولندي", "صربي", "كرواتي", "يوناني", "روماني"], rotates: true },
  { name: "شرق آسيا", nisbas: ["ياباني", "كوري", "تايواني"], rotates: true },
  { name: "جنوب آسيا", nisbas: ["هندي", "باكستاني", "بنغلاديشي", "سريلانكي"], rotates: true },
  { name: "جنوب شرق آسيا وأستراليا", nisbas: ["إندونيسي", "ماليزي", "سنغافوري", "فلبيني", "فيتنامي", "تايلاندي", "أسترالي"], rotates: true },
  { name: "آسيا الوسطى والقوقاز", nisbas: ["كازاخستاني", "أوزبكي", "تركمانستاني", "قيرغيزي", "طاجيكي", "أذربيجاني", "أرميني"], rotates: true },
  { name: "السودان والقرن الأفريقي", nisbas: ["سوداني", "صومالي", "إثيوبي", "جنوب سوداني"], rotates: true },
  { name: "أفريقيا جنوب الصحراء", nisbas: ["نيجيري", "جنوب أفريقي", "كيني", "غاني", "تنزاني", "أوغندي", "رواندي", "أنغولي", "زامبي", "سنغالي", "إيفواري", "موزمبيقي", "زيمبابوي", "كونغولي", "كاميروني", "بوتسواني", "ناميبي", "بوركيني", "مالي (البلد)", "نيجري", "تشادي"], rotates: true },
  { name: "الأمريكتان", nisbas: ["كندي", "مكسيكي", "برازيلي", "أرجنتيني", "تشيلي", "كولومبي", "بيروفي", "فنزويلي"], rotates: true },
];
const AREA_BY_KEY = new Map(WORLD_AREAS.flatMap((area) => area.nisbas.map((nisba) => [nationalityKey(nisba), area.name])));
for (const area of WORLD_AREAS) for (const nisba of area.nisbas) if (!NATIONALITY_BY_KEY.has(nationalityKey(nisba))) throw new Error(`regions: «${nisba}» of ${area.name} is not in NATIONALITIES`);

/**
 * What names a part of the world without naming a country of it: its central bank, its share index, its union. The
 * rotation's counter read «بنك إنجلترا يرفع الفائدة إلى 4%» and «نيكاي يهبط دون 60 ألف نقطة» as stories of nowhere, so
 * neither reset its part's quiet days, while scripts/coverage.mjs, with words of its own, counted both (2026-11-23).
 * Whole words only; never «الين», which stands inside many words.
 */
const AREA_SIGNS = [
  ["أوروبا الغربية والشمالية", ["بنك إنجلترا", "بنك إنكلترا", "الإسترليني", "فوتسي", "داكس", "بوندسبنك", "كاك 40", "منطقة اليورو", "المركزي الأوروبي", "الاتحاد الأوروبي", "المفوضية الأوروبية"]],
  ["شرق آسيا", ["نيكاي", "نيكي", "توبكس", "كوسبي"]],
  ["جنوب آسيا", ["سنسكس", "نيفتي"]],
].map(([name, words]) => [name, new RegExp(`(?<![${"\\u0621-\\u064A"}])(?:[وفبلك]|ال|لل)?(?:${words.join("|")})(?![${"\\u0621-\\u064A"}])`)]);

/** The parts of the world (WORLD_AREAS) a text names, by its countries or by what stands for one (AREA_SIGNS). */
export function worldAreasNamed(text) {
  const areas = new Set([...countriesNamed(text)].map((key) => AREA_BY_KEY.get(key)).filter(Boolean));
  for (const [name, sign] of AREA_SIGNS) if (sign.test(String(text ?? ""))) areas.add(name);
  return areas;
}

/**
 * The story's regions held to where its event happens: an Arab desk stays only when the headline, dek or lede names
 * one of its places, and joins when the headline names one the writer left out; a story left with none is the world
 * desk's. The other regions (Europe, the Americas, Asia, Africa, the world) all fold into the site's العالم and pass.
 * A split desk's old name (SPLIT_DESKS) is read as both its desks, so a story keeps the one it names.
 */
export function groundedRegions(regions, { title = "", subtitle = "", lede = "" } = {}) {
  const text = [title, subtitle, lede].join("\n");
  const canon = toUsDesk(canonicalRegions(regions, { cap: Infinity }), text);
  const kept = canon.filter((r) => !DESK_PLACES.has(r) || namesDesk(r, text));
  for (const desk of DESK_PLACES.keys()) if (!kept.includes(desk) && namesDesk(desk, title)) kept.push(desk);
  return kept.length ? kept.slice(0, 3) : canon.length ? ["عالمي"] : [];
}
