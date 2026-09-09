/**
 * rehype plugin: isolate every figure and every Latin run in Markdown prose as
 * <bdi dir="ltr">, so signs and percent marks stay attached to their digits and
 * Latin names keep their brackets and never split across lines inside Arabic text.
 */
const NUMBER_SRC = String.raw`(?:(?<=^|[\s(\[«"'،])[+\-−])?\d[\d.,]*(?:[-–]\d[\d.,]*)?(?:\s?[%٪])?`;
const LATIN_SRC = String.raw`(?<![&A-Za-z0-9])\(?[A-Za-z][A-Za-z0-9'’.\-]*(?:\s+[A-Za-z0-9'’.\-]+)*\)?`;
const RUN = new RegExp(`(${LATIN_SRC})|(${NUMBER_SRC})`, "g");
const SKIP = new Set(["code", "pre", "bdi", "script", "style", "svg", "a"]);

function latinNode(text) {
  const words = text.trim().split(/\s+/).length;
  // hyphenated words are held together with a nowrap span (a non-breaking hyphen has no glyph in the subset fonts)
  const children = text.split(/([^\s]*\w-\w[^\s]*)/).filter(Boolean).map((part) =>
    /\w-\w/.test(part) ? { type: "element", tagName: "span", properties: { className: ["nb"] }, children: [{ type: "text", value: part }] } : { type: "text", value: part },
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
        else if (i % 3 === 1) next.push(latinNode(piece));
        else next.push(numberNode(piece));
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
