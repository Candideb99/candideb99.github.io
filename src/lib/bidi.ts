/**
 * Mixed-direction text inside Arabic prose keeps one visual convention:
 * every figure (digits with sign, range and unit as written) and every Latin run
 * (a name, a ticker, a bracketed expansion) is isolated as a left-to-right run, so
 * signs stay attached to digits, ranges read the way they were typed, and Latin
 * names never split across lines with their brackets on the wrong side; hyphenated
 * words inside a Latin run are held together with a nowrap span.
 */
const NUMBER_SRC = String.raw`(?:(?<=^|[\s(\[«"'،])[+\-−])?\d[\d.,]*(?:[-–]\d[\d.,]*)?(?:\s?[%٪])?`;
const LATIN_SRC = String.raw`(?<![&A-Za-z0-9])\(?[A-Za-z][A-Za-z0-9'’.\-]*(?:\s+[A-Za-z0-9'’.\-]+)*\)?`;
const RUN = new RegExp(`(${LATIN_SRC})|(${NUMBER_SRC})`, "g");

export const NUMBER_PATTERN = new RegExp(NUMBER_SRC, "g");
export const RUN_PATTERN = RUN;

export function escapeHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Marks up one isolated run: a figure, or a Latin run (short ones never wrap). */
export function wrapRun(latin: string | undefined, number: string | undefined): string {
  if (latin) {
    const words = latin.trim().split(/\s+/).length;
    const cls = words <= 3 ? ' class="latin latin--short"' : ' class="latin"';
    const held = latin.replace(/[^\s]*\w-\w[^\s]*/g, (word) => `<span class="nb">${word}</span>`);
    return `<bdi dir="ltr"${cls}>${held}</bdi>`;
  }
  return `<bdi dir="ltr">${(number ?? "").replace(/^-/, "−")}</bdi>`;
}

/** Escapes `text` and isolates every figure and Latin run in `<bdi dir="ltr">`. */
export function isolateNumbers(text: string): string {
  return String(text ?? "")
    .split(RUN)
    .map((piece, i) => {
      if (piece === undefined || piece === "") return "";
      // split() yields plain text at every third position, then the Latin and number captures
      if (i % 3 === 0) return escapeHtml(piece);
      return i % 3 === 1 ? wrapRun(escapeHtml(piece), undefined) : wrapRun(undefined, escapeHtml(piece));
    })
    .join("");
}
