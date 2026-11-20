/**
 * Which tags have a page a link can lead to (2026-11-20, the owner: "check the file pages design and organization too").
 * A standing subject and a section always have theirs; a regional desk has its file; any other tag has a file of its own
 * only when two stories or more carry it. A tag on one story had a page too, 617 of the 907 file pages, each showing
 * only the story a reader had come from by its chip. The links in story text already held this bar
 * (rehype-topic-links.mjs, `linkable`); the chips under a story, the file pages and the search's list read it here.
 */
import type { Article } from "./articles";
import { allTags } from "./articles";
import { DESKS } from "./regions";
import { canonicalTag, isFileTag } from "./tag-map.mjs";

export const FILE_MIN = 2;

const sizes = new WeakMap<Article[], Map<string, number>>();

/** How many stories carry a tag (its one spelling), counted once per list of stories. */
export function fileSize(tag: string, all: Article[]): number {
  let map = sizes.get(all);
  if (!map) {
    map = new Map([...allTags(all)].map(([t, items]) => [t, items.length]));
    sizes.set(all, map);
  }
  return map.get(canonicalTag(tag)) ?? 0;
}

/** Whether the page a tag leads to (tagHref()) is built. */
export function hasPage(tag: string, all: Article[]): boolean {
  if (!isFileTag(tag)) return true;
  const name = canonicalTag(tag);
  return DESKS.some((d) => d.name === name) || fileSize(name, all) >= FILE_MIN;
}
