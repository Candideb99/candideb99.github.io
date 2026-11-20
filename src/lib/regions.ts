/**
 * The paper's regional desks as readers see them: four Arab desks and one for the world. The writers file
 * every story under the finer regions of `src/data/regions.json` (shared with the pipeline, whose photo desk
 * reads them for geography), and this file folds them for the site, so the front's "by region" block and the
 * desk pages never split one region across spellings (أمريكا / أميركا الشمالية / الولايات المتحدة).
 *
 * Five, not nine (the owner, 2026-09-24: an Americas desk is odd on an Arab economics site): الخليج، مصر،
 * المشرق وإيران وتركيا، المغرب العربي، and العالم for Europe, the Americas, Asia, Africa and the world market. The
 * third was «الشرق الأوسط» until 2026-10-19, the region the other two belong to (half its stories were the Gulf's
 * too); Egypt and the Maghreb were one desk until 2026-11-19, when Egypt held 48 of its 57 stories of the month
 * (Al Arabiya runs مصر and المغرب العربي apart). The United States has a desk of its own since 2026-11-20.
 */
// A relative address with its type, so Node can read this module in the self-test (as topics.ts).
import desks from "../data/regions.json" with { type: "json" };

export interface Desk {
  id: string;
  name: string;
  match: string[];
}

const RAW: Desk[] = desks as Desk[];
// The United States has its own desk since 2026-11-20 (the owner: "Yes, add US desk"): about 1.3 news stories a day
// named it in the headline, and in «العالم» it took that desk's one place in the front's region block from every other
// country. China, about 2 a week, stays in «العالم».
const OWN = new Set(["gulf", "egypt", "mena", "maghreb", "usa"]);
const abroad = RAW.filter((d) => !OWN.has(d.id));

export const DESKS: Desk[] = [
  ...RAW.filter((d) => OWN.has(d.id)),
  { id: "world", name: "العالم", match: [...new Set(abroad.flatMap((d) => [d.name, ...d.match]))] },
];

// Places the desks' lists do not name but tags do: a label above a headline never shows one either («الدنمارك» stood
// over a US–Denmark security story until 2026-09-27).
const OTHER_PLACES = [
  "الشرق الأوسط", "العالم العربي", "الدنمارك", "جرينلاند", "غرينلاند", "أذربيجان", "هاينان", "الخفجي", "البحر الأحمر", "باب المندب", "بلجيكا", "النمسا", "بولندا",
  "البرتغال", "اليونان", "أيرلندا", "آيسلندا", "لوكسمبورغ", "قبرص", "مالطا", "المجر", "التشيك", "رومانيا", "بلغاريا", "صربيا",
  "كرواتيا", "بيلاروسيا", "جورجيا", "أرمينيا", "كازاخستان", "أوزبكستان", "تركمانستان", "أفغانستان", "ماليزيا", "تايلاند",
  "الفلبين", "بنغلاديش", "سريلانكا", "نيوزيلندا", "كولومبيا", "بيرو", "فنزويلا", "كوبا", "الإكوادور", "تنزانيا", "أنغولا",
  "السنغال", "جيبوتي", "الصومال", "إريتريا", "الرياض", "جدة", "أبوظبي", "دبي", "الشارقة", "عجمان", "الدوحة", "القاهرة",
  "لندن", "باريس", "برلين", "بروكسل", "بكين", "شنغهاي", "طوكيو", "موسكو", "واشنطن", "نيويورك", "فرانكفورت", "طهران", "بغداد",
];

/** Every place a region tag can name, desks and countries alike: a label above a headline never shows one. */
export const PLACE_TAGS: Set<string> = new Set(RAW.flatMap((d) => [d.name, ...d.match]).concat(["العالم"], OTHER_PLACES));

// The Arab desks come first and keep a name the world desk also lists.
const byTag = new Map<string, Desk>();
for (const d of DESKS) {
  for (const m of [d.name, ...d.match]) if (!byTag.has(m)) byTag.set(m, d);
}

/** The desk a region tag belongs to, if any. */
export function deskOf(tag: string): Desk | undefined {
  return byTag.get(tag.trim());
}

/** What the desks read of a story: its id and its regions. */
interface Filed {
  id: string;
  data: { regions: string[] };
}

/** The desks a story belongs to, in the desks' order, each once. */
export function desksOf(article: Pick<Filed, "data">): Desk[] {
  const found = new Set<Desk>();
  for (const tag of article.data.regions) {
    const d = deskOf(tag);
    if (d) found.add(d);
  }
  return DESKS.filter((d) => found.has(d));
}

/**
 * One story for each desk of the front's «الأخبار بحسب المنطقة», from `pool` (newest first): each desk, in the desks'
 * order, takes its newest story that no desk before it shows and that is not on the running story one of them shows
 * (`sameStory(shown, candidate)`). A desk with none is left out. The owner, 2026-11-19, with a screenshot of the
 * block: the Revolutionary Guard at Hormuz stood under الخليج and again under المشرق وإيران وتركيا, two stories of one
 * running story, since Hormuz is the Gulf's place and Iran the Mashriq's and each war story carries both desks.
 */
export function deskStories<T extends Filed>(pool: T[], sameStory: (shown: T, candidate: T) => boolean): Array<Desk & { story: T }> {
  const out: Array<Desk & { story: T }> = [];
  for (const desk of DESKS) {
    const story = pool.find((a) => desksOf(a).some((d) => d.id === desk.id) && !out.some((o) => o.story.id === a.id || sameStory(o.story, a)));
    if (story) out.push({ ...desk, story });
  }
  return out;
}
