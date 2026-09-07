/**
 * rehype plugin: wrap every figure in Markdown prose in <bdi dir="ltr"> so that
 * signs and percent marks stay attached to their digits inside Arabic text.
 */
const NUMBER = /((?:(?<=^|[\s(\[«"'،])[+\-−])?\d[\d.,]*(?:\s?[%٪])?)/g;
const SKIP = new Set(["code", "pre", "bdi", "script", "style", "svg"]);

function isNumber(token) {
  return /^[+\-−]?\d[\d.,]*(?:\s?[%٪])?$/.test(token);
}

function walk(node) {
  if (!node.children) return;
  const next = [];
  for (const child of node.children) {
    if (child.type === "text" && NUMBER.test(child.value)) {
      NUMBER.lastIndex = 0;
      for (const part of child.value.split(NUMBER)) {
        if (!part) continue;
        if (isNumber(part)) {
          next.push({ type: "element", tagName: "bdi", properties: { dir: "ltr" }, children: [{ type: "text", value: part.replace(/^-/, "−") }] });
        } else {
          next.push({ type: "text", value: part });
        }
      }
      continue;
    }
    NUMBER.lastIndex = 0;
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
