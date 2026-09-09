/**
 * Arabic text as SVG outlines. fontkit shapes the string (joining forms, ligatures,
 * right-to-left order) and the glyph outlines become one path, so brand assets and social
 * cards render identically on every machine without a font being installed.
 *
 * Fontsource ships Amiri as script subsets, so a "font set" pairs the Arabic subset with the
 * Latin one: Arabic letters shape with the first, digits and Latin with the second.
 */
import * as fk from "fontkit";

const fontkit = fk.default ?? fk;
const cache = new Map();
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const MIRROR = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "«": "»", "»": "«" };

/** Opens a font file once per process. */
export function openFont(file) {
  if (!cache.has(file)) cache.set(file, fontkit.openSync(file));
  return cache.get(file);
}

const fix = (n) => Number(n.toFixed(2));
const asSet = (fonts) => (fonts && fonts.arabic ? fonts : { arabic: fonts, latin: fonts });

/** Advance width of a string shaped with one font, at the given pixel size. */
export function measure(font, text, size) {
  const run = font.layout(text);
  return (run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * size) / font.unitsPerEm;
}

/**
 * One SVG path (y down) for `text` shaped with one font at `size` pixels, baseline at `y`.
 * `anchor` places the ink relative to `x`: "start" is the left edge of the ink, "end" the
 * right edge (use "end" to right-align Arabic lines), "middle" centres it.
 * fontkit already hands back right-to-left runs in visual order, so glyphs are laid left to right.
 */
export function textToPath(font, text, size, { x = 0, y = 0, anchor = "start" } = {}) {
  const run = font.layout(text);
  const s = size / font.unitsPerEm;
  const advance = run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * s;
  const left = anchor === "middle" ? x - advance / 2 : anchor === "end" ? x - advance : x;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let pen = 0;
  let d = "";
  run.glyphs.forEach((glyph, i) => {
    const p = run.positions[i];
    const ox = left + (pen + p.xOffset) * s;
    const oy = y - p.yOffset * s;
    for (const c of glyph.path.commands) {
      const pts = [];
      for (let k = 0; k < c.args.length; k += 2) {
        const px = fix(ox + c.args[k] * s);
        const py = fix(oy - c.args[k + 1] * s);
        if (px < box.minX) box.minX = px;
        if (px > box.maxX) box.maxX = px;
        if (py < box.minY) box.minY = py;
        if (py > box.maxY) box.maxY = py;
        pts.push(`${px} ${py}`);
      }
      if (c.command === "moveTo") d += `M${pts[0]}`;
      else if (c.command === "lineTo") d += `L${pts[0]}`;
      else if (c.command === "quadraticCurveTo") d += `Q${pts[0]} ${pts[1]}`;
      else if (c.command === "bezierCurveTo") d += `C${pts[0]} ${pts[1]} ${pts[2]}`;
      else if (c.command === "closePath") d += "Z";
    }
    pen += p.xAdvance;
  });
  if (!Number.isFinite(box.minX)) Object.assign(box, { minX: left, maxX: left, minY: y, maxY: y });
  return { d, advance, box };
}

/**
 * Shapes `text` with one font and returns every outline contour separately (visual order,
 * y down, page coordinates), so a logo can treat parts of letters, such as their dots, on their own.
 */
export function textContours(font, text, size, { x = 0, y = 0 } = {}) {
  const run = font.layout(text);
  const s = size / font.unitsPerEm;
  let pen = 0;
  const out = [];
  run.glyphs.forEach((glyph, gi) => {
    const p = run.positions[gi];
    const ox = x + (pen + p.xOffset) * s;
    const oy = y - p.yOffset * s;
    let cur = null;
    const push = () => {
      if (cur && cur.d) out.push(cur);
      cur = null;
    };
    for (const c of glyph.path.commands) {
      const pts = [];
      for (let k = 0; k < c.args.length; k += 2) pts.push([fix(ox + c.args[k] * s), fix(oy - c.args[k + 1] * s)]);
      if (c.command === "moveTo") {
        push();
        cur = { glyph: gi, d: "", minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      }
      if (!cur) continue;
      for (const [px, py] of pts) {
        if (px < cur.minX) cur.minX = px;
        if (px > cur.maxX) cur.maxX = px;
        if (py < cur.minY) cur.minY = py;
        if (py > cur.maxY) cur.maxY = py;
      }
      const str = pts.map((q) => q.join(" "));
      if (c.command === "moveTo") cur.d += `M${str[0]}`;
      else if (c.command === "lineTo") cur.d += `L${str[0]}`;
      else if (c.command === "quadraticCurveTo") cur.d += `Q${str[0]} ${str[1]}`;
      else if (c.command === "bezierCurveTo") cur.d += `C${str[0]} ${str[1]} ${str[2]}`;
      else if (c.command === "closePath") cur.d += "Z";
    }
    push();
    pen += p.xAdvance;
  });
  const advance = run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * s;
  return { contours: out, advance };
}

/** Splits a token into segments that one subset font can shape: Arabic-script runs and the rest. */
function segments(token) {
  const out = [];
  for (const ch of token) {
    const arabic = ARABIC.test(ch);
    const last = out[out.length - 1];
    if (last && last.arabic === arabic) last.text += ch;
    else out.push({ arabic, text: ch });
  }
  return out;
}

/** Width of one token, shaped segment by segment with the font set. */
export function measureToken(fonts, token, size) {
  const set = asSet(fonts);
  return segments(token).reduce((sum, seg) => sum + measure(seg.arabic ? set.arabic : set.latin, seg.text, size), 0);
}

/** Width of a whole line laid out by `lineToPath`. */
export function measureLine(fonts, text, size) {
  const set = asSet(fonts);
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  const space = measure(set.arabic, " ", size);
  return tokens.reduce((sum, t, i) => sum + (i ? space : 0) + measureToken(set, t, size), 0);
}

/**
 * Lays out one right-to-left line whose right edge sits at `right`, baseline at `y`.
 * Arabic tokens run right to left; a run of Latin or numeric tokens keeps its left-to-right
 * order inside the line; brackets inside Arabic tokens are mirrored, as a browser would.
 */
export function lineToPath(fonts, text, size, { right = 0, y = 0 } = {}) {
  const set = asSet(fonts);
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  const space = measure(set.arabic, " ", size);
  const runs = [];
  for (const token of tokens) {
    const ltr = !ARABIC.test(token);
    const last = runs[runs.length - 1];
    if (last && last.ltr === ltr) last.tokens.push(token);
    else runs.push({ ltr, tokens: [token] });
  }
  let cursor = right;
  let d = "";
  const tokenPath = (token, x) => {
    // An Arabic token is drawn segment by segment from the right, in logical order.
    let pen = x + measureToken(set, token, size);
    for (const seg of segments(token)) {
      const font = seg.arabic ? set.arabic : set.latin;
      const text = seg.arabic ? seg.text : [...seg.text].map((c) => MIRROR[c] ?? c).join("");
      const w = measure(font, text, size);
      pen -= w;
      d += textToPath(font, text, size, { x: pen, y }).d;
    }
  };
  runs.forEach((run, ri) => {
    if (ri > 0) cursor -= space;
    if (run.ltr) {
      const widths = run.tokens.map((t) => measureToken(set, t, size));
      const total = widths.reduce((a, b) => a + b, 0) + space * (run.tokens.length - 1);
      let x = cursor - total;
      run.tokens.forEach((t, i) => {
        d += textToPath(set.latin, t, size, { x, y }).d;
        x += widths[i] + space;
      });
      cursor -= total;
    } else {
      run.tokens.forEach((t, i) => {
        if (i > 0) cursor -= space;
        const w = measureToken(set, t, size);
        tokenPath(t, cursor - w);
        cursor -= w;
      });
    }
  });
  return { d, width: right - cursor };
}

/** Greedy word wrap by measured width; returns the lines (at most `maxLines`, the last one ellipsised). */
export function wrapText(fonts, text, size, maxWidth, maxLines = 3) {
  const set = asSet(fonts);
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const space = measure(set.arabic, " ", size);
  const lines = [];
  let line = [];
  let width = 0;
  for (const word of words) {
    const w = measureToken(set, word, size);
    const next = line.length ? width + space + w : w;
    if (line.length && next > maxWidth) {
      lines.push(line.join(" "));
      line = [word];
      width = w;
    } else {
      line.push(word);
      width = next;
    }
  }
  if (line.length) lines.push(line.join(" "));
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length && measureLine(set, `${last}…`, size) > maxWidth) last = last.replace(/\s*\S+$/, "");
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}
