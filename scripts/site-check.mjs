#!/usr/bin/env node
/**
 * What a reader meets, checked on the built site (dist/) without a browser: every page is Arabic and right to left,
 * titled and not empty; every link inside the site leads to a page or file that was built; every image says what it
 * shows; no "undefined", "NaN" or "[object Object]" reached the text; every story shows its date and its sources.
 * Asked for on 2026-09-26 (the owner's go to a review that wanted the reader's experience checked, not only a build
 * that succeeds). The gate runs it after the build (scripts/gate.mjs); it can also run alone:
 *
 *   node scripts/site-check.mjs [dist]
 *
 * It exits 1 on any fault, naming the page and what is wrong.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.argv[2] ?? "dist");
if (!existsSync(DIST)) {
  console.log(`site-check: ${DIST} does not exist; build the site first (npm run build)`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      // Pagefind's index is its own machinery, not a page.
      if (name === "pagefind") continue;
      walk(p, out);
    } else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

/** Where a link inside the site leads, as a file in dist/ (a page is its folder's index.html). */
function target(href, from) {
  let clean = href.split("#")[0].split("?")[0];
  if (!clean) return null;
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* left as written */
  }
  const abs = clean.startsWith("/") ? path.join(DIST, clean) : path.join(path.dirname(from), clean);
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  if (existsSync(path.join(abs, "index.html"))) return path.join(abs, "index.html");
  if (existsSync(`${abs}.html`)) return `${abs}.html`;
  return false;
}

const pages = walk(DIST);
const faults = [];
const fault = (page, what) => faults.push(`${path.relative(DIST, page).replace(/\\/g, "/")}: ${what}`);
let links = 0;
let images = 0;
let stories = 0;
const broken = new Map();

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const rel = path.relative(DIST, page).replace(/\\/g, "/");
  // A redirect stub (<meta http-equiv="refresh">) is not a page a reader reads.
  if (/http-equiv=["']refresh["']/i.test(html) && html.length < 2000) continue;
  const tag = html.match(/<html[^>]*>/i)?.[0] ?? "";
  if (!/\blang=["']ar["']/.test(tag) || !/\bdir=["']rtl["']/.test(tag)) fault(page, `not marked Arabic right-to-left (${tag.slice(0, 60) || "no <html> tag"})`);
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  if (!title) fault(page, "no <title>");
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? "";
  const words = main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").trim();
  if (!main) fault(page, "no <main>");
  else if (words.length < 40 && rel !== "404.html") fault(page, `an empty page (${words.length} characters of text in <main>)`);
  const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  for (const leak of ["undefined", "NaN", "[object Object]", "Invalid Date"]) {
    if (new RegExp(`(^|[\\s>،:(])${leak.replace(/[[\]]/g, "\\$&")}([\\s<،.:)]|$)`).test(visible)) fault(page, `"${leak}" printed in the text`);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    images += 1;
    if (!/\balt=/.test(m[0])) fault(page, `an image without alt text (${(m[0].match(/src=["']([^"']+)/)?.[1] ?? "").slice(0, 80)})`);
  }
  for (const m of html.matchAll(/\bhref=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (/^(?:https?:|mailto:|tel:|javascript:|data:|#)/i.test(href) || href.startsWith("//")) continue;
    links += 1;
    const t = target(href, page);
    if (t === false) broken.set(`${rel} → ${href}`, true);
  }
  if (/^articles\/[^/]+\/index\.html$/.test(rel)) {
    stories += 1;
    if (!/<time\b[^>]*datetime=/i.test(html)) fault(page, "a story without its date (<time datetime>)");
    // The Sources component (src/components/Sources.astro): its section and at least one listed source. An explainer
    // written without outside sources (data-section="explainers") has none by design.
    const explainer = /data-section=["']explainers["']/.test(tag);
    if (!explainer && (!/id=["']sources-title["']/.test(html) || !/class=["'][^"']*sources__item/.test(html))) fault(page, "a story without its sources section");
  }
}
for (const key of broken.keys()) faults.push(`broken link: ${key}`);

console.log(`site-check: ${pages.length} pages (${stories} stories), ${links} links inside the site, ${images} images`);
if (faults.length) {
  console.log(`${faults.length} fault(s):`);
  for (const f of faults.slice(0, 60)) console.log(`  - ${f}`);
  if (faults.length > 60) console.log(`  … and ${faults.length - 60} more`);
  process.exit(1);
}
console.log("site-check: every page is Arabic right-to-left, titled and not empty; every link inside the site resolves; every image has alt text; every story shows its date and sources");
