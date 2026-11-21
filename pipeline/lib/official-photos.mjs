/**
 * Heads of state's own photographers (the owner, 2026-11-21: "did you add presidential offices and monarchy offices and
 * white house/US ministries and other world ministries as photo sources? … or should we give the news room freedom when it
 * comes to such cases instead of hardcoding sources … there is now tr-summit between USA, China and Russia and these
 * countries must have published images", then "Yes, build it").
 *
 * «ترامب وشي وبوتين يعتزمون زيادة إنتاج المشتقات النفطية» ran on 19 November at 11:54 UTC with Trump stepping off his
 * aircraft at Shenzhen, the best Commons then held; the Kremlin had posted the three leaders' meeting, 27 photographs, at
 * 08:30 UTC, and Commons copied the first of them an hour after the story ran. The White House's gallery of the same meeting
 * followed at 20:27 UTC. Commons gets these photographs from the offices themselves; this reads the offices.
 *
 * A registry, not an open search of the web. The desk chooses freely among a registered office's events and photographs
 * (images.mjs officialPhoto()), but which offices may be read is code: an official site is not a free photograph.
 * Presidencies and ministries repost the agencies' pictures (the pool photographer's, Xinhua's, Reuters'), and an agency,
 * not a government, is who chases a small site; China's own sites (gov.cn, Xinhua) reserve all rights, and the Arab
 * presidencies and royal courts state no licence (SPA forbids republishing: the note of 2026-11-16). The model cannot tell
 * who owns a page's photograph; an office whose licence covers its own photographers' work can. A source joins only with
 * its licence read on its own site, and its readers keep only its own photographers' frames.
 *
 * Each source: `events({ since, until, read, log })` lists the office's events in a window of days (ISO dates), each
 * { id, title, date, place, summary, url }; `photos(event, { read, log })` reads one event's photographs as the picture
 * desk's candidates. `read(url)` answers a page's text or null (the self-tests stand in for it).
 */
import { USER_AGENT, fetchPublic, readCapped, stripHtml } from "./util.mjs";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A page's text, or null: never more than 3 MB, never a page that is not HTML. */
export async function readPage(url, log = () => {}) {
  try {
    const response = await fetchPublic(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" } }, 20000);
    if (!response.ok) {
      log(`official: ${response.status} for ${url}`);
      return null;
    }
    const { bytes, cut } = await readCapped(response, 3_000_000);
    if (cut) log(`official: ${url} is over 3 MB; its first 3 MB are read`);
    return bytes.toString("utf8");
  } catch (error) {
    log(`official: ${url} could not be read (${String(error.message).split("\n")[0].slice(0, 100)})`);
    return null;
  }
}

/** An attribute's or an element's text as a reader sees it. */
const text = (s) => stripHtml(String(s ?? "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))).replace(/\s+/g, " ").trim();
const attr = (tag, name) => {
  const m = String(tag).match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i"));
  return m ? m[1] : null;
};
const day = (iso) => String(iso ?? "").slice(0, 10);
/** Whether an ISO date falls in the window, both ends included. */
const within = (date, since, until) => Boolean(date) && date >= since && date <= until;

/** The site prints a photograph as a wide crop (Photo.astro): a portrait frame is never offered, as in commons.mjs. */
const landscape = (w, h) => w > 0 && h > 0 && w / h >= 0.95 && w / h <= 2.6;

/**
 * A date written out in English («November 18-19, 2026», «november-18-19-2026», «Thursday, November 19, 2026»): the last
 * day of a range. Null when there is none.
 */
export function englishDate(s) {
  const m = String(s ?? "").toLowerCase().match(new RegExp(`\\b(${MONTHS.join("|")})[\\s-]+(\\d{1,2})(?:[\\s-]*[-–][\\s-]*(\\d{1,2})|-(\\d{1,2}))?,?[\\s-]+(\\d{4})\\b`));
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]) + 1;
  const d = Number(m[3] ?? m[4] ?? m[2]);
  if (!(d >= 1 && d <= 31)) return null;
  return `${m[5]}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------- Kremlin

const KREMLIN = "http://en.kremlin.ru";

/**
 * The Kremlin's list of the President's events (en.kremlin.ru/events/president/news, page by page), the events with
 * photographs only. Its addresses answer over plain HTTP; HTTPS timed out from here on 2026-11-21, and its photographs
 * are served from static.kremlin.ru over HTTP alone, so a chosen one is kept on the site, never linked.
 */
export function parseKremlinList(html) {
  const out = [];
  const blocks = String(html ?? "").split(/<div class="hentry h-entry hentry_event"/).slice(1);
  for (const block of blocks) {
    const id = block.match(/^\s*data-id="(\d+)"/)?.[1];
    const title = text(block.match(/itemprop="name">([^<]+)</)?.[1]);
    const date = block.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"/)?.[1];
    const photos = Number(block.match(/class="tabs_photo[^"]*"[\s\S]*?tabs__count">(\d+)</)?.[1] ?? 0);
    if (!id || !title || !date || !photos) continue;
    out.push({ id, title, date, place: text(block.match(/hentry__location[^>]*>([^<]+)</)?.[1]), photos, url: `${KREMLIN}/events/president/news/${id}` });
  }
  return out;
}

async function kremlinEvents({ since, until, read, log = () => {} }) {
  const seen = new Set();
  const out = [];
  // Twenty events a page, about three days; four pages reach back about two weeks.
  for (let page = 1; page <= 4; page += 1) {
    const html = await read(`${KREMLIN}/events/president/news${page > 1 ? `/page/${page}` : ""}`);
    const events = parseKremlinList(html);
    if (!events.length) break;
    for (const e of events) if (!seen.has(e.id) && within(e.date, since, until)) (seen.add(e.id), out.push(e));
    if (events.some((e) => e.date < since)) break;
  }
  log(`official: the Kremlin lists ${out.length} event(s) with photographs from ${since} to ${until}`);
  return out;
}

/**
 * One event's photographs, from its own page: each slide carries the caption (`data-text`), a 940-pixel copy the judge looks
 * at and a 1880-pixel copy the site keeps. The event's lead names its people, which the list's title does not («Meeting with
 * President of China and President of the United States»).
 */
export function parseKremlinPhotos(html, event, source) {
  const page = String(html ?? "");
  const summary = text(page.match(/class="read__lead[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]);
  const out = [];
  const seen = new Set();
  for (const m of page.matchAll(/<div class="slider__block" data-text="([^"]*)"[^>]*>\s*<img\s([^>]*)>/g)) {
    const tag = m[2];
    const thumb = attr(tag, "src");
    const big = attr(tag, "srcset")?.match(/(https?:\/\/static\.kremlin\.ru\/media\/events\/photos\/big2x\/([A-Za-z0-9]{16,})\.jpg)/);
    const w = Number(attr(tag, "width")) || 0;
    const h = Number(attr(tag, "height")) || 0;
    if (!thumb || !big || seen.has(big[2]) || !landscape(w, h)) continue;
    seen.add(big[2]);
    out.push(candidate(source, event, { caption: text(m[1]), summary, url: big[1], thumb, width: w * 2, height: h * 2, key: big[2], artist: source.author }));
  }
  return out;
}

async function kremlinPhotos(event, { read }) {
  return parseKremlinPhotos(await read(event.url), event, KREMLIN_SOURCE);
}

// ------------------------------------------------------------------------------------------------------------ White House

const WHITE_HOUSE = "https://www.whitehouse.gov";
/** The White House's own photographers sign every frame they make; a pool or agency picture the site reposts does not. */
const WH_OWN = /\(Official White House Photo(?:graph)? by ([^)]+)\)/i;

/**
 * The White House's galleries (whitehouse.gov/gallery/), newest first, about two weeks on its one page: each gallery's
 * address, which carries its title and date («…/president-donald-j-trump-visits-china-november-18-19-2026/»), and its
 * cover photograph's caption, which names who was there.
 */
export function parseWhiteHouseList(html) {
  const out = [];
  const seen = new Set();
  for (const block of String(html ?? "").split(/<li data-wp-key="post-template-item-/).slice(1)) {
    const url = block.match(/href="(https:\/\/www\.whitehouse\.gov\/gallery\/([a-z0-9-]+)\/)"/);
    if (!url || seen.has(url[2])) continue;
    seen.add(url[2]);
    const cover = text(block.match(/<img\s[^>]*alt="([^"]*)"/)?.[1]);
    const date = englishDate(url[2]) ?? englishDate(cover);
    const title = url[2].replace(/-(?:january|february|march|april|may|june|july|august|september|october|november|december)-[\d-]+$/, "").split("-").map((w) => (w.length > 2 || /^(?:j|d|us)$/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
    if (!date) continue;
    out.push({ id: url[2], title, date, place: "", summary: cover, url: url[1] });
  }
  return out;
}

async function whiteHouseEvents({ since, until, read, log = () => {} }) {
  const out = parseWhiteHouseList(await read(`${WHITE_HOUSE}/gallery/`)).filter((e) => within(e.date, since, until));
  log(`official: the White House lists ${out.length} gallery(ies) from ${since} to ${until}`);
  return out;
}

/**
 * One gallery's photographs: its own photographers' frames only (WH_OWN), each at 640 pixels for the judge and 1600 for the
 * site. The file keeps the Flickr number the White House gave the photograph («p20261119dt-0839_55662874378_o.jpg»), so it is
 * the same photograph as its Commons copy («… (55662874378).jpg») to the repeat guard (photoKey()).
 */
export function parseWhiteHousePhotos(html, event, source) {
  const page = String(html ?? "");
  const out = [];
  const seen = new Set();
  for (const m of page.matchAll(/<img\s([^>]*class="[^"]*wh-gallery-lightbox-image[^"]*"[^>]*)>/g)) {
    const tag = m[1];
    const src = attr(tag, "src")?.match(/^(https:\/\/www\.whitehouse\.gov\/wp-content\/uploads\/\d{4}\/\d{2}\/[^?"]+\.jpe?g)/i)?.[1];
    const caption = text(attr(tag, "alt"));
    const by = caption.match(WH_OWN);
    const w = Number(attr(tag, "width")) || 0;
    const h = Number(attr(tag, "height")) || 0;
    if (!src || !by || seen.has(src) || !landscape(w, h)) continue;
    seen.add(src);
    const flickr = src.match(/_(\d{9,12})_o\.jpe?g$/i)?.[1];
    out.push(candidate(source, event, { caption: caption.replace(WH_OWN, "").trim(), summary: event.summary, url: `${src}?w=1600`, thumb: `${src}?w=640`, width: 1600, height: Math.round((1600 * h) / w), key: flickr ?? null, artist: text(by[1]) }));
  }
  return out;
}

async function whiteHousePhotos(event, { read }) {
  return parseWhiteHousePhotos(await read(event.url), event, WHITE_HOUSE_SOURCE);
}

// --------------------------------------------------------------------------------------------------------------- registry

/** A photograph of an office's event as the picture desk's candidate (the shape the libraries give, commons.mjs). */
function candidate(source, event, { caption, summary, url, thumb, width, height, key, artist }) {
  return {
    title: caption.slice(0, 300),
    description: [event.title, event.place, summary].filter(Boolean).join(" | ").slice(0, 600),
    categories: "",
    date: event.date,
    url,
    thumb,
    width,
    height,
    license: source.license,
    licenseUrl: source.licenseUrl,
    artist,
    pageUrl: source.id === "kremlin" ? `${event.url}/photos` : event.url,
    library: `official:${source.id}`,
    libraryName: source.office,
    official: source.id,
    event: event.title,
    query: `${source.officeEn}: ${event.title}`,
    searched: `${source.officeEn}: ${event.title}`,
    // Where the site keeps it once chosen (public/photos/handouts/), named so that photoKey() knows it again.
    stored: `official-${source.id}-${key ?? url.replace(/[^A-Za-z0-9]/g, "").slice(-24)}.jpg`,
  };
}

const KREMLIN_SOURCE = {
  id: "kremlin",
  office: "الكرملين",
  officeEn: "the Kremlin",
  author: "kremlin.ru",
  country: "Russia",
  leaders: [{ name: "Vladimir Putin", ar: "بوتين" }],
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  checked: "2026-11-21: en.kremlin.ru's footer, «All content on this site is licensed under Creative Commons Attribution 4.0 International»",
  events: kremlinEvents,
  photos: kremlinPhotos,
};

const WHITE_HOUSE_SOURCE = {
  id: "whitehouse",
  office: "البيت الأبيض",
  officeEn: "the White House",
  author: "The White House",
  country: "United States",
  leaders: [
    { name: "Donald Trump", ar: "ترامب" },
    { name: "JD Vance", ar: "فانس" },
  ],
  license: "Public domain",
  licenseUrl: "https://www.usa.gov/government-copyright",
  checked: "2026-11-21: the US government's own employees' work has no copyright (17 U.S.C. § 105); only frames signed «Official White House Photo by …» are read",
  events: whiteHouseEvents,
  photos: whiteHousePhotos,
};

/**
 * The offices the picture desk may read. Before adding one, read its licence on its own site and keep only its own
 * photographers' frames; never an office that reposts agency pictures under its name without saying whose they are.
 */
export const OFFICIAL_SOURCES = [WHITE_HOUSE_SOURCE, KREMLIN_SOURCE];
