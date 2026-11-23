/**
 * Codex's third review of 2026-11-23: thirteen faults in gathering, figures, photographs and the site's search. No
 * network and no model. The page reader, the credit reader and the evidence collector run on their cases and fail on
 * the code before; the rest are held by their source lines.
 */
import { readFileSync } from "node:fs";
import { photosOf, readArticleHtml, subscribersOnly } from "../pipeline/lib/extract.mjs";
import { creditedBody } from "../pipeline/lib/images.mjs";
import { collectNewsEvidence } from "../pipeline/lib/news-evidence.mjs";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
}
const source = (file) => readFileSync(file, "utf8");
const ld = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const page = "https://news.example.com/economy/tram-line-opens";

// 2. The subscribers-only mark is the page's own article's.
const free = { "@type": "NewsArticle", headline: "Tram line opens", url: page };
const premium = { "@type": "NewsArticle", headline: "Premium analysis", url: "https://news.example.com/premium/analysis", isAccessibleForFree: false };
check("a premium story among a free article's recommendations does not close the article; the article's own mark does, with or without its address, and so does a part of it",
  [
    subscribersOnly(ld(free) + ld({ "@type": "ItemList", itemListElement: [premium] }), page),
    subscribersOnly(ld({ ...free, isAccessibleForFree: false }), page),
    subscribersOnly(ld({ "@type": "NewsArticle", headline: "x", isAccessibleForFree: "False" }), page),
    subscribersOnly(ld({ ...free, hasPart: { "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: ".paywall" } }), page),
    subscribersOnly(`<script type="application/ld+json">{"isAccessibleForFree": false, broken</script>`, page),
    subscribersOnly(`<meta itemprop="isAccessibleForFree" content="false">`, page),
    subscribersOnly(ld(free), page),
  ],
  [false, true, true, true, true, true, false]);

// 7. Two photographs told apart by a number after «?» are two; one photograph at two sizes is one.
const figures = `<html><body><article>
<figure><img src="/image.php?id=41&w=640" alt="Tokyo trading floor"><figcaption>Traders in Tokyo</figcaption></figure>
<figure><img src="/image.php?id=42&w=640" alt="Minister opens plant"><figcaption>The minister at the plant (Ministry of Energy)</figcaption></figure>
<figure><img src="/photos/port.jpg?w=1280&q=80" alt="Port"><figcaption>The port</figcaption></figure>
<figure><img src="/photos/port.jpg?w=640" alt="Port"><figcaption>The port</figcaption></figure>
</article></body></html>`;
const photos = photosOf(figures, page);
check("a photograph is its address less what only sizes it", [photos.length, photos.map((p) => new URL(p.url).search.includes("id=41") ? "floor" : new URL(p.url).search.includes("id=42") ? "plant" : "port"), photos[0].caption.includes("minister"), photos[1].caption.includes("Tokyo")],
  [3, ["floor", "plant", "port"], false, false]);

// 11. A lead photograph's address is made whole.
const body = "<p>" + "The tram line opened on Monday after four years of work, the transport authority said. ".repeat(12) + "</p>";
const read = readArticleHtml(`<html lang="en"><head><title>Tram line opens</title><meta property="og:image" content="/photos/trams.jpg"></head><body><article><h1>Tram line opens</h1>${body}</article></body></html>`, page);
check("a relative lead photograph is given whole", read.ogImage, "https://news.example.com/photos/trams.jpg");
// 10. The photographs are read from the page as trimmed of its appended stories.
check("the photographs are read from the trimmed page", [source("pipeline/lib/extract.mjs").includes("photos: photosOf(pageHtml, url, document),")], [true]);

// 8. A credit that holds the body alone.
check("the page's own credit for a photograph is a credit without «Photo:» before it; an empty one is none, and a written credit still reads",
  [creditedBody({ credit: "Ministry of Energy", caption: "The minister opens the plant" }), creditedBody({ credit: "", caption: "The minister opens the plant" }), creditedBody({ credit: "", caption: "الوزير خلال الافتتاح (وزارة البترول)" }), creditedBody({ credit: "Reuters | Jane Doe", caption: "" })],
  ["Ministry of Energy", "", "وزارة البترول", "Reuters"]);

// 9. Every verdict of the handout check is answered.
const images = source("pipeline/lib/images.mjs");
check("a handout's check must answer the watermark, the clarity and the front", [images.includes('for (const key of ["news_photo", "this_story", "watermark", "clear", "front"]) if (!d || typeof d[key] !== "boolean")')], [true]);

// 1. A linked official document is the story's only when its own title says so.
const item = { id: "m1", sourceId: "minewire", sourceName: "م", sourceNameEn: "Mine Wire", title: "Copper mine closure cuts output in Zambia", url: "https://minewire.example.com/copper-closure", lang: "en", reliability: 2, kind: "news", summary: "s", publishedAt: new Date().toISOString() };
const survey = "https://www.federalreserve.gov/publications/2026-household-economics-report.htm";
const extract = async (url) => (url === survey
  ? { ok: true, title: "Survey of Household Economics and Decisionmaking", text: "Households reported their budgets. ".repeat(40), lang: "en" }
  : { ok: true, title: item.title, text: "The copper mine closed on Monday and output fell, the operator said. ".repeat(20), links: [{ url: survey, label: "background", context: "see the Federal Reserve survey of household economics for background" }], photos: [], ogImage: "" });
const gathered = await collectNewsEvidence({ ids: ["m1"] }, [item], { extract });
check("a document the reports link «for background» is no official source of the story when its own title is about something else", gathered.sources.map((s) => s.kind), ["news"]);

// 3. A chart is an extra.
const run = source("pipeline/run.mjs");
check("a graphics editor that fails leaves the piece without a chart, in all three places it is asked", [(run.match(/const dataChart = await chartFor\(draft\);/g) ?? []).length, run.includes("the piece goes on without one"), /await pickDataChart\(\{ draft, log \}\)\)\.chart/.test(run)], [3, true, true]);

// 4, 5, 6. Figures.
check("a missing observation is no zero, in the official data and in the writer's chart", [source("pipeline/lib/datacharts.mjs").includes('value != null && value !== "" && Number.isFinite(+value)'), source("pipeline/lib/write.mjs").includes("if (value == null || !String(value).trim()) return null;")], [true, true]);
check("an inflation chart that says it is the annual rate is not sent back as monthly", [source("pipeline/lib/verify.mjs").includes("if (/تضخم/.test(about) && !annual && values.length && values.every((v) => Math.abs(v) < 1.5)) {")], [true]);
const fmt = (v, all) => { let d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2; while (d < 2 && all.some((o) => o !== v && o.toFixed(d) === v.toFixed(d))) d += 1; return v.toLocaleString("en-US", { maximumFractionDigits: d }); };
check("two different values of a chart never print alike", [[10.14, 10.06, 7.5].map((v, _, all) => fmt(v, all)), [10.14, 12.3].map((v, _, all) => fmt(v, all)), source("src/components/Chart.astro").includes("while (decimals < 2 && all.some((o) => o !== v && o.toFixed(decimals) === v.toFixed(decimals))) decimals += 1;")],
  [["10.14", "10.06", "7.5"], ["10.1", "12.3"], true]);

// 12, 13. The site's search.
check("the search reads neither the standing note under the sources nor the second copy of the fact box",
  [source("src/components/Sources.astro").includes('<p class="sources__note" data-pagefind-ignore>'), source("src/components/KeyFacts.astro").includes('data-pagefind-ignore={placement === "side" ? "" : undefined}')], [true, true]);

if (failed) {
  console.log(`\n${failed} case(s) failed.`);
  process.exit(1);
}
console.log("\nCodex's third review of 23 November: every case holds.");
