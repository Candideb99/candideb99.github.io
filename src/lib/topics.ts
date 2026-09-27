/**
 * The standing sub-topics of every news section (`src/data/topics.json`): a curated taxonomy, the
 * way a business daily's section menu reads (Banking, Commodities, Currencies…), not the tags the
 * writers happen to have used. A story belongs to a sub-topic when its headline or one of its tags
 * carries one of the sub-topic's terms, compared after Arabic normalisation.
 *
 * Terms match as whole words, through the letters Arabic joins to them («وبالنفط»، «للفائدة»), never inside another
 * word: until 2026-09-27 a bare substring test filed an FAA outage under monetary policy («الفيدرالي» inside «هيئة
 * الطيران الفيدرالية»), a uranium find under oil («خام» in «خام اليورانيوم») and the Saudi pipeline's pumping stations
 * under power («محطات» in «محطاته»). A topic's `titleMatch` terms count only in the headline (a central bank named as
 * a GDP release's source is not a monetary-policy story), and its `exclude` phrases are read out first («كفاءة الوقود»
 * is not a fuel price).
 */
import topicsData from "@data/topics.json";
import type { Article } from "./articles";

export interface Topic {
  id: string;
  name: string;
  match: string[];
  titleMatch?: string[];
  exclude?: string[];
  /** Terms that list a story here but lose its trail to any other topic its headline names («تصعيد هرمز يرفع برنت» is oil). */
  weak?: string[];
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = new Map<string, RegExp>();
/** A term as whole words, with the letters Arabic joins before it («و»، «ب»، «ل»، «ال»، «لل»). */
function termPattern(term: string): RegExp {
  const n = normalizeArabic(term);
  let re = patterns.get(n);
  if (!re) {
    const forms = n.startsWith("ال") ? `[وفبك]?(?:${escapeRe(n)}|لل${escapeRe(n.slice(2))})` : `[وفبكل]?(?:ال|لل)?${escapeRe(n)}`;
    // Arabic letters only as word edges: «،» «؛» «؟» sit in the same Unicode block and end a word («الفائدة،»).
    re = new RegExp(`(?<![\\u0621-\\u065F\\u066E-\\u06D3\\u06FA-\\u06FFa-z0-9])${forms}(?![\\u0621-\\u065F\\u066E-\\u06D3\\u06FA-\\u06FFa-z0-9])`, "g");
    patterns.set(n, re);
  }
  re.lastIndex = 0;
  return re;
}

/** The text with a topic's excluded phrases read out. */
function readable(text: string, topic: Topic): string {
  let t = normalizeArabic(text);
  for (const phrase of topic.exclude ?? []) t = t.replace(termPattern(phrase), " ");
  return t;
}

interface Hit {
  score: number;
  at: number;
  length: number;
}

/**
 * How strongly a story belongs to a topic: a term in the headline (3) outranks one in a tag (1, a little more for the
 * writer's first tags); within the headline the earlier term wins, since the desks' headline opens with its event
 * («منطقة اليورو تنمو… بقيادة الصادرات» is growth, not trade). Null when nothing matches.
 */
function hit(article: Article, topic: Topic): Hit | null {
  let best: Hit | null = null;
  const better = (h: Hit) => !best || h.score > best.score || (h.score === best.score && (h.at < best.at || (h.at === best.at && h.length > best.length)));
  const title = readable(article.data.title, topic);
  const weak = new Set(topic.weak ?? []);
  for (const term of [...topic.match, ...(topic.titleMatch ?? []), ...weak]) {
    if (normalizeArabic(term).length < 2) continue;
    const m = termPattern(term).exec(title);
    if (m) {
      const h = { score: weak.has(term) ? 2.5 : 3, at: m.index, length: term.length };
      if (better(h)) best = h;
    }
  }
  article.data.tags.forEach((tag, i) => {
    const text = readable(tag, topic);
    for (const term of [...topic.match, ...weak]) {
      if (normalizeArabic(term).length < 2 || !termPattern(term).test(text)) continue;
      const h = { score: (weak.has(term) ? 0.5 : 1) + (6 - Math.min(i, 5)) / 10, at: Infinity, length: term.length };
      if (better(h)) best = h;
    }
  });
  return best;
}

/** The section's stories filed under a sub-topic, newest first. */
export function topicArticles(articles: Article[], section: string, topic: Topic): Article[] {
  return articles.filter((a) => a.data.section === section && hit(a, topic) !== null);
}

/**
 * The one sub-topic a story sits under in its section's taxonomy, for the trail on its page (الطاقة ›
 * النفط والغاز): the strongest hit (above); ties go to the longer term, then to the taxonomy's order.
 */
export function subTopicOf(article: Article): Topic | undefined {
  let best: Topic | undefined;
  let bestHit: Hit | null = null;
  for (const topic of topicsOf(article.data.section)) {
    const h = hit(article, topic);
    if (!h) continue;
    if (!bestHit || h.score > bestHit.score || (h.score === bestHit.score && (h.at < bestHit.at || (h.at === bestHit.at && h.length > bestHit.length)))) {
      best = topic;
      bestHit = h;
    }
  }
  return best;
}

/** The sub-topics of a section with their story counts, in the taxonomy's order. */
export function topicCounts(articles: Article[], section: string): { topic: Topic; count: number }[] {
  return topicsOf(section).map((topic) => ({ topic, count: topicArticles(articles, section, topic).length }));
}
