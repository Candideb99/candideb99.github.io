import { getCollection, type CollectionEntry } from "astro:content";
import { PLACE_TAGS } from "./regions";
import { TOPICS, canonicalTag, isFileTag, topicArticles, topicHref } from "./topics";

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
  const news = articles.filter((a) => a.data.kind === "news");
  if (!news.length) return articles[0];
  // The editor's own choice comes first: a story featured from the control room leads for 48 hours
  // (the newest featured one, if several), after which the formula below takes over again.
  const featured = news.filter((a) => a.data.featured && hoursOld(a, now) < 48).sort((x, y) => Date.parse(y.data.publishedAt) - Date.parse(x.data.publishedAt));
  if (featured.length) return featured[0];
  const scored = news.map((a) => ({
    a,
    score: (a.data.quality?.importance ?? 5) - hoursOld(a, now) / 12 + (a.data.image ? 1.5 : 0),
  }));
  scored.sort((x, y) => y.score - x.score);
  return scored[0]?.a;
}

export function related(article: Article, all: Article[], count = 4): Article[] {
  const tags = new Set(article.data.tags);
  return all
    .filter((a) => a.id !== article.id)
    .map((a) => ({
      a,
      score: (a.data.section === article.data.section ? 2 : 0) + a.data.tags.filter((t) => tags.has(t)).length * 1.5 - hoursOld(a) / 72,
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, count)
    .map((x) => x.a);
}

const GENERIC_TAGS = new Set(["عالمي", "العالم", "الشرق الأوسط", "الخليج", "الخليج العربي", "أوروبا", "آسيا", "أفريقيا", "الاقتصاد", "الأسواق", "الطاقة", "الشركات", "التكنولوجيا", "الدفاع", "الاقتصاد العالمي"]);
let regionNames: Set<string> | null = null;
let tagCounts: Map<string, number> | null = null;

/** Whether every word of a tag stands in a text (normalised, the article and clinging letters aside). */
function tagIn(tag: string, text: string): boolean {
  const words = kickerWords(tag);
  if (!words.size) return false;
  const hay = kickerWords(text);
  return [...words].every((w) => hay.has(w));
}
function kickerWords(text: string): Set<string> {
  const norm = text
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/اميرك/g, "امريك");
  return new Set(
    norm
      .split(/[^\p{L}\p{N}+]+/u)
      .map((w) => w.replace(/^(وال|بال|فال|كال|لل|ال)/, "").replace(/^[وفب](?=\p{L}{3})/u, ""))
      .filter((w) => w.length > 1),
  );
}

/**
 * The topic a story is filed under, printed above its headline the way the Arabic desks do
 * (الذهب، مضيق هرمز، التضخم): the tag its headline names, else one its dek or lede names, else its
 * most-shared tag; among equals the most-shared, so the kicker names a thread the reader can follow,
 * never a place. Undefined when the story has only regions for tags. Until 2026-09-27 the most-shared tag
 * won outright, and the broadest threads (الذكاء الاصطناعي، التضخم، النفط) sat over stories about something
 * else: «النفط» over a Treasury-yield story, «التضخم» over Japan's imports.
 */
export function topicOf(article: Article): string | undefined {
  if (!cache) return article.data.tags.find((t) => !GENERIC_TAGS.has(t) && !PLACE_TAGS.has(t));
  if (!regionNames || !tagCounts) {
    regionNames = new Set(cache.flatMap((a) => a.data.regions));
    tagCounts = new Map();
    for (const a of cache) for (const t of a.data.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  // Never a place: a country tag («السعودية»، «الولايات المتحدة») read as a section of its own (the owner, 2026-09-24).
  const candidates = article.data.tags.filter((t) => !regionNames!.has(t) && !GENERIC_TAGS.has(t) && !PLACE_TAGS.has(t) && t.length <= 28);
  const d = article.data;
  const rank = (t: string) => (tagIn(t, d.title) ? 3 : tagIn(t, `${d.subtitle ?? ""} ${d.lede ?? ""}`) ? 2 : 1);
  return [...candidates].sort((x, y) => rank(y) - rank(x) || (tagCounts!.get(y) ?? 0) - (tagCounts!.get(x) ?? 0))[0];
}

export function articleHref(article: Article): string {
  return `/articles/${article.data.slug}/`;
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
 * the Bessent talks. Region and section tags never count. The closest come first, then the newest.
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
  const topics = new Set(article.data.tags.filter((t) => !regions.has(t) && !GENERIC_TAGS.has(t) && count(t) <= broad));
  if (!topics.size) return [];
  return all
    .filter((a) => a.id !== article.id && !exclude.has(a.id) && hoursOld(a, now) < days * 24)
    .map((a) => ({ a, shared: a.data.tags.filter((t) => topics.has(t)) }))
    .filter(({ shared }) => shared.some((t) => count(t) <= narrow) || shared.length >= 2)
    .map(({ a, shared }) => ({ a, score: shared.reduce((sum, t) => sum + 1 / Math.max(1, count(t)), 0) }))
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
 * What the paper is following now, for the files row under the section bar: the curated subjects (a sub-topic with
 * tags of its own, counted over every section) and the files (running stories, companies, institutions, people),
 * each once under its one page, busiest in the last week first. A subject reads under its short name.
 */
export function threads(articles: Article[], { days = 7, max = 8, now = Date.now() } = {}): Thread[] {
  const recentOf = (items: Article[]) => items.filter((a) => hoursOld(a, now) < days * 24).length;
  const out: Thread[] = [];
  for (const [section, list] of Object.entries(TOPICS)) {
    for (const topic of list) {
      if (!topic.tags?.length) continue;
      const items = topicArticles(articles, section, topic);
      if (items.length) out.push({ label: topic.short ?? topic.name, href: topicHref(section, topic.id), recent: recentOf(items), total: items.length });
    }
  }
  for (const d of dossiers(articles, { max: 500, now })) out.push({ label: d.tag, href: `/tags/${encodeURIComponent(d.tag)}/`, recent: recentOf(d.items), total: d.items.length });
  return out.filter((t) => t.recent >= 2).sort((x, y) => y.recent - x.recent || y.total - x.total).slice(0, max);
}

/** The freshest story of the last three days that carries a chart small enough for a column. */
export function chartOfTheDay(articles: Article[], now = Date.now()): Article | undefined {
  return articles.find((a) => {
    const c = a.data.chart;
    return c && c.title && c.categories.length <= 8 && c.series.length <= 2 && hoursOld(a, now) < 72;
  });
}
