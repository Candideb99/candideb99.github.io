#!/usr/bin/env node
/**
 * The market board: delayed quotes for the indices, currencies, commodities and yields the paper
 * prints in its strip and its board (`src/data/markets.json`).
 *
 * Source: Yahoo Finance's public chart endpoint (no key, delayed); currencies fall back to
 * open.er-api.com's daily reference rates when Yahoo fails. The script is best effort: an
 * instrument that cannot be fetched keeps its last good quote, marked stale, and the script never
 * fails a build. Run by the deploy workflow before every build and by the newsroom before it
 * commits, so the committed file is a fallback for a runner that cannot reach the feed.
 *
 *   node pipeline/markets.mjs            refresh src/data/markets.json
 *   node pipeline/markets.mjs --check    print the quotes and exit
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("src/data/markets.json");
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const CHECK = process.argv.includes("--check");

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

async function fetchJson(url, headers = {}) {
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
async function yahooQuote(symbol) {
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

/** The stored closes merged with the fresh bars, by date, the last thirty trading days. */
function mergeHistory(inst, old = [], fresh = [], quote) {
  const byDate = new Map();
  for (const p of old) if (p && Number.isFinite(p.c)) byDate.set(p.d, p.c);
  for (const p of fresh) if (p && Number.isFinite(p.c)) byDate.set(p.d, p.c);
  // A feed that answers with the price alone still adds today's point.
  if (quote && Number.isFinite(quote.price) && quote.time) byDate.set(quote.time.slice(0, 10), quote.price);
  const round = (v) => Number(v.toFixed(inst.decimals + 2));
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-30).map(([d, c]) => ({ d, c: round(c) }));
}

/** Daily reference rates as a fallback for currencies (no change figure; the board prints the rate alone). */
async function referenceRates() {
  try {
    const json = await fetchJson("https://open.er-api.com/v6/latest/USD");
    if (json?.result !== "success" || !json.rates) return null;
    return { rates: json.rates, time: new Date(json.time_last_update_unix * 1000).toISOString() };
  } catch {
    return null;
  }
}

function withChange(inst, quote) {
  const { price, prev } = quote;
  if (!Number.isFinite(prev) || prev === null) return { ...quote, change: null, pct: null };
  const change = price - prev;
  const pct = (change / prev) * 100;
  const move = inst.changeMode === "abs" ? Math.abs(change) : Math.abs(pct);
  // A move beyond what the instrument ever does in a day is a feed error, not news: print the price alone.
  if (move > inst.limit) return { ...quote, prev: null, change: null, pct: null, suspect: true };
  return { ...quote, change: Number(change.toFixed(6)), pct: Number(pct.toFixed(4)) };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

async function main() {
  let previous = { quotes: [] };
  try {
    previous = JSON.parse(await readFile(OUT, "utf8"));
  } catch {}
  const previousById = new Map((previous.quotes || []).map((q) => [q.id, q]));

  const results = await pool(INSTRUMENTS, 4, async (inst) => {
    try {
      const quote = withChange(inst, await yahooQuote(inst.symbol));
      return { inst, quote: { ...quote, source: "yahoo", stale: false }, ok: true };
    } catch (error) {
      return { inst, error: String(error.message || error), ok: false };
    }
  });

  const failedFx = results.filter((r) => !r.ok && r.inst.fallback);
  const rates = failedFx.length ? await referenceRates() : null;

  const quotes = [];
  const failures = [];
  for (const r of results) {
    const { inst } = r;
    let quote = r.ok ? r.quote : null;
    if (!quote && rates && inst.fallback) {
      const [base, target] = inst.fallback;
      const rate = base === "USD" ? rates.rates[target] : rates.rates[base] ? 1 / rates.rates[base] : null;
      if (Number.isFinite(rate)) quote = { price: rate, prev: null, change: null, pct: null, time: rates.time, currency: target, source: "er-api", stale: false };
    }
    const old = previousById.get(inst.id);
    if (!quote) {
      failures.push(`${inst.symbol}: ${r.error}`);
      if (!old) continue;
      quote = { ...old, stale: true };
      delete quote.id; delete quote.symbol; delete quote.name; delete quote.short; delete quote.note; delete quote.group; delete quote.unit; delete quote.decimals; delete quote.changeMode;
    }
    const history = mergeHistory(inst, old?.history, quote.history, quote.stale ? null : quote);
    delete quote.history;
    quotes.push({ id: inst.id, symbol: inst.symbol, name: inst.name, short: inst.short ?? inst.name, note: inst.note ?? null, group: inst.group, unit: inst.unit ?? null, decimals: inst.decimals, changeMode: inst.changeMode ?? "pct", ...quote, history });
  }

  const fresh = quotes.filter((q) => !q.stale).length;
  const data = {
    updatedAt: fresh ? new Date().toISOString() : previous.updatedAt || null,
    source: "Yahoo Finance",
    quotes,
  };

  if (CHECK) {
    for (const q of quotes) console.log(`${q.id.padEnd(8)} ${String(q.price).padStart(12)} ${q.pct === null ? "   n/a" : (q.pct >= 0 ? "+" : "") + q.pct.toFixed(2) + "%"}${q.stale ? "  (stale)" : ""}  ${q.time}`);
  } else {
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
  }
  console.log(`markets: ${fresh}/${INSTRUMENTS.length} fresh quotes${failures.length ? `; failed: ${failures.join("; ")}` : ""}`);
  // Nothing fresh at all is worth a loud line, but never a failed build: the board keeps its last quotes.
  if (!fresh) console.error("markets: no feed answered; the board keeps its previous quotes");
}

main().catch((error) => {
  console.error(`markets: ${error.message || error}`);
  process.exit(0);
});
