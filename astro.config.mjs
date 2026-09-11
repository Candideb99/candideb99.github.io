import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import site from "./src/data/site.json" with { type: "json" };
import rehypeIsolateNumbers from "./src/lib/rehype-isolate-numbers.mjs";

export default defineConfig({
  site: site.url,
  markdown: {
    rehypePlugins: [rehypeIsolateNumbers],
  },
  output: "static",
  trailingSlash: "always",
  compressHTML: true,
  devToolbar: { enabled: false },
  build: {
    format: "directory",
    // "always": GitHub Pages caches HTML for 10 minutes but every deploy renames and deletes the
    // hashed stylesheet files, so a cached page pointed at a stylesheet that was gone and rendered
    // half-styled. Embedded styles cannot go missing. The cost is ~4 kB gzipped per page.
    inlineStylesheets: "always",
  },
  // While `private` is set in site.json the site ships without a sitemap, so a crawler that ignores
  // robots.txt still has no index of the pages to follow.
  integrations: site.private
    ? []
    : [
        sitemap({
          filter: (page) => !page.includes("/search"),
        }),
      ],
  image: {
    remotePatterns: [{ protocol: "https", hostname: "**.wikimedia.org" }],
  },
});
