/**
 * The paper's regional desks: every region tag a writer produces is mapped to one of eight desks
 * (`src/data/regions.json`, shared with the pipeline), so the front's "by region" block and the
 * tag pages never split one region across spellings (أمريكا / أميركا الشمالية / الولايات المتحدة).
 */
import desks from "@data/regions.json";
import type { Article } from "./articles";

export interface Desk {
  id: string;
  name: string;
  match: string[];
}

export const DESKS: Desk[] = desks as Desk[];

const byTag = new Map<string, Desk>();
for (const d of DESKS) {
  byTag.set(d.name, d);
  for (const m of d.match) byTag.set(m, d);
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
