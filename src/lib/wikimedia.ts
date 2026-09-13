/**
 * Responsive sources for the Wikimedia Commons photographs the newsroom cites.
 *
 * Commons refuses arbitrary thumbnail widths ("Use thumbnail sizes listed on w.wiki/GHai"), so a
 * srcset may only offer the widths its cache serves. These six were verified against several files
 * on 2026-09-11; anything else answers HTTP 400 and the browser is left with a broken source.
 *
 * The point is weight: a 5.5rem list thumbnail was loading the 1280px original, roughly 270 kB for
 * 88 display pixels. With a srcset the browser takes the 250px copy, about 20 kB.
 */
const ALLOWED_WIDTHS = [120, 250, 330, 500, 960, 1280] as const;

// Commons hands out the same files under upload.wikimedia.org and its alias thumb.wikimedia.org,
// sometimes with a tracking query; the srcset is always built on the canonical host.
const THUMB = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)\/\d+px-[^/]+$/;
const ORIGINAL = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)$/;
const ROOT = "https://upload.wikimedia.org/wikipedia/commons";

export interface ResponsiveImage {
  /** Fallback for browsers that ignore srcset, and the URL the width/height describe. */
  src: string;
  /** Candidate widths, or undefined when the URL is not a Commons file we can resize. */
  srcset?: string;
}

/**
 * Builds a srcset for a Commons photograph. `naturalWidth` caps the candidates so the browser is
 * never offered an upscale. Returns the original URL untouched for anything not on Commons.
 */
export function responsiveImage(url: string, naturalWidth?: number | null): ResponsiveImage {
  const clean = url.split("#")[0].split("?")[0];
  const match = THUMB.exec(clean) ?? ORIGINAL.exec(clean);
  if (!match) return { src: url };
  const [, a, ab, file] = match;
  const base = `${ROOT}/thumb/${a}/${ab}/${file}`;
  const cap = naturalWidth && naturalWidth > 0 ? naturalWidth : 1280;
  const widths = ALLOWED_WIDTHS.filter((w) => w <= cap);
  if (widths.length === 0) return { src: url };
  return {
    src: `${base}/${widths[widths.length - 1]}px-${file}`,
    srcset: widths.map((w) => `${base}/${w}px-${file} ${w}w`).join(", "),
  };
}

export const WIKIMEDIA_WIDTHS = ALLOWED_WIDTHS;

/** `sizes` for a picture card in a row of `n` across the 1240px wrap (two on tablets, a 120px thumbnail on phones). */
export function cardSizes(n: number): string {
  const cols = Math.max(1, Math.min(4, n));
  return `(min-width: 1320px) ${Math.round(1240 / cols)}px, (min-width: 1024px) ${Math.round(100 / cols)}vw, (min-width: 720px) 50vw, 120px`;
}
