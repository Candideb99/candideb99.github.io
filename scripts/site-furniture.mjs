/**
 * The figures a story page prints outside their isolation (isolateNumbers() in src/lib/bidi.ts), read from its built
 * HTML: the «الأرقام» box's labels, a chart's legend, categories and table, and an Arabic source's title. Printed bare,
 * «2026-2031» drew «2031-2026», «(15-30 م³)» «30-15» and «12.7%» «%12.7» (2026-11-09). Used by site-check.mjs; a module
 * of its own so the self-test can read it on a sample page.
 */
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
