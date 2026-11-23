/**
 * The market board's quotes, read from `src/data/markets.json` (written by `pipeline/markets.mjs`
 * before every build), and the formatting the strip and the board share.
 */
import data from "@data/markets.json";
import { formatShortDate, formatTime } from "./format";

export type Group = "arab" | "world" | "fx" | "commodities" | "rates" | "crypto";

export interface Quote {
  id: string;
  symbol: string;
  name: string;
  short: string;
  note: string | null;
  group: Group;
  unit: string | null;
  decimals: number;
  changeMode: "pct" | "abs";
  price: number;
  prev: number | null;
  change: number | null;
  pct: number | null;
  time: string;
  currency: string | null;
  source: string;
  stale: boolean;
  /** A closing yield from a state's daily file (pipeline/lib/yields.mjs): dated by its session, with no time of day. */
  endOfDay?: boolean;
  /** Daily closes, oldest first, up to a year of sessions (`HISTORY_SESSIONS`, pipeline/lib/quotes.mjs). */
  history: { d: string; c: number }[];
}

export interface Board {
  updatedAt: string | null;
  source: string;
  quotes: Quote[];
}

export const board = data as Board;

export const GROUP_NAMES: Record<Group, string> = {
  arab: "الأسواق العربية",
  world: "الأسواق العالمية",
  fx: "العملات",
  commodities: "السلع",
  rates: "السندات",
  // Bitcoin stood under «السندات والأصول الرقمية» beside the Treasury yields until 2026-11-15 (the owner, asking whether
  // the dollar's rate in pounds fell under «الأسواق»): a coin is no bond, and the desks file it on its own («كريبتو» at
  // Asharq Bloomberg, «العملات المشفرة» at most Arab desks).
  crypto: "العملات المشفرة",
};

/** The strip under the section bar: eight reference numbers, each as its move on the day, on one line at 1366px. */
export const STRIP_IDS = ["tasi", "egx30", "spx", "ndq", "brent", "gold", "eurusd", "usdegp"];

/**
 * Whether the strip prints an instrument's level beside its move. A yield and an exchange rate are read by their level:
 * an Egyptian reader checks the dollar at 53.37 pounds, not «−0.04%», and the strip had printed «دولار/جنيه مصري −0.04%»
 * in red, read as the pound falling on a day it gained, its rate only in a tooltip no phone shows (the owner, 2026-11-15:
 * "is this really the best depiction for this short markets board?"). Asharq Bloomberg's strip prints «الدولار الأميركي
 * مقابل الجنيه المصري 53.42 −0.02%», Al Eqtisadiah's «اليورو / $ 1.10 −0.29%». An index or a commodity keeps its move
 * alone, for the room of eight.
 */
export function stripShowsLevel(q: Quote): boolean {
  return q.changeMode === "abs" || q.group === "fx";
}

/** The box beside the cover: what an Arab reader looks up first, five rows so the cover keeps its height. */
export const BOX_IDS = ["tasi", "egx30", "brent", "gold", "usdegp"];


/**
 * The instruments a standing sub-topic's page prints beside its lead (`section/topic` of topics.json), so the oil page
 * shows Brent and WTI as they stand as well as the stories about them (2026-10-19). A subject with no instrument of
 * its own on the board has none.
 */
export const TOPIC_QUOTE_IDS: Record<string, string[]> = {
  "energy/oil": ["brent", "wti"],
  "energy/gas": ["natgas", "ttf"],
  "markets/stocks": ["tasi", "egx30", "spx"],
  "markets/bonds": ["us10y", "de10y", "jp10y"],
  "markets/currencies": ["usdegp", "eurusd", "dxy"],
  "markets/commodities": ["gold", "silver", "copper"],
};

// The data page's six headline cards (FEATURED_IDS) went on 2026-11-20: each repeated a row of its tables.

/**
 * Whether a story's key figure is a market quote: a price, level or move of an instrument the board carries (Brent,
 * gold, Tasi, EGX 30, the dollar's rates, Treasury yields). The story printed it as it stood when it was written, and
 * the market box and the strip print it as it stands now: as one of the front's «أرقام اليوم» it put two prices of one
 * instrument on one screen (Brent at 108.52 in the box and 107.92 in the figures 740px below it, 2026-10-19). Measured
 * on the last 120 stories' 565 figures, it takes 56, all of them quotes. A forecast, a physical quantity, a reserve and
 * the local price of a gold coin or of jewellery gold are not quotes.
 */
const QUOTE_NAMES = /برنت|غرب تكساس|خام تكساس|الخام الأمريكي|الخام الأميركي|\bWTI\b|الذهب|الفضة|النحاس|القمح|هنري هب|تاسي|إيجي إكس|\bEGX|مصر 30|المؤشر الرئيسي|ستاندرد آند بورز 500|S&P 500|ناسداك المركب|مؤشر ناسداك|داو جونز الصناعي|مؤشر داو|ستوكس|فوتسي|نيكاي|شنغهاي المركب|بي?تكوين|سندات الخزانة|مؤشر الدولار|سعر الصرف|سعر صرف|مقابل الدولار|للدولار/;
const NOT_A_QUOTE = /توقع|الجنيه الذهب|عيار|احتياطيات|الاحتياطي الاستراتيجي|(?:^|\s)(?:طن|طناً|أطنان)/;
export function isMarketQuote(text: string): boolean {
  return QUOTE_NAMES.test(text) && !NOT_A_QUOTE.test(text);
}

const byId = new Map(board.quotes.map((q) => [q.id, q]));

export function quotes(ids: string[]): Quote[] {
  return ids.map((id) => byId.get(id)).filter((q): q is Quote => Boolean(q));
}

export function grouped(): { group: Group; name: string; items: Quote[] }[] {
  return (Object.keys(GROUP_NAMES) as Group[])
    .map((group) => ({ group, name: GROUP_NAMES[group], items: board.quotes.filter((q) => q.group === group) }))
    .filter((g) => g.items.length > 0);
}

const formatters = new Map<number, Intl.NumberFormat>();
function nf(decimals: number) {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  return f;
}

export function formatPrice(q: Quote): string {
  return nf(q.decimals).format(q.price) + (q.unit === "%" ? "%" : "");
}

export type Direction = "up" | "down" | "flat" | "none";

export function direction(q: Quote): Direction {
  if (q.change === null || q.pct === null) return "none";
  const v = q.changeMode === "abs" ? q.change : q.pct;
  if (Math.abs(v) < (q.changeMode === "abs" ? 0.005 : 0.005)) return "flat";
  return v > 0 ? "up" : "down";
}

/** A signed figure as printed: "+0.35", "−1.20"; a move that rounds to zero prints bare ("0.00", never "−0.00"). */
function signed(v: number, text: string): string {
  if (/^[0.,]+$/.test(text)) return text;
  return (v > 0 ? "+" : v < 0 ? "−" : "") + text;
}

/** "+0.35%" for prices, "+0.19" (points) for yields. */
export function formatMove(q: Quote): string {
  if (q.change === null || q.pct === null) return "";
  const v = q.changeMode === "abs" ? q.change : q.pct;
  return signed(v, Math.abs(v).toFixed(2)) + (q.changeMode === "abs" ? "" : "%");
}

/** The move as a percentage whatever the instrument, for the full board's % column. */
export function formatPct(q: Quote): string {
  if (q.pct === null) return "";
  return signed(q.pct, Math.abs(q.pct).toFixed(2)) + "%";
}

/** The absolute change in the instrument's own unit, for the full board's التغير column. */
export function formatChange(q: Quote): string {
  if (q.change === null) return "";
  return signed(q.change, nf(q.decimals).format(Math.abs(q.change)));
}

export const DIRECTION_LABEL: Record<Direction, string> = { up: "ارتفاع", down: "انخفاض", flat: "دون تغيير", none: "" };

/** "11 سبتمبر 14:05": the quote's own time in the site's zone. Never "today": the page may be read days after it was built. */
export function whenLabel(q: Quote): string {
  if (q.endOfDay) return `إغلاق ${formatShortDate(q.time)}`;
  return `${formatShortDate(q.time)} ${formatTime(q.time)}`;
}

/**
 * Points for a small line of the instrument's closes in the last month, as the data page's note says, or null when there
 * are too few to draw. The record keeps thirty sessions, six weeks of a weekday market, and the line had drawn them all.
 */
export function sparkline(q: Quote, width = 96, height = 28, pad = 1.5): { points: string; days: number } | null {
  const closes = (q.history ?? []).filter((p) => Number.isFinite(p.c) && /^\d{4}-\d{2}-\d{2}$/.test(p.d));
  if (!closes.length) return null;
  const from = new Date(Date.parse(`${closes[closes.length - 1].d}T00:00:00Z`) - 31 * 86400000).toISOString().slice(0, 10);
  const values = closes.filter((p) => p.d > from).map((p) => p.c);
  if (values.length < 5) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.001 || 1;
  const stepX = (width - 2 * pad) / (values.length - 1);
  const points = values.map((v, i) => `${(pad + i * stepX).toFixed(1)},${(height - pad - ((v - min) / span) * (height - 2 * pad)).toFixed(1)}`).join(" ");
  return { points, days: values.length };
}

/** Who publishes a quote, for the note under it: Yahoo's, or a state's own file (the German and Japanese yields). */
export const SOURCE_NAMES: Record<string, string> = {
  yahoo: "Yahoo Finance",
  "er-api": "ExchangeRate-API",
  bundesbank: "البنك المركزي الألماني (بوندسبنك)",
  mof: "وزارة المالية اليابانية",
};

/** An instrument's own page: its price, its closes over the periods the record fills, its group. */
export function quoteHref(q: Pick<Quote, "id">): string {
  return `/markets/data/${q.id}/`;
}

/** The strip's order when it carries every instrument (the front's moving line): the Arab markets, what their readers
 *  watch next (oil and gold), the currencies, the world's indices, the bonds and the coins. */
export const STRIP_GROUPS: Group[] = ["arab", "commodities", "fx", "world", "rates", "crypto"];
