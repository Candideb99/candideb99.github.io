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

// ------------------------------------------------------------------------------------------------------------------ Japan

const KANTEI = "https://japan.kantei.go.jp";

/**
 * The Prime Minister's Office of Japan («Prime Minister in Action», japan.kantei.go.jp/<cabinet>/actions/): the latest 20
 * entries, each with its title, date and a description that names who was met and where. The cabinet's number is in the
 * address and changes with the prime minister, so it is read from the home page's own link, never written here.
 */
export function kanteiActionsPath(home) {
  return String(home ?? "").match(/href="(\/\d+\/actions\/index\.html)"/)?.[1] ?? null;
}
export function parseKanteiList(html) {
  const out = [];
  for (const block of String(html ?? "").split(/<li class="list-photo__item">/).slice(1)) {
    const href = block.match(/<a class="list-photo__link" href="(\/\d+\/actions\/[^"]+\.html)"/)?.[1];
    const title = text(block.match(/<p class="list-photo__title">([\s\S]*?)<\/p>/)?.[1]);
    const date = block.match(/datetime="(\d{4}-\d{2}-\d{2})"/)?.[1];
    if (!href || !title || !date) continue;
    out.push({ id: href, title, date, place: "", summary: text(block.match(/<p class="list-photo__description">([\s\S]*?)<\/p>/)?.[1]), url: `${KANTEI}${href}` });
  }
  return out;
}
async function kanteiEvents({ since, until, read, log = () => {} }) {
  const path = kanteiActionsPath(await read(`${KANTEI}/`));
  const out = path ? parseKanteiList(await read(`${KANTEI}${path}`)).filter((e) => within(e.date, since, until)) : [];
  log(`official: the Prime Minister's Office of Japan lists ${out.length} event(s) from ${since} to ${until}${path ? "" : " (its actions page was not found on its home page)"}`);
  return out;
}
/** One event's photographs: the page's carousel, each 980 pixels wide with its caption. */
export function parseKanteiPhotos(html, event, source) {
  const out = [];
  const seen = new Set();
  for (const m of String(html ?? "").matchAll(/<figure class="carousel__item[^"]*"[^>]*>[\s\S]*?<img\s([^>]*)>[\s\S]*?<figcaption class="carousel__caption">([\s\S]*?)<\/figcaption>/g)) {
    const tag = m[1];
    const src = attr(tag, "src")?.match(/^\/contents\/topics\/(\d+)_ext_\d+_(\d+)\.jpe?g$/i);
    const w = Number(attr(tag, "width")) || 0;
    const h = Number(attr(tag, "height")) || 0;
    if (!src || seen.has(src[0]) || !landscape(w, h) || w < 700) continue;
    seen.add(src[0]);
    out.push(candidate(source, event, { caption: text(m[2]), summary: event.summary, url: `${KANTEI}${src[0]}`, thumb: `${KANTEI}${src[0]}`, width: w, height: h, key: `${src[1]}-${src[2]}`, artist: source.author }));
  }
  return out;
}
async function kanteiPhotos(event, { read }) {
  return parseKanteiPhotos(await read(event.url), event, KANTEI_SOURCE);
}

// ------------------------------------------------------------------------------------------------------------------ India

const PMINDIA = "https://www.pmindia.gov.in";
const PIB_STATIC = "https://static.pib.gov.in/WriteReadData/Gallery/PhotoGallery";
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The Prime Minister of India's gallery (pmindia.gov.in/en/image-gallery/): the Press Information Bureau's photographs,
 * grouped by event, each group's title (with its date) in the link's own words and each photograph's caption. The site
 * answers 403 for a while after a few quick requests, so the gallery is read once a story and the judge is shown PIB's own
 * light copy of each photograph (static.pib.gov.in, «T<date><number>.JPG», about 57 KB) rather than the 2,200-pixel original.
 */
export function parsePmIndiaGallery(html, source = PMINDIA_SOURCE) {
  const events = new Map();
  for (const m of String(html ?? "").matchAll(/<a\s([^>]*data-fancybox="gallery(\d+)"[^>]*)>/g)) {
    const tag = m[1];
    const href = attr(tag, "href")?.match(/^(https:\/\/www\.pmindia\.gov\.in\/wp-content\/uploads\/\d{4}\/\d{2}\/H(\d{4})(\d{2})(\d{2})(\d+)\.jpe?g)$/i);
    if (!href) continue;
    const date = `${href[2]}-${href[3]}-${href[4]}`;
    const group = m[2];
    const named = text(tag.match(/onmouseover="this\.title='([^']*)'/)?.[1]);
    const event = events.get(group) ?? { id: group, title: "", date, place: "", summary: "", url: `${PMINDIA}/en/image-gallery/`, photos: [] };
    if (!event.title && named) event.title = named.replace(/\s*\([^)]*\d{4}\)\s*$/, "").trim();
    if (named) event.date = englishDate(named) ?? event.date;
    events.set(group, event);
    const caption = text(attr(tag, "data-caption")) || named;
    const month = MONTH_ABBR[Number(href[3]) - 1];
    event.photos.push({ caption, url: href[1], thumb: `${PIB_STATIC}/${href[2]}/${month}/T${href[2]}${href[3]}${href[4]}${href[5]}.JPG`, key: `${href[2]}${href[3]}${href[4]}${href[5]}` });
  }
  return [...events.values()].filter((e) => e.title && e.photos.length).map((e) => ({ ...e, summary: e.title }));
}
async function pmIndiaEvents({ since, until, read, log = () => {} }) {
  const out = parsePmIndiaGallery(await read(`${PMINDIA}/en/image-gallery/`)).filter((e) => within(e.date, since, until));
  log(`official: the Prime Minister of India's gallery lists ${out.length} event(s) from ${since} to ${until}`);
  return out;
}
/** Read with the gallery: the original is the copy kept; its size is not on the page, and PIB's are 2,200 by 1,472. */
async function pmIndiaPhotos(event) {
  return (event.photos ?? []).map((p) => ({ ...candidate(PMINDIA_SOURCE, event, { caption: p.caption, summary: event.summary, url: p.url, thumb: p.thumb, width: 2200, height: 1472, key: p.key, artist: PMINDIA_SOURCE.author }), thumbAlt: p.url }));
}

// ----------------------------------------------------------------------------------------------------- European Commission

/**
 * The European Commission's Audiovisual Service (audiovisual.ec.europa.eu): its page is an application that reads its media
 * from an open interface, the address below, which its own script names; nothing in it needs a key. The latest 40
 * reportages cover about five days, each with its people («personalities»), places and copyright holder.
 */
const EC_API = "https://8hwk2cyeyb.execute-api.eu-west-1.amazonaws.com/parrotfish-prod";
const EC_PHOTO = "https://ec.europa.eu/avservices/repository/photo";
const en = (list) => text((list ?? []).find((x) => x?.language === "EN")?.content);
/** The European Union's own work only: a reportage or photograph held by anyone else, or with restricted scopes, is not. */
const euHeld = (copyright) => {
  const holders = (copyright?.holders ?? []).map((h) => h?.content).filter(Boolean);
  return !(copyright?.scopes ?? []).length && (!holders.length || holders.some((h) => /^(?:European Union|Union européenne|Europäische Union)$/i.test(String(h).trim())));
};
export function parseEcReportages(json) {
  let data;
  try {
    data = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return [];
  }
  const out = [];
  for (const it of data?.items ?? []) {
    if (it?.type !== "REPORTAGE" || !it.reference || !(it.photosCount > 0) || !euHeld(it.copyright) || !(it.copyright?.holders ?? []).length) continue;
    // Brussels' midnight is 23:00 or 22:00 UTC the day before.
    const date = new Date(Date.parse(it.startDateTime ?? it.timestamp ?? "") + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const people = (it.personalities ?? []).map((p) => text(p?.title)).filter(Boolean);
    out.push({ id: it.reference, title: en(it.titles), date, place: (it.locations ?? []).map((l) => en(l?.titles)).filter(Boolean).join(", "), summary: [en(it.summaries), people.join(", ")].filter(Boolean).join(" | "), year: it.copyright?.year ?? date.slice(0, 4), url: `https://audiovisual.ec.europa.eu/en/media/photo/${it.reference}` });
  }
  return out;
}
async function ecEvents({ since, until, read, log = () => {} }) {
  const out = parseEcReportages(await read(`${EC_API}/media/search?mediaType=REPORTAGE&sortField=search_date&sortFieldDirection=desc&offset=1&limit=40&withChildrenCount=true`)).filter((e) => within(e.date, since, until));
  log(`official: the European Commission lists ${out.length} reportage(s) from ${since} to ${until}`);
  return out;
}
/** One reportage's photographs (its first 30): the 800-pixel copy to judge, the 1200 to keep, each under CC BY. */
export function parseEcPhotos(json, event, source) {
  let data;
  try {
    data = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return [];
  }
  const item = Array.isArray(data) ? data[0] : data;
  const out = [];
  for (const p of (item?.photos ?? []).slice(0, 30)) {
    const sizes = Object.fromEntries((p?.imagesByQualities ?? []).map((q) => [q.quality, q]));
    const high = sizes.HIGH;
    const med = sizes.MEDIUM ?? sizes.LOW;
    const ref = String(p?.reference ?? "").match(/^P-(\d{6})\/(\d{2}-\d{2})$/);
    if (!high || !med || !ref || !euHeld(p.copyright) || !(p.ccBy ?? []).length || !landscape(high.width, high.height)) continue;
    const photographer = (p.cooperators ?? []).find((c) => (c?.roles ?? []).some((r) => r?.roleKey === "PHOTOGRAPHER"))?.name;
    out.push({ ...candidate(source, event, { caption: en(p.summaries) || en(p.titles), summary: event.summary, url: `${EC_PHOTO}${high.path}`, thumb: `${EC_PHOTO}${med.path}`, width: high.width, height: high.height, key: `P-${ref[1]}_${ref[2]}`, artist: `© European Union, ${event.year}` }), photographer: text(photographer) || undefined });
  }
  return out;
}
async function ecPhotos(event, { read }) {
  return parseEcPhotos(await read(`${EC_API}/media?reference=${encodeURIComponent(event.id)}`), event, EC_SOURCE);
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
 * `titles`: the headline's own words for the office's holder, read when the planner's names miss them (a prime minister
 * changes; «رئيسة الوزراء اليابانية» does not). A holder the list does not name yet is still found in the office's own
 * events (images.mjs officialPhoto(): a person most of its events name is the office's own).
 */
const KANTEI_SOURCE = {
  id: "kantei",
  office: "مكتب رئيس وزراء اليابان",
  officeEn: "the Prime Minister's Office of Japan",
  author: "Prime Minister's Office of Japan",
  country: "Japan",
  leaders: [{ name: "Sanae Takaichi", ar: "تاكايتشي" }],
  titles: ["رئيسة الوزراء اليابانية", "رئيس الوزراء الياباني", "رئيسة وزراء اليابان", "رئيس وزراء اليابان"],
  license: "PDL 1.0",
  licenseUrl: "https://japan.kantei.go.jp/policies/terms_e.html",
  checked: "2026-11-21: japan.kantei.go.jp/policies/terms_e.html, the Public Data License (Version 1.0) unless otherwise specified: the source cited with the page's address; logos and content marked with other terms excepted",
  events: kanteiEvents,
  photos: kanteiPhotos,
};

const PMINDIA_SOURCE = {
  id: "pmindia",
  office: "مكتب رئيس وزراء الهند",
  officeEn: "the Prime Minister of India's office",
  author: "PIB",
  country: "India",
  leaders: [{ name: "Narendra Modi", ar: "مودي" }],
  titles: ["رئيس الوزراء الهندي", "رئيس وزراء الهند"],
  license: "Free reuse with credit",
  licenseUrl: "https://www.pmindia.gov.in/en/website-policies/",
  checked: "2026-11-21: pmindia.gov.in/en/website-policies/, «Material featured on this website may be reproduced free of charge… accurately and not… in a derogatory manner or in a misleading context… the source must be prominently acknowledged», third parties' material excepted",
  events: pmIndiaEvents,
  photos: pmIndiaPhotos,
};

const EC_SOURCE = {
  id: "ec",
  office: "المفوضية الأوروبية",
  officeEn: "the European Commission",
  author: "European Union",
  country: null,
  leaders: [
    { name: "Ursula von der Leyen", ar: "لاين" },
    { name: "Maroš Šefčovič", ar: "شيفتشوفيتش" },
    { name: "Valdis Dombrovskis", ar: "دومبروفسكيس" },
    { name: "Teresa Ribera", ar: "ريبيرا" },
    { name: "Kaja Kallas", ar: "كالاس" },
    { name: "Dan Jørgensen", ar: "يورغنسن" },
    { name: "Stéphane Séjourné", ar: "سيجورنيه" },
    { name: "Maria Luís Albuquerque", ar: "ألبوكيركي" },
  ],
  titles: ["المفوضية الأوروبية", "رئيسة المفوضية", "المفوض الأوروبي", "المفوضة الأوروبية"],
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  checked: "2026-11-21: the Audiovisual Service's conditions of use (its reference M-002093): content the EU owns is CC BY 4.0 unless an item says otherwise, credited «© European Union, 202X, made available under CC BY 4.0»; people's image rights and third parties' material excepted. Only items held by the EU, with no restricted scope and marked CC BY, are read",
  events: ecEvents,
  photos: ecPhotos,
};

/**
 * The offices the picture desk may read. Before adding one, read its licence on its own site and keep only its own
 * photographers' frames; never an office that reposts agency pictures under its name without saying whose they are.
 * Looked at and left out on 2026-11-21: Ukraine's presidency (president.gov.ua answers «Access Denied» to every request,
 * its robots file too) and the European Council (consilium.europa.eu shows a browser check); China's sites (all rights
 * reserved); the Arab presidencies and royal courts (no licence stated; SPA forbids republishing).
 */
export const OFFICIAL_SOURCES = [WHITE_HOUSE_SOURCE, KREMLIN_SOURCE, KANTEI_SOURCE, PMINDIA_SOURCE, EC_SOURCE];

/**
 * Offices built and licence-checked but not read. India's waited here for an hour on 2026-11-21: pmindia.gov.in answers
 * 403 to a reader that names itself a bot or gives an address, as the newsroom's did; the owner then had the reader named
 * plainly (util.mjs USER_AGENT), which it answers.
 */
export const HELD_SOURCES = [];
