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
  const other = otherLibrary(url, naturalWidth);
  if (other) return other;
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

/**
 * The other photo libraries the picture desk draws on since 2026-09-24 (pipeline/lib/photolibs.mjs): Flickr by
 * way of Openverse, whose copies come in fixed sizes named by a letter, and Pexels and Unsplash, whose servers
 * resize to any width asked in the address. Null for an address none of them serves.
 */
const FLICKR = /^(https:\/\/live\.staticflickr\.com\/\d+\/\d+_[0-9a-f]+)(?:_[a-z])?\.jpg$/;
const FLICKR_SIZES: [string, number][] = [["w", 400], ["z", 640], ["c", 800], ["b", 1024]];
const RESIZABLE = /^https:\/\/images\.(?:pexels|unsplash)\.com\//;
const RESIZE_WIDTHS = [330, 500, 960, 1280];

function otherLibrary(url: string, naturalWidth?: number | null): ResponsiveImage | null {
  const flickr = FLICKR.exec(url.split("?")[0]);
  if (flickr) {
    const cap = naturalWidth && naturalWidth > 0 ? naturalWidth : 1024;
    const sizes = FLICKR_SIZES.filter(([, w]) => w <= Math.max(cap, 400));
    return { src: `${flickr[1]}_${sizes[sizes.length - 1][0]}.jpg`, srcset: sizes.map(([s, w]) => `${flickr[1]}_${s}.jpg ${w}w`).join(", ") };
  }
  if (RESIZABLE.test(url)) {
    const [base, query = ""] = url.split("?");
    const params = new URLSearchParams(query);
    const at = (w: number) => {
      params.set("w", String(w));
      return `${base}?${params.toString()}`;
    };
    const cap = naturalWidth && naturalWidth > 0 ? naturalWidth : 1280;
    const widths = RESIZE_WIDTHS.filter((w) => w <= cap);
    if (!widths.length) return { src: url };
    return { src: at(widths[widths.length - 1]), srcset: widths.map((w) => `${at(w)} ${w}w`).join(", ") };
  }
  return null;
}

/** `sizes` for a picture card in a row of `n` across the 1240px wrap (two on tablets, a 120px thumbnail on phones). */
export function cardSizes(n: number): string {
  const cols = Math.max(1, Math.min(4, n));
  return `(min-width: 1320px) ${Math.round(1240 / cols)}px, (min-width: 1024px) ${Math.round(100 / cols)}vw, (min-width: 720px) 50vw, 120px`;
}
