/**
 * The geometry of the lessons' graphs (pipeline/lib/lesson.mjs normalizes what the writer gives; src/components/
 * Diagram.astro draws what this returns). Plain JavaScript, so the pipeline's self-test can hold each figure to the
 * economics it teaches: a floor sits above the market's price and opens a surplus, a ceiling below it and opens a
 * shortage, a tax puts what buyers pay above what sellers keep, a schedule's curves meet where code found they meet,
 * and every curve stays inside its frame.
 *
 * Built 2026-11-20 at the owner's word, after he asked why a tax wedge, the Card–Krueger minimum wage and the textbook
 * curves could not be drawn ("or you have not really try to make it happen?"): they had never been built, and the writer
 * had drawn a chain of boxes in 9 of the 10 lessons since the three first templates of 8 November.
 *
 * Every figure is a 640 × 410 drawing with the origin at (80, 350), price or value up, quantity or the cause to the
 * right, as the textbooks draw it. Text is placed with `direction="ltr"` anchors (start = left), as the axis names were.
 */

export const VIEW = { width: 640, height: 410 };
const O = { x: 80, y: 350 };
const TOP = 40;
const RIGHT = 600;
const GREEN = "var(--chart-1)";
const BLUE = "var(--chart-2)";

const fmt = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/^-/, "−");
const r1 = (v) => Math.round(v * 10) / 10;

/** The axes every figure but the value curve shares, with their names. */
function axes(yName, xName) {
  return [
    { k: "line", x1: O.x, y1: O.y, x2: O.x, y2: TOP - 6, cls: "fig__axis", arrow: true },
    { k: "line", x1: O.x, y1: O.y, x2: RIGHT + 12, y2: O.y, cls: "fig__axis", arrow: true },
    { k: "text", x: O.x, y: 22, text: yName, anchor: "start", cls: "fig__axis-name" },
    { k: "text", x: RIGHT + 12, y: 398, text: xName, anchor: "end", cls: "fig__axis-name" },
  ];
}

// ---------------------------------------------------------------- supply and demand
/** @typedef {[number, number]} Pt */
/** @typedef {[Pt, Pt]} Seg */
/** @type {Seg} */
const S = [[200, 320], [480, 80]];
/** @type {Seg} */
const D = [[200, 80], [480, 320]];
const move = (seg, dx) => /** @type {Seg} */ ([[seg[0][0] + dx, seg[0][1]], [seg[1][0] + dx, seg[1][1]]]);
/** Where two lines meet. */
export function cross(p, q) {
  const [[x1, y1], [x2, y2]] = p;
  const [[x3, y3], [x4, y4]] = q;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const a = x1 * y2 - y1 * x2;
  const b = x3 * y4 - y3 * x4;
  return [(a * (x3 - x4) - (x1 - x2) * b) / den, (a * (y3 - y4) - (y1 - y2) * b) / den];
}
/** A line's x at height y, and its y at x. */
const atY = (seg, y) => seg[0][0] + ((y - seg[0][1]) * (seg[1][0] - seg[0][0])) / (seg[1][1] - seg[0][1]);
const atX = (seg, x) => seg[0][1] + ((x - seg[0][0]) * (seg[1][1] - seg[0][1])) / (seg[1][0] - seg[0][0]);
/** A curve's name at its far end: above a high end, beside a low one (below it would sit on the quantity axis). */
const endLabel = (seg, name, color) => (seg[1][1] < 200 ? { k: "text", x: seg[1][0], y: seg[1][1] - 14, text: name, anchor: "middle", cls: "fig__curve", color } : { k: "text", x: seg[1][0] + 22, y: seg[1][1] + 6, text: name, anchor: "middle", cls: "fig__curve", color });
const seg = (s, color, dashed = false) => ({ k: "line", x1: s[0][0], y1: s[0][1], x2: s[1][0], y2: s[1][1], cls: "fig__line", color, dash: dashed });
/** Dashed guides from a point to the price axis (when it has a mark there) and to the quantity axis (likewise). */
function guides([x, y], priceMark, quantityMark) {
  return [
    ...(priceMark ? [{ k: "line", x1: O.x, y1: y, x2: x, y2: y, cls: "fig__guide" }] : []),
    ...(quantityMark ? [{ k: "line", x1: x, y1: y, x2: x, y2: O.y, cls: "fig__guide" }] : []),
    ...(priceMark ? [{ k: "text", x: O.x - 8, y: y + 5, text: priceMark, anchor: "end", cls: "fig__tick" }] : []),
    ...(quantityMark ? [{ k: "text", x, y: O.y + 22, text: quantityMark, anchor: "middle", cls: "fig__tick" }] : []),
  ];
}
const dot = ([x, y], color) => ({ k: "dot", x, y, color });

const SHIFT = 100;
const dxOf = (shift) => (shift.endsWith("_up") ? SHIFT : -SHIFT);

/**
 * A supply-and-demand figure: one curve or both shifting, a price floor or ceiling with the gap it opens, or a tax or a
 * subsidy between what buyers pay and sellers keep. Returns { items, key, summary, facts } (facts: the geometry the
 * self-test reads).
 */
export function supplyDemand(fig) {
  const items = [...axes(fig.price, fig.quantity)];
  const key = [];
  const E0 = cross(S, D);
  if (fig.control) {
    const floor = fig.control.kind === "floor";
    const y = floor ? 145 : 255;
    const qd = atY(D, y);
    const qs = atY(S, y);
    items.push(seg(S, GREEN), endLabel(S, "ع", GREEN), seg(D, BLUE), endLabel(D, "ط", BLUE));
    items.push(...guides(E0, "س*", null), dot(E0));
    items.push({ k: "line", x1: O.x, y1: y, x2: RIGHT - 10, y2: y, cls: "fig__control" });
    // Its name at the line's open left end: at the right end a phone's larger type ran it into the supply curve.
    items.push({ k: "text", x: O.x + 8, y: y - 10, text: fig.control.label, anchor: "start", cls: "fig__control-name" });
    items.push(...guides([qd, y], null, "ك ط"), ...guides([qs, y], null, "ك ع"));
    // The gap the controlled price opens, bracketed between the two quantities, on the open side of the line.
    const by = floor ? y - 24 : y + 24;
    const [from, to] = [Math.min(qd, qs), Math.max(qd, qs)];
    items.push({ k: "line", x1: from + 4, y1: by, x2: to - 4, y2: by, cls: "fig__gap", arrow: true, both: true });
    items.push({ k: "text", x: (from + to) / 2, y: floor ? by - 9 : by + 20, text: fig.control.gap, anchor: "middle", cls: "fig__gap-name" });
    items.push(dot([qd, y], BLUE), dot([qs, y], GREEN));
    key.push({ color: GREEN, text: `ع: ${fig.supply}` }, { color: BLUE, text: `ط: ${fig.demand}` }, { control: true, text: fig.control.label }, { text: "ك ط: الكمية المطلوبة · ك ع: الكمية المعروضة" });
    const summary = `${fig.title}: ${fig.control.label} ${floor ? "فوق" : "دون"} سعر السوق، فالكمية المطلوبة ${floor ? "أقل" : "أكثر"} من الكمية المعروضة، والفرق ${fig.control.gap}.`;
    return { items, key, summary, facts: { kind: fig.control.kind, controlY: y, marketY: E0[1], demanded: qd, supplied: qs } };
  }
  if (fig.wedge) {
    const tax = fig.wedge.kind === "tax";
    // A tax moves the supply curve up by its amount (left, in this drawing), a subsidy down (right).
    const S2 = move(S, tax ? -82 : 82);
    const E1 = cross(S2, D);
    const q1 = E1[0];
    const buyers = E1[1];
    const sellers = atX(S, q1);
    items.push(seg(S, GREEN), endLabel(S, "ع1", GREEN), seg(S2, GREEN, true), endLabel(S2, "ع2", GREEN), seg(D, BLUE), endLabel(D, "ط", BLUE));
    // The trades the tax prevents (or the subsidy pays for beyond the market's), shaded between the old and new quantity.
    items.push({ k: "poly", points: [E0, [q1, buyers], [q1, sellers]], cls: "fig__lost" });
    items.push(...guides(E0, "س*", "ك*"), ...guides([q1, buyers], "س م", "ك1"), ...guides([q1, sellers], "س ب", null));
    items.push({ k: "line", x1: q1, y1: buyers, x2: q1, y2: sellers, cls: "fig__wedge" });
    items.push(dot(E0), dot([q1, buyers], BLUE), dot([q1, sellers], GREEN));
    key.push({ color: GREEN, text: `ع1: ${fig.supply}` }, { color: GREEN, dashed: true, text: tax ? "ع2: العرض بعد الضريبة" : "ع2: العرض بعد الدعم" }, { color: BLUE, text: `ط: ${fig.demand}` }, { wedge: true, text: fig.wedge.label }, { lost: true, text: fig.wedge.lost }, { text: "س م: ما يدفعه المشتري · س ب: ما يتسلمه البائع" });
    const summary = `${fig.title}: ${fig.wedge.label} ${tax ? "يرفع ما يدفعه المشتري فوق ما يتسلمه البائع ويقلل الكمية" : "يخفض ما يدفعه المشتري تحت ما يتسلمه البائع ويزيد الكمية"}، والمثلث المظلل ${fig.wedge.lost}.`;
    return { items, key, summary, facts: { kind: fig.wedge.kind, buyersY: buyers, sellersY: sellers, marketY: E0[1], quantity: q1, marketQuantity: E0[0] } };
  }
  // A shift: one curve, or both.
  const shifts = [fig.shift, fig.shift2].filter(Boolean);
  const demandShift = shifts.find((s) => s.startsWith("demand"));
  const supplyShift = shifts.find((s) => s.startsWith("supply"));
  const S2 = supplyShift ? move(S, dxOf(supplyShift)) : S;
  const D2 = demandShift ? move(D, dxOf(demandShift)) : D;
  const E2 = cross(S2, D2);
  items.push(seg(S, GREEN), endLabel(S, supplyShift ? "ع1" : "ع", GREEN));
  if (supplyShift) items.push(seg(S2, GREEN, true), endLabel(S2, "ع2", GREEN));
  items.push(seg(D, BLUE), endLabel(D, demandShift ? "ط1" : "ط", BLUE));
  if (demandShift) items.push(seg(D2, BLUE, true), endLabel(D2, "ط2", BLUE));
  // The price and quantity before (1) and after (2), read off the axes; a mark is not printed twice on one spot.
  const samePrice = Math.abs(E2[1] - E0[1]) < 16;
  const sameQuantity = Math.abs(E2[0] - E0[0]) < 22;
  items.push(...guides(E0, "س1", "ك1"), ...guides(E2, samePrice ? null : "س2", sameQuantity ? null : "ك2"));
  // The shift arrows: demand's high on its line; supply's high when it moves alone, low when both move, so they never meet.
  const arrow = (from, to, y) => ({ k: "line", x1: from + Math.sign(to - from) * 6, y1: y, x2: to - Math.sign(to - from) * 8, y2: y, cls: "fig__shift", arrow: true });
  if (demandShift) items.push(arrow(atY(D, 112), atY(D2, 112), 112));
  if (supplyShift) {
    const y = demandShift ? 300 : 112;
    items.push(arrow(atY(S, y), atY(S2, y), y));
  }
  items.push(dot(E0), dot(E2));
  key.push({ color: GREEN, text: `ع: ${fig.supply}` }, { color: BLUE, text: `ط: ${fig.demand}` }, { text: "1 قبل، 2 بعد" });
  const moved = [demandShift && `${fig.demand} ${demandShift.endsWith("_up") ? "يزيد" : "ينقص"}`, supplyShift && `${fig.supply} ${supplyShift.endsWith("_up") ? "يزيد" : "ينقص"}`].filter(Boolean).join(" و");
  const summary = `${fig.title}: ${moved}، فينتقل ${fig.price} من س1 إلى س2 و${fig.quantity} من ك1 إلى ك2.`;
  return { items, key, summary, facts: { before: E0, after: E2 } };
}

// ---------------------------------------------------------------- a schedule of real (or round) numbers
/** A round top for an axis: 1, 2, 2.5 or 5 times a power of ten, at or above the largest value. */
function niceTop(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
}

/** A schedule plotted: the demand and supply points as two lines, the equilibrium code found, each row's price marked. */
export function schedule(fig) {
  const qTop = niceTop(Math.max(...fig.rows.flatMap((r) => [r.demand, r.supply])) * 1.05);
  const pTop = niceTop(Math.max(...fig.rows.map((r) => r.price)) * 1.08);
  const X = (q) => O.x + (q / qTop) * 500;
  const Y = (p) => O.y - (p / pTop) * 290;
  const name = (label, unit) => (unit ? `${label} (${unit})` : label);
  const items = [...axes(name(fig.price, fig.priceUnit), name(fig.quantity, fig.quantityUnit))];
  const demand = fig.rows.map((r) => [X(r.demand), Y(r.price)]);
  const supply = fig.rows.map((r) => [X(r.supply), Y(r.price)]);
  const pathOf = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)},${r1(y)}`).join(" ");
  const eq = [X(fig.equilibrium.quantity), Y(fig.equilibrium.price)];
  // Each row's price on the axis, but not one sitting on the equilibrium's own mark.
  for (const r of fig.rows) if (Math.abs(Y(r.price) - eq[1]) >= 14) items.push({ k: "text", x: O.x - 8, y: Y(r.price) + 5, text: fmt(r.price), anchor: "end", cls: "fig__tick fig__tick--soft" });
  // Quantity marks at a round step (5, 10, 15; never 3.75), as an axis is printed.
  const qStep = [1, 2, 2.5, 5, 10].map((m) => m * 10 ** Math.floor(Math.log10(qTop / 5))).find((m) => m >= qTop / 5) ?? qTop / 4;
  const qMarks = Array.from({ length: Math.floor(qTop / qStep + 1e-9) }, (_, i) => (i + 1) * qStep);
  for (const q of qMarks) if (Math.abs(X(q) - eq[0]) >= 30) items.push({ k: "text", x: X(q), y: O.y + 22, text: fmt(q), anchor: "middle", cls: "fig__tick fig__tick--soft" });
  items.push({ k: "path", d: pathOf(supply), cls: "fig__line", color: GREEN }, { k: "path", d: pathOf(demand), cls: "fig__line", color: BLUE });
  for (const p of supply) items.push({ k: "dot", x: p[0], y: p[1], color: GREEN, small: true });
  for (const p of demand) items.push({ k: "dot", x: p[0], y: p[1], color: BLUE, small: true });
  const topD = demand.at(-1);
  const topS = supply.at(-1);
  items.push({ k: "text", x: topD[0], y: topD[1] - 14, text: "ط", anchor: "middle", cls: "fig__curve", color: BLUE }, { k: "text", x: topS[0], y: topS[1] - 14, text: "ع", anchor: "middle", cls: "fig__curve", color: GREEN });
  items.push(...guides(eq, fmt(fig.equilibrium.price), fmt(fig.equilibrium.quantity)).map((it) => (it.k === "text" ? { ...it, cls: "fig__tick fig__tick--eq" } : it)), dot(eq));
  const key = [{ color: BLUE, text: "ط: الكمية المطلوبة" }, { color: GREEN, text: "ع: الكمية المعروضة" }, { text: `التوازن: ${fig.price} ${fmt(fig.equilibrium.price)}، ${fig.quantity} ${fmt(fig.equilibrium.quantity)}` }];
  const summary = `${fig.title}: يلتقي الطلب والعرض عند ${fig.price} ${fmt(fig.equilibrium.price)} و${fig.quantity} ${fmt(fig.equilibrium.quantity)}.`;
  return { items, key, summary, facts: { equilibrium: eq, demand, supply } };
}

// ---------------------------------------------------------------- the field's named curves
const MAP = (t, v) => [O.x + 500 * t, O.y - 290 * v];
const sample = (fn, t0 = 0, t1 = 1, n = 64) => Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n).map((t) => MAP(t, fn(t)));
const pathOf = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)},${r1(y)}`).join(" ");
/** A smooth line through points (Catmull–Rom), for a shape given by its turning points. */
function through(points) {
  const pts = points.map(([t, v]) => MAP(t, v));
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(p2[0])},${r1(p2[1])}`;
  }
  return d;
}

const laffer = (t) => 0.88 * 4 * t * (1 - t);
const kuznets = (t) => 0.82 * Math.sin(Math.PI * t ** 0.8);
const phillips = (t) => 0.06 + 0.82 * Math.exp(-3.4 * t);
const lorenz = (t) => t ** 2.4;
const lorenz2 = (t) => t ** 4.2;
const diminishing = (t) => 0.88 * Math.sqrt(t);
const YIELD = { normal: (t) => 0.2 + 0.5 * (1 - Math.exp(-3.5 * t)), flat: (t) => 0.46 + 0.03 * t, inverted: (t) => 0.72 - 0.42 * (1 - Math.exp(-3.5 * t)) };
const J = [[0, 0.5], [0.12, 0.32], [0.26, 0.27], [0.45, 0.5], [0.7, 0.72], [1, 0.82]];
/** Prospect theory's value curve over gains and losses from the reference point (t = 0.5): steeper for losses. */
const valueCurve = (t) => {
  const u = (t - 0.5) * 2;
  return u >= 0 ? 0.5 + 0.38 * (1 - Math.exp(-2.2 * u)) : 0.5 - 0.46 * (1 - Math.exp(3.2 * u));
};

/** Where each named point sits on its shape, as (t, v). */
const MARKS = {
  laffer: { peak: [0.5, laffer(0.5)], left: [0.22, laffer(0.22)], right: [0.82, laffer(0.82)] },
  kuznets: { peak: [0.42, kuznets(0.42)], left: [0.14, kuznets(0.14)], right: [0.84, kuznets(0.84)] },
  ppf: { inside: [0.32, 0.3], on: [0.85 * Math.SQRT1_2, 0.85 * Math.SQRT1_2], outside: [0.8, 0.78] },
  j_curve: { bottom: [0.25, 0.268], end: [1, 0.82] },
  value_function: { gain: [0.8, valueCurve(0.8)], loss: [0.2, valueCurve(0.2)] },
};

/**
 * Where a point's name goes beside its dot, on the side the curve leaves open: above a peak, beside a slope away from
 * it, under a trough (dx, dy, anchor). The first test page set «الرفع هنا يقلل الحصيلة» across the Laffer curve.
 */
const PLACE = {
  peak: [0, -14, "middle"],
  // A hill's slopes: the name under the dot, inside the hill, where the curve leaves room (beside it, the right slope's
  // name ran past the drawing's edge).
  left: [12, 24, "start"],
  right: [-12, 24, "end"],
  inside: [0, 26, "middle"],
  on: [12, -10, "start"],
  outside: [0, -14, "middle"],
  bottom: [0, 30, "middle"],
  end: [-12, -14, "end"],
  gain: [-12, -14, "end"],
  loss: [12, 26, "start"],
};

/** A named curve drawn as its shape, its axes, second curve and points named by the writer. */
export function curve(fig) {
  const items = fig.shape === "value_function" ? [] : [...axes(fig.y, fig.x)];
  const key = [{ color: GREEN, text: fig.label }];
  const main = (d) => ({ k: "path", d, cls: "fig__line", color: GREEN });
  const second = (d) => ({ k: "path", d, cls: "fig__line", color: BLUE, dash: true });
  const ends = (low, high) => [{ k: "text", x: O.x, y: O.y + 22, text: low, anchor: "middle", cls: "fig__tick fig__tick--soft" }, { k: "text", x: O.x + 500, y: O.y + 22, text: high, anchor: "middle", cls: "fig__tick fig__tick--soft" }];
  const vEnds = (low, high) => [{ k: "text", x: O.x - 8, y: O.y + 5, text: low, anchor: "end", cls: "fig__tick fig__tick--soft" }, { k: "text", x: O.x - 8, y: O.y - 290 + 5, text: high, anchor: "end", cls: "fig__tick fig__tick--soft" }];
  let path = "";
  switch (fig.shape) {
    case "laffer":
      path = pathOf(sample(laffer));
      items.push(...ends("0%", "100%"));
      break;
    case "kuznets":
      path = pathOf(sample(kuznets));
      break;
    case "phillips":
      path = pathOf(sample(phillips, 0.04, 0.96));
      if (fig.second) items.push(second(pathOf(sample((t) => phillips(t) + 0.2, 0.04, 0.8))));
      if (fig.longRun) {
        const [x] = MAP(0.42, 0);
        items.push({ k: "line", x1: x, y1: O.y, x2: x, y2: TOP + 10, cls: "fig__control" }, { k: "text", x: x + 8, y: TOP + 22, text: fig.longRun.label, anchor: "start", cls: "fig__control-name" });
      }
      break;
    case "ppf": {
      const arc = (r) => pathOf(Array.from({ length: 65 }, (_, i) => (Math.PI / 2) * (i / 64)).map((a) => MAP(r * Math.cos(a), r * Math.sin(a))));
      path = arc(0.85);
      if (fig.second) items.push(second(arc(1)));
      break;
    }
    case "lorenz": {
      const line = sample(lorenz);
      const diagonal = [MAP(0, 0), MAP(1, 1)];
      items.push({ k: "poly", points: [...diagonal, ...[...line].reverse()], cls: "fig__shade" });
      items.push({ k: "line", x1: diagonal[0][0], y1: diagonal[0][1], x2: diagonal[1][0], y2: diagonal[1][1], cls: "fig__guide fig__guide--strong" });
      items.push({ k: "text", x: MAP(0.62, 0.62)[0] - 10, y: MAP(0.62, 0.62)[1] - 10, text: "المساواة التامة", anchor: "end", cls: "fig__tick" });
      if (fig.second) items.push(second(pathOf(sample(lorenz2))));
      items.push(...ends("0%", "100%"), ...vEnds("0%", "100%"));
      path = pathOf(line);
      break;
    }
    case "diminishing": {
      path = pathOf(sample(diminishing));
      // Equal steps of the input, each adding less output than the one before.
      const steps = [0.08, 0.3, 0.52, 0.74, 0.96];
      for (let i = 0; i < steps.length - 1; i += 1) {
        const [a, b] = [MAP(steps[i], diminishing(steps[i])), MAP(steps[i + 1], diminishing(steps[i + 1]))];
        items.push({ k: "line", x1: a[0], y1: a[1], x2: b[0], y2: a[1], cls: "fig__guide" }, { k: "line", x1: b[0], y1: a[1], x2: b[0], y2: b[1], cls: "fig__rise" });
      }
      break;
    }
    case "yield_curve":
      path = pathOf(sample(YIELD[fig.variant ?? "normal"]));
      if (fig.second) items.push(second(pathOf(sample(YIELD[fig.second.variant]))));
      break;
    case "j_curve": {
      const zero = MAP(0, 0.5);
      items.push({ k: "line", x1: O.x, y1: zero[1], x2: O.x + 500, y2: zero[1], cls: "fig__guide fig__guide--strong" }, { k: "text", x: O.x - 8, y: zero[1] + 5, text: "0", anchor: "end", cls: "fig__tick" });
      path = through(J);
      break;
    }
    case "value_function": {
      // Its axes cross at the reference point: gains to the right, losses to the left, value up and down.
      const c = MAP(0.5, 0.5);
      items.push(
        { k: "line", x1: O.x, y1: c[1], x2: O.x + 512, y2: c[1], cls: "fig__axis", arrow: true, both: true },
        { k: "line", x1: c[0], y1: O.y, x2: c[0], y2: TOP - 6, cls: "fig__axis", arrow: true, both: true },
        { k: "text", x: c[0] + 8, y: 22, text: fig.y, anchor: "start", cls: "fig__axis-name" },
        { k: "text", x: O.x + 512, y: c[1] + 26, text: fig.x, anchor: "end", cls: "fig__axis-name" },
        { k: "text", x: O.x + 490, y: c[1] - 10, text: "مكاسب", anchor: "end", cls: "fig__tick fig__tick--soft" },
        { k: "text", x: O.x + 10, y: c[1] - 10, text: "خسائر", anchor: "start", cls: "fig__tick fig__tick--soft" },
        { k: "text", x: c[0] + 8, y: c[1] + 22, text: "نقطة المرجع", anchor: "start", cls: "fig__tick fig__tick--soft" },
      );
      path = pathOf(sample(valueCurve));
      break;
    }
  }
  items.push(main(path));
  if (fig.second) key.push({ color: BLUE, dashed: true, text: fig.second.label });
  if (fig.longRun) key.push({ control: true, text: fig.longRun.label });
  // The writer's points, each a dot on its place and its name above it, kept inside the frame.
  for (const m of fig.marks ?? []) {
    const at = MARKS[fig.shape]?.[m.at];
    if (!at) continue;
    const [x, y] = MAP(at[0], at[1]);
    if (m.at === "peak") items.push({ k: "line", x1: x, y1: y, x2: x, y2: O.y, cls: "fig__guide" });
    const [dx, dy, anchor] = PLACE[m.at] ?? [0, -14, "middle"];
    items.push({ k: "dot", x, y, color: GREEN }, { k: "text", x: x + dx, y: y + dy, text: m.label, anchor, cls: "fig__mark" });
  }
  const summary = `${fig.title}: ${fig.label}${fig.second ? ` و${fig.second.label}` : ""}.`;
  return { items, key, summary, facts: { path } };
}

/** The drawing of any graph template, or null for the templates drawn in HTML (flows, chain). */
export function drawFigure(fig) {
  if (!fig) return null;
  if (fig.type === "supply_demand") return supplyDemand(fig);
  if (fig.type === "schedule") return schedule(fig);
  if (fig.type === "curve") return curve(fig);
  return null;
}
