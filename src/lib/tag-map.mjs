/**
 * Where a tag leads: one page per subject (the owner, 2026-09-27). A subject lived at up to four addresses: the
 * curated sub-topic («التضخم والأسعار», 15 stories), the tag file («التضخم», 23), and more tag files for the same thing
 * spelt otherwise («النفط», «أسعار النفط», «خام برنت», «برنت»), each with its own count, so the kicker and the trail
 * above one story led to two pages. Now:
 *
 * - a tag that is a curated sub-topic's subject (its `tags` in src/data/topics.json, chosen by hand, never a company,
 *   an institution, a person, a place or a running event) leads to the sub-topic's page, which lists that tag's
 *   stories from every section;
 * - a tag that names a news section («الطاقة») leads to the section;
 * - a second spelling of a running story's tag (src/data/tag-aliases.json: «هرمز» for «مضيق هرمز») leads to its file;
 * - every other tag is a file of its own at /tags/.
 *
 * Plain JavaScript so the three places that need it agree: the site's links (lib/topics.ts), the links in story
 * text (rehype-topic-links.mjs) and the redirects of the old tag addresses (astro.config.mjs).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const read = (name) => JSON.parse(readFileSync(path.join(process.cwd(), "src", "data", name), "utf8"));

/** Arabic normalisation for matching: no diacritics or tatweel, one alef, ta marbuta as ha, alef maqsura as ya. */
export function normalizeArabic(s) {
  return String(s ?? "")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const HUBS = new Set(["analysis", "explainers"]);
/** @type {Map<string, { section: string, id: string, name: string }>} */
const SUBJECTS = new Map();
for (const [section, list] of Object.entries(read("topics.json"))) {
  for (const topic of list) {
    for (const tag of topic.tags ?? []) {
      const key = normalizeArabic(tag);
      if (SUBJECTS.has(key)) throw new Error(`topics.json: «${tag}» is the subject of two sub-topics`);
      SUBJECTS.set(key, { section, id: topic.id, name: topic.name });
    }
  }
}
/** @type {Map<string, string>} */
const ALIASES = new Map(Object.entries(read("tag-aliases.json")).map(([from, to]) => [normalizeArabic(from), String(to)]));
/** @type {Map<string, string>} */
const SECTION_TAGS = new Map(read("sections.json").filter((s) => !HUBS.has(s.id)).map((s) => [normalizeArabic(s.name), s.id]));

/** A tag in its one spelling: «هرمز» is «مضيق هرمز». @param {string} tag */
export function canonicalTag(tag) {
  return ALIASES.get(normalizeArabic(tag)) ?? tag;
}

/** The curated sub-topic a tag is the subject of, if it is one. @param {string} tag */
export function subjectOfTag(tag) {
  return SUBJECTS.get(normalizeArabic(canonicalTag(tag)));
}

/** Whether a tag is a file of its own: not a sub-topic's subject and not a section's name. @param {string} tag */
export function isFileTag(tag) {
  return !subjectOfTag(tag) && !SECTION_TAGS.has(normalizeArabic(tag));
}

/** The one page a tag leads to: its subject's page, its section's page, or its own file. @param {string} tag */
export function tagHref(tag) {
  const subject = subjectOfTag(tag);
  if (subject) return `/topics/${subject.section}/${subject.id}/`;
  const section = SECTION_TAGS.get(normalizeArabic(tag));
  if (section) return `/${section}/`;
  return `/tags/${encodeURIComponent(canonicalTag(tag))}/`;
}

/**
 * The old tag addresses that now forward, for Astro's `redirects`: every tag the stories carry that is a subject, a
 * section's name or a second spelling, and every second spelling listed. A tiny page per address, not a copy of the
 * site's stylesheet (the pages built as ordinary tag pages carried 30 KB of it).
 * @param {Iterable<string>} tags
 * @returns {Record<string, string>}
 */
export function tagRedirects(tags) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const tag of new Set([...tags, ...Object.keys(read("tag-aliases.json"))])) {
    if (isFileTag(tag) && !ALIASES.has(normalizeArabic(tag))) continue;
    // Astro encodes the destination itself: an already-encoded «/tags/%D9…/» came out as «%25D9…», a page that is not there.
    out[`/tags/${tag}/`] = decodeURIComponent(tagHref(tag));
  }
  return out;
}

/** Every tag the published stories carry, read from their front matter (for the redirects, at config time). */
export function storyTags() {
  const dir = path.join(process.cwd(), "content", "articles");
  const tags = new Set();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return tags;
  }
  for (const f of files) {
    const front = readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
    if (!front) continue;
    let data;
    try {
      data = YAML.parse(front[1]);
    } catch {
      continue;
    }
    if (data?.draft) continue;
    for (const tag of data?.tags ?? []) if (String(tag).trim()) tags.add(String(tag).trim());
  }
  return tags;
}
