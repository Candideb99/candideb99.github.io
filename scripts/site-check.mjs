#!/usr/bin/env node
/**
 * What a reader meets, checked on the built site (dist/) without a browser: every page is Arabic and right to left,
 * titled and not empty; every link inside the site leads to a page or file that was built; every image says what it
 * shows; no "undefined", "NaN" or "[object Object]" reached the text; every story shows its date and its sources; and
 * (2026-09-27) every «الأرقام» box holds figures, never a place, a name or a date (pipeline/lib/keyfacts.mjs).
 * Asked for on 2026-09-26 (the owner's go to a review that wanted the reader's experience checked, not only a build
 * that succeeds). The gate runs it after the build (scripts/gate.mjs); it can also run alone:
 *
 *   node scripts/site-check.mjs [dist]
 *
 * It exits 1 on any fault, naming the page and what is wrong.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isFigure } from "../pipeline/lib/keyfacts.mjs";
import { agendaFaults, articleFootFaults, bareFigures, boardFaults, countFaults, figureModuleFaults, filePageFaults, filesIndexFaults, interactiveFaults, latestPageFaults, pageHeadFaults, photoCredit, photoSourceFaults, readingFaults, selfLabelLinks, topicPageFaults } from "./site-furniture.mjs";

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

// The market strip prints an exchange rate's level beside its move (`stripShowsLevel()`, src/lib/markets.ts; the owner,
// 2026-11-15: «دولار/جنيه مصري −0.04%» in red, its 53.37 only in a tooltip, read as the pound falling on a day it gained),
// and the board files only yields under «السندات» (bitcoin had stood there).
const board = JSON.parse(readFileSync(fileURLToPath(new URL("../src/data/markets.json", import.meta.url)), "utf8"));
const rateIds = new Set(board.quotes.filter((q) => q.group === "fx").map((q) => q.id));
for (const q of board.quotes) {
  if (q.group === "rates" && q.unit !== "%") faults.push(`markets.json: «${q.name}» is filed under the bonds (group "rates") but is no yield (pipeline/lib/quotes.mjs)`);
}
let stripRates = 0;
let links = 0;
let images = 0;
let stories = 0;
let facts = 0;
// Where the published photographs come from, as their captions say (photoCredit(), 2026-11-20).
const credited = new Set();
const broken = new Map();

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  // A chart's note and switches and the front's figure cards (interactiveFaults(), scripts/site-furniture.mjs).
  for (const what of interactiveFaults(html)) fault(page, what);
  // A summary cut off with «…» and a worked sum printed left to right (readingFaults(), the same module, 2026-11-20).
  for (const what of readingFaults(html)) fault(page, what);
  const rel = path.relative(DIST, page).replace(/\\/g, "/");
  // A card's label that leads back to the page it is on (selfLabelLinks(), the same module, 2026-11-20).
  for (const what of selfLabelLinks(html, `/${rel.replace(/(^|\/)index\.html$/, "$1")}`)) fault(page, what);
  // A page head's row with names run together, or under a sentence that names it again (pageHeadFaults(), 2026-11-20).
  for (const what of pageHeadFaults(html)) fault(page, what);
  // A hub piece's cited stories printed again, its list naming the site on every line, its note naming the wrong kind
  // (articleFootFaults(), 2026-11-20).
  for (const what of articleFootFaults(html)) fault(page, what);
  // A lead without a photograph beside photographed stories, a bare «تحليل» label, an archive month left open
  // (topicPageFaults(), 2026-11-20).
  for (const what of topicPageFaults(html)) fault(page, what);
  // A file of one story, or a file page of more than twenty (filePageFaults(), 2026-11-20).
  for (const what of filePageFaults(html)) fault(page, what);
  // A line under a day's head on /latest/ printing its date or age, not its hour (latestPageFaults(), 2026-11-20).
  for (const what of latestPageFaults(html)) fault(page, what);
  // A count of stories under a page's title or in the files index (countFaults(), 2026-11-21).
  for (const what of countFaults(html)) fault(page, what);
  // The files index naming every file, a file twice, or a cell on a file gone quiet (filesIndexFaults(), 2026-11-21).
  for (const what of filesIndexFaults(html)) fault(page, what);
  // «أرقام اليوم» and «بالأرقام» on one page (figureModuleFaults(), 2026-11-21).
  for (const what of figureModuleFaults(html)) fault(page, what);
  // An agenda note said again under a later event (agendaFaults(), 2026-11-20).
  for (const what of agendaFaults(html)) fault(page, what);
  // An instrument printed twice on the board, an instrument's oldest close without its move (boardFaults(), 2026-11-20).
  for (const what of boardFaults(html)) fault(page, what);
  const credit = photoCredit(html);
  if (credit) credited.add(credit);
  // A redirect stub (<meta http-equiv="refresh">) is not a page a reader reads, but it must land on one: on 2026-09-27
  // eleven forwarded tag addresses pointed at a doubly encoded path («%25D9…») that was never built.
  if (/http-equiv=["']refresh["']/i.test(html) && html.length < 2000) {
    const to = html.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i)?.[1] ?? "";
    links += 1;
    if (to && !/^(?:https?:)?\/\//i.test(to) && !target(to, page)) fault(page, `forwards to ${to}, which was not built`);
    continue;
  }
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
  for (const m of html.matchAll(/<li class="markets__item"[^>]*data-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)) {
    if (!rateIds.has(m[1])) continue;
    stripRates += 1;
    if (!/class="q__price"/.test(m[2])) fault(page, `the market strip prints «${m[1]}» as its move alone, without its rate`);
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
    // Every figure of the box's labels, a chart's legend, categories and table, and an Arabic source title is isolated as
    // the text's own figures are (bareFigures(), scripts/site-furniture.mjs).
    for (const snippet of bareFigures(html)) fault(page, `a figure printed outside its isolation, which reverses a range: «${snippet}»`);
    // Under «الأرقام» a figure, never a place, a name or a date (the owner, 2026-09-27; pipeline/lib/keyfacts.mjs). The
    // side and inline boxes print the same facts, so the first is read; an explainer's glossary (facts--terms) is not.
    const box = html.match(/<aside class="facts\b[^"]*"[\s\S]*?<\/aside>/)?.[0] ?? "";
    if (box && !/facts--terms/.test(box.slice(0, 200))) {
      facts += 1;
      const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
      for (const m of box.matchAll(/<dt class="facts__label"[^>]*>([\s\S]*?)<\/dt>\s*<dd class="facts__value"[^>]*>([\s\S]*?)<\/dd>/g)) {
        if (!isFigure(text(m[2]), text(m[1]))) fault(page, `«${text(m[1])}: ${text(m[2])}» under «الأرقام» is not a figure (node pipeline/tidy.mjs takes it out)`);
      }
    }
  }
}
for (const key of broken.keys()) faults.push(`broken link: ${key}`);
// The about, methodology and privacy pages name every library the credits use, and the handouts when any run (2026-11-20).
for (const rel of ["about/index.html", "methodology/index.html", "privacy/index.html"]) {
  const file = path.join(DIST, rel);
  if (existsSync(file)) for (const what of photoSourceFaults(readFileSync(file, "utf8"), credited)) faults.push(`${rel}: ${what}`);
}

console.log(`site-check: ${pages.length} pages (${stories} stories, ${facts} «الأرقام» boxes), ${links} links inside the site, ${images} images, ${stripRates} exchange rates in the market strip`);
if (!stripRates) faults.push("no exchange rate found in any page's market strip: the strip's markup changed and this check reads nothing");
if (faults.length) {
  console.log(`${faults.length} fault(s):`);
  for (const f of faults.slice(0, 60)) console.log(`  - ${f}`);
  if (faults.length > 60) console.log(`  … and ${faults.length - 60} more`);
  process.exit(1);
}
console.log("site-check: every page is Arabic right-to-left, titled and not empty; every link inside the site resolves; every image has alt text; every story shows its date and sources; every «الأرقام» box holds figures");
