/**
 * The site's health, checked without a single Claude call (2026-09-25). The research behind it found that the
 * maintenance loops that last are deterministic and quiet: they ask an authoritative source, confirm a fault
 * before acting on it, and spend nothing on a day when nothing is wrong.
 *
 * Photographs are hotlinked, so a file deleted or renamed at its library breaks on the site with no one told.
 *   - Commons: one API request answers for fifty files: deleted ("missing"), renamed (a redirect to the new
 *     title) or relicensed. An HTTP sweep of the photos themselves is no detector: a fast one got "429 Too Many
 *     Requests" for 114 of this site's 147 healthy photos (measured 2026-09-24), and a renamed file's old
 *     thumbnail answers 404 even though its page redirects.
 *   - Flickr (through Openverse), rawpixel, Pexels, Unsplash: the photo's own page, never its image address: a
 *     Flickr photo whose page is gone can keep serving the picture for years, credit link dead.
 * A rename is mended in code at once (the new address is certain); a missing file or page counts as gone only when
 * a second check at least 20 hours after the first still finds it gone, and only then is a new photo sought.
 */
import { USER_AGENT, fetchWithTimeout, sleep } from "./util.mjs";

const API = "https://commons.wikimedia.org/w/api.php";
/** Wikimedia asks automated clients to name themselves, with a way to reach them and the word "bot", and not to borrow a browser's name. */
const HEADERS = { "user-agent": `KhazendarHealthBot/1.0 (https://khazendar.pages.dev/about/) node/${process.versions.node}` };
export const CONFIRM_AFTER_H = 20;

/** The Commons file title a photo was taken from ("File:Name.jpg"), or null for another library's photo. */
export function commonsTitle(image) {
  if (!image?.url) return null;
  const page = String(image.pageUrl ?? "").match(/commons\.wikimedia\.org\/wiki\/(File(?::|%3A)[^?#]+)/i);
  if (page) {
    try {
      return decodeURIComponent(page[1]).replace(/_/g, " ");
    } catch {
      /* fall through to the address */
    }
  }
  const m = String(image.url).split("?")[0].match(/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
  if (!m) return null;
  try {
    return `File:${decodeURIComponent(m[1]).replace(/_/g, " ")}`;
  } catch {
    return null;
  }
}

/**
 * Asks Commons about the given file titles, fifty a request, one request at a time. Returns a Map from each asked
 * title to { status: "ok" | "missing" | "renamed", to?, url?, license? }; a title the API could not be asked about
 * (network, 429) is left out, so it is simply checked again next time.
 */
export async function checkCommons(titles, { log = () => {} } = {}) {
  const out = new Map();
  const unique = [...new Set(titles)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "imageinfo", iiprop: "url|extmetadata", iiextmetadatafilter: "LicenseShortName", redirects: "1", titles: batch.join("|"), maxlag: "5" });
    let payload = null;
    for (let attempt = 1; attempt <= 3 && !payload; attempt += 1) {
      try {
        const response = await fetchWithTimeout(`${API}?${params}`, { headers: HEADERS }, 30000);
        if (response.status === 429 || response.status >= 500) {
          const wait = Number(response.headers.get("retry-after")) || 10 * attempt;
          log(`commons api ${response.status}; waiting ${wait}s`);
          await sleep(wait * 1000);
          continue;
        }
        const body = await response.json();
        if (body?.error) {
          log(`commons api error ${body.error.code}`);
          await sleep(5000 * attempt);
          continue;
        }
        payload = body;
      } catch (error) {
        log(`commons api: ${error.message}`);
        await sleep(5000 * attempt);
      }
    }
    if (!payload) continue;
    // The asked title may come back normalised (underscores, a lower-case first letter) and then redirected.
    const normal = new Map((payload.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const moved = new Map((payload.query?.redirects ?? []).map((r) => [r.from, r.to]));
    const pages = new Map((payload.query?.pages ?? []).map((p) => [p.title, p]));
    for (const asked of batch) {
      const normalised = normal.get(asked) ?? asked;
      const target = moved.get(normalised) ?? normalised;
      const page = pages.get(target);
      if (!page) continue;
      if (page.missing || page.invalid || !page.imageinfo?.length) {
        out.set(asked, { status: "missing" });
        continue;
      }
      const info = page.imageinfo[0];
      const license = info.extmetadata?.LicenseShortName?.value ?? "";
      out.set(asked, target !== normalised ? { status: "renamed", to: target, url: info.url, license } : { status: "ok", url: info.url, license });
    }
    await sleep(1000);
  }
  return out;
}

/**
 * The photo's address after a rename: the new file's own address, at the width the old one had when it was a
 * thumbnail. Commons serves only its standard widths, so the width is kept as it was.
 */
export function renamedUrl(oldUrl, newOriginal) {
  const clean = String(newOriginal ?? "").replace(/^https:\/\/thumb\.wikimedia\.org\//, "https://upload.wikimedia.org/").split("?")[0];
  const width = String(oldUrl ?? "").split("?")[0].match(/\/thumb\/.*\/(\d+)px-[^/]+$/)?.[1];
  if (!width) return clean;
  const file = clean.split("/").pop();
  return `${clean.replace("/wikipedia/commons/", "/wikipedia/commons/thumb/")}/${width}px-${file}`;
}

/**
 * Whether each page still stands, one request every second and a half. "gone" only for 404 or 410; anything else
 * that is not a success (429, 403, a timeout) is "unknown" and changes nothing.
 */
export async function checkPages(urls, { log = () => {} } = {}) {
  const out = new Map();
  for (const url of [...new Set(urls)]) {
    try {
      const response = await fetchWithTimeout(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" }, redirect: "follow" }, 25000);
      out.set(url, response.ok ? "ok" : response.status === 404 || response.status === 410 ? "gone" : "unknown");
      await response.body?.cancel?.().catch(() => {});
    } catch (error) {
      log(`page ${url.slice(0, 80)}: ${error.message}`);
      out.set(url, "unknown");
    }
    await sleep(1500);
  }
  return out;
}

/**
 * Keeps a fault until it is confirmed: `record` is the photo's entry in the health state (or undefined), `bad`
 * whether this check found it gone. Returns the new entry (null when the photo is well) and whether the loss is now
 * confirmed: seen gone twice, at least CONFIRM_AFTER_H hours apart.
 */
export function confirmLoss(record, bad, reason, now = new Date()) {
  if (!bad) return { entry: null, confirmed: false };
  const first = record?.firstBadAt ?? now.toISOString();
  const entry = { firstBadAt: first, lastCheckedAt: now.toISOString(), checks: (record?.checks ?? 0) + 1, reason };
  const confirmed = entry.checks >= 2 && (now.getTime() - Date.parse(first)) / 36e5 >= CONFIRM_AFTER_H;
  return { entry, confirmed };
}
