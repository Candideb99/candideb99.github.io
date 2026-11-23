/**
 * Government bond yields Yahoo does not carry, read from each state's own daily file (2026-11-23, the owner: "how about
 * other bonds like euro bonds or Japanese bonds"). Both are free to reuse with the source named, need no key, and give
 * one closing yield a working day, published the next:
 *
 * - the Bundesbank's statistics API: the ten-year yield of its fitted curve of federal securities (BBSIS, daily), as CSV
 *   with a decimal comma («2026-11-20;3,37;»);
 * - Japan's Ministry of Finance: the JGB yields of the month (jgbcme.csv), a row a day («2026/11/19,1.659,…»), and the
 *   whole series since 1974 (jgbcme_all.csv, 1.2 MB), read only while the board's record is short.
 *
 * A yield's move is its close against the one before, both from the file or the board's record; the quote is dated by
 * its session alone (`endOfDay`), never by a time of day the file does not give.
 */
import { HISTORY_SESSIONS, isSessionDay } from "./quotes.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MOF = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate";

async function fetchText(url, ms = 30000) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/csv,text/plain,*/*" }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** The Bundesbank's CSV: one «date;value;» line a day, a decimal comma, «.» for a day with no value. */
export function parseBundesbank(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2});(-?\d+(?:,\d+)?);/);
    if (m) out.push({ d: m[1], c: Number(m[2].replace(",", ".")) });
  }
  return out;
}

/** The Ministry of Finance's CSV: a header row naming the terms («Date,1Y,…,10Y,…»), then «2026/11/19,1.659,…» a day. */
export function parseMof(text, term = "10Y") {
  const out = [];
  let col = -1;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells[0] === "Date") {
      col = cells.indexOf(term);
      continue;
    }
    const m = cells[0]?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m || col < 0) continue;
    const v = Number(cells[col]);
    if (cells[col] && Number.isFinite(v)) out.push({ d: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, c: v });
  }
  return out;
}

async function closesOf(inst, record) {
  if (inst.source === "bundesbank") {
    const n = record.length >= 30 ? 10 : HISTORY_SESSIONS;
    return parseBundesbank(await fetchText(`https://api.statistiken.bundesbank.de/rest/data/BBSIS/${inst.symbol.replace(/^BBSIS\./, "")}?lastNObservations=${n}&format=csv`));
  }
  if (inst.source === "mof") {
    const month = parseMof(await fetchText(`${MOF}/jgbcme.csv`));
    if (record.length >= 30) return month;
    const all = parseMof(await fetchText(`${MOF}/historical/jgbcme_all.csv`, 60000));
    return [...all.slice(-HISTORY_SESSIONS), ...month];
  }
  throw new Error(`no official source ${inst.source}`);
}

/**
 * The latest closing yield of an instrument with an official `source`, its move from the close before (from the file, or
 * the board's record when the file starts a new month), and the closes read, for the board's record.
 */
export async function officialYield(inst, record = []) {
  const fresh = (await closesOf(inst, record)).filter((p) => Number.isFinite(p.c) && isSessionDay(p.d, inst));
  if (!fresh.length) throw new Error("no yield in the file");
  const byDate = new Map();
  for (const p of record ?? []) if (p && Number.isFinite(p.c) && isSessionDay(p.d, inst)) byDate.set(p.d, p.c);
  for (const p of fresh) byDate.set(p.d, p.c);
  const days = [...byDate.keys()].sort();
  const last = fresh.reduce((a, b) => (b.d > a.d ? b : a));
  const before = days.filter((d) => d < last.d).at(-1);
  return {
    price: last.c,
    prev: before ? byDate.get(before) : null,
    time: `${last.d}T12:00:00Z`,
    session: last.d,
    currency: null,
    endOfDay: true,
    history: fresh,
  };
}
