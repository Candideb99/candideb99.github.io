/**
 * The drawing of an instrument's closes on its own page (/markets/data/{id}/), as numbers: one function, run when the
 * page is built and again in the reader's browser when a period is chosen, so the two can never draw differently.
 * The drawing runs left to right, oldest close first, as every price chart does in Arabic pages too.
 */

/** The periods a reader may choose, in sessions; one is offered only when the record holds more than the one before. */
export const PERIODS = [
  { id: "m1", label: "شهر", sessions: 22 },
  { id: "m3", label: "3 أشهر", sessions: 66 },
  { id: "m6", label: "6 أشهر", sessions: 130 },
  { id: "y1", label: "سنة", sessions: 260 },
];

/**
 * The same periods for a market with a close every day of the week (bitcoin): a month is 30 closes there, not 22.
 * With the weekday count its «شهر» ran 22 days, and on 22 November printed −22.55% from 1 November where the month
 * from 22 October was −25.47% (a review of 2026-11-22).
 */
export const DAILY_PERIODS = [
  { id: "m1", label: "شهر", sessions: 30 },
  { id: "m3", label: "3 أشهر", sessions: 91 },
  { id: "m6", label: "6 أشهر", sessions: 182 },
  { id: "y1", label: "سنة", sessions: 365 },
];

/** Whether an instrument of the board closes every day of the week (pipeline/lib/quotes.mjs tradingWeekdays()). */
export const closesDaily = (quote) => quote?.id === "btc" || quote?.group === "crypto";

/** The periods the record can fill: every one shorter than the record, and the record itself as the longest. */
export function periodsFor(count, daily = false) {
  const out = [];
  for (const p of daily ? DAILY_PERIODS : PERIODS) {
    if (count >= p.sessions) out.push(p);
    else {
      // What the record holds beyond the last period it fills is offered as «الكل», never under the name of a period
      // it does not fill (thirty sessions had been offered as «3 أشهر»).
      if (!out.length || count > out[out.length - 1].sessions + 5) out.push({ id: "all", label: "الكل", sessions: count });
      break;
    }
  }
  return out.length ? out : [{ id: "all", label: "الكل", sessions: count }];
}

const nice = (span) => {
  const rough = span / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
};

/**
 * @param {{d: string, c: number}[]} closes oldest first
 * @param {{width?: number, height?: number, decimals?: number}} [opts]
 */
export function priceChart(closes, { width = 720, height = 300, decimals = 2 } = {}) {
  const pts = closes.filter((p) => Number.isFinite(p.c));
  if (pts.length < 2) return null;
  const PAD = { top: 16, right: 14, bottom: 8, left: 14 };
  const values = pts.map((p) => p.c);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  const step = nice(span);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step === yMin ? yMin + step : Math.ceil(hi / step) * step;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (plotW * i) / (pts.length - 1);
  const y = (v) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const ticks = [];
  for (let v = yMin; v <= yMax + step * 1e-6; v += step) ticks.push({ v: Number(v.toFixed(8)), y: Number(y(v).toFixed(1)) });
  const xy = pts.map((p, i) => [Number(x(i).toFixed(1)), Number(y(p.c).toFixed(1))]);
  const line = xy.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join(" ");
  const base = PAD.top + plotH;
  const area = `${line} L${xy[xy.length - 1][0]} ${base} L${xy[0][0]} ${base} Z`;
  // Five dates under the plot at most, the first and the last always.
  const marks = Math.min(5, pts.length);
  const dates = [];
  for (let k = 0; k < marks; k++) {
    const i = Math.round(((pts.length - 1) * k) / (marks - 1));
    dates.push({ i, d: pts[i].d, pct: Number(((xy[i][0] / width) * 100).toFixed(2)) });
  }
  const first = pts[0].c;
  const last = pts[pts.length - 1].c;
  const hiAt = values.indexOf(hi);
  const loAt = values.indexOf(lo);
  return {
    width, height, PAD, line, area, ticks, dates, xy,
    points: pts,
    stepDecimals: Math.max(0, Math.min(decimals, -Math.floor(Math.log10(step)) + (String(step / 10 ** Math.floor(Math.log10(step))).includes(".") ? 1 : 0))),
    stats: {
      first, last, change: last - first, pct: first ? ((last - first) / Math.abs(first)) * 100 : null,
      high: hi, highDay: pts[hiAt].d, low: lo, lowDay: pts[loAt].d, sessions: pts.length, from: pts[0].d, to: pts[pts.length - 1].d,
    },
  };
}
