/**
 * The standing sub-topics of every news section (`src/data/topics.json`): a curated taxonomy, the
 * way a business daily's section menu reads (Banking, Commodities, Currencies…), not the tags the
 * writers happen to have used. A story belongs to a sub-topic when one of its tags or its title
 * carries one of the sub-topic's terms, compared after Arabic normalisation.
 */
import topicsData from "@data/topics.json";
import type { Article } from "./articles";

export interface Topic {
  id: string;
  name: string;
  match: string[];
}

export const TOPICS = topicsData as Record<string, Topic[]>;

/** Arabic normalisation for matching: no diacritics or tatweel, one alef, ta marbuta as ha, alef maqsura as ya. */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function topicsOf(section: string): Topic[] {
  return TOPICS[section] ?? [];
}

export function getTopic(section: string, id: string): Topic | undefined {
  return topicsOf(section).find((t) => t.id === id);
}

export function topicHref(section: string, id: string): string {
  return `/topics/${section}/${id}/`;
}

function matches(article: Article, topic: Topic): boolean {
  const hay = [article.data.title, ...article.data.tags].map(normalizeArabic);
  return topic.match.some((term) => {
    const t = normalizeArabic(term);
    return t.length > 1 && hay.some((h) => h.includes(t));
  });
}

/** The section's stories filed under a sub-topic, newest first. */
export function topicArticles(articles: Article[], section: string, topic: Topic): Article[] {
  return articles.filter((a) => a.data.section === section && matches(a, topic));
}

/** The sub-topics of a section with their story counts, in the taxonomy's order. */
export function topicCounts(articles: Article[], section: string): { topic: Topic; count: number }[] {
  return topicsOf(section).map((topic) => ({ topic, count: topicArticles(articles, section, topic).length }));
}
