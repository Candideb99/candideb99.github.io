/**
 * Brand assets for خازندار, traced from the owner's logo artwork (brand/logo-source.png):
 * the wordmark خازندار in dark green calligraphy over the treasurer's key in gold on a thin rule.
 * The artwork is the source of truth; this script only converts it into scalable vectors and
 * the derived formats, never redraws it.
 *
 * Writes:
 *   src/lib/brand.ts                 traced paths, viewBox and colours (used by the social-card endpoint)
 *   public/logo.svg                  the lockup, green lettering (light pages)
 *   public/logo-dark.svg             the lockup, paper lettering (dark pages)
 *   public/favicon.svg               the key's bow in gold on a green square
 *   public/apple-touch-icon.png      180 px mark
 *   public/icon-512.png              512 px mark (publisher logo)
 *   public/avatar.png                1024 px dark-green square with the lockup in paper and gold
 *   public/og-default.png            1200×630 social card with the lockup
 *
 * Run: npm run brand
 */
import sharp from "sharp";
import potrace from "potrace";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const SOURCE = path.join(root, "brand", "logo-source.png");
const PAPER = "#fcfcf9";
const INK = "#141414";
const GREEN_FIELD = "#0f5c3c";
const GREEN_DARK = "#0b3d28";
const fix = (n) => Number(n.toFixed(1));

// ---- Read the artwork and separate its two inks ----
const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const greenMask = Buffer.alloc(W * H, 255);
const goldMask = Buffer.alloc(W * H, 255);
const greenSamples = [];
const goldSamples = [];
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let i = 0, p = 0; i < data.length; i += 3, p += 1) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const ink = (255 - Math.min(r, g, b)) / 255; // 0 on white, near 1 on solid colour
  const gold = r > g + 4;
  // The gold is lighter than the green, so its edge sits lower on the ink scale; keep its small cut-outs open.
  if (ink < (gold ? 0.36 : 0.5)) continue;
  (gold ? goldMask : greenMask)[p] = 0;
  const x = p % W, y = (p - x) / W;
  if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  if (ink > 0.6) (gold ? goldSamples : greenSamples).push([r, g, b]);
}
const median = (samples) => {
  const pick = (k) => samples.map((s) => s[k]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  return `#${[0, 1, 2].map((k) => pick(k).toString(16).padStart(2, "0")).join("")}`;
};
const GREEN = median(greenSamples);
const GOLD = median(goldSamples);

/** Traces a mask (0 = ink) into an SVG path in image pixels. */
async function trace(mask) {
  const png = await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
  return new Promise((resolve, reject) => {
    const tracer = new potrace.Potrace({ threshold: 128, turdSize: 4, alphaMax: 1, optCurve: true, optTolerance: 0.25 });
    tracer.loadImage(png, (error) => {
      if (error) return reject(error);
      const tag = tracer.getPathTag();
      resolve(tag.match(/ d="([^"]+)"/)[1]);
    });
  });
}
const greenPath = await trace(greenMask);
const goldPath = await trace(goldMask);

// ---- The lockup box: the artwork cropped to its ink with a small margin ----
const margin = 12;
const box = { x: minX - margin, y: minY - margin, w: maxX - minX + 2 * margin, h: maxY - minY + 2 * margin };
const viewBox = `${box.x} ${box.y} ${box.w} ${box.h}`;
const lockupInner = (lettering, key = GOLD) => `<path d="${greenPath}" fill="${lettering}" fill-rule="evenodd"/><path d="${goldPath}" fill="${key}" fill-rule="evenodd"/>`;
const lockupSvg = (width, lettering) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${fix((width * box.h) / box.w)}">${lockupInner(lettering)}</svg>`;

// ---- The mark: the key's bow on a green square. The bow is the tallest run of gold columns. ----
const extent = new Array(W).fill(0);
for (let x = 0; x < W; x += 1) {
  let top = -1, bottom = -1;
  for (let y = 0; y < H; y += 1) if (goldMask[y * W + x] === 0) { if (top < 0) top = y; bottom = y; }
  extent[x] = top < 0 ? 0 : bottom - top + 1;
}
const tallest = Math.max(...extent);
let bowStart = extent.findIndex((e) => e > tallest * 0.55);
let bowEnd = extent.length - 1 - [...extent].reverse().findIndex((e) => e > tallest * 0.55);
// the bit at the other end is also tall; keep the run that contains the tallest column
const peak = extent.indexOf(tallest);
if (!(bowStart <= peak && peak <= bowEnd)) { bowStart = peak; bowEnd = peak; }
for (let x = peak; x >= 0 && extent[x] > tallest * 0.55; x -= 1) bowStart = x;
for (let x = peak; x < W && extent[x] > tallest * 0.55; x += 1) bowEnd = x;
let bowTop = H, bowBottom = 0;
for (let x = bowStart; x <= bowEnd; x += 1) for (let y = 0; y < H; y += 1) if (goldMask[y * W + x] === 0) { if (y < bowTop) bowTop = y; if (y > bowBottom) bowBottom = y; }
const bowBox = { x: bowStart - 4, y: bowTop - 4, w: bowEnd - bowStart + 8 + 18, h: bowBottom - bowTop + 8 };
const markInner = () => {
  const s = 70 / Math.max(bowBox.w, bowBox.h);
  const cx = bowBox.x + bowBox.w / 2 - 9;
  const cy = bowBox.y + bowBox.h / 2;
  return `<rect width="100" height="100" fill="${GREEN_FIELD}"/><clipPath id="bow"><rect x="${fix(bowBox.x - 18)}" y="${fix(bowBox.y)}" width="${fix(bowBox.w)}" height="${fix(bowBox.h)}"/></clipPath><g transform="translate(50 50) scale(${s.toFixed(4)}) translate(${fix(-cx)} ${fix(-cy)})"><path d="${goldPath}" fill="${GOLD}" fill-rule="evenodd" clip-path="url(#bow)"/></g>`;
};
const markSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${markInner()}</svg>`;

// ---- Outputs ----
await mkdir(path.join(root, "public"), { recursive: true });
await writeFile(
  path.join(root, "src", "lib", "brand.ts"),
  `// Generated by scripts/brand.mjs from brand/logo-source.png. Do not edit by hand; run \`npm run brand\` after replacing the artwork.
/** The lockup traced from the artwork: lettering and key paths in image pixels, with the viewBox that crops to the ink. */
export const LOGO = ${JSON.stringify({ viewBox, width: box.w, height: box.h, lettering: greenPath, key: goldPath, colors: { green: GREEN, gold: GOLD } })};
`,
);
await writeFile(path.join(root, "public", "logo.svg"), lockupSvg(900, GREEN));
await writeFile(path.join(root, "public", "logo-dark.svg"), lockupSvg(900, PAPER));
await writeFile(path.join(root, "public", "favicon.svg"), markSvg(64));
for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-512.png", 512]]) {
  await writeFile(path.join(root, "public", name), await sharp(Buffer.from(markSvg(size))).png().toBuffer());
}
{
  const S = 1024;
  const w = 820;
  const h = (w * box.h) / box.w;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"><rect width="${S}" height="${S}" fill="${GREEN_DARK}"/><g transform="translate(${fix((S - w) / 2)} ${fix((S - h) / 2)}) scale(${(w / box.w).toFixed(5)}) translate(${-box.x} ${-box.y})">${lockupInner(PAPER)}</g></svg>`;
  await writeFile(path.join(root, "public", "avatar.png"), await sharp(Buffer.from(svg)).png().toBuffer());
}
{
  const CW = 1200, CH = 630, w = 660;
  const h = (w * box.h) / box.w;
  const og =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}"><rect width="${CW}" height="${CH}" fill="${PAPER}"/>` +
    `<rect x="80" y="70" width="${CW - 160}" height="3" fill="${INK}"/><rect x="80" y="78" width="${CW - 160}" height="1" fill="${INK}"/>` +
    `<rect x="80" y="${CH - 79}" width="${CW - 160}" height="1" fill="${INK}"/><rect x="80" y="${CH - 73}" width="${CW - 160}" height="3" fill="${INK}"/>` +
    `<g transform="translate(${fix((CW - w) / 2)} ${fix((CH - h) / 2)}) scale(${(w / box.w).toFixed(5)}) translate(${-box.x} ${-box.y})">${lockupInner(GREEN)}</g></svg>`;
  const png = await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(root, "public", "og-default.png"), png);
}
console.log(`brand: traced ${W}×${H} artwork; lockup box ${box.w}×${box.h}; lettering ${GREEN}, key ${GOLD}; lettering path ${greenPath.length} chars, key path ${goldPath.length} chars`);
