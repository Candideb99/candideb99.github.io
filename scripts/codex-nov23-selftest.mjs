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

// Codex's fourth review of the same day: the reports desk, corrections, market data, the calendar, place pages.
{
  const { pressRelease, reportExcerpts } = await import("../pipeline/lib/reports.mjs");
  const { parseBls, buildCalendar } = await import("../pipeline/lib/calendar.mjs");
  const { mergeHistory, INSTRUMENTS, DAILY_HISTORY } = await import("../pipeline/lib/quotes.mjs");
  const base = "https://www.worldbank.org/en/research/commodity-markets";
  const links = `<html><body><a href="/en/news/press-release/2026/10/02/peru-hospital-network-financing">Press release: Peru hospital network</a><a href="/en/news/press-release/2026/10/28/commodity-markets-outlook-october-2026">Press release: Commodity Markets Outlook</a></body></html>`;
  check("a report's press release is the one that names the report, not the first of the year on its page",
    [pressRelease(links, base, { key: 202610 }, "Commodity Markets Outlook"), pressRelease(links, base, { key: 202610 }, "Global Wealth Report"), pressRelease(links, base, { key: 202610 })],
    ["https://www.worldbank.org/en/news/press-release/2026/10/28/commodity-markets-outlook-october-2026", null, "https://www.worldbank.org/en/news/press-release/2026/10/02/peru-hospital-network-financing"]);
  const finding = "Key findings\n" + "Global wealth grew 4.6% in 2025, led by North America, while the Gulf's grew faster than Europe's. ".repeat(8);
  const pages = [finding, "Contents\nMethodology ..... 3\nAppendix ..... 4", "Methodology\n" + "The sample covers 56 markets and uses household balance sheets. ".repeat(10), "Appendix\n" + "Tables of the data by market follow in this appendix section. ".repeat(10)];
  check("a report that opens on its key findings gives them to the writer; a cover is still passed over",
    [JSON.stringify(reportExcerpts(pages)).includes("Global wealth grew 4.6%"), JSON.stringify(reportExcerpts(["Global Wealth Report 2026", ...pages.slice(1)])).includes("Global Wealth Report 2026")],
    [true, false]);

  const bls = { org: "BLS", local: "08:30", zone: "America/New_York", url: "https://www.bls.gov/x", title: (ref) => `t ${ref}`, short: (ref) => `s ${ref}` };
  const table = `<table class="release-list"><tr><td>November 2026</td><td>Dec. 10, 2026</td><td>08:30 AM</td></tr><tr><td>December 2026</td><td>Jan. 13, 2027</td><td>10:00 AM</td></tr><tr><td>January 2027</td><td>Feb. 10, 2027</td><td>TBD</td></tr></table>`;
  check("a release takes the hour its schedule prints, and none where the schedule says it is to be decided",
    parseBls(table, bls).map((e) => e.time ?? null), ["13:30 UTC", "15:00 UTC", null]);

  const bea = { id: "bea", org: "o", what: "w", url: "u" };
  const stored = { updatedAt: "2026-11-20T00:00:00Z", sources: [{ id: "bea", readAt: "2026-11-20T00:00:00Z" }], events: [{ source: "bea", date: "2026-12-05", title: "a" }, { source: "bea", date: "2027-01-28", title: "b" }, { source: "bea", date: "2027-03-25", title: "c" }] };
  const now = Date.parse("2026-11-23T12:00:00Z");
  const partial = Object.assign([{ date: "2026-12-05", title: "a" }, { date: "2026-12-19", title: "new" }], { partial: true });
  const whole = [{ date: "2026-12-05", title: "a" }, { date: "2026-12-19", title: "new" }];
  const dates = (events) => buildCalendar(stored, new Map([["bea", { events }]]), now, [bea]).events.map((e) => e.date);
  check("a reading that missed one of a source's pages keeps the stored dates beyond its reach; a whole reading replaces them",
    [dates(partial), dates(whole)], [["2026-12-05", "2026-12-19", "2027-01-28", "2027-03-25"], ["2026-12-05", "2026-12-19"]]);

  const days = Array.from({ length: 400 }, (_, i) => ({ d: new Date(Date.UTC(2025, 9, 1) + i * 86400000).toISOString().slice(0, 10), c: 60000 + i }));
  check("a market that closes every day keeps a year of days", [mergeHistory(INSTRUMENTS.find((i) => i.id === "btc"), days, [], null).length, DAILY_HISTORY], [365, 365]);
  check("a price older than the board's record is refused as stale", [source("pipeline/markets.mjs").includes("if (newest && raw.session && raw.session < newest) throw new Error(`stale quote:")], [true]);

  const fix = source("pipeline/correct.mjs");
  check("the corrections editor reads a story's sources as the fact-check does, refuses an answer that changes nothing, and a language fix moves no figure and no chart",
    [fix.includes("const read = await loadSources({ slug, sources: story.sources ?? [] }"), fix.includes('if (!diff.length && !problems.length) problems.push("nothing was changed");'), fix.includes('problems.push("a language fix changed the order of the figures")'), fix.includes('problems.push("a language fix touched the table or the chart")'), /if \(!s\.url \|\| s\.url\.startsWith\("\/"\)\) continue;/.test(fix)],
    [true, true, true, true, false]);
  const look = source("pipeline/recheck.mjs");
  check("the second look reads an unread story again, reopens a correction that came back in no report, and counts the second pass's calls",
    [look.includes('const retryUnread = (e) => e.outcome === "unverifiable" && (e.unread ?? 1) < MAX_FAILURES && hoursSince(e.at) >= 12;'), look.includes('entry.reason = "the corrections editor wrote no report for it";'), look.includes("editorCalls += second.filter((i) => i.model).length;")],
    [true, true, true]);
  check("the region balance never takes the place of the story the section balance brought in", [source("pipeline/run.mjs").includes("chosen.filter((s) => !arabWorld(s.regions) && !balanced.has(s))")], [true]);
  check("a city's page stands under its desk, and an instrument's newest row says it is its latest price",
    [source("src/pages/tags/[tag]/[...page].astro").includes("deskOf(name) ?? DESKS.find((d) => d.name === groundedRegions([], { title: name })[0]) ?? DESKS.find((d) => d.id === \"world\")"), source("src/pages/markets/data/[id].astro").includes("const latest = !q.endOfDay && Boolean(q.time) && closes[0]?.d >= String(q.time).slice(0, 10);")],
    [true, true]);
}

// Codex's fifth review of the same day: the reader's controls, the search, the lesson's sums and a photograph's year.
{
  const { normalizeWorked, normalizeDiagram } = await import("../pipeline/lib/lesson.mjs");
  const worked = (a, b) => normalizeWorked({ op: "share", title: "t", formula: "f", result: { label: "الحصة" }, terms: [{ label: "أ", value: a[0], unit: a[1] }, { label: "ب", value: b[0], unit: b[1] }] })?.result.value;
  check("a share of two amounts written on two scales is computed on one", [worked([500, "مليون دولار"], [2, "مليار دولار"]), worked([22.5, "مليار دولار"], [57.5, "مليار دولار"])], [25, 39.1]);
  const crossing = normalizeDiagram({ type: "schedule", title: "t", caption: "c", price: "السعر", quantity: "الكمية", hypothetical: true, rows: [{ price: 1, demand: 6, supply: 2 }, { price: 2, demand: 2, supply: 6 }, { price: 3, demand: 1, supply: 8 }] });
  check("a schedule's equilibrium is where its lines cross, not the nearest whole price", crossing?.equilibrium, { price: 1.5, quantity: 4 });
  const { selectIdea } = await import("../pipeline/lib/select.mjs");
  const recent = [{ title: "الذهب يسجل خسارة أسبوعية ثانية مع صعود الدولار", lede: "l" }, { title: "هيئة السوق السعودية تلزم الشركات المدرجة بمناقشة نتائجها علناً", lede: "l" }];
  const idea = { id: "lemons", idea: "i", field: "micro", pegs: "p", economists: [{ en: "George Akerlof" }], year: 1970, work: "w" };
  const pegged = async (peg) => {
    try {
      const out = await selectIdea({ candidates: [idea], recentArticles: recent, log: () => {}, chatWith: async ({ validate }) => { const data = { id: "lemons", question_ar: "سؤال؟", peg_titles: [peg] }; validate(data); return { data, model: "stand-in" }; } });
      return out.related.map((a) => a.title);
    } catch (error) {
      return String(error.message).split("\n")[0];
    }
  };
  check("two letters name no story; a headline by its whole or by a long opening does",
    [await pegged("ال"), await pegged(recent[1].title), await pegged("هيئة السوق السعودية تلزم الشركات المدرجة بمناقشة")],
    ["peg_titles names no story of the list", [recent[1].title], [recent[1].title]]);
  check("a photograph's record dated before 1900 is its year", [source("pipeline/lib/commons.mjs").includes("const year = text.match(/(?<!\\d)((?:1[5-9]|20)\\d\\d)(?!\\d)/);"), source("pipeline/lib/images.mjs").includes('const fromDate = String(image.date ?? "").match(/(?<!\\d)((?:1[5-9]|20)\\d\\d)(?!\\d)/)?.[1];')], [true, true]);

  const mast = source("src/components/Masthead.astro");
  check("the phone bar fades its end, and the phone menu scrolls inside a short screen", [mast.includes("mask-image: linear-gradient(to right, transparent, #000 2.5rem); }"), mast.includes("max-block-size: calc(100dvh - 3.75rem); overflow-y: auto;")], [true, true]);
  const chart = source("src/components/Chart.astro");
  check("a line chart keeps its note, and its end labels are set apart", [chart.includes('const plain = chart.series.length === 1 && chart.type !== "line" && (horizontal || showValueLabels);'), chart.includes("y={endLabelY.get(si) ?? last[1]}")], [true, true]);
  const pchart = source("src/components/PriceChart.astro");
  check("an instrument's closes are walked with the arrow keys", [pchart.includes('<div class="pchart__plot" tabindex="0"'), pchart.includes("const step = { ArrowLeft: -1, ArrowRight: 1, Home: -last, End: last }[e.key];")], [true, true]);
  check("a printed story opens its sources, the moving line heeds a change of motion setting, and the copy button keeps its own words",
    [source("src/components/Sources.astro").includes('window.addEventListener("beforeprint"'), source("src/components/Marquee.astro").includes('calm.addEventListener("change"'), source("src/components/Share.astro").includes("clearTimeout(back);")], [true, true, true]);
  const search = source("src/pages/search.astro");
  check("a search whose results do not arrive says so, and a list that did not arrive is asked for again", [search.includes('say("تعذّر تحميل النتائج. تحقق من الاتصال وحاول مرة أخرى.");'), search.includes(".catch(function () { return new Map(); });"), search.includes("PAGES = new Map(); return PAGES; })")], [true, true, false]);
}

// Codex's sixth review of the same day.
{
  const { periodsFor } = await import("../src/lib/price-chart.mjs");
  check("a record a few closes longer than its last period draws them all in that period", [70, 66, 72, 27].map((n) => periodsFor(n).map((p) => p.id + ":" + p.sessions).join(" ")), ["m1:22 m3:70", "m1:22 m3:66", "m1:22 m3:66 all:72", "m1:27"]);
  check("the text size back at the house size is no size of the reader's own, and a search of passing mentions alone is headed as one",
    [source("src/components/TextSize.astro").includes('if (px === base) document.documentElement.style.removeProperty("--reader-size");'), source("src/pages/search.astro").includes("var label = e.passing && (at === 0 || !entries[at - 1].passing) ?")], [true, true]);
}

if (failed) {
  console.log(`\n${failed} case(s) failed.`);
  process.exit(1);
}
console.log("\nCodex's third review of 23 November: every case holds.");
