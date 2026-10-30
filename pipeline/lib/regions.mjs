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

/** An alias must stand as a whole word in the tag (a nisba ending is allowed: المصرية, الإماراتي); "مصرف" is not "مصر". */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = new Map(DESKS.flatMap((d) => d.match.map((m) => [m, new RegExp(`(?<!\\p{L})${escapeRe(m)}(?:ي|ية)?(?!\\p{L})`, "u")])));

/** Canonical desk names for a list of region tags, in the writer's order (the first is the story's main region), each once; unknown tags are dropped. */
export function canonicalRegions(tags) {
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw).trim();
    const d = byTag.get(tag) || DESKS.find((x) => x.match.some((m) => wholeWord.get(m).test(tag)));
    if (d && !out.includes(d.name)) out.push(d.name);
  }
  return out.slice(0, 3);
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
 * Hormuz, the mouth of the Gulf, is the Gulf desk's.
 */
const PLACES = {
  // Not «تداول» or «مبادلة»: they are also the words for trading and swapping.
  "الخليج": ["خليجي", "سعودي", "إماراتي", "قطري", "كويتي", "بحريني", "عماني", "الرياض", "جدة", "الدمام", "أبوظبي", "أبو ظبي", "دبي", "الشارقة", "الفجيرة", "عجمان", "الدوحة", "المنامة", "مسقط", "أرامكو", "أدنوك", "سابك", "ينبع", "هرمز", "رأس تنورة", "رأس لفان", "جازان", "الخفجي", "نيوم", "مجلس التعاون", "صندوق الاستثمارات العامة", "جهاز قطر للاستثمار", "قطر للطاقة"],
  "مصر والمغرب العربي": ["مصري", "مغربي", "جزائري", "تونسي", "ليبي", "موريتاني", "القاهرة", "الإسكندرية", "السويس", "بورسعيد", "الدار البيضاء", "الرباط", "طنجة"],
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
const placeRe = (w, { country = false } = {}) => {
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
  "صيني": ["صين", "بكين", "شنغهاي", "شنتشن", "هونغ كونغ"], "ياباني": ["يابان", "طوكيو"], "هندي": ["هند", "مومباي", "نيودلهي"], "كوري": ["كوري", "سيول"], "تايواني": ["تايوان"], "سنغافوري": ["سنغافور"],
  "إندونيسي": ["إندونيسي"], "ماليزي": ["ماليزي"], "باكستاني": ["باكستان"], "أسترالي": ["أسترالي"], "روسي": ["روسي", "موسكو"],
  "أوكراني": ["أوكراني"], "بريطاني": ["بريطاني", "المملكة المتحدة", "لندن"], "ألماني": ["ألماني", "الألماني", "برلين", "فرانكفورت"], "فرنسي": ["فرنس", "باريس"],
  "إيطالي": ["إيطالي", "روما", "ميلانو"], "إسباني": ["إسباني", "مدريد"], "هولندي": ["هولند", "أمستردام", "روتردام"], "سويسري": ["سويسر", "زيورخ"], "سويدي": ["سويد"], "نرويجي": ["نرويج"],
  "دنماركي": ["دنمارك"], "فنلندي": ["فنلند"], "بلجيكي": ["بلجيك"], "نمساوي": ["نمسا", "نمساو"], "نيجيري": ["نيجيري"], "فنزويلي": ["فنزويل"],
};
// Household names, whose country no Arab reader needs told (the writer's rule says the same; «مصر تبحث مع «بي بي»…»
// was the one other hit of the first calibration).
const HOUSEHOLD = new Set(["بي بي", "شل", "توتال إنرجيز", "إكسون موبيل", "شيفرون", "أرامكو", "أدنوك", "أبل", "مايكروسوفت", "ألفابت",
  "غوغل", "جوجل", "أمازون", "ميتا", "إنفيديا", "تسلا", "سامسونغ", "تويوتا", "بوينغ", "إيرباص"].map(normalizePlace));
const nationalityKey = (word) => normalizePlace(word).replace(/(?:يه|يين|يون|ين|ي)$/, "");
const NATIONALITY_BY_KEY = new Map(Object.entries(NATIONALITIES).map(([nisba, places]) => [nationalityKey(nisba), places.map((p) => placeRe(p, { country: true }))]));
/** Text as the country readers read it: «المملكة المتحدة» is Britain, never also «المملكة»; «عمّان» with its shadda is
 *  Amman, never Oman. */
const countryText = (text) => normalizePlace(String(text ?? "").replace(/عمّان/g, "الأردن")).replace(/المملكه المتحده/g, "بريطانيا");
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
 * The story's regions held to where its event happens: an Arab desk stays only when the headline, dek or lede names
 * one of its places, and joins when the headline names one the writer left out; a story left with none is the world
 * desk's. The other regions (Europe, the Americas, Asia, Africa, the world) all fold into the site's العالم and pass.
 */
export function groundedRegions(regions, { title = "", subtitle = "", lede = "" } = {}) {
  const canon = canonicalRegions(regions);
  const text = [title, subtitle, lede].join("\n");
  const kept = canon.filter((r) => !DESK_PLACES.has(r) || namesDesk(r, text));
  for (const desk of DESK_PLACES.keys()) if (!kept.includes(desk) && namesDesk(desk, title)) kept.push(desk);
  return kept.length ? kept.slice(0, 3) : canon.length ? ["عالمي"] : [];
}
