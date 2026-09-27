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
 */
const PLACES = {
  // Not «تداول» or «مبادلة»: they are also the words for trading and swapping.
  "الخليج": ["خليجي", "سعودي", "إماراتي", "قطري", "كويتي", "بحريني", "عماني", "الرياض", "جدة", "الدمام", "أبوظبي", "أبو ظبي", "دبي", "الشارقة", "الفجيرة", "عجمان", "الدوحة", "المنامة", "مسقط", "أرامكو", "أدنوك", "سابك", "ينبع", "رأس تنورة", "رأس لفان", "جازان", "الخفجي", "نيوم", "مجلس التعاون", "صندوق الاستثمارات العامة", "جهاز قطر للاستثمار", "قطر للطاقة"],
  "مصر والمغرب العربي": ["مصري", "مغربي", "جزائري", "تونسي", "ليبي", "موريتاني", "القاهرة", "الإسكندرية", "السويس", "بورسعيد", "الدار البيضاء", "الرباط", "طنجة"],
  "الشرق الأوسط": ["إيراني", "عراقي", "تركي", "إسرائيلي", "أردني", "لبناني", "سوري", "يمني", "فلسطيني", "طهران", "بغداد", "البصرة", "كردستان", "الحوثي", "هرمز", "البحر الأحمر", "باب المندب", "غزة", "الضفة الغربية", "أنقرة", "إسطنبول", "بيروت", "دمشق", "تل أبيب"],
};
const normalizePlace = (s) => String(s ?? "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
// A place as a whole word, through the letters Arabic joins to it («وبالسعودية»، «للرياض») and the endings of its
// adjective and plural («السعوديين»، «الحوثيون»), never inside another word («الرياضة» is not «الرياض»).
// Arabic letters and marks only: the Arabic comma, semicolon and question mark sit in the same Unicode block and end
// a word («مضيق هرمز؟»).
const LETTER = "\\u0621-\\u065F\\u066E-\\u06D3\\u06FA-\\u06FF";
const placeRe = (w) => {
  const n = escapeRe(normalizePlace(w));
  const forms = n.startsWith("ال") ? `[وفبك]?(?:${n}|لل${n.slice(2)})` : `[وفبلك]?(?:ال|لل)?${n}`;
  return new RegExp(`(?<![${LETTER}])${forms}(?:ي|يه|ين|يون|يين|ون|ات|ه)?(?![${LETTER}])`);
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
