/**
 * Deterministic mid-century cover art.
 * Every article without a licensed photograph gets an abstract composition in
 * its section's spot colour: flat shapes, one paper cut-out, one ink accent, a
 * halftone screen. Seeded by the slug so the same story always draws the same cover.
 */
const PAPER = "#fbfaf6";
const INK = "#171512";
const SAFFRON = "#e5a52b";

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CoverOptions {
  color: string;
  ink?: string;
  width?: number;
  height?: number;
  /** "field" = spot colour ground (cover), "paper" = paper ground (cards) */
  ground?: "field" | "paper";
}

export function coverSvg(seed: string, { color, ink = INK, width = 1200, height = 750, ground = "field" }: CoverOptions): string {
  const random = rng(hash(seed));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(random() * arr.length)];
  const bg = ground === "field" ? color : PAPER;
  const fg = ground === "field" ? PAPER : color;
  const id = `c${hash(seed).toString(36)}`;
  const shapes: string[] = [];
  const w = width;
  const h = height;

  // Big anchor form on one side.
  const anchor = pick(["disc", "quarter", "arch", "wedge", "bars"]);
  const side = random() < 0.5 ? -1 : 1;
  const cx = side < 0 ? w * 0.28 : w * 0.72;
  const r = h * (0.42 + random() * 0.18);
  if (anchor === "disc") shapes.push(`<circle cx="${cx}" cy="${h * 0.52}" r="${r}" fill="${fg}"/>`);
  if (anchor === "quarter") {
    const x = side < 0 ? 0 : w;
    const y = random() < 0.5 ? 0 : h;
    shapes.push(`<path d="M${x} ${y} h${-side * r * 1.5} a${r * 1.5} ${r * 1.5} 0 0 ${(side < 0) === (y === 0) ? 1 : 0} ${side * r * 1.5} ${y === 0 ? r * 1.5 : -r * 1.5} z" fill="${fg}"/>`);
  }
  if (anchor === "arch") {
    const aw = r * 1.6;
    const x0 = cx - aw / 2;
    shapes.push(`<path d="M${x0} ${h} V${h * 0.55} A${aw / 2} ${aw / 2} 0 0 1 ${x0 + aw} ${h * 0.55} V${h} Z" fill="${fg}"/>`);
  }
  if (anchor === "wedge") {
    const x = side < 0 ? 0 : w;
    shapes.push(`<path d="M${x} 0 L${x} ${h} L${x - side * w * 0.55} ${h * (0.3 + random() * 0.4)} Z" fill="${fg}"/>`);
  }
  if (anchor === "bars") {
    const n = 3 + Math.floor(random() * 3);
    const gap = h / (n * 2 + 1);
    for (let i = 0; i < n; i += 1) {
      const bw = w * (0.35 + random() * 0.35);
      const x = side < 0 ? 0 : w - bw;
      shapes.push(`<rect x="${x}" y="${gap * (2 * i + 1)}" width="${bw}" height="${gap}" fill="${fg}"/>`);
    }
  }

  // Ink accent: a small solid form that "prints" over the composition.
  const accent = pick(["dot", "ring", "line", "square"]);
  const ax = side < 0 ? w * (0.62 + random() * 0.25) : w * (0.12 + random() * 0.25);
  const ay = h * (0.18 + random() * 0.6);
  const ar = h * (0.05 + random() * 0.07);
  if (accent === "dot") shapes.push(`<circle cx="${ax}" cy="${ay}" r="${ar}" fill="${ink}"/>`);
  if (accent === "ring") shapes.push(`<circle cx="${ax}" cy="${ay}" r="${ar * 1.6}" fill="none" stroke="${ink}" stroke-width="${ar * 0.45}"/>`);
  if (accent === "line") shapes.push(`<rect x="${ax - ar * 2.4}" y="${ay - ar * 0.22}" width="${ar * 4.8}" height="${ar * 0.44}" fill="${ink}" transform="rotate(${-25 + random() * 50} ${ax} ${ay})"/>`);
  if (accent === "square") shapes.push(`<rect x="${ax - ar}" y="${ay - ar}" width="${ar * 2}" height="${ar * 2}" fill="${ink}" transform="rotate(${random() * 40 - 20} ${ax} ${ay})"/>`);

  // Saffron cut-out: the brand's spot colour appears once, small.
  const sx = side < 0 ? w * (0.55 + random() * 0.3) : w * (0.15 + random() * 0.3);
  const sy = h * (0.55 + random() * 0.35);
  const sr = h * (0.035 + random() * 0.04);
  shapes.push(random() < 0.5 ? `<circle cx="${sx}" cy="${sy}" r="${sr}" fill="${SAFFRON}"/>` : `<rect x="${sx - sr}" y="${sy - sr * 0.5}" width="${sr * 2}" height="${sr}" fill="${SAFFRON}"/>`);

  // Halftone screen over one region.
  const dotSize = 9 + Math.floor(random() * 5);
  const hx = side < 0 ? w * 0.52 : 0;
  const hy = random() < 0.5 ? 0 : h * 0.5;
  const hw = w * 0.48;
  const hh = h * 0.5;
  const screen = `<pattern id="${id}h" width="${dotSize}" height="${dotSize}" patternUnits="userSpaceOnUse"><circle cx="${dotSize / 2}" cy="${dotSize / 2}" r="${dotSize * 0.2}" fill="${ground === "field" ? PAPER : ink}" fill-opacity="${ground === "field" ? 0.55 : 0.28}"/></pattern>`;
  shapes.push(`<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" fill="url(#${id}h)"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-hidden="true"><defs>${screen}</defs><rect width="${w}" height="${h}" fill="${bg}"/>${shapes.join("")}</svg>`;
}

export function coverDataUri(seed: string, options: CoverOptions): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverSvg(seed, options))}`;
}
