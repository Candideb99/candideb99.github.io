/**
 * The desk an analysis belongs to, read from the paper's own stories it draws on (its internal
 * sources): economic, markets, energy, companies or technology. Printed as the kicker so a reader
 * never mistakes one kind of reading for another, the way the business dailies keep "Heard on the
 * Street" apart from their other columns. The defence desk went with the defence section, 2026-10-19.
 */
import type { Article } from "./articles";
import { EXPLAINER_KINDS } from "./sections";

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
};

const bySlug = new WeakMap<Article[], Map<string, Article>>();

/**
 * The news section a piece written from our own stories belongs to: the section most of the stories it cites are filed
 * under, or none when it cites none of ours. An analysis's desk reads it, and since 2026-11-21 the explainers' page,
 * which sets its lessons out by field.
 */
export function fieldOf(article: Article, all: Article[]): string | undefined {
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
  return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
}

/** The desk of an analysis (majority section of the stories it cites), the weekly's own label, or null for other kinds. */
export function analysisDesk(article: Article, all: Article[]): Desk | null {
  const kind = article.data.kind;
  if (kind === "weekly") return { id: "weekly", label: "حصاد الأسبوع" };
  if (kind === "feature") return { id: "feature", label: "في العمق" };
  if (kind !== "analysis") return null;
  const field = fieldOf(article, all);
  return field ? { id: field, label: ANALYSIS_DESKS[field] } : { id: "general", label: "تحليل" };
}

/** The page that lists every week's review (src/pages/analysis/weekly.astro). */
export const WEEKLY_HREF = "/analysis/weekly/";

/**
 * The page a piece of the paper's own leads to from its label: an analysis's desk, the week's review's own page, an
 * explainer's kind; undefined for news and for a reading with no list of its own («في العمق», an analysis no desk
 * claims), which keep their section (2026-11-20, the owner: "check the analysis page design and organization too"). On
 * the analysis section's page every card's label had led back to that same page, and the week's review had no page.
 */
export function readingHref(article: Article, all: Article[]): string | undefined {
  const kind = EXPLAINER_KINDS.find((k) => k.kind === article.data.kind);
  if (kind) return `/explainers/kind/${kind.id}/`;
  if (article.data.kind === "weekly") return WEEKLY_HREF;
  const desk = analysisDesk(article, all);
  return desk && ANALYSIS_DESKS[desk.id] ? `/analysis/desk/${desk.id}/` : undefined;
}

/** The kicker text for a story's kind: the analysis desk, the weekly, or nothing for news. */
export function analysisLabel(article: Article, all: Article[]): string | undefined {
  return analysisDesk(article, all)?.label;
}

/** A desk is offered in the menus while it has had DESK_MIN analyses in the last DESK_DAYS days. */
export const DESK_MIN = 2;
export const DESK_DAYS = 60;

/**
 * The analysis desks the menus offer (the bar's panel, a desk page's neighbours), in their order: only those we are
 * writing in (2026-10-19, the owner's check of the whole site: six desks were offered for nine analyses, technology and
 * defence with none). A desk's page stays, since an analysis's kicker leads there.
 */
export function liveDesks(all: Article[], now = Date.now()): Desk[] {
  const since = now - DESK_DAYS * 864e5;
  const counts = new Map<string, number>();
  for (const a of all) {
    if (a.data.kind !== "analysis" || Date.parse(a.data.publishedAt) < since) continue;
    const id = analysisDesk(a, all)?.id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return Object.entries(ANALYSIS_DESKS).filter(([id]) => (counts.get(id) ?? 0) >= DESK_MIN).map(([id, label]) => ({ id, label }));
}
