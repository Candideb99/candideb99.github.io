/**
 * The working line of an explainer's worked example (WorkedExample.astro): the sum its result was computed from
 * (pipeline/lib/lesson.mjs), written as a textbook writes it. Plain JavaScript, so the pipeline's self-test reads it.
 */

/**
 * A figure as the site prints it: Western digits, a true minus, no more decimals than it has (up to four, as a small
 * result keeps two significant figures: lib/lesson.mjs resultDecimals(); at two, 0.004 printed as 0).
 */
export function figure(v) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 }).replace(/^-/, "−");
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
  // A share or a ratio of one thing on two scales works on one scale (`operands`, lib/lesson.mjs): the line had printed
  // «500 ÷ 2 × 100 = 25%» for 500 million of 2 billion (Codex, 2026-11-24).
  const values = worked.operands?.length === worked.terms.length ? worked.operands : worked.terms.map((t) => t.value);
  const [a, b] = values.map(operand);
  const r = figure(worked.result.value);
  // A product prints a percentage with its sign, so «10% × 5 = 50%» and «8.6% × 0.2 = 1.72%» read true as they stand.
  const pct = (i) => (/^%/.test(String(worked.terms[i]?.unit ?? "").trim()) ? "%" : "");
  const resultPct = /^%/.test(String(worked.result.unit ?? "").trim()) ? "%" : "";
  switch (worked.op) {
    case "difference": return `${a} − ${b} = ${r}`;
    case "sum": return `${worked.terms.map((t) => operand(t.value)).join(" + ")} = ${r}`;
    case "ratio": return `${a} ÷ ${b} = ${r}`;
    case "product": return `${a}${pct(0)} × ${b}${pct(1)} = ${r}${resultPct}`;
    case "percent_of": return `${b} × ${a} ÷ 100 = ${r}${resultPct}`;
    case "share": return `${a} ÷ ${b} × 100 = ${r}%`;
    case "recovery": return `${a} ÷ (100 − ${a}) × 100 = ${r}%`;
    default: return `(${b} − ${a}) ÷ ${a} × 100 = ${r}%`;
  }
}
