/**
 * Photo libraries beside Wikimedia Commons (the owner, 2026-09-24: "add a second free photo library or even third
 * or fourth"). Commons has few modern pictures of some subjects: its trading floors are 1949 and 1963 archive
 * shots or named traders, and the bond explainer ran without a photo for it.
 *
 * - Openverse, with no key: Flickr's openly licensed photographs and a few museums and archives. Anonymous use
 *   is limited to 20 searches a minute and 200 a day, so the picture desk asks it only when Commons has fewer
 *   than five fitting candidates for a search, and stops asking for the rest of a run after a refusal (429).
 * - Pexels and Unsplash, when their free keys are set (PEXELS_API_KEY, UNSPLASH_ACCESS_KEY in .env and as
 *   repository secrets). Both allow use without payment on a site that carries advertising; Unsplash asks that
 *   a used photo's download be reported (`noteUse`).
 *
 * Every search returns candidates in the Commons shape, so the ranking, the judges and the second check read
 * them alike. `library` says where each came from; `thumb` is a small copy for the judge to look at. Licences
 * that forbid commercial use or changes (NC, ND) are never asked for.
 */
import { BAD_TITLE } from "./commons.mjs";
import { USER_AGENT, fetchWithTimeout } from "./util.mjs";

/** A Flickr static URL at another of its sizes (n 320, w 400, z 640, c 800, b 1024); null for any other address. */
export function flickrSize(url, size) {
  const m = String(url ?? "").match(/^(https:\/\/live\.staticflickr\.com\/\d+\/\d+_[0-9a-f]+)(?:_[a-z])?\.jpg$/);
  return m ? `${m[1]}_${size}.jpg` : null;
}

const landscape = (w, h) => w > 0 && h > 0 && w / h >= 0.95 && w / h <= 2.6;

let openverseRefused = false;

/** Openverse, Flickr's openly licensed photographs among them; never its Wikimedia copies, which Commons already gives. */
export async function searchOpenverse(query, { limit = 10, log = () => {} } = {}) {
  if (openverseRefused) return [];
  const params = new URLSearchParams({ q: query, license: "by,by-sa,cc0,pdm", page_size: "20", mature: "false", excluded_source: "wikimedia", extension: "jpg" });
  try {
    const response = await fetchWithTimeout(`https://api.openverse.org/v1/images/?${params}`, { headers: { "user-agent": USER_AGENT } }, 20000);
    if (response.status === 429) {
      openverseRefused = true;
      log("openverse: the day's anonymous limit is reached; Commons alone for the rest of this run");
      return [];
    }
    if (!response.ok) {
      log(`openverse "${query}": HTTP ${response.status}`);
      return [];
    }
    const payload = await response.json();
    const out = [];
    for (const r of payload.results ?? []) {
      const width = Number(r.width) || 0;
      const height = Number(r.height) || 0;
      const url = String(r.url ?? "");
      const title = String(r.title ?? "").trim();
      // Flickr's largest copy with the photo's own secret is 1024 pixels wide: enough for the article's 1024.
      if (width < 960 || !landscape(width, height) || !/^https:\/\//.test(url) || BAD_TITLE.test(title)) continue;
      const kind = String(r.license ?? "").toLowerCase();
      const license = kind === "cc0" ? "CC0" : kind === "pdm" ? "Public domain" : `CC ${kind.toUpperCase()} ${r.license_version ?? ""}`.trim();
      out.push({
        title,
        pageUrl: String(r.foreign_landing_url ?? url),
        url,
        fullUrl: url,
        width,
        height,
        license,
        licenseUrl: String(r.license_url ?? ""),
        // A file with no photographer named is credited to the collection it came from (rawpixel, not «أوبن فيرس» twice).
        artist: String(r.creator ?? "").trim().slice(0, 80) || String(r.source ?? ""),
        description: "",
        date: "",
        uploaded: "",
        categories: (r.tags ?? []).map((t) => t?.name).filter(Boolean).slice(0, 25).join(", "),
        library: r.source === "flickr" ? "flickr" : `openverse:${r.source}`,
        thumb: flickrSize(url, "n") ?? String(r.thumbnail ?? url),
      });
      if (out.length >= limit) break;
    }
    log(`openverse "${query}": ${out.length} usable of ${(payload.results ?? []).length}`);
    return out;
  } catch (error) {
    log(`openverse "${query}": ${error.message}`);
    return [];
  }
}

/** Pexels, when PEXELS_API_KEY is set. */
export async function searchPexels(query, { limit = 8, log = () => {} } = {}) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ query, per_page: "15", orientation: "landscape" });
  try {
    const response = await fetchWithTimeout(`https://api.pexels.com/v1/search?${params}`, { headers: { authorization: key, "user-agent": USER_AGENT } }, 20000);
    if (!response.ok) {
      log(`pexels "${query}": HTTP ${response.status}`);
      return [];
    }
    const payload = await response.json();
    const out = [];
    for (const p of payload.photos ?? []) {
      const base = String(p.src?.original ?? "").split("?")[0];
      if (!base || !landscape(p.width, p.height) || (p.width ?? 0) < 1280) continue;
      out.push({
        title: String(p.alt ?? "").trim(),
        pageUrl: String(p.url ?? ""),
        url: `${base}?auto=compress&cs=tinysrgb&w=1280`,
        fullUrl: base,
        width: 1280,
        height: Math.round((1280 * p.height) / p.width),
        license: "Pexels License",
        licenseUrl: "https://www.pexels.com/license/",
        artist: String(p.photographer ?? "").trim().slice(0, 80),
        description: String(p.alt ?? ""),
        date: "",
        uploaded: "",
        categories: "",
        library: "pexels",
        thumb: `${base}?auto=compress&cs=tinysrgb&w=500`,
      });
      if (out.length >= limit) break;
    }
    log(`pexels "${query}": ${out.length} usable`);
    return out;
  } catch (error) {
    log(`pexels "${query}": ${error.message}`);
    return [];
  }
}

/** Unsplash, when UNSPLASH_ACCESS_KEY is set. Its photos are always shown from its own servers, as it requires. */
export async function searchUnsplash(query, { limit = 8, log = () => {} } = {}) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ query, per_page: "15", orientation: "landscape", content_filter: "high" });
  try {
    const response = await fetchWithTimeout(`https://api.unsplash.com/search/photos?${params}`, { headers: { authorization: `Client-ID ${key}`, "accept-version": "v1", "user-agent": USER_AGENT } }, 20000);
    if (!response.ok) {
      log(`unsplash "${query}": HTTP ${response.status}`);
      return [];
    }
    const payload = await response.json();
    const out = [];
    for (const p of payload.results ?? []) {
      const raw = String(p.urls?.raw ?? "");
      if (!raw || !landscape(p.width, p.height) || (p.width ?? 0) < 1280) continue;
      const join = raw.includes("?") ? "&" : "?";
      out.push({
        title: String(p.alt_description ?? p.description ?? "").trim(),
        pageUrl: `${p.links?.html ?? "https://unsplash.com"}?utm_source=khazendar&utm_medium=referral`,
        url: `${raw}${join}w=1280&fit=max&q=80`,
        fullUrl: raw,
        width: 1280,
        height: Math.round((1280 * p.height) / p.width),
        license: "Unsplash License",
        licenseUrl: "https://unsplash.com/license",
        artist: String(p.user?.name ?? "").trim().slice(0, 80),
        description: String(p.description ?? ""),
        date: "",
        uploaded: String(p.created_at ?? "").slice(0, 10),
        categories: "",
        library: "unsplash",
        download: String(p.links?.download_location ?? ""),
        thumb: `${raw}${join}w=500&fit=max&q=70`,
      });
      if (out.length >= limit) break;
    }
    log(`unsplash "${query}": ${out.length} usable`);
    return out;
  } catch (error) {
    log(`unsplash "${query}": ${error.message}`);
    return [];
  }
}

/** Every library beside Commons that is open to this run, for one search. */
export async function searchLibraries(query, { log = () => {} } = {}) {
  const [openverse, pexels, unsplash] = await Promise.all([searchOpenverse(query, { log }), searchPexels(query, { log }), searchUnsplash(query, { log })]);
  return [...openverse, ...pexels, ...unsplash];
}

/** Unsplash counts a photo as used only when its download is reported; its terms ask for it. */
export async function noteUse(image, log = () => {}) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key || image?.library !== "unsplash" || !image.download) return;
  try {
    await fetchWithTimeout(image.download, { headers: { authorization: `Client-ID ${key}`, "accept-version": "v1" } }, 15000);
  } catch (error) {
    log(`unsplash: download report failed (${error.message})`);
  }
}
