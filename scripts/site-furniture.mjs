/**
 * The figures a story page prints outside their isolation (isolateNumbers() in src/lib/bidi.ts), read from its built
 * HTML: the «الأرقام» box's labels, a chart's legend, categories and table, and an Arabic source's title. Printed bare,
 * «2026-2031» drew «2031-2026», «(15-30 م³)» «30-15» and «12.7%» «%12.7» (2026-11-09). Used by site-check.mjs; a module
 * of its own so the self-test can read it on a sample page.
 */
import { INDEX_MAX, RUNNING_DAYS } from "../src/lib/files-index.mjs";

/**
 * The faults of the parts a reader works with his pointer or finger (2026-11-16): a chart's note must have a line for
 * every category the drawing can be pointed at and a value for each from every series, a chart of several series a
 * switch per series, and a figure card of the front's «بالأرقام» three figures and a story printed nowhere else on
 * its page. Read from built HTML, as bareFigures() is.
 */
export function interactiveFaults(html) {
  const out = [];
  const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const m of html.matchAll(/<figure\b[^>]*\bdata-chart\b[^>]*>[\s\S]*?<\/figure>/g)) {
    const fig = m[0];
    const id = fig.match(/\bid="([^"]*)"/)?.[1] ?? "chart";
    let tips;
    try { tips = JSON.parse(unescape(fig.match(/\bdata-tips="([^"]*)"/)?.[1] ?? "")); } catch { tips = null; }
    if (!tips || !Array.isArray(tips.cats) || !Array.isArray(tips.series)) { out.push(`chart #${id}: its note's text (data-tips) does not parse`); continue; }
    const targets = (fig.match(/class="(?:chart__hit|hbars__row)"/g) ?? []).length;
    if (targets !== tips.cats.length) out.push(`chart #${id}: ${tips.cats.length} categories in its note, ${targets} to point at`);
    if (tips.series.some((s) => !Array.isArray(s.values) || s.values.length !== tips.cats.length)) out.push(`chart #${id}: a series without a value for every category`);
    const keys = (fig.match(/<button\b[^>]*class="chart__key"/g) ?? []).length;
    if (tips.series.length > 1 && keys !== tips.series.length) out.push(`chart #${id}: ${tips.series.length} series, ${keys} switches in its legend`);
    if (!/class="chart__tip\b/.test(fig)) out.push(`chart #${id}: no note to show`);
  }
  // An instrument's price chart (PriceChart.astro): a close and a date for every session, and periods the record fills.
  for (const m of html.matchAll(/<section\b[^>]*\bdata-pchart\b[^>]*>/g)) {
    let series;
    try { series = JSON.parse(unescape(m[0].match(/\bdata-series="([^"]*)"/)?.[1] ?? "")); } catch { series = null; }
    if (!series || !Array.isArray(series.c) || !Array.isArray(series.d) || !Array.isArray(series.periods)) { out.push("price chart: its closes (data-series) do not parse"); continue; }
    if (series.c.length < 2 || series.c.length !== series.d.length) out.push(`price chart: ${series.c.length} closes for ${series.d.length} dates`);
    if (!series.periods.length || series.periods.some((p) => !(p.sessions >= 2 && p.sessions <= series.c.length))) out.push("price chart: a period the record does not fill");
  }
  // The moving market strip prints every instrument exactly twice, once for the eye only, or its loop shows a seam.
  for (const m of html.matchAll(/<div\b[^>]*class="markets-wrap markets-wrap--moving"[^>]*>[\s\S]*?<\/ul>/g)) {
    const ids = [...m[0].matchAll(/<li class="markets__item"[^>]*data-id="([^"]+)"([^>]*)>/g)];
    const shown = ids.filter((x) => !/aria-hidden="true"/.test(x[0])).map((x) => x[1]);
    const copy = ids.filter((x) => /aria-hidden="true"/.test(x[0])).map((x) => x[1]);
    if (!shown.length || shown.join() !== copy.join()) out.push(`moving market strip: ${shown.length} items and ${copy.length} in its second printing`);
  }
  for (const m of html.matchAll(/<li\b[^>]*class="figcard"[^>]*>([\s\S]*?)<\/li>/g)) {
    const href = m[1].match(/<a\b[^>]*\bhref="([^"]+)"/)?.[1] ?? "";
    const facts = (m[1].match(/class="figcard__fact"/g) ?? []).length;
    if (facts !== 3) out.push(`figure card ${href}: ${facts} figures, not three`);
    // Among the page's stories: the section bar's panels list headlines too, as navigation (the first gate run counted
    // an analysis three times, twice in the menus).
    const stories = html.match(/<main\b[\s\S]*<\/main>/)?.[0] ?? html;
    const printed = stories.split(`href="${href}"`).length - 1;
    if (!href || printed !== 1) out.push(`figure card ${href || "(no link)"}: its story is printed ${printed} times on the page`);
  }
  return out;
}

/**
 * What a reader meets broken in a sentence or a sum (2026-11-20, the owner's two questions of that night): a summary on
 * a card, the cover or the digest cut off with «…» (every dek is one whole sentence; dek() in src/lib/format.ts prints
 * it whole), and an explainer's worked sum printed as one left-to-right run, the mirror of its formula in words above it
 * (WorkedExample.astro: each figure is isolated, the sum reads from the right). Read from built HTML.
 */
export function readingFaults(html) {
  const out = [];
  const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  for (const m of html.matchAll(/<p class="(cover__dek|cover__reading-dek|digest__text|card__summary)"[^>]*>([\s\S]*?)<\/p>/g)) {
    if (/(?:…|\.\.\.)$/.test(text(m[2]))) out.push(`a summary cut off with «…» (${m[1]}): «${text(m[2]).slice(-50)}»`);
  }
  // Arabic words set inside a left-to-right run read backwards from the right: a chart table's «29.9 مليار درهم» read
  // «مليار درهم 29.9» (2026-11-20). An isolation holds a figure or a Latin run, never Arabic letters («٪» is a sign).
  for (const m of html.matchAll(/<bdi dir="ltr"[^>]*>([^<]*[ء-ي][^<]*)<\/bdi>/g)) out.push(`Arabic words inside a left-to-right isolation: «${m[1].trim().slice(0, 50)}»`);
  for (const m of html.matchAll(/<p class="worked__working"[^>]*>([\s\S]*?)<\/p>/g)) {
    for (const run of m[1].matchAll(/<bdi dir="ltr"[^>]*>([\s\S]*?)<\/bdi>/g)) {
      if (/[=÷×]/.test(run[1])) out.push(`a worked sum printed left to right as one run, the mirror of its formula: «${text(run[1])}»`);
      // A negative figure the sum works on stands in brackets (2026-11-21, the owner on the Card–Krueger piece's
      // «−1 − −1 = 0»): bare, its sign met the operator's. Only the result, after «=», keeps its sign bare.
      const before = text(m[1].slice(0, run.index));
      if (/^[−\-]/.test(text(run[1])) && !/[(=]$/.test(before)) out.push(`a negative figure in a worked sum without its brackets: «${text(m[1])}»`);
    }
  }
  return out;
}

/**
 * A card's label that leads to the page the card is printed on (2026-11-20): on the analysis section's page every
 * card's «تحليل الطاقة» or «حصاد الأسبوع» led back to /analysis/, where the reader already was, never to the desk's
 * or the series' own page (readingHref(), src/lib/analysis.ts). `path` is the page's own address, «/analysis/».
 */
export function selfLabelLinks(html, path) {
  const out = [];
  for (const m of html.matchAll(/<p class="meta card__meta"[^>]*>([\s\S]*?)<\/p>/g)) {
    for (const a of m[1].matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
      if (a[1] === path) out.push(`a card's label «${a[2].trim()}» leads to the page it is printed on`);
    }
  }
  return out;
}

/**
 * A page head's row of links and the sentence above it (2026-11-20, the owner: "check the section pages design and
 * organization too"). Two names with nothing between them run together (the topic and desk pages' own copies of the row
 * had no dot; LinkRow.astro prints one), and a news section's sentence named its sub-topics, which the row under it
 * names again («الذكاء الاصطناعي والرقائق ومراكز البيانات…» over «الذكاء الاصطناعي · الرقائق ومراكز البيانات · …»):
 * three of the row's names, and at least half of them, in the sentence above it is the row said twice.
 */
export function pageHeadFaults(html) {
  const out = [];
  const stem = (w) => w.replace(/[^ء-ي]/g, "").replace(/^و(?=ال)/, "").replace(/^ال/, "");
  for (const head of html.matchAll(/<header class="page-head(?: [^"]*)?"[^>]*>([\s\S]*?)<\/header>/g)) {
    const intro = head[1].match(/<p class="page-intro"[^>]*>([\s\S]*?)<\/p>/);
    const said = new Set((intro?.[1] ?? "").replace(/<[^>]+>/g, " ").split(/\s+/).map(stem).filter(Boolean));
    for (const row of head[1].matchAll(/<p class="page-head__topics[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
      const names = [...row[1].matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map((a) => a[1].trim());
      const between = row[1].split(/<a\b[^>]*>[^<]*<\/a>/).slice(1, -1);
      if (between.some((s) => !s.replace(/<[^>]+>/g, "").trim())) out.push(`names run together in a page head's row: «${names.slice(0, 3).join(" ")}»`);
      // A dot must close the item of the name before it: as an item of its own it wrapped to open a line (LinkRow.astro).
      const dots = row[1].match(/class="page-head__sep"/g)?.length ?? 0;
      const held = row[1].match(/<\/a><span class="page-head__sep"[^>]*>[^<]*<\/span><\/span>/g)?.length ?? 0;
      if (dots > held) out.push(`a dot in a page head's row stands apart from the name before it, so it can open a line: «${names.slice(0, 3).join(" · ")}»`);
      const repeated = names.filter((n) => said.has(stem(n.split(/\s+/)[0])));
      if (repeated.length >= 3 && repeated.length * 2 >= names.length) out.push(`the sentence over a page head's row names the row again: ${repeated.join("، ")}`);
    }
  }
  return out;
}

/**
 * The foot of an article page (2026-11-20, the owner: "check the article pages design and organization too"): a story
 * the piece cites as its source printed again in «اقرأ أيضاً» (the line in the text or the list beside it), «المزيد من …»
 * or the «آخر الأخبار» strip (53 of the 86 hub pieces built on our stories); «خازندار» as the source's name on a line
 * under «مواد ذات صلة في خازندار», the heading's own word (280 lines); and the note under the list calling a piece that is
 * not an explainer «هذا الشرح» (40 pages).
 */
export function articleFootFaults(html) {
  const out = [];
  // A rail with nothing in it still drew its rule down the page beside the text (21 short stories, the same night).
  if (/<aside class="article__side"[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*<\/aside>/.test(html)) out.push("an empty side column ruled beside the text");
  const sources = html.match(/<section class="sources"[\s\S]*?<\/section>/)?.[0];
  if (!sources) return out;
  const links = (s) => [...s.matchAll(/href="(\/articles\/[^"#?]+?)\/?"/g)].map((m) => m[1]);
  const cited = new Set(links(sources));
  const places = [
    ["«اقرأ أيضاً» in the text", /<aside class="also"[\s\S]*?<\/aside>/],
    ["«اقرأ أيضاً» beside the text", /<section class="side-related"[\s\S]*?<\/section>/],
    ["«المزيد من …»", /<section class="wrap--article article__more"[\s\S]*?<\/section>/],
    ["the «آخر الأخبار» strip", /<ul class="ticker__list"[\s\S]*?<\/ul>/],
  ];
  for (const [where, re] of places) {
    for (const href of links(html.match(re)?.[0] ?? "")) if (cited.has(href)) out.push(`a story the piece cites printed again in ${where}: ${href}/`);
  }
  if (sources.includes("مواد ذات صلة في خازندار")) {
    const named = (sources.match(/<span class="sources__name[^"]*"[^>]*>\s*خازندار\s*<\/span>/g) ?? []).length;
    if (named) out.push(`«خازندار» named as the source on ${named} line(s) under «مواد ذات صلة في خازندار»`);
  }
  const kind = html.match(/<p class="article__kind"[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").trim();
  if (kind && kind !== "شرح مبسّط" && /<p class="sources__note"[^>]*>[\s\S]*?هذا الشرح/.test(sources)) out.push(`the note under «${kind}» calls it «هذا الشرح»`);
  return out;
}

/**
 * A subject's page and the labels on any page (2026-11-20, the owner: "check the topic pages design and organization
 * too"): a lead without a photograph while one of the next three stories carries one (9 of 24 subject pages; a section
 * page has led on a photographed story since 2026-11-10), an analysis labelled with the bare «تحليل» where its desk is
 * known (a card or an archive line), and an archive month after the newest printed open (النفط's ran a phone page to
 * 15,700px).
 */
export function topicPageFaults(html) {
  const out = [];
  const leadAt = html.search(/<div class="(?:topic-top__lead|section-page__lead)"/);
  if (leadAt >= 0) {
    const cards = [...html.slice(leadAt).matchAll(/<article class="card[\s\S]*?<\/article>/g)].map((m) => m[0]);
    if (cards.length > 1 && !/<img\b/.test(cards[0]) && cards.slice(1, 4).some((c) => /<img\b/.test(c))) out.push("a lead without a photograph while one of the next three stories carries one");
  }
  const bare = [...html.matchAll(/<p class="meta (?:card__meta|topic-month__meta)"[^>]*>([\s\S]*?)<\/p>/g)].filter((m) => /<a\b[^>]*>\s*تحليل\s*<\/a>/.test(m[1])).length;
  if (bare) out.push(`${bare} analysis label(s) reading the bare «تحليل», not the desk`);
  const months = [...html.matchAll(/<(section|details) class="topic-month"([^>]*)>/g)];
  const open = months.slice(1).filter((m) => m[1] === "section" || /\bopen\b/.test(m[2])).length;
  if (open) out.push(`${open} archive month(s) after the newest printed open`);
  return out;
}

/**
 * A file's page (2026-11-20, the owner: "check the file pages design and organization too"): a file of one story, the
 * story a reader came from by its chip (617 of 907 file pages), and a page of more than twenty stories («العالم» printed
 * its 363 on one, 1.1 MB). Files run in pages of twenty from two stories (src/pages/tags/[tag]/[...page].astro).
 */
export function filePageFaults(html) {
  const out = [];
  const items = (html.match(/<li class="thread__item"/g) ?? []).length;
  if (!items) return out;
  if (items > 20) out.push(`a file printing ${items} stories on one page`);
  if (items === 1 && !/<nav class="pager"/.test(html)) out.push("a file of one story");
  // A place is a desk, set out as a section's page (2026-11-21, the owner, of the Gulf's page: "is this the best
  // depiction for articles when clicking on regions?"): never the thread. And the thread names a day once: «20 نوفمبر»
  // had stood in the margin of row after row.
  if (/<section class="wrap block"[^>]*\bdata-place\b/.test(html)) out.push("a region's or a country's page printed as a file's thread");
  const days = [...html.matchAll(/<div class="thread__when[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => /<time[^>]*>([^<]*)<\/time>/.exec(m[1])?.[1].trim());
  const again = days.filter((d, i) => d && days.slice(0, i).includes(d)).length;
  if (again) out.push(`${again} thread row(s) naming a day the thread has already named`);
  return out;
}

/**
 * A count of stories in a page's own furniture (2026-11-21, the owner, of a region page's «ملف يجمع 266 مادة عن الخليج»:
 * "i do not think we really should mention how many articles are there, no?"): the sentence under a page's title and
 * the files index's cells and lists (39 counts on /tags/). The archive's bookkeeping, as on the front's region block
 * (18 November) and the sections' rows (20 November). A search's own count of results is not read here.
 */
export function countFaults(html) {
  const out = [];
  const COUNT = /(?:\d[\d,]*\s*(?:مادة|مواد)|مادتان|مادتين|مادة واحدة)(?![ء-ي])/;
  const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const m of html.matchAll(/<p class="page-intro"[^>]*>([\s\S]*?)<\/p>/g)) if (COUNT.test(strip(m[1]))) out.push("a count of stories in the sentence under a page's title");
  const lists = [...html.matchAll(/<(?:p class="files-index__count|ul class="(?:files-all__list|regions__list))[^>]*>([\s\S]*?)<\/(?:p|ul)>/g)];
  const counted = lists.filter((m) => COUNT.test(strip(m[1])) || /<bdi[^>]*>\s*\d+\s*<\/bdi>/.test(m[1])).length;
  if (counted) out.push(`${counted} cell(s) or list(s) of the files index printing a count of stories`);
  return out;
}

/**
 * The files index (2026-11-21, the owner: "what would happen after one year of running the website if this part still
 * exists?"): a bounded set of names, never every file. It had named all 244 files and grown by about 0.4 a story, and
 * its cells, ranked by size, could stand on files nothing had been added to for weeks. Faults: more names than
 * `INDEX_MAX` (src/lib/files-index.mjs), a file named twice, and a cell whose last update is more than the running window
 * older than the newest cell's.
 */
export function filesIndexFaults(html) {
  if (!/<div class="files-index"/.test(html)) return [];
  const out = [];
  const names = [];
  for (const m of html.matchAll(/<(?:h2 class="files-index__name"|ul class="files-all__list)[^>]*>([\s\S]*?)<\/(?:h2|ul)>/g)) {
    for (const a of m[1].matchAll(/<a href="\/tags\/([^"/]+)\/"/g)) names.push(decodeURIComponent(a[1]));
  }
  if (names.length > INDEX_MAX) out.push(`the files index names ${names.length} files (at most ${INDEX_MAX}): it grows with the archive`);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length) out.push(`the files index names ${[...new Set(twice)].join("، ")} twice`);
  const updated = [...html.matchAll(/<p class="files-index__count[^>]*>[\s\S]*?<time datetime="([^"]+)"/g)].map((m) => Date.parse(m[1]));
  const newest = Math.max(...updated);
  const stale = updated.filter((t) => newest - t > RUNNING_DAYS * 86_400_000).length;
  if (stale) out.push(`${stale} cell(s) of the files index on a file not written about in the ${RUNNING_DAYS} days before the newest cell`);
  return out;
}

/**
 * The front's figures (2026-11-21, the owner: "we have أرقام اليوم and بالأرقام, is this redundancy?"): one module of
 * figures at a time. The list in the side column and the band of cards under the first screen had both run on a wide
 * screen whenever the band did.
 */
export function figureModuleFaults(html) {
  return /id="figures-head"/.test(html) && /id="figcards-head"/.test(html) ? ["«أرقام اليوم» and «بالأرقام» on one page: two modules of figures"] : [];
}

/**
 * The latest page (2026-11-20, the owner: "check the latest news page design and organization too"): a line under a
 * day's head prints its hour («14:29»), never its date again («21 أكتوبر 2026» under «الأربعاء 21 أكتوبر 2026», on every
 * line of the older pages) or its age («منذ يوم» under a head naming the day).
 */
export function latestPageFaults(html) {
  const out = [];
  let lines = 0;
  for (const day of html.matchAll(/<section class="latest__day"[\s\S]*?<\/section>/g)) {
    for (const t of day[0].matchAll(/<p class="meta card__meta"[^>]*>[\s\S]*?<time[^>]*>([^<]*)<\/time>/g)) if (!/^\d{2}:\d{2}$/.test(t[1].trim())) lines++;
  }
  if (lines) out.push(`${lines} line(s) under a day's head printing a date or an age, not the hour`);
  return out;
}

/**
 * The agenda (2026-11-20, the owner: "check the agenda page design and organization too"): an event's note said again
 * under a later event (the PCE measure three times, the Gulf pegs twice). A note is longer than an institution's name
 * alone, which a release prints each time, so only a line past 40 characters counts.
 */
export function agendaFaults(html) {
  const seen = new Set();
  const repeated = new Set();
  for (const m of html.matchAll(/<p class="event__meta[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text.length <= 40) continue;
    if (seen.has(text)) repeated.add(text);
    seen.add(text);
  }
  return [...repeated].map((t) => `an agenda note said again: «${t.slice(0, 60)}»`);
}

/**
 * The markets board (2026-11-20, the owner: "check the markets board page design and organization too"): an instrument
 * printed twice on the board (its six headline cards repeated six rows of its tables, the two Arab indices twice in a row
 * on a phone), and an instrument page's closes whose oldest row has no move though the record holds the session before.
 */
export function boardFaults(html) {
  const out = [];
  const board = html.match(/<section class="wrap block" id="board"[\s\S]*?<\/section>\s*<\/main>|<section class="wrap block" id="board"[\s\S]*$/)?.[0];
  if (board) {
    const groups = board.split(/<section class="news"/)[0];
    const ids = [...groups.matchAll(/href="\/markets\/data\/([a-z0-9-]+)\/"/g)].map((m) => m[1]);
    const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (twice.length) out.push(`instruments printed twice on the board: ${twice.join(", ")}`);
  }
  const closes = html.match(/<table class="closes[^"]*"[\s\S]*?<\/table>/)?.[0];
  if (closes) {
    const rows = [...closes.matchAll(/<tbody[^>]*>[\s\S]*?<\/tbody>/g)][0]?.[0].match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    const sessions = Number(html.match(/data-stat="sessions"[^>]*>(\d+)</)?.[1] ?? 0);
    if (rows.length >= 22 && /<td[^>]*>\s*—\s*<\/td>\s*<\/tr>$/.test(rows.at(-1)) && sessions > rows.length) out.push("the oldest close has no move though the record holds the session before it");
  }
  return out;
}

/** The photo libraries a credit can name, as the captions print them. */
export const PHOTO_LIBRARIES = ["ويكيميديا كومنز", "بيكسلز", "فليكر", "أوبن فيرس", "أنسبلاش"];

/** Where an article's photograph comes from, read from its caption: a library, or its own source (a handout). */
export function photoCredit(html) {
  const credit = html.match(/<span class="article__credit"[^>]*>([\s\S]*?)<\/span>\s*<\/figcaption>/)?.[1];
  if (!credit) return null;
  const text = credit.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return PHOTO_LIBRARIES.find((lib) => text.includes(lib)) ?? "handout";
}

/**
 * The pages that say where the photographs come from (2026-11-20, the owner: "check the about page design and
 * organization too"): the about and methodology pages named Wikimedia Commons and Flickr, the methodology Creative
 * Commons licences only, while Pexels gave 149 of the 577 published photographs and the stories' own sources 14. Each
 * library the published credits name must be named on the page, and the handouts when any run.
 */
export function photoSourceFaults(pageHtml, credited) {
  const text = pageHtml.replace(/<[^>]+>/g, " ");
  const out = [];
  for (const source of credited) {
    if (source === "handout") { if (!/صاحبة الخبر|صاحبة الأخبار/.test(text)) out.push("published photographs come from the stories' own sources, which the page does not say"); }
    else if (!text.includes(source)) out.push(`published photographs come from «${source}», which the page does not name`);
  }
  return out;
}

export function bareFigures(html) {
  const furniture = [
    ...html.matchAll(/<dt class="facts__label"[^>]*>([\s\S]*?)<\/dt>/g),
    ...html.matchAll(/<ul class="chart__legend[^"]*"[^>]*>([\s\S]*?)<\/ul>/g),
    ...html.matchAll(/<ol class="chart__cats"[^>]*>([\s\S]*?)<\/ol>/g),
    ...html.matchAll(/<details class="chart__data"[^>]*>([\s\S]*?)<\/details>/g),
    // To the title's own end, before the host: the first «</span>» could be a held word's inside an isolation
    // («<bdi dir="ltr"><span class="nb">10-year</span></bdi>»), which left the isolation unclosed and its figure
    // "bare" (a review of 2026-11-10).
    ...[...html.matchAll(/<(?:a|span) class="sources__title"[^>]*>([\s\S]*?)<\/(?:a|span)>\s*<span class="sources__host/g)].filter((m) => /[؀-ۿ]/.test(m[1])),
  ];
  const out = [];
  for (const m of furniture) {
    const bare = m[1].replace(/<bdi dir="ltr"[^>]*>[\s\S]*?<\/bdi>/g, "").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ");
    if (/\d/.test(bare)) out.push(m[1].replace(/<[^>]+>/g, "").trim().slice(0, 60));
  }
  return out;
}
