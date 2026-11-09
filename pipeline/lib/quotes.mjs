/**
 * Delayed quotes from Yahoo Finance's public chart endpoint (no key), shared by the market board
 * (pipeline/markets.mjs) and the newsroom, which reads the latest price of the instruments a story is about
 * before it is written (lib/context.mjs; the owner, 2026-10-19).
 */
/** The quote page a market-data source is filed under: read once, never fetched again (lib/factcheck.mjs). */
export const MARKET_QUOTE_URL = /^https:\/\/finance\.yahoo\.com\/quote\//;

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/**
 * The instruments, in the order the full board prints them. `decimals` is the printed precision,
 * `changeMode` "abs" prints the change in points (yields) instead of a percentage, `limit` is the
 * largest daily move the feed may report before the change is treated as a data error and dropped.
 */
export const INSTRUMENTS = [
  // الأسواق العربية ثم العالمية
  { id: "tasi", group: "arab", symbol: "^TASI.SR", name: "تاسي", short: "تاسي", note: "السعودية", decimals: 2, limit: 15 },
  { id: "egx30", group: "arab", symbol: "^CASE30", name: "إيجي إكس 30", short: "مصر 30", note: "مصر", decimals: 2, limit: 15 },
  { id: "spx", group: "world", symbol: "^GSPC", name: "ستاندرد آند بورز 500", short: "S&P 500", note: "الولايات المتحدة", decimals: 2, limit: 15 },
  { id: "ndq", group: "world", symbol: "^IXIC", name: "ناسداك المركب", short: "ناسداك", note: "الولايات المتحدة", decimals: 2, limit: 15 },
  { id: "dji", group: "world", symbol: "^DJI", name: "داو جونز", short: "داو جونز", note: "الولايات المتحدة", decimals: 2, limit: 15 },
  { id: "sx5e", group: "world", symbol: "^STOXX50E", name: "يورو ستوكس 50", short: "ستوكس 50", note: "منطقة اليورو", decimals: 2, limit: 15 },
  { id: "ftse", group: "world", symbol: "^FTSE", name: "فوتسي 100", short: "فوتسي 100", note: "بريطانيا", decimals: 2, limit: 15 },
  { id: "n225", group: "world", symbol: "^N225", name: "نيكاي 225", short: "نيكاي", note: "اليابان", decimals: 2, limit: 15 },
  { id: "sse", group: "world", symbol: "000001.SS", name: "شنغهاي المركب", short: "شنغهاي", note: "الصين", decimals: 2, limit: 15 },
  // العملات. A pound or a lira is named with its country, the short label too: «دولار/جنيه» alone could be the Sudanese
  // or the British pound, «ليرة» the Lebanese or the Syrian (the owner, 2026-11-09). Only currencies that float and that
  // Yahoo quotes cleanly: measured that day over three months of daily closes, its Moroccan dirham, Tunisian dinar,
  // Qatari riyal and Pakistani rupee swing 2-4% every other day between two price sources (a move above 2% on 22 to 37
  // of 65 days, most of them reversed the next day), its Saudi riyal sat at 3.64 for weeks against a peg of 3.75 and printed
  // +3.21% on 9 November, and a pegged currency would print 0.00% forever. The franc and the rupee read clean: no move
  // above 1.8% for the franc, one reversed pair of about 2% in August for the rupee, which its limit of 2 drops.
  { id: "eurusd", group: "fx", symbol: "EURUSD=X", name: "يورو / دولار", short: "يورو/دولار", decimals: 4, limit: 8, fallback: ["EUR", "USD"] },
  { id: "gbpusd", group: "fx", symbol: "GBPUSD=X", name: "جنيه إسترليني / دولار", short: "إسترليني/دولار", decimals: 4, limit: 8, fallback: ["GBP", "USD"] },
  { id: "usdjpy", group: "fx", symbol: "JPY=X", name: "دولار / ين ياباني", short: "دولار/ين", decimals: 2, limit: 8, fallback: ["USD", "JPY"] },
  { id: "usdchf", group: "fx", symbol: "CHF=X", name: "دولار / فرنك سويسري", short: "دولار/فرنك سويسري", decimals: 4, limit: 8, fallback: ["USD", "CHF"] },
  { id: "usdegp", group: "fx", symbol: "EGP=X", name: "دولار / جنيه مصري", short: "دولار/جنيه مصري", decimals: 2, limit: 8, fallback: ["USD", "EGP"] },
  { id: "usdtry", group: "fx", symbol: "TRY=X", name: "دولار / ليرة تركية", short: "دولار/ليرة تركية", decimals: 2, limit: 8, fallback: ["USD", "TRY"] },
  { id: "usdcny", group: "fx", symbol: "CNY=X", name: "دولار / يوان صيني", short: "دولار/يوان", decimals: 4, limit: 8, fallback: ["USD", "CNY"] },
  { id: "usdinr", group: "fx", symbol: "INR=X", name: "دولار / روبية هندية", short: "دولار/روبية هندية", decimals: 2, limit: 2, fallback: ["USD", "INR"] },
  { id: "dxy", group: "fx", symbol: "DX-Y.NYB", name: "مؤشر الدولار", short: "مؤشر الدولار", decimals: 2, limit: 8 },
  // السلع
  { id: "brent", group: "commodities", symbol: "BZ=F", name: "خام برنت", short: "برنت", unit: "دولار/برميل", decimals: 2, limit: 25 },
  { id: "wti", group: "commodities", symbol: "CL=F", name: "خام غرب تكساس", short: "غرب تكساس", unit: "دولار/برميل", decimals: 2, limit: 25 },
  { id: "natgas", group: "commodities", symbol: "NG=F", name: "الغاز الطبيعي (هنري هب)", short: "الغاز", unit: "دولار/مليون وحدة حرارية", decimals: 3, limit: 30 },
  { id: "gold", group: "commodities", symbol: "GC=F", name: "الذهب", short: "الذهب", unit: "دولار/أونصة", decimals: 2, limit: 15 },
  { id: "silver", group: "commodities", symbol: "SI=F", name: "الفضة", short: "الفضة", unit: "دولار/أونصة", decimals: 2, limit: 20 },
  { id: "copper", group: "commodities", symbol: "HG=F", name: "النحاس", short: "النحاس", unit: "دولار/رطل", decimals: 3, limit: 20 },
  { id: "wheat", group: "commodities", symbol: "ZW=F", name: "القمح (شيكاغو)", short: "القمح", unit: "سنت/بوشل", decimals: 2, limit: 20 },
  // السندات والأصول الرقمية
  { id: "us10y", group: "rates", symbol: "^TNX", name: "عائد سندات الخزانة الأمريكية لعشر سنوات", short: "الخزانة 10 سنوات", unit: "%", decimals: 2, changeMode: "abs", limit: 1.5 },
  { id: "us30y", group: "rates", symbol: "^TYX", name: "عائد سندات الخزانة الأمريكية لثلاثين سنة", short: "الخزانة 30 سنة", unit: "%", decimals: 2, changeMode: "abs", limit: 1.5 },
  { id: "btc", group: "rates", symbol: "BTC-USD", name: "بتكوين", short: "بتكوين", unit: "دولار", decimals: 0, limit: 40 },
];

export async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "user-agent": BROWSER_UA, accept: "application/json,text/plain,*/*", ...headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function yahooChart(symbol, range, interval = "1d") {
  let lastError;
  for (const host of ["query2", "query1"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await fetchJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
        const result = json?.chart?.result?.[0];
        if (!result?.meta) throw new Error(json?.chart?.error?.description || "no result");
        return result;
      } catch (error) {
        lastError = error;
        if (!/HTTP (429|5\d\d)/.test(String(error.message))) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw lastError || new Error("unreachable");
}

function barsOf(result) {
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return stamps.map((t, i) => ({ t: t * 1000, c: closes[i] })).filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c));
}

/** A moment's date (YYYY-MM-DD) in a time zone; an unknown zone reads as UTC. */
function dateIn(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
const dayAfter = (day, step = 1) => new Date(Date.parse(`${day}T12:00:00Z`) + step * 86400000).toISOString().slice(0, 10);

/**
 * The weekdays (0 is Sunday) a market holds sessions on, from an instrument of the board or from Yahoo's answer: the Saudi
 * and Egyptian exchanges Sunday to Thursday, crypto every day, every other market Monday to Friday.
 */
export function tradingWeekdays({ id, group, instrumentType, exchangeTimezoneName } = {}) {
  if (id === "btc" || instrumentType === "CRYPTOCURRENCY") return [0, 1, 2, 3, 4, 5, 6];
  if (group === "arab" || /^(?:Asia\/Riyadh|Africa\/Cairo)$/.test(exchangeTimezoneName ?? "")) return [0, 1, 2, 3, 4];
  return [1, 2, 3, 4, 5];
}

/** Whether a stored date is a day the market holds a session on. */
export function isSessionDay(day, market) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(day ?? "")) && tradingWeekdays(market).includes(weekdayOf(day));
}

/**
 * The session a moment belongs to, as the date Yahoo files its daily bar under (2026-11-09). A future's trading day opens
 * at 18:00 New York time, so Sunday evening's prices are Monday's session (Yahoo stamps that bar on Monday); every other
 * market's day is its exchange's own calendar day. A moment on a day the market holds no session (a currency quoted on a
 * Saturday, the dollar index's Sunday evening) belongs to the next session. Dating a Sunday evening's price by its own
 * date had left a point in the history no bar ever replaced: Brent "closed" on three Sundays of October, the dollar
 * against the yen on a Saturday.
 */
export function sessionDay(meta, ms) {
  let day = meta?.instrumentType === "FUTURE" ? dateIn(ms + 6 * 3600000, "America/New_York") : dateIn(ms, meta?.exchangeTimezoneName);
  for (let i = 0; i < 6 && !isSessionDay(day, meta); i++) day = dayAfter(day);
  return day;
}

/**
 * Two chart calls: a one-day range for the latest price, and three months of daily closes. The move is measured from
 * the close of the session before the quote's own, read from the daily closes (2026-11-09). The one-day range's
 * `chartPreviousClose` had been the move's base, and it is the close before the range's day, which is not always the
 * quote's: between a market's new day and its first trade, the range holds an empty day, its previous close is the
 * quote's own close, and the board printed every commodity "unchanged, 0.00%" on Sunday evening (Brent's +0.03%,
 * gold's −0.94% of Friday), wheat the same all night, and the Nikkei at 0.00% for the twenty minutes after Tokyo opened
 * on Monday, beside its 5.97% fall of Friday. An index Yahoo keeps one bar for (the Saudi and Egyptian ones) has no
 * daily closes to read: its move is the feed's previous close, which the board checks against its own record
 * (`recordedPrev()`). A quote older than a session the daily closes already hold is stale and refused: on 8 November
 * the one-day answer for natural gas gave a time of 15 October and a previous close of 3.533 beside Friday's price of
 * 2.998, and the board printed −15.14% dated 15 October.
 */
export async function yahooQuote(symbol) {
  const today = await yahooChart(symbol, "1d");
  // A currency's daily closes are read from its hourly prices, each session's last (found later on 2026-11-09, after the
  // change above went live): Yahoo's daily currency bar carries roughly the price at the start of its day, not its end.
  // Over three weeks, 7 to 15 of each currency's 21 daily closes sat nearer the evening before than their own day's end,
  // and the board printed the euro −0.16%, the pound −0.24% and the yen +0.32% on a Monday when they had moved +0.60%,
  // +0.51% and −0.27% from Friday's close. The hourly closes agreed with Yahoo's own previous close for all eight
  // currencies. The indices, yields, futures and bitcoin keep their daily bars, which close their own day (a future's at
  // its settlement price, checked against the hourly prices of Brent and copper).
  const hourly = today.meta?.instrumentType === "CURRENCY";
  // Whether the three months were read: a one-day bar is not evidence that a feed keeps no daily closes (context.mjs
  // quoteLine(); the review of 2026-10-30: a failed call took gold's and Brent's moves away).
  let months = null;
  try {
    months = await yahooChart(symbol, "3mo", hourly ? "60m" : "1d");
  } catch {}
  // A field Yahoo leaves empty is no price: Number(null) is 0, and a price of 0 reached the board and the stories'
  // market data (a review of 2026-11-01). Of the two answers, the newer price.
  const priced = (m) => typeof m?.regularMarketPrice === "number" && Number.isFinite(m.regularMarketPrice) && typeof m.regularMarketTime === "number" && Number.isFinite(m.regularMarketTime);
  const meta = [today.meta, months?.meta].filter(priced).sort((a, b) => b.regularMarketTime - a.regularMarketTime)[0];
  if (!meta) throw new Error("no price");
  const price = meta.regularMarketPrice;
  const ms = meta.regularMarketTime * 1000;
  const day = sessionDay(meta, ms);
  // One close per session, the latest bar of a session winning (the dollar index's Sunday evening and its Monday).
  const closes = new Map();
  for (const bar of barsOf(months)) closes.set(sessionDay(meta, bar.t), bar.c);
  const later = [...closes.keys()].filter((d) => d > day).sort();
  if (later.length) throw new Error(`stale quote: dated ${day}, the daily closes reach ${later.at(-1)}`);
  const before = [...closes.entries()].filter(([d]) => d < day).sort(([a], [b]) => (a < b ? -1 : 1));
  // The feed's own previous close, usable only when its one-day range holds the quote's session (before a session's
  // first trade the range is the new, empty day, and its previous close is the quote's own close).
  const own = barsOf(today).some((bar) => sessionDay(meta, bar.t) === day);
  const feed = Number(today.meta?.chartPreviousClose);
  const feedUsable = own && Number.isFinite(feed) && feed > 0;
  let lastSession = dayAfter(day, -1);
  for (let i = 0; i < 6 && !isSessionDay(lastSession, meta); i++) lastSession = dayAfter(lastSession, -1);
  // `prevFrom`: "bars" from the daily closes; "feed" from the feed when the daily closes miss the session before the
  // quote's (Yahoo left bitcoin's Sunday bar empty on 8 November, and Saturday's close would have made Monday's move two
  // days long); "unchecked" from the feed with no daily closes to hold it against, which the board checks against its
  // own record (`recordedPrev()`) and the newsroom does not print (context.mjs, quoteLine()).
  let prev = null;
  let prevFrom = null;
  if (before.length >= 4 && (before.at(-1)[0] === lastSession || !feedUsable)) {
    prev = before.at(-1)[1];
    prevFrom = "bars";
  } else if (feedUsable) {
    prev = feed;
    prevFrom = before.length >= 4 ? "feed" : "unchecked";
  }
  const history = [...before.map(([d, c]) => ({ d, c })), { d: day, c: price }];
  return { price, prev, prevFrom, time: new Date(ms).toISOString(), session: day, currency: meta.currency || null, history, historyRead: Boolean(months) };
}

const sameClose = (a, b) => Math.abs(a - b) <= Math.abs(b) * 0.0005;

/**
 * The previous close of an index Yahoo keeps one daily bar for (the Saudi and Egyptian ones), checked against the board's
 * own record of its closes (2026-11-09): the feed's figure when it is the record's last close before the quote's session,
 * the record's last close when the feed's is an earlier one, and none when the two cannot be matched. The feed is
 * sometimes a session stale: on Sunday 8 November it gave the EGX30's close of Wednesday the 4th, and the board printed the
 * index up 0.32% where it had lost 0.67% from Thursday's close (on 25 October the same fault had put a 6.85% fall in a
 * story for 3.56%).
 */
export function recordedPrev(inst, quote, record = []) {
  if (!Number.isFinite(quote?.prev) || !quote.session) return null;
  const closes = record.filter((p) => p && Number.isFinite(p.c) && isSessionDay(p.d, inst) && p.d < quote.session).sort((a, b) => (a.d < b.d ? -1 : 1));
  const last = closes.at(-1);
  if (!last) return null;
  if (sameClose(quote.prev, last.c)) return quote.prev;
  if (closes.slice(0, -1).some((p) => sameClose(quote.prev, p.c))) return last.c;
  return null;
}

/**
 * An instrument's daily closes for its line: the stored record, the fresh closes over it, and the quote's own session,
 * the last thirty sessions. A stored point on a day the market holds no session is dropped: a price dated by its own day
 * rather than its session's had left Sunday "closes" in Brent's line that no bar of Yahoo's ever replaced.
 */
export function mergeHistory(inst, old = [], fresh = [], quote = null) {
  const byDate = new Map();
  const usable = (p) => p && Number.isFinite(p.c) && isSessionDay(p.d, inst);
  for (const p of old ?? []) if (usable(p)) byDate.set(p.d, p.c);
  for (const p of fresh ?? []) if (usable(p)) byDate.set(p.d, p.c);
  // A feed that answers with the price alone still adds its session's point.
  if (quote && Number.isFinite(quote.price) && isSessionDay(quote.session, inst)) byDate.set(quote.session, quote.price);
  const round = (v) => Number(v.toFixed(inst.decimals + 2));
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-30).map(([d, c]) => ({ d, c: round(c) }));
}

export function withChange(inst, quote) {
  const { price, prev } = quote;
  if (!Number.isFinite(prev) || prev === null) return { ...quote, change: null, pct: null };
  const change = price - prev;
  const pct = (change / prev) * 100;
  const move = inst.changeMode === "abs" ? Math.abs(change) : Math.abs(pct);
  // A move beyond what the instrument ever does in a day is a feed error, not news: print the price alone.
  if (move > inst.limit) return { ...quote, prev: null, change: null, pct: null, suspect: true };
  return { ...quote, change: Number(change.toFixed(6)), pct: Number(pct.toFixed(4)) };
}

