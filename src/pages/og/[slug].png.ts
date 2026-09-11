import type { APIContext } from "astro";
import path from "node:path";
import sharp from "sharp";
import { getArticles } from "@lib/articles";
import { getSection, kindLabel } from "@lib/sections";
import { formatDate } from "@lib/format";
import { LOGO } from "@lib/brand";
import { openFont, lineToPath, wrapText } from "@lib/textpath.mjs";

/**
 * Social preview for stories without a licensed photograph: the paper's own card, with the
 * masthead lockup and the headline set in Amiri outlines (no font needs to be installed).
 */
export async function getStaticPaths() {
  const articles = await getArticles();
  return articles.filter((a) => !a.data.image).map((a) => ({ params: { slug: a.data.slug }, props: { article: a } }));
}

const PAPER = "#fcfcf9";
const INK = "#141414";
const INK_3 = "#6a6965";
const GREEN = "#0f5c3c";
const W = 1200;
const H = 630;
const MARGIN = 80;
const FONTS = path.join(process.cwd(), "node_modules/@fontsource/amiri/files");

export async function GET({ props }: APIContext) {
  const { article } = props;
  const sec = getSection(article.data.section);
  const bold = { arabic: openFont(path.join(FONTS, "amiri-arabic-700-normal.woff2")), latin: openFont(path.join(FONTS, "amiri-latin-700-normal.woff2")) };
  const regular = { arabic: openFont(path.join(FONTS, "amiri-arabic-400-normal.woff2")), latin: openFont(path.join(FONTS, "amiri-latin-400-normal.woff2")) };

  const right = W - MARGIN;
  const width = W - MARGIN * 2;
  const logoH = 104;
  const logoScale = logoH / LOGO.height;
  const logoW = LOGO.width * logoScale;
  const [vbX, vbY] = LOGO.viewBox.split(" ").map(Number);
  const headSize = 58;
  const lines = wrapText(bold, article.data.title, headSize, width, 3);
  const lineHeight = headSize * 1.5;
  const blockTop = 292;
  const headline = lines.map((line, i) => lineToPath(bold, line, headSize, { right, y: blockTop + i * lineHeight }).d).join("");
  const sectionName = kindLabel(article.data.kind, article.data.section);
  const sectionPath = lineToPath(regular, sectionName, 30, { right: MARGIN + 260, y: 150 });
  // The section name sits at the left margin: shift its right edge so its left edge lands on the margin.
  const section = lineToPath(regular, sectionName, 30, { right: MARGIN + sectionPath.width, y: 150 }).d;
  const date = lineToPath(regular, formatDate(article.data.publishedAt), 26, { right, y: H - 100 }).d;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
    `<rect x="${MARGIN}" y="56" width="${width}" height="3" fill="${INK}"/><rect x="${MARGIN}" y="64" width="${width}" height="1" fill="${INK}"/>` +
    `<g transform="translate(${(right - logoW).toFixed(2)} 88) scale(${logoScale.toFixed(5)}) translate(${-vbX} ${-vbY})"><path d="${LOGO.lettering}" fill="${LOGO.colors.green}" fill-rule="evenodd"/><path d="${LOGO.key}" fill="${LOGO.colors.gold}" fill-rule="evenodd"/></g>` +
    `<path d="${section}" fill="${GREEN}"/>` +
    `<rect x="${MARGIN}" y="214" width="${width}" height="1" fill="${INK}"/>` +
    `<path d="${headline}" fill="${INK}"/>` +
    `<path d="${date}" fill="${INK_3}"/>` +
    `<rect x="${MARGIN}" y="${H - 64}" width="${width}" height="1" fill="${INK}"/><rect x="${MARGIN}" y="${H - 58}" width="${width}" height="3" fill="${INK}"/>` +
    `</svg>`;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
