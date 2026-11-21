/**
 * The working line of an explainer's worked example (WorkedExample.astro): the sum its result was computed from
 * (pipeline/lib/lesson.mjs), written as a textbook writes it. Plain JavaScript, so the pipeline's self-test reads it.
 */

/** A figure as the site prints it: Western digits, a true minus, no more decimals than it has. */
export function figure(v) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/^-/, "−");
}

/**
 * A figure the sum works on: a negative one in brackets, «(−1)», as a textbook writes it. Bare, two minus signs stood
 * side by side, and on a right-to-left line the first figure's sign touched the operator too: the Card–Krueger piece
 * printed «−1 − −1 = 0», which read from the right as «1− − 1− = 0» (the owner, 2026-11-21: "-1--1= 0 or something
 * like that, it was writing in confusing way for me as an arabic reader"). The result after «=» stands alone and keeps
 * its sign bare.
 */
export function operand(v) {
  return v < 0 ? `(${figure(v)})` : figure(v);
}

/**
 * The working, read as its formula in words above it reads, from the right (the line goes through isolateNumbers(),
 * each figure isolated, the operators and brackets in the line's own direction; 2026-11-20, the owner on the Anthropic
 * IPO explainer's mirrored sum). The digits stay Western: every Arabic outlet the newsroom reads prints them.
 */
export function workingOf(worked) {
  const [a, b] = worked.terms.map((t) => operand(t.value));
  const r = figure(worked.result.value);
  switch (worked.op) {
    case "difference": return `${a} − ${b} = ${r}`;
    case "sum": return `${worked.terms.map((t) => operand(t.value)).join(" + ")} = ${r}`;
    case "ratio": return `${a} ÷ ${b} = ${r}`;
    case "share": return `${a} ÷ ${b} × 100 = ${r}%`;
    case "recovery": return `${a} ÷ (100 − ${a}) × 100 = ${r}%`;
    default: return `(${b} − ${a}) ÷ ${a} × 100 = ${r}%`;
  }
}
