import { USER_AGENT, fetchWithTimeout, stripHtml } from "./util.mjs";

const API = "https://commons.wikimedia.org/w/api.php";
/** Anchored at both ends: "CC BY-NC-SA 4.0" once passed on its "CC BY" prefix. */
const ALLOWED_LICENSE = /^(cc0(?:\s[\d.]+)?|public domain|pd(?:[\s-][\w. -]*)?|cc by(?:-sa)?(?:\s[\d.]+)?(?:\s\w+)?|no restrictions)$/i;
/** Non-commercial and no-derivatives terms never run on a paper that carries advertising, whatever the rest of the name says. */
const FORBIDDEN_LICENSE = /[\s-](nc|nd)\b|non-?commercial|no ?derivative/i;
const BAD_TITLE = /(logo|map|diagram|screenshot|chart|graph|flag|coat of arms|seal|icon|cover|poster|banner|table|infographic|meme|cartoon|drawing|sketch|painting|stamp|coin\b|banknote|passport|document|scan|text|book|page|plot|\.svg|\.tif|\.gif|\.pdf)/i;

/**
 * Searches Wikimedia Commons for editorial photographs matching `query`.
 * Only permissively licensed bitmap photos with attribution metadata are returned.
 */
export async function searchCommons(query, { limit = 10, log = () => {} } = {}) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(limit * 2, 30)),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1280",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription|DateTimeOriginal|Categories",
  });
  try {
    const response = await fetchWithTimeout(`${API}?${params}`, { headers: { "user-agent": USER_AGENT } }, 20000);
    if (!response.ok) return [];
    const payload = await response.json();
    const pages = Object.values(payload?.query?.pages ?? {});
    const out = [];
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const meta = info.extmetadata ?? {};
      const license = meta.LicenseShortName?.value ?? "";
      const title = String(page.title ?? "");
      // Photographs are JPEGs; PNG and WebP files on Commons are mostly maps, diagrams and screenshots.
      if (!/^image\/jpeg$/i.test(info.mime ?? "")) continue;
      if (!ALLOWED_LICENSE.test(license) || FORBIDDEN_LICENSE.test(license)) continue;
      if (BAD_TITLE.test(title)) continue;
      if ((info.width ?? 0) < 1000 || (info.height ?? 0) < 600) continue;
      const ratio = info.width / info.height;
      if (ratio < 0.95 || ratio > 2.6) continue;
      const artist = stripHtml(meta.Artist?.value ?? "").trim();
      const cleanUrl = (u) => String(u ?? "").replace(/^https:\/\/thumb\.wikimedia\.org\//, "https://upload.wikimedia.org/").replace(/\?.*$/, "");
      out.push({
        title: title.replace(/^File:/, ""),
        pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        url: cleanUrl(info.thumburl ?? info.url),
        fullUrl: cleanUrl(info.url),
        width: info.thumbwidth ?? info.width,
        height: info.thumbheight ?? info.height,
        license,
        licenseUrl: meta.LicenseUrl?.value ?? "",
        artist: artist.slice(0, 80),
        description: stripHtml(meta.ImageDescription?.value ?? "").slice(0, 200),
        date: (meta.DateTimeOriginal?.value ?? "").slice(0, 10),
        categories: stripHtml(meta.Categories?.value ?? "").slice(0, 200),
      });
    }
    log(`commons "${query}": ${out.length} usable of ${pages.length}`);
    return out.slice(0, limit);
  } catch (error) {
    log(`commons "${query}": ${error.message}`);
    return [];
  }
}

export function attributionLine(image) {
  const author = image.artist || "Wikimedia Commons";
  return `${author} · ${image.license} · ويكيميديا كومنز`;
}
