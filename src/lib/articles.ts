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
    score: (a.data.quality?.importance ?? 5) - hoursOld(a, now) / 12 + (a.data.image ? 0.5 : 0),
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

export function articleHref(article: Article): string {
  return `/articles/${article.data.slug}/`;
}

export function allTags(articles: Article[]): Map<string, Article[]> {
  const map = new Map<string, Article[]>();
  for (const a of articles) for (const t of a.data.tags) map.set(t, [...(map.get(t) ?? []), a]);
  return map;
}
