/**
 * A story's tags name what the story is about. They put it on tag pages, on the sections' sub-topic pages, in the
 * running files on the front and above its own headline, so a tag the story never mentions files it under a subject
 * it does not cover. The audit of 2026-09-27 (the owner: "posting info that does not match category/title") found
 * «الذكاء الاصطناعي» on a Trump–Xi summit story that never mentions AI, «التضخم» on a Japanese trade story, «أوبك+»,
 * «السعودية», «إيران» and «لجنة الاتصالات الفيدرالية» on stories that name none of them, and the tags of items pasted into
 * a story (فنلندا، جوجل، العقارات عجمان), and one subject split across spellings (النفط/نفط، الذكاء الاصطناعي/ذكاء
 * اصطناعي). So code decides, where a draft is normalised (lib/write.mjs) and over the published stories
 * (`node pipeline/tidy.mjs`):
 *
 * - spelling: one form per tag, the one the site already uses most (with the article when both exist), in the house
 *   spelling («الأمريكية»، «ترامب»);
 * - grounding: a tag stays only when the story's own text carries it: every distinctive word of an institution's name
 *   («لجنة الاتصالات الفيدرالية»), at least half of any other tag's distinctive words, or a word a subject is written
 *   with («الطيران» in «طائرات»، «النفط» in «برنت»). A thematic tag the story never words at all goes.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

// Arabic letters and marks, the edges of a word: not the whole Unicode block, whose «،» «؛» «؟» end a word.
const AR = "ء-ٟٮ-ۓۺ-ۿ";
/** Arabic as matched: no diacritics or tatweel, one alef, ه for ة, ي for ى, the house spellings. */
export function normalizeTagText(s) {
  return String(s ?? "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/اميرك/g, "امريك")
    .replace(/ترمب/g, "ترامب")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["في", "من", "علي", "الي", "عن", "مع", "و", "او", "ال", "بين", "حول", "ضد"]);
// Head nouns that say what kind of thing a name is, not which one: «مضيق هرمز» is about Hormuz.
const HEADS = new Set(["لجنه", "وزاره", "هيئه", "منظمه", "مجلس", "بنك", "مصرف", "صندوق", "مكتب", "وكاله", "مؤسسه", "شركه", "شركات", "جامعه", "محكمه", "مضيق", "قطاع", "سوق", "اسواق", "اسعار", "سعر", "مؤشر", "قمه", "ازمه", "سياسه"]);
// A name that begins with one of these is an institution: all of its distinctive words must be in the story.
const INSTITUTION = new Set(["لجنه", "وزاره", "هيئه", "منظمه", "مجلس", "بنك", "مصرف", "صندوق", "مكتب", "وكاله", "مؤسسه", "جامعه", "محكمه"]);

/** A word as it is searched for: without the article or a clinging letter, without a plural or nisba ending. */
function stem(word) {
  let w = word.replace(/^(?:وال|بال|فال|كال|لل|ال)/, "");
  if (w.length > 4) w = w.replace(/^[وفبل](?=ال)/, "");
  const cut = w.match(/(?:يات|ات|ون|ين|يه|يا|ه|ي|ا)$/);
  if (cut && w.length - cut[0].length >= 3) w = w.slice(0, -cut[0].length);
  return w;
}

// Words a subject is written with when its tag's own words are not used (normalised forms).
const WRITTEN_AS = {
  "الذكاء الاصطناعي": ["ذكاء اصطناعي"],
  "النفط": ["خام", "برنت", "برميل"],
  "الغاز الطبيعي": ["غاز"],
  "الطاقه": ["نفط", "غاز", "كهرباء", "وقود", "طاقه"],
  "الطيران": ["طائر", "رحلات", "مطار", "الجوي"],
  "اشباه الموصلات": ["رقائق", "شرائح", "معالجات"],
  "سلاسل التوريد": ["امدادات", "توريد", "الامداد"],
  "سلاسل الامداد": ["امدادات", "توريد", "الامداد"],
  "الصناعات الدفاعيه": ["عسكري", "البحريه", "مدمر", "اسلحه", "دفاع"],
  "الاسكان": ["عقار", "رهن", "منازل", "مساكن"],
  "قطاع الاسكان": ["عقار", "رهن", "منازل", "مساكن"],
  "الحوثيون": ["حوثي"],
  "الولايات المتحده": ["امريك", "واشنطن"],
  "المملكه المتحده": ["بريطان", "لندن"],
  "الاحتياطي الفيدرالي": ["الفيدرالي"],
  "الوجبات السريعه": ["مطاعم", "مطعم", "ماكدونالدز"],
  "السياحه": ["سفر", "المسافر", "حجوزات", "فنادق", "سياح"],
};

/** Whether the story's normalised text carries the tag (see above). */
function grounded(tag, text) {
  const t = normalizeTagText(tag).replace(/[«»"+]/g, "");
  if (!t) return false;
  if (text.includes(t)) return true;
  if ((WRITTEN_AS[t] ?? []).some((w) => text.includes(w))) return true;
  // A hyphen joins two names in one tag («قمة ترامب-شي»، «خط الشرق-الغرب»); each is a word of its own.
  const words = t.split(/[\s\-–]+/).filter((w) => w && !STOP.has(w));
  const distinctive = words.map((w) => (/^\d+$/.test(w) ? w : stem(w))).filter((w, i) => w.length >= 3 && !HEADS.has(words[i]) && !HEADS.has(words[i].replace(/^ال/, "")));
  if (!distinctive.length) return words.some((w) => text.includes(stem(w)));
  const found = distinctive.filter((w) => new RegExp(`(?<![${AR}])(?:[وفبلك]?(?:ال|لل)?)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text)).length;
  const head = words[0].replace(/^ال/, "");
  return INSTITUTION.has(head) || INSTITUTION.has(words[0]) ? found === distinctive.length : found >= Math.ceil(distinctive.length / 2);
}

/** The key under which spellings of one tag meet: normalised, without the article on any word. */
const spellingKey = (t) => normalizeTagText(t).split(" ").map((w) => w.replace(/^ال/, "")).join(" ");

let known = null;
/** One spelling per tag across the site: the published stories' most used form, the more definite one on a tie
 *  («مراكز البيانات», not «مراكز بيانات»). */
function spellings(dir) {
  if (known) return known;
  const counts = new Map();
  try {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const m = readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
      for (const tag of (m && YAML.parse(m[1])?.tags) || []) counts.set(houseSpelling(tag), (counts.get(houseSpelling(tag)) ?? 0) + 1);
    }
  } catch {
    /* no published stories here (a test, a fresh checkout): each tag keeps its own house spelling */
  }
  known = new Map();
  const definite = (t) => t.split(" ").filter((w) => w.startsWith("ال")).length;
  for (const [tag] of [...counts].sort((a, b) => b[1] - a[1] || definite(b[0]) - definite(a[0]))) {
    const k = spellingKey(tag);
    if (!known.has(k)) known.set(k, tag);
  }
  return known;
}

/** The house spelling of a tag: «أمريكي», «ترامب», «أوبن إيه آي», no shadda. */
function houseSpelling(tag) {
  return String(tag ?? "")
    // Shadda, sukun and tatweel go («النصفيّة»); the other marks stay, so «عُمان» is never read as Amman.
    .replace(/[ّْـ]/g, "")
    .replace(/أميرك/g, "أمريك")
    .replace(/ترمب/g, "ترامب")
    .replace(/أوبن أيه آي/g, "أوبن إيه آي")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A story's tags, each in the site's one spelling and only if its text carries it, in the writer's order, each
 * once. `text` is the story's whole text (headline, dek, lede, body, box, «لماذا يهمّ»). `dir` is where the published
 * stories are (the site's spellings come from them).
 */
export function cleanTags(tags, text, { dir = path.join(process.cwd(), "content", "articles") } = {}) {
  const hay = normalizeTagText(text);
  const map = spellings(dir);
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const house = houseSpelling(raw);
    if (!house) continue;
    const tag = map.get(spellingKey(house)) ?? house;
    if (!out.includes(tag) && grounded(tag, hay)) out.push(tag);
  }
  return out;
}

/** The text a story's tags are held to. */
export function storyText(d) {
  return [d.title, d.subtitle, d.lede, d.body, d.whyItMatters, ...(d.keyFacts ?? []).flatMap((k) => [k.label, k.value]), d.chart?.title, d.table?.title].filter(Boolean).join("\n");
}
