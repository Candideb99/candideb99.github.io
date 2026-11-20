/**
 * The explainer as a simplified textbook lesson (the owner, 2026-11-08, on «احتياطي مصر عند مستوى قياسي، فلماذا تقيّد
 * الحكومة إنفاق الدولار؟»: "this article has turned into news reporting instead of being simplified economics class, i had
 * expected this section to be like economics textbooks with graphs, mathematics and everything (but simplified for
 * everyone to understand)"). Beside the text, two parts a textbook has and the section never had, both checked in code:
 *
 *  - `worked`: the calculation the answer rests on, the formula said in words and worked through with the stories' real
 *    figures (or, where they give none for the mechanism, round numbers said to be an illustration). The result is
 *    computed here, never taken from a model, so the arithmetic printed is always right.
 *  - `diagram`: one textbook figure the site draws from a fixed template: supply and demand with one curve shifting, money
 *    flowing into and out of something, or a chain of cause and effect. No picture is generated; the figure's numbers,
 *    where it has any, are held to the sources as a chart's are (verify.mjs).
 *
 * The figures come from the week's stories, as the owner asked on 2026-10-23 when he found explainers priced in invented
 * «وحدات نقدية» to be machine writing.
 */
import { normalizeDigits } from "./util.mjs";

/**
 * A label at most `max` characters, cut at a word and never inside brackets: the first test lesson printed «…لو توقفت
 * التدفقات الرأسمالية وا» and «تدفقات الاستثمار والقروض (الحساب الرأسمالي والمالي», cut mid-word and mid-bracket, and
 * its critic called the example's name truncated (2026-11-08). The writer is asked for short labels; this is the net.
 */
const text = (v, max) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, max).replace(/\s+\S*$/, "");
  const open = cut.lastIndexOf("(");
  if (open > cut.lastIndexOf(")")) cut = cut.slice(0, open);
  return cut.replace(/[\s،,؛:(«-]+$/u, "").trim();
};
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(normalizeDigits(String(v ?? "")).replace(/[,\s]/g, "").replace(/−/g, "-"));
  return String(v ?? "").trim() && Number.isFinite(n) ? n : null;
};
const decimalsOf = (n) => {
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
};
const round = (n, d) => Number(n.toFixed(d));
/** The step a part prints in (the page sets it after that step's first paragraph), or null: the page's default place. */
const sectionOf = (v) => {
  const n = num(v);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
};

/** The operations a worked example may carry: how many terms, the sign printed between them, and the result. */
export const WORKED_OPS = {
  difference: { terms: [2, 2], sign: "−", sameUnit: true, compute: ([a, b]) => a - b },
  sum: { terms: [2, 6], sign: "+", sameUnit: true, compute: (t) => t.reduce((s, x) => s + x, 0) },
  ratio: { terms: [2, 2], sign: "÷", compute: ([a, b]) => (b ? a / b : null) },
  share: { terms: [2, 2], sign: "÷", percent: true, compute: ([a, b]) => (b ? (a / b) * 100 : null) },
  change: { terms: [2, 2], sameUnit: true, percent: true, compute: ([a, b]) => (a ? ((b - a) / a) * 100 : null) },
  // The rise that brings a level back after a fall of the one term's percent: fall ÷ (100 − fall) × 100. A base effect's
  // lesson rests on it, and its base, 100 less the fall, is a figure no story prints, so the sum could not be shown: the
  // explainer of 10 November cut its own answer («a 23.5% fall needs a 30.7% rise») to «more than 23.5%» (2026-11-10).
  recovery: { terms: [1, 1], percent: true, compute: ([fall]) => (fall > 0 && fall < 100 ? (fall / (100 - fall)) * 100 : null) },
};

/**
 * A worked example as the writer gave it, made sound, or null: a known operation, the right number of labelled terms
 * with their values, one unit where the sum needs one, and the result computed here and rounded to the inputs' precision
 * (a percentage and a ratio to one decimal). A hypothetical example must use round numbers (none above ten that is not
 * a multiple of five), which the page labels as an illustration.
 */
export function normalizeWorked(w) {
  if (!w || typeof w !== "object") return null;
  const op = WORKED_OPS[w.op];
  if (!op) return null;
  // An invented money unit («وحدة نقدية») is no unit (the owner, 2026-10-23, called pieces priced in it machine writing; the
  // first Ibn Khaldun dry run of 2026-11-20 used it): the figure stands without one.
  const unitOf = (u) => (/^وحد(?:ة|ات) نقدية$/.test(text(u, 30)) ? "" : text(u, 30));
  const terms = (Array.isArray(w.terms) ? w.terms : []).map((t) => ({ label: text(t?.label, 80), value: num(t?.value), unit: unitOf(t?.unit) })).filter((t) => t.label && t.value !== null);
  if (terms.length < op.terms[0] || terms.length > op.terms[1]) return null;
  if (op.sameUnit && new Set(terms.map((t) => t.unit)).size > 1) return null;
  const hypothetical = w.hypothetical === true;
  if (hypothetical && terms.some((t) => !Number.isInteger(t.value) || (Math.abs(t.value) > 10 && t.value % 5 !== 0))) return null;
  const raw = op.compute(terms.map((t) => t.value));
  if (raw === null || !Number.isFinite(raw)) return null;
  const decimals = op.percent || w.op === "ratio" ? 1 : Math.min(2, Math.max(...terms.map((t) => decimalsOf(t.value))));
  const title = text(w.title, 120);
  const formula = text(w.formula, 200);
  const result = { label: text(w.result?.label, 80), unit: op.percent ? "%" : unitOf(w.result?.unit ?? (op.sameUnit ? terms[0].unit : "")), value: round(raw, decimals) };
  if (!title || !formula || !result.label) return null;
  return { title, formula, op: w.op, terms, result, hypothetical, section: sectionOf(w.section) };
}

const SHIFTS = new Set(["demand_up", "demand_down", "supply_up", "supply_down"]);
const CONTROLS = new Set(["floor", "ceiling"]);
const WEDGES = new Set(["tax", "subsidy"]);

/**
 * The textbook curves the site draws as shapes (src/lib/figures.mjs): what each may mark, and its second curve. The
 * owner, 2026-11-20, asking why a tax wedge, the Card–Krueger minimum wage and the textbook curves could not be drawn:
 * they had never been built, and with three templates the writer drew a chain of boxes in 9 of the 10 lessons since
 * 8 November, the oil-surplus explainer, a supply-and-demand story, included.
 */
export const CURVE_SHAPES = {
  laffer: { marks: ["peak", "left", "right"] },
  kuznets: { marks: ["peak", "left", "right"] },
  phillips: { second: true, longRun: true },
  ppf: { marks: ["inside", "on", "outside"], second: true },
  lorenz: { second: true },
  diminishing: {},
  yield_curve: { variants: ["normal", "flat", "inverted"], second: true },
  j_curve: { marks: ["bottom", "end"] },
  value_function: { marks: ["gain", "loss"] },
};

/** Whether every value is an integer: a made-up schedule uses whole numbers, said to be an illustration. */
const whole = (values) => values.every((v) => Number.isInteger(v));

/**
 * A schedule's rows sorted by price, its demand falling and its supply rising as the price rises, and where the two
 * meet, found by code between the two rows where the excess demand changes sign; null when the rows do not cross.
 */
export function scheduleEquilibrium(rows) {
  for (let i = 0; i < rows.length - 1; i += 1) {
    const [a, b] = [rows[i], rows[i + 1]];
    const ea = a.demand - a.supply;
    const eb = b.demand - b.supply;
    if (ea === 0) return { price: a.price, quantity: a.demand };
    if (ea > 0 && eb <= 0) {
      const f = ea / (ea - eb);
      return { price: a.price + f * (b.price - a.price), quantity: a.demand + f * (b.demand - a.demand) };
    }
  }
  const last = rows.at(-1);
  return last && last.demand === last.supply ? { price: last.price, quantity: last.demand } : null;
}

/**
 * A diagram as the writer gave it, made sound, or null. The templates the site draws (src/components/Diagram.astro, its
 * geometry in src/lib/figures.mjs):
 *  - supply_demand: the price on the vertical axis, the quantity on the horizontal, a supply and a demand curve named,
 *    and ONE mechanism (a figure with nothing happening explains nothing): a curve shifting (`shift`, and `shift2` for
 *    the other curve when both move), a price held above or below the market's (`control`: a floor such as a minimum
 *    wage, or a ceiling such as a capped fuel price, with the gap it opens), or a tax or a subsidy between what buyers
 *    pay and sellers keep (`wedge`, with the trades it costs);
 *  - schedule: three to eight rows of prices with the quantities demanded and supplied, plotted, and the equilibrium
 *    computed here (the stories' figures, or whole numbers said to be an illustration);
 *  - curve: one of the field's named curves drawn as its shape (CURVE_SHAPES), its axes and points named by the writer;
 *  - flows: what flows into something and out of it (one to three each, with the stories' values and one unit), and the
 *    net, computed here;
 *  - chain: two to five short steps, cause to effect: the last resort, for a sequence of events no graph shows.
 */
export function normalizeDiagram(d) {
  if (!d || typeof d !== "object") return null;
  const title = text(d.title, 120);
  const caption = text(d.caption, 220);
  const section = sectionOf(d.section);
  if (!title) return null;
  if (d.type === "supply_demand") {
    const base = { type: "supply_demand", title, caption, section, price: text(d.price, 50), quantity: text(d.quantity, 50), supply: text(d.supply, 40), demand: text(d.demand, 40) };
    if (!base.price || !base.quantity || !base.supply || !base.demand) return null;
    const c = d.control && typeof d.control === "object" && CONTROLS.has(d.control.kind) ? d.control : null;
    const control = c && text(c.label, 40) ? { kind: c.kind, label: text(c.label, 40), gap: text(c.gap, 30) || (c.kind === "floor" ? "فائض" : "عجز") } : null;
    const w = d.wedge && typeof d.wedge === "object" && WEDGES.has(d.wedge.kind) ? d.wedge : null;
    const wedge = w && text(w.label, 40) ? { kind: w.kind, label: text(w.label, 40), lost: text(w.lost, 30) || "صفقات ضائعة" } : null;
    // One mechanism a figure: a floor and a tax at once is two lessons; a shift given beside either is dropped.
    if (control && wedge) return null;
    if (control || wedge) return { ...base, shift: null, shift2: null, control, wedge };
    const shift = SHIFTS.has(d.shift) ? d.shift : null;
    if (!shift) return null;
    const curveOf = (s) => s.split("_")[0];
    const shift2 = SHIFTS.has(d.shift2) && curveOf(d.shift2) !== curveOf(shift) ? d.shift2 : null;
    return { ...base, shift, shift2, control: null, wedge: null };
  }
  if (d.type === "schedule") {
    const rows = (Array.isArray(d.rows) ? d.rows : [])
      .map((r) => ({ price: num(r?.price), demand: num(r?.demand), supply: num(r?.supply) }))
      .filter((r) => r.price !== null && r.demand !== null && r.supply !== null && r.price >= 0 && r.demand >= 0 && r.supply >= 0)
      .sort((a, b) => a.price - b.price)
      .filter((r, i, all) => i === 0 || r.price !== all[i - 1].price);
    if (rows.length < 3 || rows.length > 8) return null;
    // A schedule that teaches the law of demand and supply: demand never rises with the price, supply never falls.
    for (let i = 1; i < rows.length; i += 1) if (rows[i].demand > rows[i - 1].demand || rows[i].supply < rows[i - 1].supply) return null;
    const hypothetical = d.hypothetical === true;
    const values = rows.flatMap((r) => [r.price, r.demand, r.supply]);
    if (hypothetical && !whole(values)) return null;
    const eq = scheduleEquilibrium(rows);
    if (!eq) return null;
    const decimals = Math.min(2, Math.max(...values.map(decimalsOf)));
    const fig = { type: "schedule", title, caption, section, price: text(d.price, 40), quantity: text(d.quantity, 40), priceUnit: text(d.price_unit ?? d.priceUnit, 24), quantityUnit: text(d.quantity_unit ?? d.quantityUnit, 24), rows, equilibrium: { price: round(eq.price, decimals), quantity: round(eq.quantity, decimals) }, hypothetical };
    return fig.price && fig.quantity ? fig : null;
  }
  if (d.type === "curve") {
    const shape = CURVE_SHAPES[d.shape] ? d.shape : null;
    if (!shape) return null;
    const spec = CURVE_SHAPES[shape];
    const fig = { type: "curve", shape, title, caption, section, x: text(d.x, 36), y: text(d.y, 36), label: text(d.label, 40) };
    if (!fig.x || !fig.y || !fig.label) return null;
    if (spec.variants) fig.variant = spec.variants.includes(d.variant) ? d.variant : spec.variants[0];
    const marks = (Array.isArray(d.marks) ? d.marks : []).map((m) => ({ at: m?.at, label: text(m?.label, 40) })).filter((m, i, all) => spec.marks?.includes(m.at) && m.label && all.findIndex((n) => n.at === m.at) === i);
    if (marks.length) fig.marks = marks.slice(0, 3);
    if (spec.second && d.second && typeof d.second === "object" && text(d.second.label, 40)) {
      const variant = spec.variants ? (spec.variants.includes(d.second.variant) && d.second.variant !== fig.variant ? d.second.variant : null) : undefined;
      if (variant !== null) fig.second = { label: text(d.second.label, 40), ...(variant ? { variant } : {}) };
    }
    if (spec.longRun && d.long_run && typeof d.long_run === "object" && text(d.long_run.label, 40)) fig.longRun = { label: text(d.long_run.label, 40) };
    return fig;
  }
  if (d.type === "flows") {
    const side = (list) => (Array.isArray(list) ? list : []).map((f) => ({ label: text(f?.label, 70), value: num(f?.value) })).filter((f) => f.label && f.value !== null && f.value >= 0).slice(0, 3);
    const inflows = side(d.inflows);
    const outflows = side(d.outflows);
    const center = text(d.center, 50);
    if (!inflows.length || !outflows.length || !center) return null;
    const decimals = Math.min(2, Math.max(...[...inflows, ...outflows].map((f) => decimalsOf(f.value))));
    const net = round(inflows.reduce((s, f) => s + f.value, 0) - outflows.reduce((s, f) => s + f.value, 0), decimals);
    return { type: "flows", title, caption, section, center, unit: text(d.unit, 30), inflows, outflows, net };
  }
  if (d.type === "chain") {
    const steps = (Array.isArray(d.steps) ? d.steps : []).map((s) => text(s, 60)).filter(Boolean);
    return steps.length >= 2 && steps.length <= 5 ? { type: "chain", title, caption, section, steps } : null;
  }
  return null;
}

/** The figures of a lesson's parts that must come from the stories: a real worked example's, and a flow's. */
export function lessonNumbers(part) {
  if (!part) return [];
  if (part.terms) return part.hypothetical ? [] : part.terms.map((t) => t.value);
  if (part.type === "flows") return [...part.inflows, ...part.outflows].map((f) => f.value);
  // A schedule of the stories' prices and quantities is held to them as a flow is; a made-up one is labelled so.
  if (part.type === "schedule") return part.hypothetical ? [] : part.rows.flatMap((r) => [r.price, r.demand, r.supply]);
  return [];
}

/**
 * The words a lesson's part prints beside its figures (its title, caption, labels and steps), held to the stories as a
 * chart's title and labels are (verify.mjs): a caption is printed on the page, and only the values had been checked.
 * Never the formula, whose constants («× 100») are no facts, and nothing of a hypothetical example, which is made up and
 * labelled so.
 */
export function lessonText(part) {
  if (!part || part.hypothetical) return "";
  return partLabels(part).join(" ");
}

/** Every word a lesson part prints: its title, caption and labels, of whichever template (lessonText, the page's layout). */
export function partLabels(part) {
  if (!part) return [];
  return [
    part.title, part.caption, part.center, part.price, part.quantity, part.supply, part.demand, part.result?.label,
    part.control?.label, part.control?.gap, part.wedge?.label, part.wedge?.lost, part.priceUnit, part.quantityUnit,
    part.x, part.y, part.label, part.second?.label, part.longRun?.label, ...(part.marks ?? []).map((m) => m.label),
    ...(part.terms ?? []).map((t) => t.label), ...(part.inflows ?? []).map((f) => f.label), ...(part.outflows ?? []).map((f) => f.label),
    ...(part.steps ?? []),
  ].filter(Boolean);
}

/**
 * What code computed from figures already held to the stories (the example's result, the flows' difference, a
 * schedule's equilibrium): grounded by construction.
 */
export function lessonResults(...parts) {
  return parts.flatMap((p) => (p && !p.hypothetical ? [p.result?.value, p.net, p.equilibrium?.price, p.equilibrium?.quantity] : [])).filter((v) => Number.isFinite(v));
}

/** A revision that dropped a lesson's part (the reviser answers with the keys it was asked for) keeps the one it had. */
export function keepLessonParts(before, after) {
  const out = { ...after };
  if (before?.worked && !after?.worked) out.worked = before.worked;
  if (before?.diagram && !after?.diagram) out.diagram = before.diagram;
  // The researcher's plan (write.mjs planExplainer) travels with the draft; a reviser never answers with it.
  if (before?.lessonPlan && !after?.lessonPlan) out.lessonPlan = before.lessonPlan;
  return out;
}

/** The schema lines the explainer writer fills (write.mjs EXPLAINER_SCHEMA). */
// Every label is short (at most six words): the page prints them beside their figures, and a long one is cut (text()).
export const LESSON_SCHEMA = `"worked": null or {"title": "Arabic: what the sum answers, as a short phrase", "formula": "Arabic: the formula in words, with = and the operation, as a textbook writes it («الربح = الإيرادات − التكاليف»)", "op": "difference" | "sum" | "ratio" | "share" | "change" | "recovery" (recovery: the rise, in percent, that brings a level back after a fall; its one term is the fall in percent as the material prints it, and the site computes fall ÷ (100 − fall) × 100: a base effect's lesson rests on it), "terms": [{"label": "Arabic, at most six words: what the figure is", "value": a number exactly as in the material, "unit": "Arabic unit"}], "result": {"label": "Arabic, at most six words: what the result is", "unit": "Arabic unit (for share, change and recovery it is %)"}, "hypothetical": false, which is true ONLY for small round numbers made up to illustrate; a what-if worked on the stories' real figures stays false, "section": the number of the subheaded step whose question it answers (1, 2 or 3)},
  "diagram": null or ONE figure, the graph the field itself draws for this mechanism (every label in Arabic and in the reader's words, at most six words; no number in a label unless the stories print it):
   {"type": "supply_demand", "title": "...", "price": "Arabic: the vertical axis, the price of the thing traded", "quantity": "Arabic: the horizontal axis", "supply": "Arabic name of the supply curve", "demand": "Arabic name of the demand curve", and EXACTLY ONE mechanism: "shift": "demand_up" | "demand_down" | "supply_up" | "supply_down" (with "shift2" for the other curve when both move), OR "control": {"kind": "floor" | "ceiling", "label": "Arabic: the price a rule holds above the market's (floor) or below it (ceiling), as the stories name it", "gap": "Arabic: what the gap between the quantities is (a surplus, a shortage, or what the stories call it)"}, OR "wedge": {"kind": "tax" | "subsidy", "label": "Arabic: the tax or subsidy as the stories name it", "lost": "Arabic: the trades it costs, if the default «صفقات ضائعة» does not fit"}, "caption": "one Arabic sentence: what happens and what follows"}
   or {"type": "schedule", "title": "...", "price": "Arabic axis name", "quantity": "Arabic axis name", "price_unit": "...", "quantity_unit": "...", "rows": [3-8 rows of {"price": number, "demand": number, "supply": number}, demand falling and supply rising as the price rises], "hypothetical": true only for whole numbers made up to illustrate (otherwise every number is one the stories print), "caption": "..."}: the site plots it and computes where the curves meet
   or {"type": "curve", "shape": "laffer" | "phillips" | "ppf" | "lorenz" | "kuznets" | "diminishing" | "yield_curve" | "j_curve" | "value_function", "title": "...", "x": "Arabic: the horizontal axis", "y": "Arabic: the vertical axis", "label": "Arabic name of the curve", "marks": [{"at": a point the shape has (laffer and kuznets: "peak", "left", "right"; ppf: "inside", "on", "outside"; j_curve: "bottom", "end"; value_function: "gain", "loss"), "label": "Arabic: what that point is in this piece"}], "second": {"label": "Arabic name of a second curve", "variant": for yield_curve only} for phillips (higher expectations), ppf (a grown frontier), lorenz (another distribution) or yield_curve, "variant": "normal" | "flat" | "inverted" for yield_curve, "long_run": {"label": "..."} for phillips' vertical long run, "caption": "..."}: the field's named curves drawn as their shapes (the Laffer curve, the Phillips curve, the production possibility frontier, the Lorenz curve, the Kuznets curve, diminishing returns, the yield curve, the J-curve after a devaluation, prospect theory's value curve)
   or {"type": "flows", "title": "...", "center": "Arabic: what the money flows into and out of", "inflows": [{"label": "Arabic", "value": number}], "outflows": [{"label": "Arabic", "value": number}], "unit": "Arabic unit", "caption": "..."}
   or, LAST, {"type": "chain", "title": "...", "steps": ["2-5 short Arabic steps, cause to effect, each a subject and its verb"], "caption": "..."}: only for a sequence of events that no graph of the field shows; a chain where the field draws a graph (a price moved by supply and demand, a price held above or below the market's, a tax, a trade-off, a curve) teaches less than the graph.
   Each figure also carries "section": the number of the subheaded step it shows (1, 2 or 3)`;
