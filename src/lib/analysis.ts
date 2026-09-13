/**
 * The desk an analysis belongs to, read from the paper's own stories it draws on (its internal
 * sources): economic, markets, energy, companies, technology, or defence and geopolitics. Printed
 * as the kicker so a reader never mistakes a defence reading for an economic one, the way the
 * business dailies keep "Heard on the Street" apart from their geopolitical columns.
 */
import type { Article } from "./articles";

export interface Desk {
  id: string;
  label: string;
}

export const ANALYSIS_DESKS: Record<string, string> = {
  economy: "تحليل اقتصادي",
  markets: "تحليل الأسواق",
  energy: "تحليل الطاقة",
  companies: "تحليل الشركات",
  technology: "تحليل التكنولوجيا",
  defense: "تحليل دفاعي وجيوسياسي",
};

const bySlug = new WeakMap<Article[], Map<string, Article>>();

/** The desk of an analysis (majority section of the stories it cites), the weekly's own label, or null for other kinds. */
export function analysisDesk(article: Article, all: Article[]): Desk | null {
  const kind = article.data.kind;
  if (kind === "weekly") return { id: "weekly", label: "حصاد الأسبوع" };
  if (kind !== "analysis") return null;
  let index = bySlug.get(all);
  if (!index) {
    index = new Map(all.map((a) => [a.data.slug, a]));
    bySlug.set(all, index);
  }
  const counts = new Map<string, number>();
  for (const s of article.data.sources) {
    const slug = s.url.match(/^\/articles\/([^/]+)\/?$/)?.[1];
    const section = slug ? index.get(slug)?.data.section : undefined;
    if (section && ANALYSIS_DESKS[section]) counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  return top ? { id: top[0], label: ANALYSIS_DESKS[top[0]] } : { id: "general", label: "تحليل" };
}

/** The kicker text for a story's kind: the analysis desk, the weekly, or nothing for news. */
export function analysisLabel(article: Article, all: Article[]): string | undefined {
  return analysisDesk(article, all)?.label;
}
