/**
 * Mixed-direction text inside Arabic prose keeps one visual convention:
 * every figure (digits with sign, range and unit as written) and every Latin run
 * (a name, a ticker, a bracketed expansion) is isolated as a left-to-right run, so
 * signs stay attached to digits, ranges read the way they were typed, and Latin
 * names never split across lines with their brackets on the wrong side; hyphenated
 * words inside a Latin run are held together with a nowrap span.
 *
 * A figure is one run however many groups it has: a fiscal year «2026/27», a date «2026-09-19», a
 * time «14:30», a range «2020–2025». Split into separate runs, the right-to-left line laid the groups
 * out in reverse («27/2026», «19-2026-09»), which the reader took for the figure itself (2026-09-22).
 * rehype-isolate-numbers.mjs carries the same pattern for the article body.
 */
const NUMBER_SRC = String.raw`(?:(?<=^|[\s(\[«"'،])[+\-−])?\d[\d.,]*(?:[\/:\-–]\d[\d.,]*)*(?:\s?[%٪])?`;
// Any Latin-script letter, accents included (2026-10-24: «(Santiago Jiménez Londoño)» was cut at «é» and «ñ», and the
// pieces were laid out right to left as «(o، énez Londoñ(Santiago Jim»).
const LATIN_SRC = String.raw`(?<![&\p{Script=Latin}\p{M}0-9])\(?(?:\d+(?=\p{Script=Latin}))?\p{Script=Latin}[\p{Script=Latin}\p{M}0-9'’.\-]*(?:\s+[\p{Script=Latin}\p{M}0-9'’.\-]+)*\)?`;
const RUN = new RegExp(`(${LATIN_SRC})|(${NUMBER_SRC})`, "gu");

export const NUMBER_PATTERN = new RegExp(NUMBER_SRC, "gu");
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
    const held = latin.replace(/[^\s]*[\p{L}\p{N}]-[\p{L}\p{N}][^\s]*/gu, (word) => `<span class="nb">${word}</span>`);
    return `<bdi dir="ltr"${cls}>${held}</bdi>`;
  }
  return `<bdi dir="ltr">${(number ?? "").replace(/^-/, "−")}</bdi>`;
}

/**
 * A headline breaks between phrases (the owner, 2026-10-23, on «الأسهم السعودية تهبط / 2.3% إلى أدنى / إغلاق منذ 2021»:
 * "the headline was split across lines, so it was not so easy to read"). `text-wrap: balance` evens the lines and knows
 * nothing of Arabic phrases, so a few joins are held with a no-break space:
 * - a figure with the word before it («تهبط 2.3%») and with its unit after it («112 دولاراً»);
 * - a superlative with its noun («أدنى إغلاق»);
 * - a preposition or particle with the word it governs («منذ 2021»، «إلى أدنى»).
 * Nothing is held across a comma or a colon, and a held phrase never grows past HOLD_MAX characters, so a narrow
 * column always keeps a place to break.
 */
const NBSP = " ";
const HOLD_MAX = 16;
const PARTICLES = new Set(["إلى", "في", "من", "على", "عن", "مع", "منذ", "بعد", "قبل", "حتى", "دون", "نحو", "عند", "بين", "رغم", "خلال", "وسط", "أمام", "ضد", "عبر", "لدى", "تحت", "فوق", "أو", "ثم", "لا", "لم", "لن", "قد", "بعدما", "بسبب", "إثر", "عقب"]);
const HEADS = new Set(["أدنى", "أعلى", "أكبر", "أكثر", "أقل", "أول", "آخر", "أسرع", "أبطأ", "أقوى", "أضعف", "أفضل", "أسوأ", "أبرز", "أحدث"]);
const UNITS = new Set(["مليار", "مليارات", "مليون", "ملايين", "ألف", "آلاف", "تريليون", "دولار", "دولاراً", "دولارا", "دولارات", "يورو", "جنيه", "جنيهاً", "جنيهات", "ريال", "ريالاً", "ريالات", "درهم", "درهماً", "دينار", "نقطة", "نقاط", "برميل", "براميل", "طن", "أطنان", "سنتاً", "شهراً", "أشهر", "عاماً", "أعوام", "سنوات", "يوماً", "أيام", "أسابيع"]);
const FIGURE = /^[+\-−]?\d[\d.,]*(?:[\/:\-–]\d[\d.,]*)*[%٪]?$/;
const bare = (word: string) => word.replace(/^[«"'(]+|[»"')،؛:.!؟]+$/g, "");
/** A word of the set, alone or with the و/ف an Arabic joint attaches («وفي»، «وأعلى»). */
const isIn = (set: Set<string>, word: string) => set.has(word) || (/^[وف]/.test(word) && set.has(word.slice(1)));

export function holdPhrases(text: string): string {
  const words = String(text ?? "").split(/ +/);
  if (words.length < 4) return String(text ?? "");
  const holds = words.slice(0, -1).map((word, i) => {
    if (/[،؛:.!؟»)]$/.test(word)) return false;
    const a = bare(word);
    const b = bare(words[i + 1]);
    if (isIn(PARTICLES, a) || isIn(HEADS, a)) return true;
    if (FIGURE.test(b) && !FIGURE.test(a)) return true;
    return FIGURE.test(a) && isIn(UNITS, b);
  });
  let out = words[0];
  let run = words[0].length;
  for (let i = 1; i < words.length; i++) {
    const hold = holds[i - 1] && run + 1 + words[i].length <= HOLD_MAX;
    out += (hold ? NBSP : " ") + words[i];
    run = hold ? run + 1 + words[i].length : words[i].length;
  }
  return out;
}

/** A headline: its phrases held together at line breaks, then every figure and Latin run isolated. */
export function headline(text: string): string {
  return isolateNumbers(holdPhrases(text));
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
