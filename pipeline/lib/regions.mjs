/**
 * The regional desks, shared with the site (`src/data/regions.json`): the writer's free-form
 * region tags are mapped to the desk names before an article is saved.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const DESKS = JSON.parse(readFileSync(path.join(process.cwd(), "src", "data", "regions.json"), "utf8"));
const byTag = new Map();
for (const d of DESKS) {
  byTag.set(d.name, d);
  for (const m of d.match) byTag.set(m, d);
}

export const DESK_NAMES = DESKS.map((d) => d.name);

/** Canonical desk names for a list of region tags, in the desks' order, each once; unknown tags are dropped. */
export function canonicalRegions(tags) {
  const found = new Set();
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw).trim();
    const d = byTag.get(tag) || DESKS.find((x) => x.match.some((m) => tag.includes(m)));
    if (d) found.add(d.name);
  }
  return DESK_NAMES.filter((n) => found.has(n)).slice(0, 3);
}
