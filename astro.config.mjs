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
    inlineStylesheets: "auto",
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/search"),
    }),
  ],
  image: {
    remotePatterns: [{ protocol: "https", hostname: "**.wikimedia.org" }],
  },
});
