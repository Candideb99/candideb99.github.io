/**
 * Numbers inside Arabic prose must keep one visual convention (digits, then sign
 * and unit as written): isolate each figure as a left-to-right run.
 */
const NUMBER = /((?:(?<=^|[\s(\[«"'،])[+\-−])?\d[\d.,]*(?:\s?[%٪])?)/g;

export function escapeHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escapes `text` and wraps every figure in `<bdi dir="ltr">`. */
export function isolateNumbers(text: string): string {
  return escapeHtml(text).replace(NUMBER, (match) => `<bdi dir="ltr">${match.replace(/^-/, "−")}</bdi>`);
}

export const NUMBER_PATTERN = NUMBER;
