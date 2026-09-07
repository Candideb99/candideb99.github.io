import type { APIContext } from "astro";
import sharp from "sharp";
import { getArticles } from "@lib/articles";
import { getSection } from "@lib/sections";
import { coverSvg } from "@lib/cover";

/** Social preview images for stories that carry generated cover art. */
export async function getStaticPaths() {
  const articles = await getArticles();
  return articles.filter((a) => !a.data.image).map((a) => ({ params: { slug: a.data.slug }, props: { article: a } }));
}

export async function GET({ props }: APIContext) {
  const { article } = props;
  const sec = getSection(article.data.section);
  const svg = coverSvg(article.data.slug, { color: sec.color, ground: "field", width: 1200, height: 630 });
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
