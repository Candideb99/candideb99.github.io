import type { APIContext } from "astro";
import site from "@data/site.json";

export function GET(_context: APIContext) {
  const body = `User-agent: *
Allow: /
Disallow: /search
Disallow: /pagefind/

Sitemap: ${new URL("/sitemap-index.xml", site.url)}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
