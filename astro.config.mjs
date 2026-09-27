import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import site from "./src/data/site.json" with { type: "json" };
import rehypeIsolateNumbers from "./src/lib/rehype-isolate-numbers.mjs";
import rehypeTopicLinks from "./src/lib/rehype-topic-links.mjs";
import { storyTags, tagRedirects } from "./src/lib/tag-map.mjs";

export default defineConfig({
  site: site.url,
  markdown: {
    // Topic links first: the figure isolation leaves the inside of a link alone.
    rehypePlugins: [rehypeTopicLinks, rehypeIsolateNumbers],
  },
  output: "static",
  // One page per subject (2026-09-27): the old address of a tag that is now a sub-topic's subject, a section's name or
  // a second spelling forwards to its one page (lib/tag-map.mjs); a tiny page each, not a copy of the site.
  redirects: tagRedirects(storyTags()),
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
