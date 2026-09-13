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

/** An alias must stand as a whole word in the tag (a nisba ending is allowed: المصرية, الإماراتي); "مصرف" is not "مصر". */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = new Map(DESKS.flatMap((d) => d.match.map((m) => [m, new RegExp(`(?<!\\p{L})${escapeRe(m)}(?:ي|ية)?(?!\\p{L})`, "u")])));

/** Canonical desk names for a list of region tags, in the writer's order (the first is the story's main region), each once; unknown tags are dropped. */
export function canonicalRegions(tags) {
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw).trim();
    const d = byTag.get(tag) || DESKS.find((x) => x.match.some((m) => wholeWord.get(m).test(tag)));
    if (d && !out.includes(d.name)) out.push(d.name);
  }
  return out.slice(0, 3);
}
