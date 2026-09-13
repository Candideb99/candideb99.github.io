import { getCollection, type CollectionEntry } from "astro:content";

export type Article = CollectionEntry<"articles">;

let cache: Article[] | null = null;

/** All published articles, newest first. */
export async function getArticles(): Promise<Article[]> {
  if (cache) return cache;
  const all = await getCollection("articles", ({ data }) => !data.draft);
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

/**
 * The topic a story is filed under, printed above its headline the way the Arabic desks do
 * (الذهب، مضيق هرمز، التضخم): its most-shared non-region tag, so the kicker names a thread the
 * reader can follow, never a place. Undefined when the story has only regions for tags.
 */
export function topicOf(article: Article): string | undefined {
  if (!cache) return article.data.tags.find((t) => !GENERIC_TAGS.has(t));
  if (!regionNames || !tagCounts) {
    regionNames = new Set(cache.flatMap((a) => a.data.regions));
    tagCounts = new Map();
    for (const a of cache) for (const t of a.data.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const candidates = article.data.tags.filter((t) => !regionNames!.has(t) && !GENERIC_TAGS.has(t) && t.length <= 28);
  return [...candidates].sort((x, y) => (tagCounts!.get(y) ?? 0) - (tagCounts!.get(x) ?? 0))[0];
}

export function articleHref(article: Article): string {
  return `/articles/${article.data.slug}/`;
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

export function allTags(articles: Article[]): Map<string, Article[]> {
  const map = new Map<string, Article[]>();
  for (const a of articles) for (const t of a.data.tags) map.set(t, [...(map.get(t) ?? []), a]);
  return map;
}

export interface Dossier {
  tag: string;
  items: Article[];
  latest: Article;
}

/**
 * Running stories: topic tags carried by at least `min` articles, ranked by size and freshness.
 * Region names are left out (a country is a place, not a story), as are the section names.
 */
export function dossiers(articles: Article[], { min = 3, max = 4, now = Date.now() } = {}): Dossier[] {
  const regions = new Set(articles.flatMap((a) => a.data.regions));
  const generic = new Set(["عالمي", "العالم", "الشرق الأوسط", "الخليج", "الخليج العربي", "أوروبا", "آسيا", "أفريقيا", "الاقتصاد", "الأسواق", "الطاقة", "الشركات", "التكنولوجيا", "الدفاع", "الاقتصاد العالمي"]);
  const out: Dossier[] = [];
  for (const [tag, items] of allTags(articles)) {
    if (items.length < min || regions.has(tag) || generic.has(tag)) continue;
    const sorted = [...items].sort((a, b) => Date.parse(b.data.publishedAt) - Date.parse(a.data.publishedAt));
    out.push({ tag, items: sorted, latest: sorted[0] });
  }
  const score = (d: Dossier) => d.items.length + Math.max(0, 3 - hoursOld(d.latest, now) / 24);
  return out.sort((x, y) => score(y) - score(x)).slice(0, max);
}

/** The freshest story of the last three days that carries a chart small enough for a column. */
export function chartOfTheDay(articles: Article[], now = Date.now()): Article | undefined {
  return articles.find((a) => {
    const c = a.data.chart;
    return c && c.title && c.categories.length <= 8 && c.series.length <= 2 && hoursOld(a, now) < 72;
  });
}
