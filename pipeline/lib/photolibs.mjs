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
import { BAD_TITLE, cleanArtist } from "./commons.mjs";
import { USER_AGENT, fetchWithTimeout } from "./util.mjs";

/** A Flickr static URL at another of its sizes (n 320, w 400, z 640, c 800, b 1024); null for any other address. */
export function flickrSize(url, size) {
  const m = String(url ?? "").match(/^(https:\/\/live\.staticflickr\.com\/\d+\/\d+_[0-9a-f]+)(?:_[a-z])?\.jpg$/);
  return m ? `${m[1]}_${size}.jpg` : null;
}

const landscape = (w, h) => w > 0 && h > 0 && w / h >= 0.95 && w / h <= 2.6;

/**
 * Real photographs only (the owner, 2026-09-27, giving his Pexels key: "only serious real life images and not ai
 * generated images"): an entry whose own title, description or tags say it was made by a computer or drawn is dropped
 * before any judge sees it. The judges also refuse what only looks generated (GRAVITY_RULE in images.mjs).
 */
export const NOT_A_PHOTO = /\b(?:ai[- ]generated|generated (?:by|with) ai|generative ai|midjourney|dall[- ]?e|stable diffusion|3d[- ](?:render|rendering|illustration|model|image)|rendered|cgi|illustration|illustrated|digital (?:art|painting|illustration|image)|vector|clip ?art|cartoon|mock-?up)\b/i;

let openverseRefused = false;
// Openverse down (2026-10-28): 89 of the morning round's 97 searches timed out at 45 seconds each, and the 8 answers held
// nothing. Seven stories took 38 minutes, so the round hit its 45-minute limit while committing and lost its pictures and
// photo checks, three days running. The newsroom's own runs waited the same way (27 timeouts in one). So three failures in a
// row, with no answer between them, stand Openverse down for ten minutes, and the next search after that tries it again.
const OPENVERSE_FAILURES = 3;
const OPENVERSE_REST_MS = 10 * 60 * 1000;
let openverseFailures = 0;
let openverseRestUntil = 0;
const openverseResting = () => Date.now() < openverseRestUntil;
function openverseFailed(log) {
  openverseFailures += 1;
  if (openverseFailures < OPENVERSE_FAILURES || openverseResting()) return;
  openverseFailures = 0;
  openverseRestUntil = Date.now() + OPENVERSE_REST_MS;
  log(`openverse: ${OPENVERSE_FAILURES} failures in a row; left alone for ${OPENVERSE_REST_MS / 60000} minutes`);
}
// A pass asks the libraries for all its searches at once (images.mjs collect()); Openverse allows 20 anonymous searches a
// minute, so at most three are in flight and the rest wait their turn. After a failure the next waits for the searches in
// flight to answer: three timeouts land together when Openverse is down, and searches started after the first and second
// went out a moment before the third opened the breaker (2026-10-30).
let openverseInFlight = 0;
const openverseQueue = [];
async function openverseTurn(work) {
  while (openverseInFlight >= 3 || (openverseFailures > 0 && openverseInFlight > 0)) await new Promise((resolve) => openverseQueue.push(resolve));
  openverseInFlight += 1;
  try {
    return await work();
  } finally {
    openverseInFlight -= 1;
    for (const wake of openverseQueue.splice(0)) wake();
  }
}

/**
 * Openverse, Flickr's openly licensed photographs among them; never its Wikimedia copies, which Commons already gives.
 * It answers in 10 to 50 seconds: at 20 seconds 36 of the 93 searches of the morning round of 2026-10-26 timed out. And
 * it matches a library's short titles, so a long phrase finds nothing («Egyptian pound dollar exchange», 0 results) where
 * its first words find the photograph («Egyptian pound»: a hand holding Egyptian notes, which the pound's record low
 * needed and never saw, 2026-10-27). `simpler`: the shorter forms of the phrase (images.mjs simplerQueries()); when the
 * phrase gives nothing usable, the first of them is asked once. Each result says which phrase found it (`searched`).
 */
export async function searchOpenverse(query, { limit = 10, log = () => {}, simpler = [] } = {}) {
  if (openverseRefused || openverseResting()) return [];
  const params = new URLSearchParams({ q: query, license: "by,by-sa,cc0,pdm", page_size: "20", mature: "false", excluded_source: "wikimedia", extension: "jpg" });
  try {
    // A search queued behind three that failed is not sent once the breaker has opened. A failure is counted before the
    // turn is handed on: counted after it, the three searches waiting behind the third timeout started a moment before the
    // breaker opened, and each pass lost another 45 seconds (the cloud logs of 2026-10-30, 19:24:17 → 19:25:02).
    const response = await openverseTurn(async () => {
      if (openverseResting()) return null;
      try {
        const answer = await fetchWithTimeout(`https://api.openverse.org/v1/images/?${params}`, { headers: { "user-agent": USER_AGENT } }, 45000);
        if (answer.status >= 500) {
          log(`openverse "${query}": HTTP ${answer.status}`);
          openverseFailed(log);
          return null;
        }
        openverseFailures = 0;
        return answer;
      } catch (error) {
        log(`openverse "${query}": ${error.message}`);
        openverseFailed(log);
        return null;
      }
    });
    if (!response) return [];
    if (response.status === 429) {
      // A minute's limit says to wait seconds, the day's limit hours: only the second ends Openverse for the run.
      const wait = Number(response.headers.get("retry-after"));
      if (Number.isFinite(wait) && wait <= 120) {
        log(`openverse "${query}": busy for ${wait} s; this search is left`);
        return [];
      }
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
      if (NOT_A_PHOTO.test(`${title} ${(r.tags ?? []).map((t) => t?.name).join(" ")}`)) continue;
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
        artist: cleanArtist(r.creator) || String(r.source ?? ""),
        description: "",
        date: "",
        uploaded: "",
        categories: (r.tags ?? []).map((t) => t?.name).filter(Boolean).slice(0, 25).join(", "),
        library: r.source === "flickr" ? "flickr" : `openverse:${r.source}`,
        thumb: flickrSize(url, "n") ?? String(r.thumbnail ?? url),
        // Openverse's own copy, asked for when Flickr refuses its thumbnail (images.mjs, shortlist).
        thumbAlt: r.thumbnail ? String(r.thumbnail) : undefined,
        searched: query,
      });
      if (out.length >= limit) break;
    }
    log(`openverse "${query}": ${out.length} usable of ${(payload.results ?? []).length}`);
    if (!out.length && simpler[0] && simpler[0] !== query) return await searchOpenverse(simpler[0], { limit, log });
    return out;
  } catch (error) {
    log(`openverse "${query}": ${error.message}`);
    openverseFailed(log);
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
      if (NOT_A_PHOTO.test(String(p.alt ?? ""))) continue;
      out.push({
        title: String(p.alt ?? "").trim(),
        pageUrl: String(p.url ?? ""),
        url: `${base}?auto=compress&cs=tinysrgb&w=1280`,
        fullUrl: base,
        width: 1280,
        height: Math.round((1280 * p.height) / p.width),
        license: "Pexels License",
        licenseUrl: "https://www.pexels.com/license/",
        // A name as its owner typed it can carry emoji, doubled spaces or a trailing «_» («Oleksiy Yeshtokyn,🌻🇺🇦🌻»).
        artist: cleanArtist(p.photographer),
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
      if (NOT_A_PHOTO.test(`${p.alt_description ?? ""} ${p.description ?? ""}`)) continue;
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
        artist: cleanArtist(p.user?.name),
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

/**
 * Every library beside Commons that is open to this run, for one search (`simpler`: see searchOpenverse()), taken in turn,
 * one of each: a search takes only its share of a pass's candidates (images.mjs collect()), and listed one library after
 * another the first filled it. Once Openverse stopped timing out its Flickr snapshots took every place and Pexels' modern
 * offices never reached the judges of the AI-agents reading (2026-10-27).
 */
export async function searchLibraries(query, { log = () => {}, simpler = [] } = {}) {
  const lists = await Promise.all([searchOpenverse(query, { log, simpler }), searchPexels(query, { log }), searchUnsplash(query, { log })]);
  const out = [];
  for (let i = 0; i < Math.max(...lists.map((list) => list.length)); i += 1) for (const list of lists) if (list[i]) out.push(list[i]);
  return out;
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
