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

// ------------------------------------------------------------------------------------------------- Spanish-speaking offices

/**
 * The countries a Spanish title names, in the English the picture desk matches on (images.mjs officialEventFits() reads
 * English country names): «Reunión del Presidente con su par de Estados Unidos» names the United States.
 */
const SPANISH_COUNTRIES = [
  ["Estados Unidos", "United States"], ["China", "China"], ["Brasil", "Brazil"], ["Chile", "Chile"], ["Uruguay", "Uruguay"], ["Paraguay", "Paraguay"],
  ["Bolivia", "Bolivia"], ["México", "Mexico"], ["Perú", "Peru"], ["Colombia", "Colombia"], ["Venezuela", "Venezuela"], ["Ecuador", "Ecuador"],
  ["Argentina", "Argentina"], ["Canadá", "Canada"], ["España", "Spain"], ["Francia", "France"], ["Alemania", "Germany"], ["Italia", "Italy"],
  ["Reino Unido", "United Kingdom"], ["Japón", "Japan"], ["India", "India"], ["Rusia", "Russia"], ["Corea", "South Korea"], ["Turquía", "Turkey"],
  ["Israel", "Israel"], ["Arabia Saudita", "Saudi Arabia"], ["Emiratos Árabes", "United Arab Emirates"], ["Qatar", "Qatar"], ["Catar", "Qatar"], ["Egipto", "Egypt"],
];
/** The same in Italian, for Palazzo Chigi's titles. */
const ITALIAN_COUNTRIES = [
  ["Stati Uniti", "United States"], ["Cina", "China"], ["Francia", "France"], ["Germania", "Germany"], ["Regno Unito", "United Kingdom"], ["Giappone", "Japan"],
  ["India", "India"], ["Russia", "Russia"], ["Ucraina", "Ukraine"], ["Arabia Saudita", "Saudi Arabia"], ["Emirati Arabi", "United Arab Emirates"], ["Egitto", "Egypt"],
  ["Turchia", "Turkey"], ["Brasile", "Brazil"], ["Spagna", "Spain"], ["Algeria", "Algeria"], ["Libia", "Libya"], ["Tunisia", "Tunisia"], ["Marocco", "Morocco"], ["Qatar", "Qatar"],
];
export function withEnglishCountries(text) {
  const found = [...SPANISH_COUNTRIES, ...ITALIAN_COUNTRIES].filter(([es]) => new RegExp(`(?<![\\p{L}])${es}(?![\\p{L}])`, "u").test(String(text ?? ""))).map(([, en]) => en);
  return found.length ? `${text} (${[...new Set(found)].join(", ")})` : String(text ?? "");
}

/** RSS items as { title, link, date } (Joomla's feeds, as Casa Rosada's). */
export function parseRssItems(xml) {
  return [...String(xml ?? "").matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const get = (tag) => text(m[1].match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1]);
    const when = Date.parse(get("pubDate"));
    return { title: get("title"), link: get("link"), date: Number.isFinite(when) ? new Date(when - 3 * 60 * 60 * 1000).toISOString().slice(0, 10) : null };
  });
}

const CASA_ROSADA = "https://www.casarosada.gob.ar";
/**
 * Argentina's presidency (casarosada.gob.ar, «Actividad oficial»): its RSS feed lists each official event, and each event's
 * page names its main photograph (og:image, 1,280 pixels, on the site's own /images/<yyyymm>/). The date is Buenos Aires'.
 */
async function casaRosadaEvents({ since, until, read, log = () => {} }) {
  const out = parseRssItems(await read(`${CASA_ROSADA}/informacion/actividad-oficial?format=feed&type=rss`))
    .filter((i) => i.title && /^https:\/\/www\.casarosada\.gob\.ar\//.test(i.link) && within(i.date, since, until))
    .map((i) => ({ id: i.link, title: i.title, date: i.date, place: "", summary: withEnglishCountries(i.title), url: i.link }));
  log(`official: Argentina's presidency lists ${out.length} event(s) from ${since} to ${until}`);
  return out;
}
export function parseCasaRosadaPhotos(html, event, source) {
  const page = String(html ?? "");
  const out = [];
  const seen = new Set();
  const og = page.match(/<meta property="og:image" content="(https:\/\/www\.casarosada\.gob\.ar\/images\/(\d{6})\/([\w.-]+?)\.(?:jpe?g|png))"/i);
  const description = text(page.match(/<meta (?:name|property)="(?:og:)?description" content="([^"]*)"/i)?.[1]);
  for (const m of og ? [og] : []) {
    if (seen.has(m[1]) || /-cropped$/i.test(m[3])) continue;
    seen.add(m[1]);
    out.push(candidate(source, event, { caption: event.title, summary: withEnglishCountries([description, event.summary].filter(Boolean).join(" | ")), url: m[1], thumb: m[1], width: 1280, height: 854, key: `${m[2]}-${m[3]}`, artist: source.author }));
  }
  return out;
}
async function casaRosadaPhotos(event, { read }) {
  return parseCasaRosadaPhotos(await read(event.url), event, CASA_ROSADA_SOURCE);
}

// ------------------------------------------------------------------------------------------------------------- Italy, Spain

const GOVERNO = "https://www.governo.it";
/**
 * Italy's government (governo.it): its news feed, each article's main photograph named on its page (og:image, on the
 * site's own /sites/governo.it/files/). Decrees and communiqués carry the site's emblem or nothing, and are passed over.
 */
async function governoEvents({ since, until, read, log = () => {} }) {
  const out = parseRssItems(await read(`${GOVERNO}/it/feed/rss`))
    .filter((i) => i.title && /^https:\/\/www\.governo\.it\//.test(i.link) && within(i.date, since, until))
    .map((i) => ({ id: i.link, title: i.title, date: i.date, place: "", summary: withEnglishCountries(i.title), url: i.link }));
  log(`official: Italy's government lists ${out.length} item(s) from ${since} to ${until}`);
  return out;
}
export function parseGovernoPhotos(html, event, source) {
  const og = String(html ?? "").match(/<meta property="og:image" content="(https:\/\/www\.governo\.it\/sites\/governo\.it\/files\/(?:field\/image\/)?([\w.-]+?)\.(?:jpe?g|png))"/i);
  if (!og || /logo|stemma|emblem|default|placeholder/i.test(og[2])) return [];
  const description = text(String(html ?? "").match(/<meta (?:name|property)="(?:og:)?description" content="([^"]*)"/i)?.[1]);
  return [candidate(source, event, { caption: event.title, summary: withEnglishCountries([description, event.summary].filter(Boolean).join(" | ")), url: og[1], thumb: og[1], width: 1200, height: 800, key: og[2], artist: source.author })];
}
async function governoPhotos(event, { read }) {
  return parseGovernoPhotos(await read(event.url), event, GOVERNO_SOURCE);
}

const MONCLOA = "https://www.lamoncloa.gob.es";
/**
 * Spain's government (lamoncloa.gob.es): its photo galleries' feed, each gallery's frames listed in the page's own data
 * (schema.org ImageObject: the 2,000-pixel file, its caption, its author). The site authorises reuse of its content but
 * not of third parties', and its galleries mix the government's photographers («Pool Moncloa/Fernando Calvo») with an
 * agency's («EFE/ Mariscal», on the gallery of Lula's visit of 16 November 2026): only Moncloa's own frames are read.
 */
async function moncloaEvents({ since, until, read, log = () => {} }) {
  const out = parseRssItems(await read(`${MONCLOA}/Paginas/rss.aspx?tipo=41`))
    .filter((i) => i.title && /^https:\/\/www\.lamoncloa\.gob\.es\//.test(i.link) && within(i.date, since, until))
    .map((i) => ({ id: i.link, title: i.title, date: i.date, place: "", summary: withEnglishCountries(i.title), url: i.link.replace(/\?qfr=\d+$/, "") }));
  log(`official: Spain's government lists ${out.length} gallery(ies) from ${since} to ${until}`);
  return out;
}
const AGENCY = /\b(?:EFE|Europa Press|Reuters|AFP|AP|Getty|EP|Agencia)\b/i;
export function parseMoncloaPhotos(html, event, source) {
  const out = [];
  const seen = new Set();
  for (const m of String(html ?? "").matchAll(/\{"@id":"[^"]*","@type":"ImageObject"[^{}]*?"contentUrl":"(https:\/\/www\.lamoncloa\.gob\.es\/multimedia\/fotos\/[^"]+?\/([\w.-]+?)\.jpe?g)"[^{}]*?"name":"([^"]*)"[^{}]*?"author":\{"@type":"Person","name":"([^"]*)"\}[^{}]*?"width":"(\d+)","height":"(\d+)"\}/g)) {
    const [, url, file, name, author, w, h] = m;
    if (seen.has(url) || !/Moncloa/i.test(author) || AGENCY.test(author) || !landscape(Number(w), Number(h))) continue;
    seen.add(url);
    out.push(candidate(source, event, { caption: text(name), summary: event.summary, url, thumb: `${url}?RenditionID=34`, width: Number(w), height: Number(h), key: file, artist: text(author) }));
  }
  return out;
}
async function moncloaPhotos(event, { read }) {
  return parseMoncloaPhotos(await read(event.url), event, MONCLOA_SOURCE);
}

// ---------------------------------------------------------------------------------------------------------------- Romania

const GOV_RO = "https://gov.ro";
/** «19 Nov 2026» as an ISO date, or null. */
export function dayMonthYear(s) {
  const m = String(s ?? "").match(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (20\d\d)\b/);
  if (!m) return null;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[2]) + 1;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
/** The event pages the photo section lists, newest first, titled by their own addresses. */
export function parseGovRoList(html) {
  const out = [];
  for (const m of String(html ?? "").matchAll(/href="(https?:\/\/gov\.ro\/en\/media\/photo\/([a-z0-9-]+))(?:&amp;|&)page=1"/gi)) {
    if (out.some((e) => e.url === m[1])) continue;
    out.push({ id: m[1], url: m[1], title: m[2].split("-").map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ") });
  }
  return out;
}
/**
 * Romania's government (gov.ro: «Reproduction of materials from the site is authorized, indicating the source»): its photo
 * section lists the prime minister's events, each page dated and holding its frames (galerie_foto/<n>original_<k>.jpeg, a
 * «big» copy beside it). Its RSS links all lead to one page, so the section itself is read; six events at most.
 */
async function govRoEvents({ since, until, read, log = () => {} }) {
  const out = [];
  for (const e of parseGovRoList(await read(`${GOV_RO}/en/media/photo`)).slice(0, 6)) {
    const html = await read(`${e.url}&page=1`);
    const date = dayMonthYear(text(html));
    if (within(date, since, until)) out.push({ ...e, date, place: "", summary: e.title, html });
  }
  log(`official: Romania's government lists ${out.length} event(s) from ${since} to ${until}`);
  return out;
}
export function parseGovRoPhotos(html, event, source) {
  const out = [];
  const seen = new Set();
  for (const m of String(html ?? "").matchAll(/https?:\/\/gov\.ro\/fisiere\/galerie_foto\/(\d+)original_(\d+)\.jpe?g/gi)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push(candidate(source, event, { caption: event.title, summary: event.summary, url: m[0], thumb: m[0].replace("original_", "big_"), width: 1200, height: 800, key: `${m[1]}-${m[2]}`, artist: source.author }));
  }
  return out.slice(0, 10);
}
async function govRoPhotos(event, { read }) {
  return parseGovRoPhotos(event.html ?? (await read(`${event.url}&page=1`)), event, GOV_RO_SOURCE);
}

// ----------------------------------------------------------------------------------------------------------------- Flickr

/**
 * An office that publishes on Flickr (flickr.com/services/feeds: its 20 newest photographs, no key). The feed carries no
 * licence, and an account's licence changes: the UK Prime Minister's and the UK Government's photographs were CC BY for
 * years and are CC BY-NC-ND 4.0 now (2026-11-21), which an advertised site may not run. So each photograph's own page is
 * read for its licence before it is offered (`"license":<n>` in Flickr's page data), and only a free one passes.
 */
const FLICKR_LICENCES = { 4: "CC BY 2.0", 5: "CC BY-SA 2.0", 8: "Public domain (US Government Work)", 9: "CC0", 10: "Public domain", 11: "CC BY 4.0", 12: "CC BY-SA 4.0" };
export function flickrLicence(html) {
  const n = String(html ?? "").match(/"license":(\d+)/)?.[1];
  return n !== undefined && FLICKR_LICENCES[n] ? FLICKR_LICENCES[n] : null;
}
/** The feed's photographs grouped by their title (one event's frames share it), dated by when each was taken. */
export function parseFlickrFeed(json) {
  let data;
  try {
    data = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return [];
  }
  const events = new Map();
  for (const it of data?.items ?? []) {
    const m = String(it?.media?.m ?? "").match(/^(https:\/\/live\.staticflickr\.com\/\d+\/(\d+)_[0-9a-f]+)_m\.jpg$/);
    const title = text(it?.title);
    if (!m || !title || /^(?:IMG|DSCN?|DJI|P)[_-]?\d|^[\w-]+\.jpe?g$/i.test(title)) continue;
    const date = String(it.date_taken ?? it.published ?? "").slice(0, 10);
    const event = events.get(title) ?? { id: title, title, date, place: "", summary: withEnglishCountries(text(String(it.description ?? "").replace(/^[\s\S]*?posted a photo:\s*/i, "")).slice(0, 500)), url: String(it.link ?? ""), photos: [] };
    event.photos.push({ base: m[1], id: m[2], link: String(it.link ?? ""), caption: title });
    events.set(title, event);
  }
  return [...events.values()];
}
function flickrSource({ id, nsid, office, officeEn, author, country, leaders, titles }) {
  const source = {
    id,
    office,
    officeEn,
    author,
    country,
    leaders,
    titles,
    license: "",
    licenseUrl: "",
    flickr: nsid,
    checked: "each photograph's licence is read on its own Flickr page before it is offered",
    async events({ since, until, read, log = () => {} }) {
      const out = parseFlickrFeed(await read(`https://www.flickr.com/services/feeds/photos_public.gne?id=${encodeURIComponent(nsid)}&format=json&nojsoncallback=1`)).filter((e) => within(e.date, since, until));
      log(`official: ${officeEn}'s Flickr lists ${out.length} event(s) from ${since} to ${until}`);
      return out;
    },
    async photos(event, { read, log = () => {} }) {
      const out = [];
      // Eight frames an event at most: each costs one page read for its licence.
      for (const p of (event.photos ?? []).slice(0, 8)) {
        const licence = flickrLicence(await read(p.link));
        if (!licence) {
          log(`official: ${officeEn}'s photograph ${p.id} is not under a free licence; passed over`);
          continue;
        }
        out.push({ ...candidate(source, event, { caption: p.caption, summary: event.summary, url: `${p.base}_b.jpg`, thumb: `${p.base}_z.jpg`, width: 1024, height: 683, key: p.id, artist: author }), license: licence, licenseUrl: p.link, pageUrl: p.link, stored: `official-flickr-${p.id}.jpg` });
      }
      return out;
    },
  };
  return source;
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
 * its robots file too; its Flickr is CC0 but stopped in February 2026) and the European Council (consilium.europa.eu
 * shows a browser check); China's sites (all rights reserved); the Arab presidencies and royal courts (no licence stated;
 * SPA forbids republishing); the UK Prime Minister and the UK Government (their Flickr photographs are CC BY-NC-ND 4.0
 * now); Brazil's presidency (gov.br: «Creative Commons Atribuição-SemDerivações 3.0», no derivatives, and the site crops)
 * and Agência Brasil («Todos os direitos reservados pela EBC»); Mexico (gob.mx/terminos: download «solamente para su uso
 * personal y no para un uso comercial»); Canada (pm.gc.ca/en/important-notices: commercial reproduction «prohibited
 * except with written permission from the Privy Council Office», which the owner could ask for).
 */
const CASA_ROSADA_SOURCE = {
  id: "casarosada",
  office: "الرئاسة الأرجنتينية",
  officeEn: "Argentina's presidency",
  author: "Casa Rosada",
  country: "Argentina",
  leaders: [{ name: "Javier Milei", ar: "ميلي" }],
  titles: ["الرئيس الأرجنتيني", "رئيس الأرجنتين"],
  license: "CC BY 2.5 AR",
  licenseUrl: "https://creativecommons.org/licenses/by/2.5/ar/",
  checked: "2026-11-21: casarosada.gob.ar's footer, «Los contenidos de Casa Rosada están licenciados bajo Creative Commons Reconocimiento 2.5 Argentina License»",
  events: casaRosadaEvents,
  photos: casaRosadaPhotos,
};

const ECUADOR_SOURCE = flickrSource({
  id: "ecuador",
  nsid: "7965504@N03",
  office: "الرئاسة الإكوادورية",
  officeEn: "Ecuador's presidency",
  author: "Presidencia de la República del Ecuador",
  country: "Ecuador",
  leaders: [{ name: "Daniel Noboa", ar: "نوبوا" }],
  titles: ["الرئيس الإكوادوري", "رئيس الإكوادور"],
});

/*
 * The G20's other offices, read the same day: France (elysee.fr's legal notice: content under the Licence Ouverte, but its
 * «photographies … ne sont pas … réutilisables sans leur accord»), Korea (KOGL type 4: no commercial use, no changes),
 * Australia (pm.gov.au: CC BY 4.0 «with the exception of … all photos and graphics»), Germany (its photo archive's terms
 * page answers 404), South Africa and Turkey (no reuse statement found), Indonesia (presidenri.go.id 403; setkab.go.id
 * states only its copyright), Saudi Arabia (SPA, the rule of 16 November): none is read.
 */
const GOVERNO_SOURCE = {
  id: "governo",
  office: "الحكومة الإيطالية",
  officeEn: "Italy's government",
  author: "Palazzo Chigi",
  country: "Italy",
  leaders: [{ name: "Giorgia Meloni", ar: "ميلوني" }],
  titles: ["رئيسة الوزراء الإيطالية", "رئيسة وزراء إيطاليا", "رئيسة الحكومة الإيطالية"],
  license: "CC BY 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
  checked: "2026-11-21: governo.it/it/note-legali, «Salvo ove diversamente indicato, i contenuti pubblicati sul presente sito (testi, immagini, fotografie, video, ecc.) sono messi a disposizione con licenza CC-BY 3.0»",
  events: governoEvents,
  photos: governoPhotos,
};

const MONCLOA_SOURCE = {
  id: "moncloa",
  office: "الحكومة الإسبانية",
  officeEn: "Spain's government",
  author: "La Moncloa",
  country: "Spain",
  leaders: [{ name: "Pedro Sánchez", ar: "سانشيز" }],
  titles: ["رئيس الوزراء الإسباني", "رئيس الحكومة الإسبانية", "رئيس وزراء إسبانيا"],
  license: "Reuse authorised",
  licenseUrl: "https://www.lamoncloa.gob.es/Paginas/es_AvisoLegal.aspx",
  checked: "2026-11-21: lamoncloa.gob.es's legal notice, «Se autoriza la reproducción total o parcial, modificación, distribución y comunicación de la información disponible en este sitio web, con excepción de los contenidos sobre los que existan derechos … de terceros»; only frames credited to its own photographers (Pool Moncloa) are read",
  events: moncloaEvents,
  photos: moncloaPhotos,
};

/*
 * The rest of the owner's list, read the same day: Greece (primeminister.gr: CC BY-ND 4.0, no derivatives), Morocco
 * (maroc.ma: commercial use, reproduction or modification «sans notre consentement écrit est illicite»), the Netherlands
 * (CC0 for text, but «almost no situations in which you are allowed to use visual materials»), Poland (gov.pl: photographs
 * CC BY-NC-ND), Tunisia («جميع الحقوق محفوظة لرئاسة الجمهورية»), Oman (its terms grant no reuse); and no reuse statement
 * the reader can find (a footer drawn by script, or none) for Algeria, Libya, Egypt, Iraq, Jordan, Lebanon, Yemen, Iran,
 * Pakistan, Bangladesh, Kazakhstan, the Czech Republic, Bosnia, Serbia, Estonia, Lithuania, Ireland, Portugal, Kenya,
 * Nigeria and the Philippines (several refuse the reader or fail their certificates).
 */
const GOV_RO_SOURCE = {
  id: "govro",
  office: "الحكومة الرومانية",
  officeEn: "Romania's government",
  author: "Government of Romania",
  country: "Romania",
  leaders: [{ name: "Luca Niculescu", ar: "نيكولسكو" }],
  titles: ["رئيس الوزراء الروماني", "رئيس وزراء رومانيا", "الحكومة الرومانية"],
  license: "Reproduction authorised",
  licenseUrl: "https://gov.ro/en/legal-conditions",
  checked: "2026-11-21: gov.ro/en/legal-conditions, «Reproduction of materials from the site is authorized, indicating the source … Restriction to reproduce materials from the site will be clearly indicated where appropriate»",
  events: govRoEvents,
  photos: govRoPhotos,
};

export const OFFICIAL_SOURCES = [WHITE_HOUSE_SOURCE, KREMLIN_SOURCE, KANTEI_SOURCE, PMINDIA_SOURCE, EC_SOURCE, CASA_ROSADA_SOURCE, ECUADOR_SOURCE, GOVERNO_SOURCE, MONCLOA_SOURCE, GOV_RO_SOURCE];

/**
 * Offices built and licence-checked but not read. India's waited here for an hour on 2026-11-21: pmindia.gov.in answers
 * 403 to a reader that names itself a bot or gives an address, as the newsroom's did; the owner then had the reader named
 * plainly (util.mjs USER_AGENT), which it answers.
 */
export const HELD_SOURCES = [];
