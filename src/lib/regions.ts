/**
 * The paper's regional desks as readers see them: three Arab desks and one for the world. The writers file
 * every story under the finer regions of `src/data/regions.json` (shared with the pipeline, whose photo desk
 * reads them for geography), and this file folds them for the site, so the front's "by region" block and the
 * desk pages never split one region across spellings (أمريكا / أميركا الشمالية / الولايات المتحدة).
 *
 * Four, not eight (the owner, 2026-09-24: an Americas desk is odd on an Arab economics site): الخليج،
 * مصر والمغرب العربي، الشرق الأوسط، and العالم for Europe, the Americas, Asia, Africa and the world market.
 */
import desks from "@data/regions.json";
import type { Article } from "./articles";

export interface Desk {
  id: string;
  name: string;
  match: string[];
}

const RAW: Desk[] = desks as Desk[];
const ARAB = new Set(["gulf", "egypt-maghreb", "mena"]);
const abroad = RAW.filter((d) => !ARAB.has(d.id));

export const DESKS: Desk[] = [
  ...RAW.filter((d) => ARAB.has(d.id)),
  { id: "world", name: "العالم", match: [...new Set(abroad.flatMap((d) => [d.name, ...d.match]))] },
];

/** Every place a region tag can name, desks and countries alike: a label above a headline never shows one. */
export const PLACE_TAGS: Set<string> = new Set(RAW.flatMap((d) => [d.name, ...d.match]).concat(["العالم"]));

// The Arab desks come first and keep a name the world desk also lists.
const byTag = new Map<string, Desk>();
for (const d of DESKS) {
  for (const m of [d.name, ...d.match]) if (!byTag.has(m)) byTag.set(m, d);
}

/** The desk a region tag belongs to, if any. */
export function deskOf(tag: string): Desk | undefined {
  return byTag.get(tag.trim());
}

/** The desks a story belongs to, in the desks' order, each once. */
export function desksOf(article: Article): Desk[] {
  const found = new Set<Desk>();
  for (const tag of article.data.regions) {
    const d = deskOf(tag);
    if (d) found.add(d);
  }
  return DESKS.filter((d) => found.has(d));
}
