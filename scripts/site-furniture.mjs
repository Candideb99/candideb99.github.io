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
