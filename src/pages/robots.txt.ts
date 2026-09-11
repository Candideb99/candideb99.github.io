import type { APIContext } from "astro";
import site from "@data/site.json";

export function GET(_context: APIContext) {
  // Pre-launch: the site is deployed but asks every crawler to stay away, and advertises no sitemap.
  if (site.private) {
    return new Response(`User-agent: *
Disallow: /
`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const body = `User-agent: *
Allow: /
Disallow: /search
Disallow: /pagefind/
Disallow: /admin/
Disallow: /api/

Sitemap: ${new URL("/sitemap-index.xml", site.url)}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
