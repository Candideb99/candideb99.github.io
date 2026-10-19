/**
 * The latest price of what a story is about (the owner, 2026-10-19: "build 1 and 2", after three of the day's stories were
 * read beside الشرق بلومبرغ, Reuters and the Financial Times on the same events). The oil story of that morning printed WTI
 * at 02:27 GMT, published at 05:14, while Reuters had updated to 06:19. `marketData()` reads the delayed quotes
 * (lib/quotes.mjs, the market board's own feed) of the instruments the story is about, just before it is written, as one
 * source carrying each price's time. It is context, never an outlet for the two-origin rule (news-evidence.mjs), and the
 * second look reads it only as it stood at publication (lib/factcheck.mjs).
 *
 * Withdrawn the same day, before it shipped: handing the writer our own earlier stories on the same subject (item 1).
 * The owner asked whether old stories would make the writer hallucinate or give it too much to process. Measured on the
 * 40 newest stories, matching by shared headline words linked China's growth to Egypt's and Venezuela's oil to
 * Anthropic's losses; by tag words, 37 of 40 matched, mostly through «دولار» and «شركات»; by whole subject tags, about a
 * third of the matches were right (the Egyptian bourse to itself, Al Dar to Al Dar) and the rest were other subjects
 * (China's growth to Egypt's food exports). And the case that prompted it would not have been mended: our archive never
 * carried Anthropic's profitable quarter (it was reported during the outage of 1-17 October), while it did carry the
 * 2025 loss that pointed the writer the wrong way. A wrong match is an earlier event stitched into today's story.
 */
import { INSTRUMENTS, withChange, yahooQuote } from "./quotes.mjs";

/** The words that name each instrument in a headline or a report's title. */
const NAMES = {
  brent: /برنت|\bBrent\b/i,
  wti: /غرب تكساس|الخام الأمريكي|\bWTI\b|West Texas/i,
  natgas: /الغاز الطبيعي|هنري هب|natural gas|Henry Hub/i,
  gold: /(?<![؀-ۿ])(?:و|ف|ب|ل)?الذهب(?![؀-ۿ])|\bgold\b/i,
  silver: /(?<![؀-ۿ])(?:و|ف|ب|ل)?الفضة(?![؀-ۿ])|\bsilver\b/i,
  copper: /(?<![؀-ۿ])(?:و|ف|ب|ل)?النحاس(?![؀-ۿ])|\bcopper\b/i,
  wheat: /(?<![؀-ۿ])(?:و|ف|ب|ل)?القمح(?![؀-ۿ])|\bwheat\b/i,
  tasi: /تاسي|السوق السعودية|الأسهم السعودية|البورصة السعودية|\bTASI\b|Saudi (?:stocks|shares|bourse|index)/i,
  egx30: /البورصة المصرية|إيجي إكس|الأسهم المصرية|\bEGX ?30\b|Egyptian (?:stocks|shares|bourse|exchange)/i,
  // The index, never the rating agency: «ستاندرد آند بورز تثبّت تصنيف السعودية» is a rating, not a price.
  spx: /(?:ستاندرد آند بورز|إس آند بي) 500|S&P ?500/i,
  ndq: /ناسداك|\bNasdaq\b/i,
  dji: /داو جونز|\bDow\b/i,
  sx5e: /ستوكس|\bSTOXX\b/i,
  ftse: /فوتسي|\bFTSE\b/i,
  n225: /نيكاي|\bNikkei\b/i,
  sse: /شنغهاي المركب|Shanghai Composite/i,
  usdegp: /الجنيه المصري|Egyptian pound/i,
  usdtry: /الليرة التركية|Turkish lira/i,
  usdcny: /(?<![؀-ۿ])(?:و|ف|ب|ل)?اليوان(?![؀-ۿ])|\byuan\b|renminbi/i,
  usdjpy: /(?<![؀-ۿ])(?:و|ف|ب|ل)?الين(?![؀-ۿ])|\byen\b/i,
  dxy: /مؤشر الدولار|dollar index/i,
  // The yield, not the bonds: «الإمارات ترفع حيازتها من سندات الخزانة» is a holding, not a price.
  us10y: /عائد(?:ات)? (?:سندات الخزانة|السندات الأمريكية)|Treasury yields?/i,
  btc: /بتكوين|\bbitcoin\b/i,
};
/** A headline about a price, not one that merely names a commodity or a currency («استثمارات بـ40 مليار يورو»). */
const PRICE_WORDS = /سعر|أسعار|يرتفع|ترتفع|يتراجع|تتراجع|يقفز|تقفز|يهبط|تهبط|ينخفض|تنخفض|يصعد|تصعد|يربح|تربح|يخسر|تخسر|مكاسب|خسائر|خسارة|مستوى|عائد|صرف|يسجل|تسجل|يغلق|تغلق|ينهي|تنهي|\b(?:rise|rises|falls?|slips?|jumps?|drops?|gains?|surges?|tumbles?|climbs?|hits?|price|prices|yields?)\b/i;
const MARKET_SECTIONS = new Set(["markets", "energy"]);

/**
 * The market an economic release or a central-bank decision is read in (the owner's go, 2026-10-19, item 3 of the next
 * steps): Bloomberg and Reuters gave China's third-quarter growth with the yuan and the bond yield; ours had no market at
 * all. A forecast is not a release and fetches nothing.
 */
const MACRO = /الناتج المحلي|الناتج الإجمالي|نمو الاقتصاد|النمو الاقتصادي|الاقتصاد [؀-ۿ]+ (?:ينمو|ينكمش|يتسارع|يتباطأ)|(?<![؀-ۿ])(?:و|ل|ب)?التضخم(?![؀-ۿ])|أسعار المستهلكين|البطالة|الوظائف|مبيعات التجزئة|الإنتاج الصناعي|مديري المشتريات|الميزان التجاري|الفائض التجاري|العجز التجاري|(?<![؀-ۿ])(?:و|ل|ب)?الفائدة(?![؀-ۿ])/;
const FORECAST = /(?<![؀-ۿ])(?:يتوقع|تتوقع|يتوقعان|تتوقعان|يتوقعون|توقعات|يرجح|ترجح|يرجّح|ترجّح|يُرجّح|تُرجّح|يرجحان|يرجّحان|ترجحان|ترجّحان|يرجحون|يرجّحون)(?![؀-ۿ])/;
const MARKET_OF = [
  { place: /الصين|الصيني|بكين|بنك الشعب/, ids: ["sse", "usdcny"] },
  { place: /مصر|المصري|المصرية/, ids: ["egx30", "usdegp"] },
  { place: /السعودية|السعودي|ساما/, ids: ["tasi"] },
  { place: /الأمريكي|الأمريكية|الولايات المتحدة|الفيدرالي/, ids: ["spx", "us10y", "dxy"] },
  { place: /اليابان|الياباني|اليابانية/, ids: ["n225", "usdjpy"] },
  { place: /تركيا|التركي|التركية/, ids: ["usdtry"] },
  { place: /منطقة اليورو|المركزي الأوروبي|ألمانيا|الألماني|الألمانية/, ids: ["sx5e", "eurusd"] },
  { place: /بريطانيا|البريطاني|البريطانية|بنك إنجلترا/, ids: ["ftse", "gbpusd"] },
];
export function macroMarketOf(headline) {
  if (!MACRO.test(headline) || FORECAST.test(headline)) return [];
  return MARKET_OF.find((m) => m.place.test(headline))?.ids ?? [];
}

/** The instruments a story is about: named in its headline, or for a market or energy story in its reports' titles. */
export function instrumentsOf(story, sources = []) {
  const headline = String(story.headlineHint ?? "");
  const titles = sources.map((s) => s.title ?? "").join(" \n ");
  const macro = macroMarketOf(headline);
  const priced = MARKET_SECTIONS.has(story.section) || PRICE_WORDS.test(headline);
  if (!priced && !macro.length) return [];
  let ids = priced ? Object.keys(NAMES).filter((id) => NAMES[id].test(headline)) : [];
  if (!ids.length && macro.length) ids = macro;
  if (!ids.length && MARKET_SECTIONS.has(story.section) && PRICE_WORDS.test(titles)) ids = Object.keys(NAMES).filter((id) => NAMES[id].test(titles)).slice(0, 2);
  // A story about the long bond is about the thirty-year yield.
  if (ids.includes("us10y") && /30 عاماً|30 سنة|ثلاثين (?:عاماً|سنة)|30-year/i.test(headline)) ids = ids.map((id) => (id === "us10y" ? "us30y" : id));
  // Oil is reported with both benchmarks, Brent first: the Gulf's crude is priced off it.
  if (ids.includes("brent") || ids.includes("wti")) ids = ["brent", "wti", ...ids.filter((id) => id !== "brent" && id !== "wti")];
  return ids.slice(0, 3).map((id) => INSTRUMENTS.find((i) => i.id === id)).filter(Boolean);
}

/**
 * A routine move told twice: «برنت يقفز فوق 109 دولارات مع تعطل صادرات ينبع» ran four hours after «أرامكو تعلّق
 * تحميلات ينبع… برنت يرتفع 3%» (15 September). The newest of our price stories of the last `hours` (eight: the duplicate came four hours after, a real development twelve) on the same
 * instrument, or null; a new record or a reversal named in the headline is news again.
 */
const NEWS_AGAIN = /أعلى مستوى|أدنى مستوى|قياسي|قياسية|منذ (?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر|\d)|يعكس اتجاه|يمحو|يبدد/;
export function repeatsInstrument(story, existing = [], { now = Date.now(), hours = 8 } = {}) {
  if (!MARKET_SECTIONS.has(story.section) || NEWS_AGAIN.test(String(story.headlineHint ?? ""))) return null;
  const lead = instrumentsOf({ headlineHint: story.headlineHint, section: story.section })[0];
  if (!lead) return null;
  const earlier = existing
    .filter((a) => a.kind === "news" && MARKET_SECTIONS.has(a.section) && a.publishedAt && now - new Date(a.publishedAt) < hours * 3600000)
    .filter((a) => instrumentsOf({ headlineHint: a.title, section: a.section })[0]?.id === lead.id)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
  return earlier ? earlier.title : null;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function gmt(iso) {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} GMT on ${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const UNIT_EN = { "دولار/برميل": "US dollars per barrel", "دولار/أونصة": "US dollars per troy ounce", "دولار/مليون وحدة حرارية": "US dollars per million British thermal units", "دولار/رطل": "US dollars per pound", "سنت/بوشل": "US cents per bushel", "%": "percent", "دولار": "US dollars" };
const FUTURES = new Set(["brent", "wti", "natgas", "gold", "silver", "copper", "wheat"]);

/** One instrument's line: price, unit, time, and the move from the previous close when the feed gives one. */
export function quoteLine(inst, q, now = Date.now()) {
  const price = Number(q.price).toFixed(inst.decimals);
  const unit = UNIT_EN[inst.unit] ?? (inst.group === "fx" ? "" : "points");
  const series = FUTURES.has(inst.id) ? ` (futures, Yahoo Finance's continuous front-month series ${inst.symbol})` : ` (${inst.symbol})`;
  const label = inst.group === "fx" ? `${inst.name} exchange rate` : inst.name;
  let line = `${label}${series}: ${price}${unit ? ` ${unit}` : ""} at ${gmt(q.time)} (delayed quote)`;
  if (Number.isFinite(q.change) && Number.isFinite(q.pct) && Number.isFinite(q.prev)) {
    const dir = q.change >= 0 ? "up" : "down";
    line += inst.changeMode === "abs"
      ? `, ${dir} ${Math.abs(q.change).toFixed(3)} percentage points from the previous close of ${Number(q.prev).toFixed(inst.decimals)}`
      : `, ${dir} ${Math.abs(q.change).toFixed(inst.decimals)} or ${Math.abs(q.pct).toFixed(2)}% from the previous close of ${Number(q.prev).toFixed(inst.decimals)}`;
  }
  if (now - new Date(q.time) > 18 * 3600000) line += ". The market has not traded since this quote";
  return `${line}.`;
}

/**
 * The latest delayed quotes for the instruments the story is about, as one source, or null when the story is about no
 * priced instrument or the feed does not answer. `fetchQuote` stands in for the network in the self-test.
 */
export async function marketData({ story, sources = [], now = Date.now(), fetchQuote = yahooQuote, log = () => {} }) {
  const instruments = instrumentsOf(story, sources);
  if (!instruments.length) return null;
  const lines = [];
  for (const inst of instruments) {
    try {
      const q = withChange(inst, await fetchQuote(inst.symbol));
      lines.push(quoteLine(inst, q, now));
    } catch (error) {
      log(`market data: ${inst.symbol} did not answer (${String(error.message ?? error).slice(0, 80)})`);
    }
  }
  if (!lines.length) return null;
  const read = new Date(now).toISOString();
  return {
    sourceName: "ياهو فايننس",
    sourceNameEn: "Yahoo Finance",
    title: `بيانات السوق: ${instruments.map((i) => i.name).join("، ")}`,
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(instruments[0].symbol)}/`,
    lang: "en",
    kind: "market",
    publishedAt: read,
    fetchedAt: read,
    text: `Delayed market quotes read by Khazendar at ${gmt(read)}, just before this story was written.\n${lines.join("\n")}`,
    summary: "",
  };
}
