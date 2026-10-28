import { USER_AGENT, fetchWithTimeout, stripHtml } from "./util.mjs";

const API = "https://commons.wikimedia.org/w/api.php";
/** Anchored at both ends: "CC BY-NC-SA 4.0" once passed on its "CC BY" prefix. */
const ALLOWED_LICENSE = /^(cc0(?:\s[\d.]+)?|public domain|pd(?:[\s-][\w. -]*)?|cc by(?:-sa)?(?:\s[\d.]+)?(?:\s\w+)?|no restrictions)$/i;
/** Non-commercial and no-derivatives terms never run on a paper that carries advertising, whatever the rest of the name says. */
const FORBIDDEN_LICENSE = /[\s-](nc|nd)\b|non-?commercial|no ?derivative/i;
/**
 * A title that names something other than a photograph. Whole words only: matched inside words, it dropped «Vegetable
 * market» (table), «Photograph of …» (graph), «Covered market» (cover) and «Textile factory» (text) before any check saw
 * them. «Banknote» and «table» are no longer in it: a note's printed face is refused by its own check (SCAN and DEPICTION
 * in images.mjs), which lets money photographed as money through as the owner's rule of 2026-09-28 asks, and the filter
 * had dropped every «… banknotes» photograph before that check could run (2026-10-27, the pound's record low ran without
 * a photograph); a table is mostly furniture («gold bars on a table»), and a data table on Commons is a PNG, refused anyway.
 */
export const BAD_TITLE = /(?<!\p{L})(?:logos?|maps?|diagrams?|screenshots?|charts?|graphs?|flags?|coats? of arms|seals?|icons?|covers?|posters?|banners?|infographics?|memes?|cartoons?|drawings?|sketch(?:es)?|paintings?|stamps?|coin|passports?|documents?|scan(?:s|ned)?|texts?|books?|pages?|plots?)(?!\p{L})|\.(?:svg|tiff?|gif|pdf)\b/iu;

/**
 * Searches Wikimedia Commons for editorial photographs matching `query`.
 * Only permissively licensed bitmap photos with attribution metadata are returned.
 */
/**
 * When the photograph was taken, as far as its record says: "2026-05-14", or the year alone when the field
 * is prose ("Taken on 28 June 2019" → "2019"); "" when it says nothing. It was cut to ten characters,
 * which turned prose into "Taken on 2".
 */
function takenOn(value) {
  const text = stripHtml(String(value ?? ""));
  const iso = text.match(/(?<!\d)((?:19|20)\d\d-[01]\d-[0-3]\d)(?!\d)/);
  if (iso) return iso[1];
  const year = text.match(/(?<!\d)((?:19|20)\d\d)(?!\d)/);
  return year ? year[1] : "";
}

export async function searchCommons(query, { limit = 10, log = () => {} } = {}) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(limit * 2, 30)),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata|timestamp",
    iiurlwidth: "1280",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Attribution|Credit|ImageDescription|DateTimeOriginal|Categories",
  });
  try {
    const response = await fetchWithTimeout(`${API}?${params}`, { headers: { "user-agent": USER_AGENT } }, 20000);
    if (!response.ok) return [];
    const payload = await response.json();
    // The search's own order, which the API returns as `index`: the pages come back keyed by page id, and
    // taking them in that order kept the oldest uploads (the lowest ids) and dropped the newest (2026-09-23:
    // for "Donald Trump Xi Jinping" the 2017 and 2018 files came first and May 2026's were cut).
    const pages = Object.values(payload?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const out = photographs(pages);
    log(`commons "${query}": ${out.length} usable of ${pages.length}`);
    return out.slice(0, limit);
  } catch (error) {
    log(`commons "${query}": ${error.message}`);
    return [];
  }
}

const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const GENERIC_PLACE_WORDS = new Set(["the", "and", "of", "in", "at", "de", "al", "el"]);
/**
 * The photographs filed under a named place's own Commons category, as a person browses Commons rather than searching
 * words: «Baghdad market shoppers» returned 2007-09 US Army patrols of Baghdad's markets, and the CC0 photograph of a
 * crowded Shorja market in 2024 was found only under its name (2026-10-25). The category is taken from a search of category
 * names, and only one whose name carries every distinctive word of the place («Port of Umm Qasr» for «Umm Qasr port»);
 * newest additions first; the same filters as a search.
 */
export async function searchCommonsCategory(name, { limit = 20, log = () => {} } = {}) {
  const words = fold(name).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !GENERIC_PLACE_WORDS.has(w));
  if (!words.length) return [];
  try {
    const find = new URLSearchParams({ action: "query", format: "json", list: "search", srsearch: name, srnamespace: "14", srlimit: "8" });
    const found = await fetchWithTimeout(`${API}?${find}`, { headers: { "user-agent": USER_AGENT } }, 20000);
    if (!found.ok) return [];
    const titles = ((await found.json())?.query?.search ?? []).map((hit) => String(hit.title ?? ""));
    const category = titles.find((title) => {
      const said = fold(title).split(/[^\p{L}\p{N}]+/u);
      return words.every((w) => said.includes(w));
    });
    if (!category) {
      log(`commons category "${name}": none carries its name`);
      return [];
    }
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "categorymembers",
      gcmtitle: category,
      gcmtype: "file",
      gcmsort: "timestamp",
      gcmdir: "desc",
      gcmlimit: String(Math.min(limit * 2, 50)),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata|timestamp",
      iiurlwidth: "1280",
      iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Attribution|Credit|ImageDescription|DateTimeOriginal|Categories",
    });
    const response = await fetchWithTimeout(`${API}?${params}`, { headers: { "user-agent": USER_AGENT } }, 20000);
    if (!response.ok) return [];
    // Keyed by page id; the newest uploads first, as the category lists its newest additions.
    const pages = Object.values((await response.json())?.query?.pages ?? {}).sort((a, b) => String(b.imageinfo?.[0]?.timestamp ?? "").localeCompare(String(a.imageinfo?.[0]?.timestamp ?? "")));
    const out = photographs(pages);
    log(`commons ${category}: ${out.length} usable of ${pages.length}`);
    return out.slice(0, limit);
  } catch (error) {
    log(`commons category "${name}": ${error.message}`);
    return [];
  }
}

/** A query's pages that are photographs this paper may run (JPEG, a free licence, 1000 pixels wide, a photograph's shape), shaped as the desk reads them. */
function photographs(pages) {
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
      const artist = creditName(meta);
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
        artist,
        description: stripHtml(meta.ImageDescription?.value ?? "").slice(0, 200),
        date: takenOn(meta.DateTimeOriginal?.value),
        uploaded: String(info.timestamp ?? "").slice(0, 10),
        categories: stripHtml(meta.Categories?.value ?? "").slice(0, 500),
      });
    }
    return out;
}

/**
 * The author as a credit line names them, from Commons' free-text Artist field. It printed «No machine-readable author
 * provided. MatthiasKabel assumed (based on copyright c» under a story (the owner, 2026-09-27): the field carries
 * Commons' own placeholders and whole sentences, and was cut at 80 characters mid-word. Now the name Commons assumes,
 * the creator a sentence names, an uploader without the city Flickr adds («Andrew A. Shenouda from Cairo, Egypt»),
 * and a long credit ended at a clause, never inside a word; nothing when Commons knows no author.
 *
 * And never words that are not a name (2026-10-28). A file's Artist field read «You may select the license of your
 * choice.», and published credits carried «[null Courtesy]», «mo -- ( Talk», «Photographer: Mosbatho», «Original: NASA
 * Johnson Space Center Derivative work: Nythar», «Mo7amedsalim at Arabic Wikipedia», a Flickr city with its state
 * («from Greenbelt, MD, USA»), emoji, «Jr. Jr.» and doubled spaces. A licence statement or a placeholder now gives
 * nothing, so the credit takes the next name the record holds (creditName()); a label, a talk link, a wiki, a
 * derivative's second author and a licence after the name are cut.
 */
const PLACEHOLDER = /^(?:\[[^\]]*\]|unknown(?: (?:author|photographer|artist))?|author unknown|anonymous(?: photographer)?|not provided|unattributed|none|n\/a)$/i;
const LICENCE_TEXT = /^(?:you (?:may|can|are free)\b|licen[cs]ed?\b|released (?:under|into)\b|(?:this|the) (?:file|work|image|photo(?:graph)?|picture)\b.*\b(?:licen[cs]ed|released|public domain|copyright)\b|public domain\b|cc[ -]?(?:by|0)\b|creative commons\b|gfdl\b|no (?:known )?copyright\b|copyrighted free use\b|attribution\b|own work\b|free (?:to use|for any use)\b.*\b(?:credit|attribution|licen[cs]e|purpose|commercial)\b)/i;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

export function cleanArtist(raw) {
  let a = String(raw ?? "").replace(/\s+/g, " ").trim();
  a = a.replace(/^(?:©|\(c\)|copyright\b)\s*(?:(?:19|20)\d\d\b[\s,]*)?/i, "").replace(EMOJI, " ").replace(/\s+/g, " ").trim();
  const assumed = a.match(/^No machine-readable author provided\.\s*(.+?)\s+assumed\b/i);
  if (assumed) a = assumed[1];
  const created = a.match(/^This (?:photograph|photo|picture|image|file) (?:is|was) (?:created|taken|made) by\s+(.+?)\s*\.(?:\s|$)/i);
  if (created) a = created[1];
  const derived = a.match(/^Original:\s*(.+?)\s+Derivative work:/i);
  if (derived) a = derived[1];
  const creditTo = a.match(/\bcredit(?:ed)? to (?:the )?(?:photographer|author|creator)?\s*:?\s*(.+)$/i);
  if (creditTo) a = creditTo[1];
  a = a.replace(/^(?:(?:photographer|photograph|photo|picture|image|credit|author|attribution|foto|fotograf|autor|auteur)\s*:|(?:photo(?:graph)?|picture|image)s?\s+by\b)\s*/i, "").replace(/^[Bb]y\s+(?=\p{Lu})/u, "");
  a = a.replace(/^User:\s*/i, "").replace(/\s*-*\s*\(\s*(?:talk|contribs)\b[^)]*\)?/gi, " ").trim();
  a = a.replace(/\s+at\s+(?:(?:\p{L}+ )?Wikipedia|[a-z]{2,3}\.wikipedia(?:\.org)?)$/iu, "");
  a = a.replace(/^(.{2,48}?) from [A-Z][^,]{1,30}(?:, [A-Z][^,]{1,30}){0,2}$/u, "$1");
  a = a.replace(/(?:\s*[,/|;(–-]\s*|\s+)(?:licen[cs]e[ds]?\b|cc[ -]?(?:by|0)\b|creative commons\b|gfdl\b|(?:via )?wikimedia commons\b)[\s\S]*$/i, "");
  a = a.replace(/\s+([,;:])/g, "$1").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\(\s*\)/g, "").replace(/\s*\($/, "");
  a = a.replace(/\b(Jr|Sr)\.?\s+\1\b\.?/g, "$1.").replace(/\s+/g, " ").replace(/^[\s,;:\-–_]+/, "").trim();
  if (PLACEHOLDER.test(a) || LICENCE_TEXT.test(a)) return "";
  if (a.length > 72) {
    const cut = a.slice(0, 72);
    // A list of names breaks at its commas first; a dash or a full stop only when there is no comma.
    const comma = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "));
    const at = comma >= 20 ? comma : Math.max(cut.lastIndexOf(" - "), cut.lastIndexOf(". "));
    a = at >= 20 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, "");
  }
  // A full stop that ends an abbreviation or a dotted handle stays («Samuel King Jr.», «Se.By.»); any other trailing mark goes.
  a = a.replace(/[\s,;:\-–_]+$/, "");
  return /(?:^|[\s.])\p{L}{1,3}\.$/u.test(a) ? a : a.replace(/[\s.,;:\-–_]+$/, "").trim();
}

/** The body a release names in Commons' Credit field («This image was released by the United States Department of Defense with the ID …»). */
function releasedBy(credit) {
  return String(credit ?? "").match(/\breleased by (?:the )?([A-Z][\w.,' -]{3,60}?) with the ID\b/)?.[1] ?? "";
}

/**
 * The name a credit line prints for a Commons file, from its record: the Artist field; when that names no one, the
 * attribution its author asked for («Tasnim News Agency» where the Artist field held «You may select the license of
 * your choice.»), then the body a release names («[null Courtesy]» on a Department of Defense photograph); "" when
 * the record names no one. The attribution comes second because it is often longer than a name («CEphoto, Uwe Aranas
 * or alternatively © CEphoto, Uwe Aranas», «© European Union, 2026» for a named photographer); tried first, it changed
 * eight good credits of 276.
 */
export function creditName(meta = {}) {
  const field = (name) => stripHtml(meta?.[name]?.value ?? "");
  return cleanArtist(field("Artist")) || cleanArtist(field("Attribution")) || releasedBy(field("Credit"));
}

/** Where a photo came from, as the credit line names it (pipeline/lib/photolibs.mjs gives each candidate its `library`). */
const LIBRARIES = { flickr: "فليكر", pexels: "بيكسلز", unsplash: "أنسبلاش" };

export function attributionLine(image) {
  const library = String(image.library ?? "");
  const where = LIBRARIES[library] ?? (library.startsWith("openverse:") ? "أوبن فيرس" : "ويكيميديا كومنز");
  const author = image.artist || (where === "ويكيميديا كومنز" ? "Wikimedia Commons" : where);
  // Pexels and Unsplash name no licence of the CC kind; their own licence is linked from the credit. With no
  // photographer named, the library alone («بيكسلز», not «بيكسلز · بيكسلز»).
  if (library === "pexels" || library === "unsplash") return image.artist ? `${author} · ${where}` : where;
  return `${author} · ${image.license} · ${where}`;
}
