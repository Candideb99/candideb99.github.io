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
  // العملات
  { id: "eurusd", group: "fx", symbol: "EURUSD=X", name: "يورو / دولار", short: "يورو/دولار", decimals: 4, limit: 8, fallback: ["EUR", "USD"] },
  { id: "gbpusd", group: "fx", symbol: "GBPUSD=X", name: "جنيه إسترليني / دولار", short: "إسترليني/دولار", decimals: 4, limit: 8, fallback: ["GBP", "USD"] },
  { id: "usdjpy", group: "fx", symbol: "JPY=X", name: "دولار / ين ياباني", short: "دولار/ين", decimals: 2, limit: 8, fallback: ["USD", "JPY"] },
  { id: "usdegp", group: "fx", symbol: "EGP=X", name: "دولار / جنيه مصري", short: "دولار/جنيه", decimals: 2, limit: 8, fallback: ["USD", "EGP"] },
  { id: "usdtry", group: "fx", symbol: "TRY=X", name: "دولار / ليرة تركية", short: "دولار/ليرة", decimals: 2, limit: 8, fallback: ["USD", "TRY"] },
  { id: "usdcny", group: "fx", symbol: "CNY=X", name: "دولار / يوان صيني", short: "دولار/يوان", decimals: 4, limit: 8, fallback: ["USD", "CNY"] },
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

async function yahooChart(symbol, range) {
  let lastError;
  for (const host of ["query2", "query1"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await fetchJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`);
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
  const stamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return stamps.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: closes[i] })).filter((b) => Number.isFinite(b.c));
}

/**
 * Two chart calls: a one-day range, whose `chartPreviousClose` is the close before that session
 * (over a longer range it is the close before the range's first bar, which misled the first
 * version by a week), and a three-month range for the line of daily closes, best effort.
 */
export async function yahooQuote(symbol) {
  const today = await yahooChart(symbol, "1d");
  const meta = today.meta;
  const price = Number(meta.regularMarketPrice);
  const time = Number(meta.regularMarketTime);
  if (!Number.isFinite(price) || !Number.isFinite(time)) throw new Error("no price");
  let prev = Number(meta.chartPreviousClose);
  if (!Number.isFinite(prev) || prev <= 0) prev = null;
  let history = barsOf(today);
  try {
    history = barsOf(await yahooChart(symbol, "3mo"));
  } catch {}
  return { price, prev, time: new Date(time * 1000).toISOString(), currency: meta.currency || null, history };
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

