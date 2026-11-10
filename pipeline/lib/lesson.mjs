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
  const terms = (Array.isArray(w.terms) ? w.terms : []).map((t) => ({ label: text(t?.label, 80), value: num(t?.value), unit: text(t?.unit, 30) })).filter((t) => t.label && t.value !== null);
  if (terms.length < op.terms[0] || terms.length > op.terms[1]) return null;
  if (op.sameUnit && new Set(terms.map((t) => t.unit)).size > 1) return null;
  const hypothetical = w.hypothetical === true;
  if (hypothetical && terms.some((t) => !Number.isInteger(t.value) || (Math.abs(t.value) > 10 && t.value % 5 !== 0))) return null;
  const raw = op.compute(terms.map((t) => t.value));
  if (raw === null || !Number.isFinite(raw)) return null;
  const decimals = op.percent || w.op === "ratio" ? 1 : Math.min(2, Math.max(...terms.map((t) => decimalsOf(t.value))));
  const title = text(w.title, 120);
  const formula = text(w.formula, 200);
  const result = { label: text(w.result?.label, 80), unit: op.percent ? "%" : text(w.result?.unit ?? (op.sameUnit ? terms[0].unit : ""), 30), value: round(raw, decimals) };
  if (!title || !formula || !result.label) return null;
  return { title, formula, op: w.op, terms, result, hypothetical, section: sectionOf(w.section) };
}

const SHIFTS = new Set(["demand_up", "demand_down", "supply_up", "supply_down"]);

/**
 * A diagram as the writer gave it, made sound, or null. Three templates the site draws (src/components/Diagram.astro):
 *  - supply_demand: the price on the vertical axis, the quantity on the horizontal, a supply and a demand curve named,
 *    and ONE of them shifting (a figure with nothing moving explains nothing);
 *  - flows: what flows into something and out of it (one to three each, with the stories' values and one unit), and the
 *    net, computed here;
 *  - chain: two to five short steps, cause to effect.
 */
export function normalizeDiagram(d) {
  if (!d || typeof d !== "object") return null;
  const title = text(d.title, 120);
  const caption = text(d.caption, 220);
  const section = sectionOf(d.section);
  if (!title) return null;
  if (d.type === "supply_demand") {
    const fig = { type: "supply_demand", title, caption, section, price: text(d.price, 50), quantity: text(d.quantity, 50), supply: text(d.supply, 40), demand: text(d.demand, 40), shift: SHIFTS.has(d.shift) ? d.shift : null };
    return fig.price && fig.quantity && fig.supply && fig.demand && fig.shift ? fig : null;
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
  return [
    part.title, part.caption, part.center, part.price, part.quantity, part.supply, part.demand, part.result?.label,
    ...(part.terms ?? []).map((t) => t.label), ...(part.inflows ?? []).map((f) => f.label), ...(part.outflows ?? []).map((f) => f.label),
    ...(part.steps ?? []),
  ].filter(Boolean).join(" ");
}

/** What code computed from figures already held to the stories (the example's result, the flows' difference): grounded by construction. */
export function lessonResults(...parts) {
  return parts.flatMap((p) => (p && !p.hypothetical ? [p.result?.value, p.net] : [])).filter((v) => Number.isFinite(v));
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
  "diagram": null or {"type": "supply_demand", "title": "Arabic: what the figure shows", "price": "Arabic: the vertical axis, the price of the thing traded", "quantity": "Arabic: the horizontal axis, its quantity", "supply": "Arabic name of the supply curve", "demand": "Arabic name of the demand curve", "shift": "demand_up" | "demand_down" | "supply_up" | "supply_down", "caption": "one Arabic sentence: what moves and what follows"} or {"type": "flows", "title": "...", "center": "Arabic: what the money flows into and out of", "inflows": [{"label": "Arabic", "value": number}], "outflows": [{"label": "Arabic", "value": number}], "unit": "Arabic unit", "caption": "..."} or {"type": "chain", "title": "...", "steps": ["2-5 short Arabic steps, cause to effect, each a subject and its verb"], "caption": "..."}; each figure also carries "section": the number of the subheaded step it shows (1, 2 or 3)`;
