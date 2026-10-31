import { getCollection, type CollectionEntry } from "astro:content";
import { PLACE_TAGS } from "./regions";
import { canonicalTag, isFileTag } from "./topics";

export type Article = CollectionEntry<"articles">;

let cache: Article[] | null = null;

/** All published articles, newest first. */
export async function getArticles(): Promise<Article[]> {
  if (cache) return cache;
  // Drafts never reach the published site. The control room's local preview sets
  // KHAZENDAR_SHOW_DRAFTS=1 so the editor can read a draft as it will look before approving it.
  const showDrafts = process.env.KHAZENDAR_SHOW_DRAFTS === "1";
  const all = await getCollection("articles", ({ data }) => showDrafts || !data.draft);
  cache = all.sort((a, b) => Date.parse(b.data.publishedAt) - Date.parse(a.data.publishedAt));
  return cache;
}

export async function getArticlesBySection(section: string): Promise<Article[]> {
  return (await getArticles()).filter((a) => a.data.section === section);
}

export function hoursOld(article: Article, now = Date.now()): number {
  return (now - Date.parse(article.data.publishedAt)) / 36e5;
}

/**
 * Lead story: the strongest story of the last day, otherwise the newest.
 * Strength = editor importance, with a freshness penalty of one point per 12 hours.
 */
export function pickLead(articles: Article[], now = Date.now()): Article | undefined {
  // A short story never leads by the formula (the owner, 2026-10-18): the front opens on a developed report whenever
  // there is one. The owner's own choice from the control room still wins.
  const all = articles.filter((a) => a.data.kind === "news");
  const full = all.filter((a) => a.data.format !== "short");
  const news = full.length ? full : all;
  if (!news.length) return articles[0];
  // The editor's own choice comes first: a story featured from the control room leads for 48 hours
  // (the newest featured one, if several), after which the formula below takes over again.
  const featured = all.filter((a) => a.data.featured && hoursOld(a, now) < 48).sort((x, y) => Date.parse(y.data.publishedAt) - Date.parse(x.data.publishedAt));
  if (featured.length) return featured[0];
  const scored = news.map((a) => ({
    a,
    score: (a.data.quality?.importance ?? 5) - hoursOld(a, now) / 12 + (a.data.image ? 1.5 : 0),
  }));
  scored.sort((x, y) => y.score - x.score);
  return scored[0]?.a;
}

/**
 * «اقرأ أيضاً» under a story: stories on its running topic of the last two months (`onTheSameTopic`), or none. Until
 * 2026-10-19 (the owner's check of the article pages) it scored the same section and any shared tag, a country
 * included, and always filled four places: Qatar's defence plant was followed by the Bank of Cairo's IPO and the World
 * Bank's Gulf forecast by Syria's reconstruction fund. A page with nothing related prints no «اقرأ أيضاً».
 */
export function related(article: Article, all: Article[], count = 4): Article[] {
  return onTheSameTopic(article, all, { n: count, days: 60 });
}

/**
 * The «آخر الأخبار» strip of a page (Base.astro): the eight newest news stories, leaving out the page's own story and
 * any the page prints itself (`printed`, ids). Since 2026-10-19 (the owner's check of the section pages) a section or
 * subject page passes the stories it prints: on الاقتصاد and الشركات three of the first four stories ran in the strip
 * above them as well.
 */
export function stripStories(all: Article[], path: string, printed: Iterable<string> = []): Article[] {
  const skip = new Set(printed);
  return all.filter((a) => a.data.kind === "news" && articleHref(a) !== path && !skip.has(a.id)).slice(0, 8);
}

const GENERIC_TAGS = new Set(["عالمي", "العالم", "الشرق الأوسط", "الخليج", "الخليج العربي", "أوروبا", "آسيا", "أفريقيا", "الاقتصاد", "الأسواق", "الطاقة", "الشركات", "التكنولوجيا", "الدفاع", "الاقتصاد العالمي"]);
// The label above a headline is the story's sub-topic since 2026-10-20 (`kickerOf()` in lib/topics.ts), never a tag.

export function articleHref(article: Article): string {
  return `/articles/${article.data.slug}/`;
}

/**
 * A picture is printed once per page even when two stories share it (the picture desk falls back to the same
 * Commons illustration of a sector): the ids of the stories that print theirs, the first in the page's order to carry
 * each file. Later ones run as text. Until 2026-09-27 only the front page kept the rule, and a topic page printed
 * one tanker twice.
 */
export function firstPictures(order: (Article | undefined)[]): Set<string> {
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const a of order) {
    const url = a?.data.image?.url;
    if (!a || !url || seen.has(url)) continue;
    seen.add(url);
    ids.add(a.id);
  }
  return ids;
}

// Words a headline shares with any other and that say nothing about the event.
const STOP_WORDS = new Set(["علي", "بعد", "قبل", "حول", "دون", "منذ", "بين", "عبر", "خلال", "وسط", "امام", "عند", "حتي", "التي", "الذي", "هذا", "هذه", "اول", "اكثر", "اقل", "مع"]);

/** The content words of a headline, normalised so spelling variants of one word meet. */
function headlineWords(title: string): Set<string> {
  const text = title
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ترامب/g, "ترمب")
    .replace(/اميرك/g, "امريك");
  const words = text.split(/[^\p{L}\p{N}]+/u).map((w) => {
    let word = w.replace(/^(وال|بال|فال|كال|لل|ال)/, "");
    // A clinging و or ل and a nisba ending: «وتعيين» meets «تعيين», «الإيرانية» meets «الإيراني».
    if (word.length > 4) word = word.replace(/^[ول]/, "");
    return word.replace(/يه$/, "ي");
  });
  return new Set(words.filter((w) => w.length > 2 && !STOP_WORDS.has(w)));
}

/**
 * Two stories on one event: headlines published within two days of each other that share at least
 * four content words, and at least 60% of the shorter one's. The newsroom should never file an event
 * twice; when it does, the front page prints it once.
 */
export function sameEvent(a: Article, b: Article): boolean {
  if (Math.abs(Date.parse(a.data.publishedAt) - Date.parse(b.data.publishedAt)) > 48 * 36e5) return false;
  const x = headlineWords(a.data.title);
  const y = headlineWords(b.data.title);
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared >= 4 && shared / Math.min(x.size, y.size) >= 0.6;
}

/**
 * Stories on the same running topic as `article`: they share a narrow topic (a tag carried by at most
 * one story in twenty, such as الديزل or أرامكو) or two topics at once (النفط and إيران). One broad tag
 * alone (الصين, النفط, a country) does not make stories related: it put Chinese retail sales under
 * the Bessent talks. Region and section tags never count, and since 2026-10-19 no place does (`PLACE_TAGS`: a
 * country tag such as «قطر» or «فرنسا» is often rare enough to pass as narrow, and tied a Qatari defence plant to a
 * Lebanese power deal). The closest come first, then the newest.
 * Used under the cover story, where the lead's text column stood 175px short of its photograph (the
 * owner, 2026-09-23: "too much space").
 */
export function onTheSameTopic(article: Article, all: Article[], { exclude = new Set<string>(), n = 2, days = 14, now = Date.now() } = {}): Article[] {
  const regions = new Set(all.flatMap((a) => a.data.regions));
  const counts = new Map<string, number>();
  for (const a of all) for (const t of a.data.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const count = (t: string) => counts.get(t) ?? 0;
  const narrow = Math.max(3, Math.floor(all.length / 20));
  const broad = Math.max(3, Math.floor(all.length / 8));
  const topics = new Set(article.data.tags.filter((t) => !regions.has(t) && !PLACE_TAGS.has(t) && !GENERIC_TAGS.has(t) && count(t) <= broad));
  if (!topics.size) return [];
  // A standing sub-topic's subject («السياسة النقدية»، «مصافي النفط») is a beat, not a running story: alone it tied
  // Lagarde's departure to Egypt's rate hold and the Houthis' strikes to China's fuel stocks, and 412 of the site's 1,539
  // related links rested on such a tag alone (the audit of 2026-10-31). It counts only beside a second shared topic. And
  // two shared topics rank before one rare one.
  return all
    .filter((a) => a.id !== article.id && !exclude.has(a.id) && hoursOld(a, now) < days * 24)
    .map((a) => ({ a, shared: a.data.tags.filter((t) => topics.has(t)) }))
    .filter(({ shared }) => shared.some((t) => count(t) <= narrow && isFileTag(t)) || shared.length >= 2)
    .map(({ a, shared }) => ({ a, score: shared.length + shared.reduce((sum, t) => sum + 1 / Math.max(1, count(t)), 0) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, n)
    .map(({ a }) => a);
}

/** The stories that repeat an event already told by a newer story in the list (the list is newest first). */
export function repeatedEvents(list: Article[]): Set<string> {
  const kept: Article[] = [];
  const repeats = new Set<string>();
  for (const a of list) {
    if (kept.some((k) => sameEvent(k, a))) repeats.add(a.id);
    else kept.push(a);
  }
  return repeats;
}

/** A section's running topics: its most-used tags that are neither regions nor section names. */
export function sectionTopics(articles: Article[], section: string, n = 8): string[] {
  const regions = new Set(articles.flatMap((a) => a.data.regions));
  const counts = new Map<string, number>();
  for (const a of articles) {
    if (a.data.section !== section) continue;
    for (const t of a.data.tags) if (!regions.has(t) && !GENERIC_TAGS.has(t) && t.length <= 28) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "ar")).slice(0, n).map(([t]) => t);
}

/** Every tag with its stories, each tag in its one spelling («هرمز» counts as «مضيق هرمز»; lib/topics.ts). */
export function allTags(articles: Article[]): Map<string, Article[]> {
  const map = new Map<string, Article[]>();
  for (const a of articles) for (const t of new Set(a.data.tags.map(canonicalTag))) map.set(t, [...(map.get(t) ?? []), a]);
  return map;
}

export interface Dossier {
  tag: string;
  items: Article[];
  latest: Article;
}

/**
 * Running stories: topic tags carried by at least `min` articles, ranked by size and freshness.
 * Region names are left out (a country is a place, not a story), as are the section names and the tags that are a
 * curated sub-topic's subject, whose one page is the sub-topic's (lib/topics.ts).
 */
export function dossiers(articles: Article[], { min = 3, max = 4, now = Date.now() } = {}): Dossier[] {
  const regions = new Set(articles.flatMap((a) => a.data.regions));
  const generic = new Set(["عالمي", "العالم", "الشرق الأوسط", "الخليج", "الخليج العربي", "أوروبا", "آسيا", "أفريقيا", "الاقتصاد", "الأسواق", "الطاقة", "الشركات", "التكنولوجيا", "الدفاع", "الاقتصاد العالمي"]);
  const out: Dossier[] = [];
  for (const [tag, items] of allTags(articles)) {
    // A file follows a story, never a country (a «الولايات المتحدة» file read as a US section, 2026-09-24).
    if (items.length < min || regions.has(tag) || generic.has(tag) || PLACE_TAGS.has(tag) || !isFileTag(tag)) continue;
    const sorted = [...items].sort((a, b) => Date.parse(b.data.publishedAt) - Date.parse(a.data.publishedAt));
    out.push({ tag, items: sorted, latest: sorted[0] });
  }
  const score = (d: Dossier) => d.items.length + Math.max(0, 3 - hoursOld(d.latest, now) / 24);
  return out.sort((x, y) => score(y) - score(x)).slice(0, max);
}

export interface Thread {
  label: string;
  href: string;
  /** Stories in the last `days` days. */
  recent: number;
  total: number;
}

/**
 * What the paper is following now, for the files row under the section bar: the running files (a running story, a
 * company, an institution, a person), each once under its one page, busiest in the last week first.
 *
 * Never a standing subject (2026-10-19, the owner's check of the front page): the row had carried the sub-topics with
 * tags of their own (النفط، الأسهم، التضخم…), seven of its eight entries one evening, a second copy of the section menus
 * under a label that promises the stories being followed. The running stories are what the big sites keep outside
 * their menus; the subjects are in the menus.
 */
export function threads(articles: Article[], { days = 7, max = 8, now = Date.now() } = {}): Thread[] {
  const recentOf = (items: Article[]) => items.filter((a) => hoursOld(a, now) < days * 24).length;
  const out: Thread[] = [];
  for (const d of dossiers(articles, { max: 500, now })) out.push({ label: d.tag, href: `/tags/${encodeURIComponent(d.tag)}/`, recent: recentOf(d.items), total: d.items.length });
  return out.filter((t) => t.recent >= 2).sort((x, y) => y.recent - x.recent || y.total - x.total).slice(0, max);
}

/**
 * The chart of the day, for the front's side column (about 280px wide): the freshest chart of the last three days that
 * fits it, five categories or fewer, or none. Six long names such as the Egyptian exchange's indices could not stand
 * side by side there (2026-09-27); such a chart goes to the wider band instead. Until 2026-10-19 a chart of up to eight
 * was taken when no smaller one was fresh, and Dubai's six sectors printed their names over each other.
 */
export function chartOfTheDay(articles: Article[], now = Date.now()): Article | undefined {
  return articles.find((a) => {
    const c = a.data.chart;
    return Boolean(c && c.title && c.categories.length <= 5 && c.series.length <= 2 && hoursOld(a, now) < 72);
  });
}
