/**
 * Where an explainer's figure and worked example print (2026-11-08). A textbook sets a figure beside the paragraph that
 * calls for it; the page had set the figure under the lede, before the text that explains it, and the worked example
 * after all the text, and the owner, reading a test piece, "did not feel the flow of the article".
 *
 * Each part prints right after the paragraph that leads into it: the one sharing most of its words and figures, in the
 * step the writer named (`section`, pipeline/lib/lesson.mjs) by preference. The page reads the final text, so a
 * revision that merges or moves paragraphs moves the part with them; the writer's first test under "after the step's
 * first paragraph" set a chain of foreigners selling treasury bills after a paragraph on stock and flow, two paragraphs
 * above the one about the bills. A part nothing in the body leads into keeps the page's default place. Plain
 * JavaScript, so the pipeline's self-test can run it.
 */

const STOP = new Set(["التي", "الذي", "الذين", "هذا", "هذه", "ذلك", "تلك", "على", "إلى", "الى", "عن", "مع", "بين", "كان", "كانت", "يكون", "تكون", "قد", "لكن", "لكنه", "أن", "إن", "أو", "ثم", "حتى", "كل", "بعد", "قبل", "عند", "فيها", "فيه", "منه", "منها", "عليه", "عليها", "إذا", "اذا", "لو", "وهو", "وهي", "هو", "هي", "ما", "لا", "لم", "لن", "نحو", "مثل", "دون", "غير", "أي", "اي"]);

/** Arabic text as comparable words: no marks, one alef, the article and «و/ف» before it taken off, short words dropped. */
function words(text) {
  const plain = String(text ?? "")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
  const out = new Set();
  for (let w of plain.match(/[ء-ي]+/g) ?? []) {
    if (STOP.has(w)) continue;
    w = w.replace(/^(?:وال|بال|فال|كال|لل|ال)(?=[ء-ي]{3})/, "");
    if (w.length >= 5) w = w.replace(/^[وف](?=[ء-ي]{4})/, "");
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

/** The figures a text carries that can tell one paragraph from another: never a small count or a year. */
function figures(text) {
  const digits = String(text ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".");
  const out = new Set();
  for (const m of digits.match(/\d+(?:\.\d+)?/g) ?? []) {
    const n = Number(m);
    if (!Number.isFinite(n) || (Number.isInteger(n) && (n <= 31 || (n >= 1900 && n <= 2100)))) continue;
    out.add(String(n));
  }
  return out;
}

const textOf = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, " ");

/** Everything a part prints, as words and figures to match a paragraph against. */
function partSignature(part) {
  const strings = [part.title, part.caption, part.center, part.price, part.quantity, part.supply, part.demand, part.result?.label, ...(part.terms ?? []).map((t) => t.label), ...(part.inflows ?? []).map((f) => f.label), ...(part.outflows ?? []).map((f) => f.label), ...(part.steps ?? [])].filter(Boolean).join(" ");
  const values = [...(part.terms ?? []).map((t) => t.value), ...(part.inflows ?? []).map((f) => f.value), ...(part.outflows ?? []).map((f) => f.value)];
  // The formula's words help (its constants, «× 100», are no figure of the story).
  return { words: words(`${strings} ${part.formula ?? ""}`), figures: figures(`${strings} ${values.join(" ")}`) };
}

/**
 * @param {string} html the body's rendered HTML
 * @param {{ diagram?: any, worked?: any }} parts the explainer's figure and worked example, each with its `section`
 * @returns {Array<{ html: string } | { part: "diagram" | "worked" }> | null} the body in pieces, or null for no cut
 */
export function placeLessonParts(html, parts) {
  html = String(html ?? "");
  const heads = [...html.matchAll(/<h2[\s>]/g)].map((m) => m.index ?? 0);
  // Paragraphs at the top level of the body only: a cut inside a quotation or a list would break it in two.
  const opened = (tag, before) => (before.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length - (before.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
  const paragraphs = [...html.matchAll(/<p[\s>][\s\S]*?<\/p>/g)]
    .filter((m) => ["blockquote", "ul", "ol", "table"].every((tag) => opened(tag, html.slice(0, m.index)) === 0))
    .map((m) => {
      const start = m.index ?? 0;
      const text = textOf(m[0]);
      return { end: start + m[0].length, section: heads.filter((h) => h < start).length, words: words(text), figures: figures(text) };
    });
  /** @type {Array<{ at: number, part: "diagram" | "worked" }>} */
  const cuts = [];
  for (const name of /** @type {const} */ (["diagram", "worked"])) {
    const part = parts?.[name];
    if (!part) continue;
    const sig = partSignature(part);
    const wanted = Number.isInteger(part.section) ? part.section : null;
    let best = null;
    let bestScore = 0;
    for (const p of paragraphs) {
      const shared = [...sig.words].filter((w) => p.words.has(w)).length + 3 * [...sig.figures].filter((f) => p.figures.has(f)).length;
      // A paragraph with nothing in common never leads into the part, whatever its step.
      if (!shared) continue;
      const score = shared + (p.section === wanted ? 2 : 0);
      if (score > bestScore) [best, bestScore] = [p, score];
    }
    // Too little in common to be sure: the first paragraph of the named step, else the default place.
    if (bestScore < 4) best = wanted ? paragraphs.find((p) => p.section === wanted) ?? null : null;
    if (best) cuts.push({ at: best.end, part: name });
  }
  if (!cuts.length) return null;
  // Two parts after the same paragraph: the figure first, then the example.
  cuts.sort((a, b) => a.at - b.at || (a.part === "diagram" ? -1 : 1));
  /** @type {Array<{ html: string } | { part: "diagram" | "worked" }>} */
  const pieces = [];
  let from = 0;
  for (const cut of cuts) {
    if (cut.at > from) pieces.push({ html: html.slice(from, cut.at) });
    pieces.push({ part: cut.part });
    from = cut.at;
  }
  if (from < html.length) pieces.push({ html: html.slice(from) });
  return pieces;
}
