import { XMLParser } from "fast-xml-parser";
import { USER_AGENT, canonicalUrl, fetchWithTimeout, hoursSince, safeIsoDate, stripHtml, truncate } from "./util.mjs";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: true,
});

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === "object") {
    if (node.__cdata != null) return textOf(node.__cdata);
    if (node["#text"] != null) return textOf(node["#text"]);
    if (node["@_href"]) return String(node["@_href"]);
  }
  return "";
}

function atomLink(entry) {
  const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
  const alternate = links.find((l) => typeof l === "object" && (!l["@_rel"] || l["@_rel"] === "alternate"));
  return textOf(alternate ?? links[0]);
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

const AR_MONTHS = { يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, إبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12 };

/**
 * A feed date, in the standard forms or in Arabic as اليوم السابع writes it («الخميس، 24 سبتمبر 2026 12:00 ص»),
 * read at +03:00 (the Gulf, and Cairo in summer); an hour either way does not move an item across the 36-hour
 * freshness line. Undated items are dropped by the reader, so a date it cannot read costs the whole feed.
 */
function feedDate(value) {
  const standard = safeIsoDate(value);
  if (standard || !value) return standard;
  const m = String(value).match(/(\d{1,2})\s+([^\s\d،,]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([صم])?)?/);
  const month = m && AR_MONTHS[m[2]];
  if (!month) return null;
  let hour = Number(m[4] ?? 0);
  if (m[6] === "م" && hour < 12) hour += 12;
  if (m[6] === "ص" && hour === 12) hour = 0;
  const pad = (n) => String(n).padStart(2, "0");
  return safeIsoDate(`${m[3]}-${pad(month)}-${pad(m[1])}T${pad(hour)}:${m[5] ?? "00"}:00+03:00`);
}

const decoded = (url) => {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
};

/** A link as some feeds print it: «>http://www.alriyadh.com/2207847» (الرياض, 2026-09-24), with the tag's «>» doubled. */
const cleanLink = (url) => String(url ?? "").trim().replace(/^[>\s]+/, "");

function normalizeItems(doc) {
  if (doc?.rss?.channel) {
    return asArray(doc.rss.channel.item).map((item) => ({
      title: stripHtml(textOf(item.title)),
      url: cleanLink(textOf(item.link) || textOf(item.guid)),
      summary: stripHtml(textOf(item["content:encoded"]) || textOf(item.description)),
      publishedAt: feedDate(textOf(item.pubDate) || textOf(item["dc:date"])),
      categories: asArray(item.category).map(textOf).filter(Boolean),
    }));
  }
  if (doc?.feed) {
    return asArray(doc.feed.entry).map((entry) => ({
      title: stripHtml(textOf(entry.title)),
      url: atomLink(entry),
      summary: stripHtml(textOf(entry.summary) || textOf(entry.content)),
      publishedAt: safeIsoDate(textOf(entry.published) || textOf(entry.updated)),
      categories: asArray(entry.category).map((c) => c?.["@_term"] ?? textOf(c)).filter(Boolean),
    }));
  }
  // A Google News sitemap (2026-10-22, Independent Arabia): the list of a site's last two days of articles that it
  // publishes for crawlers, named in its robots.txt. Titles and dates only; the article page gives the rest.
  if (doc?.urlset) {
    return asArray(doc.urlset.url)
      .filter((entry) => entry["news:news"])
      .map((entry) => ({
        title: stripHtml(textOf(entry["news:news"]["news:title"])),
        url: textOf(entry.loc),
        summary: "",
        publishedAt: safeIsoDate(textOf(entry["news:news"]["news:publication_date"])),
        categories: [],
      }));
  }
  const rdf = doc?.["rdf:RDF"];
  if (rdf) {
    return asArray(rdf.item).map((item) => ({
      title: stripHtml(textOf(item.title)),
      url: textOf(item.link) || item["@_rdf:about"],
      summary: stripHtml(textOf(item.description)),
      publishedAt: safeIsoDate(textOf(item["dc:date"])),
      categories: [],
    }));
  }
  return [];
}

/**
 * Fetches and normalizes one feed. Returns [] on any failure (the run must never
 * die because a single publisher is down).
 */
export async function fetchFeed(source, { maxAgeHours = 36, log = () => {} } = {}) {
  try {
    // `hourKey`: a publisher whose own cache stopped refreshing (Independent Arabia, 2026-10-22: Cloudflare served a
    // feed 65 hours old to every reader, browsers included) is asked once an hour under a new key, which its cache has
    // not seen. Our reader still names itself; a reader asks no more than once an hour.
    const hour = new Date().toISOString().slice(0, 13).replace(/\D/g, "");
    const url = source.hourKey ? `${source.url}${source.url.includes("?") ? "&" : "?"}t=${hour}` : source.url;
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        },
        redirect: "follow",
      },
      25000,
    );
    if (!response.ok) {
      log(`feed ${source.id}: HTTP ${response.status}`);
      return [];
    }
    const raw = await response.text();
    if (raw.length > 4_000_000) {
      log(`feed ${source.id}: oversized response`);
      return [];
    }
    const doc = parser.parse(raw);
    const pathFilter = source.pathFilter ? new RegExp(source.pathFilter, "i") : null;
    const excludePath = source.excludePath ? new RegExp(source.excludePath, "i") : null;
    const limitHours = source.maxAgeHours ?? maxAgeHours;
    const items = normalizeItems(doc)
      .filter((item) => item.title && item.url && /^https?:\/\//i.test(item.url))
      .map((item) => ({
        ...item,
        url: canonicalUrl(item.url),
        // Research feeds carry a whole abstract in the summary; `summaryChars` lets them keep it.
        summary: truncate(item.summary, source.summaryChars ?? 1200),
        sourceId: source.id,
      }))
      // An Arabic address is percent-encoded («/node/660964/%D8%A7…»): the filter reads it decoded too.
      .filter((item) => !pathFilter || pathFilter.test(item.url) || pathFilter.test(decoded(item.url)) || pathFilter.test(item.categories.join(" ")))
      .filter((item) => !excludePath || !(excludePath.test(item.url) || excludePath.test(decoded(item.url))))
      // A PDF cannot be read as a page; a working-paper series that links only to PDFs sets `allowPdf` and is read from its abstract.
      .filter((item) => source.allowPdf || !item.url.toLowerCase().endsWith(".pdf"))
      // An undated item has no age and cannot be "fresh": it is dropped (hoursSince(null) is Infinity).
      .filter((item) => hoursSince(item.publishedAt) <= limitHours)
      .slice(0, source.maxItems ?? 40);
    log(`feed ${source.id}: ${items.length} fresh items`);
    return items;
  } catch (error) {
    log(`feed ${source.id}: ${error.message}`);
    return [];
  }
}
