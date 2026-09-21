import type { APIContext } from "astro";
import { getArticles, articleHref } from "@lib/articles";
import site from "@data/site.json";

/**
 * Google News sitemap: only the stories of the last 48 hours, with the publication name, language,
 * date and title Google asks for (developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap).
 * The ordinary sitemap-index.xml still lists every page; this one is what Top Stories reads.
 * Empty while the site is private, like everything else that invites a crawler.
 */
export async function GET(_context: APIContext) {
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const recent = site.private ? [] : (await getArticles()).filter((a) => Date.parse(a.data.publishedAt) >= cutoff).slice(0, 1000);
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const urls = recent
    .map(
      (a) => `  <url>
    <loc>${escape(new URL(articleHref(a), site.url).toString())}</loc>
    <news:news>
      <news:publication><news:name>${escape(site.name)}</news:name><news:language>ar</news:language></news:publication>
      <news:publication_date>${new Date(a.data.publishedAt).toISOString()}</news:publication_date>
      <news:title>${escape(a.data.title)}</news:title>
    </news:news>
  </url>`,
    )
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
