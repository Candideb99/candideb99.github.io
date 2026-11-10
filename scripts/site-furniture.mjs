/**
 * The figures a story page prints outside their isolation (isolateNumbers() in src/lib/bidi.ts), read from its built
 * HTML: the «الأرقام» box's labels, a chart's legend, categories and table, and an Arabic source's title. Printed bare,
 * «2026-2031» drew «2031-2026», «(15-30 م³)» «30-15» and «12.7%» «%12.7» (2026-11-09). Used by site-check.mjs; a module
 * of its own so the self-test can read it on a sample page.
 */
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
