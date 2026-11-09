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
import { INSTRUMENTS, fetchJson, mergeHistory, recordedPrev, withChange, yahooQuote } from "./lib/quotes.mjs";

export { INSTRUMENTS };

const OUT = path.resolve("src/data/markets.json");
const CHECK = process.argv.includes("--check");

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
      const raw = await yahooQuote(inst.symbol);
      // An index Yahoo keeps one bar for: its previous close only when the board's own record bears it out.
      const prev = raw.prevFrom === "unchecked" ? recordedPrev(inst, raw, previousById.get(inst.id)?.history) : raw.prev;
      const quote = withChange(inst, { ...raw, prev });
      delete quote.prevFrom;
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
    delete quote.historyRead;
    delete quote.session;
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
