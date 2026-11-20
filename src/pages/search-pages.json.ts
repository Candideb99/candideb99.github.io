import type { APIContext } from "astro";
import { getArticles, allTags } from "@lib/articles";
import { TOPICS, topicHref } from "@lib/topics";
import { sections, sectionHref } from "@lib/sections";
import { DESKS } from "@lib/regions";
import { isFileTag, normalizeArabic } from "@lib/tag-map.mjs";
import tagAliases from "@data/tag-aliases.json";

/**
 * The pages a search can name (2026-11-20, the owner: "check the search page design and organization too"): the site
 * keeps one page per subject, file, region and section, and the search never led to one («النفط» listed 288 stories and
 * not the oil page with its prices). The search page fetches this list on its first search and offers the page a whole
 * query names above the results. A file of its own, read only by a reader who searches: handed to the page inline it
 * grew the page from 26 KB to 43 KB compressed for every visit.
 *
 * Each entry: the name as tag-map.mjs's normalizeArabic() reads it, its kind (m subject, q section, r region, f file),
 * the page's name and, for a subject or a section, its address; a file's and a region's address is its name under /tags/.
 */
export async function GET(_context: APIContext) {
  const articles = await getArticles();
  const named = new Map<string, [string, string, string]>();
  const name = (key: string | undefined, kind: string, label: string, href: string) => {
    const k = normalizeArabic(key);
    if (k && !named.has(k)) named.set(k, [kind, label, href]);
  };
  for (const [section, list] of Object.entries(TOPICS)) {
    for (const t of list) for (const key of [t.name, t.short, ...(t.tags ?? [])]) name(key, "m", t.name, topicHref(section, t.id));
  }
  for (const s of sections) name(s.name, "q", s.name, sectionHref(s.id));
  for (const d of DESKS) name(d.name, "r", d.name, "");
  const files = allTags(articles);
  for (const tag of files.keys()) if (isFileTag(tag)) name(tag, "f", tag, "");
  for (const [alias, to] of Object.entries(tagAliases as Record<string, string>)) if (files.has(to) && isFileTag(to)) name(alias, "f", to, "");
  const pages = [...named.entries()].map(([key, [kind, label, href]]) => (href ? [key, kind, label, href] : [key, kind, label]));
  return new Response(JSON.stringify(pages), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
