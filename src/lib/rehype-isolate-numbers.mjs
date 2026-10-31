/**
 * rehype plugin: isolate every figure and every Latin run in Markdown prose as
 * <bdi dir="ltr">, so signs and percent marks stay attached to their digits and
 * Latin names keep their brackets and never split across lines inside Arabic text.
 */
// One run per figure however many groups it has (2026/27, 2026-09-19, 14:30, 2020–2025); see src/lib/bidi.ts.
// A figure ends on a digit, so a sentence's full stop stays outside it; a percent may stand before a spaced or unspaced
// range dash (2026-10-31; see src/lib/bidi.ts).
const NUMBER_SRC = String.raw`(?:(?<=^|[\s(\[«"'،])[+\-−])?\d(?:[\d.,]*\d)?(?:\s?[%٪])?(?:(?:[\/:]|\s?[\-–]\s?)\d(?:[\d.,]*\d)?(?:\s?[%٪])?)*`;
// Any Latin-script letter, accents included: an ASCII class cut «Jiménez» at «é» (2026-10-24; see src/lib/bidi.ts).
// «&» joins a run («S&P 500»), and digits before a word join it, hyphened or not («10-year»; see src/lib/bidi.ts).
const LATIN_SRC = String.raw`(?<![&\p{Script=Latin}\p{M}0-9])\(?(?:\d+-?(?=\p{Script=Latin}))?\p{Script=Latin}[\p{Script=Latin}\p{M}0-9'’.\-&]*(?:\s+[\p{Script=Latin}\p{M}0-9'’.\-&]+)*\)?`;
const RUN = new RegExp(`(${LATIN_SRC})|(${NUMBER_SRC})`, "gu");

/** A Latin run gives back the sentence's full stop and a bracket it did not open or close (latinParts in src/lib/bidi.ts). */
export function latinParts(run) {
  let head = "";
  let core = run;
  let tail = "";
  const count = (s, c) => s.split(c).length - 1;
  for (;;) {
    if (core.length > 1 && core.endsWith(".")) [core, tail] = [core.slice(0, -1), `.${tail}`];
    else if (core.endsWith(")") && count(core, ")") > count(core, "(")) [core, tail] = [core.slice(0, -1), `)${tail}`];
    else if (core.startsWith("(") && count(core, "(") > count(core, ")")) [head, core] = [`${head}(`, core.slice(1)];
    else return [head, core, tail];
  }
}
const SKIP = new Set(["code", "pre", "bdi", "script", "style", "svg", "a"]);

function latinNode(text) {
  const words = text.trim().split(/\s+/).length;
  // hyphenated words are held together with a nowrap span (a non-breaking hyphen has no glyph in the subset fonts)
  const children = text.split(/([^\s]*[\p{L}\p{N}]-[\p{L}\p{N}][^\s]*)/u).filter(Boolean).map((part) =>
    /[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(part) ? { type: "element", tagName: "span", properties: { className: ["nb"] }, children: [{ type: "text", value: part }] } : { type: "text", value: part },
  );
  return {
    type: "element",
    tagName: "bdi",
    properties: { dir: "ltr", className: words <= 3 ? ["latin", "latin--short"] : ["latin"] },
    children,
  };
}
function numberNode(text) {
  return { type: "element", tagName: "bdi", properties: { dir: "ltr" }, children: [{ type: "text", value: text.replace(/^-/, "−") }] };
}

function walk(node) {
  if (!node.children) return;
  const next = [];
  for (const child of node.children) {
    if (child.type === "text") {
      const pieces = child.value.split(RUN);
      if (pieces.length === 1) {
        next.push(child);
        continue;
      }
      pieces.forEach((piece, i) => {
        if (piece === undefined || piece === "") return;
        if (i % 3 === 0) next.push({ type: "text", value: piece });
        else if (i % 3 === 2) next.push(numberNode(piece));
        else {
          const [head, core, tail] = latinParts(piece);
          if (head) next.push({ type: "text", value: head });
          next.push(latinNode(core));
          if (tail) next.push({ type: "text", value: tail });
        }
      });
      continue;
    }
    if (child.type === "element" && !SKIP.has(child.tagName)) walk(child);
    next.push(child);
  }
  node.children = next;
}

export default function rehypeIsolateNumbers() {
  return (tree) => {
    walk(tree);
  };
}
