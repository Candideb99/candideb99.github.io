/**
 * Which news stories an instrument's own page lists (src/pages/markets/data/[id].astro): those whose headline names it as
 * a whole word, two or more, or the module is left out. Plain JavaScript with no imports, so the self-test reads it.
 *
 * The names a headline uses (2026-11-20, the owner: "check the instrument pages design and organization too"): the page
 * matched the board's own name only, and the newsroom names the two Arab indices by their markets, «الأسهم السعودية»
 * (3 headlines) and «البورصة المصرية» (6), never «تاسي» or «إيجي إكس 30», so neither page listed a story; the Nikkei is
 * «نيكي» in one headline and «نيكاي» in another; bitcoin «بتكوين» beside «بيتكوين». The owner chose «نيكاي» and «بيتكوين»
 * the same night (the spelling table and the board write them); the old forms stay here for the stories written before.
 * Each name here means the
 * instrument and nothing else in a headline: never «اليورو» (the euro area's «منطقة اليورو» is not the euro's page's
 * news), never «السوق السعودية» (a company that «تدخل السوق السعودية» is entering a market, not moving an index), never
 * «ستاندرد آند بورز» without its 500 (the rating agency).
 */
export const NEWS_NAMES = {
  tasi: ["الأسهم السعودية", "السوق الرئيسية السعودية"],
  egx30: ["البورصة المصرية", "الأسهم المصرية"],
  spx: ["إس آند بي 500"],
  n225: ["نيكي"],
  btc: ["بتكوين"],
  wti: ["الخام الأمريكي"],
  usdegp: ["الجنيه المصري"],
  usdtry: ["الليرة التركية"],
  usdcny: ["اليوان"],
  usdinr: ["الروبية الهندية"],
  usdjpy: ["الين"],
  gbpusd: ["الجنيه الإسترليني", "الإسترليني"],
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The names a headline may give an instrument: the board's name and short name, and the newsroom's. */
export function headlineNames(q) {
  return [...new Set([q.name, q.short, ...(NEWS_NAMES[q.id] ?? [])])].filter((n) => typeof n === "string" && n.length >= 3);
}

/** A test of a headline for any of the names, as a whole word with a clinging و، ب، ل، ف، ك or the article. */
export function namesInHeadline(names) {
  const re = new RegExp(`(?:^|[\\s«(،])(?:[وبلفك]|ال|لل)?(?:${names.map(escape).join("|")})(?=$|[\\s»)،.:؛])`);
  return (title) => re.test(String(title ?? ""));
}
