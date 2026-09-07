import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getArticles, articleHref } from "@lib/articles";
import { getSection } from "@lib/sections";
import { excerpt } from "@lib/format";
import site from "@data/site.json";

export async function GET(context: APIContext) {
  const articles = (await getArticles()).slice(0, 50);
  return rss({
    title: site.name,
    description: site.description,
    site: context.site ?? site.url,
    trailingSlash: true,
    items: articles.map((a) => ({
      title: a.data.title,
      description: a.data.subtitle || excerpt(a.data.lede, 200),
      pubDate: new Date(a.data.publishedAt),
      link: articleHref(a),
      categories: [getSection(a.data.section).name, ...a.data.tags],
      content: `<p>${a.data.lede}</p><p><a href="${new URL(articleHref(a), site.url)}">اقرأ المقال كاملاً في خازندار</a></p>`,
    })),
    customData: `<language>ar</language><image><url>${new URL("/og-default.png", site.url)}</url><title>${site.name}</title><link>${site.url}</link></image>`,
  });
}
