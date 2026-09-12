/**
 * The market board's quotes, read from `src/data/markets.json` (written by `pipeline/markets.mjs`
 * before every build), and the formatting the strip and the board share.
 */
import data from "@data/markets.json";

export type Group = "indices" | "fx" | "commodities" | "rates";

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
}

export interface Board {
  updatedAt: string | null;
  source: string;
  quotes: Quote[];
}

export const board = data as Board;

export const GROUP_NAMES: Record<Group, string> = {
  indices: "المؤشرات",
  fx: "العملات",
  commodities: "السلع",
  rates: "السندات والأصول الرقمية",
};

/** The strip under the section bar: eight reference numbers, each as its move on the day, on one line at 1240px. */
export const STRIP_IDS = ["tasi", "egx30", "spx", "ndq", "brent", "gold", "eurusd", "usdegp"];

/** The box beside the cover: what an Arab reader looks up first, five rows so the cover keeps its height. */
export const BOX_IDS = ["tasi", "egx30", "brent", "gold", "usdegp"];

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

/** "+0.35%" for prices, "+0.19" (points) for yields. */
export function formatMove(q: Quote): string {
  if (q.change === null || q.pct === null) return "";
  const v = q.changeMode === "abs" ? q.change : q.pct;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return sign + Math.abs(v).toFixed(2) + (q.changeMode === "abs" ? "" : "%");
}

/** The move as a percentage whatever the instrument, for the full board's % column. */
export function formatPct(q: Quote): string {
  if (q.pct === null) return "";
  const sign = q.pct > 0 ? "+" : q.pct < 0 ? "−" : "";
  return sign + Math.abs(q.pct).toFixed(2) + "%";
}

/** The absolute change in the instrument's own unit, for the full board's التغير column. */
export function formatChange(q: Quote): string {
  if (q.change === null) return "";
  const sign = q.change > 0 ? "+" : q.change < 0 ? "−" : "";
  return sign + nf(q.decimals).format(Math.abs(q.change));
}

export const DIRECTION_LABEL: Record<Direction, string> = { up: "ارتفاع", down: "انخفاض", flat: "دون تغيير", none: "" };
