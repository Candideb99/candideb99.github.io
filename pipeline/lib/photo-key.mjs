/**
 * One photograph's identity, whatever address it is printed under. The repeat guard compared addresses, and on
 * 2026-10-24 Duqm's port ran on two stories: the Oman story of 7 September stores it as thumb.wikimedia.org/…?utm_source=…,
 * and the picture desk offered the same file as upload.wikimedia.org/… to a rewritten explainer. A Commons file is its
 * name (any width, any host, either encoding of a comma, its first letter in either case); a Flickr, Pexels or Unsplash
 * photograph its number; anything else its address without the query.
 */
export function photoKey(url) {
  const u = String(url ?? "").trim();
  if (!u) return "";
  const commons = u.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/);
  if (commons) {
    let name = commons[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      /* a stray % stays as written */
    }
    // A Commons name is case-sensitive but for its first letter: «Riyadh_skyline.jpg» and «Riyadh_Skyline.jpg» are two
    // photographs, each on its own Saudi story.
    name = name.replace(/_/g, " ");
    // A file imported from Flickr keeps the Flickr number in brackets: it is that Flickr photograph, which a story can
    // run from Flickr itself (the same tanker ran on two stories of 26 October, one copy from each). A crop of a file is
    // the file («… Keynote (cropped).jpg» beside «… Keynote.jpg», 2026-10-31).
    const fromFlickr = name.match(/\((\d{9,12})\)(?:\s*\((?:cropped|edited)\))?\.\w+$/i);
    if (fromFlickr) return `flickr:${fromFlickr[1]}`;
    name = name.replace(/\s*\((?:cropped|edited|crop)\)(?=\.\w+$)/i, "");
    return `commons:${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
  const flickr = u.match(/staticflickr\.com\/(?:\d+\/)*(\d+)_[0-9a-f]+/i);
  if (flickr) return `flickr:${flickr[1]}`;
  // A head of state's office's photograph (official-photos.mjs), at the office or kept on the site as
  // /photos/handouts/official-<office>-<its number>.jpg: the White House names its file by the Flickr number it gave the
  // photograph, which the Commons copy carries too («… (55662874378).jpg»), so the three are one photograph; the Kremlin's
  // number is its large copy's own name.
  const whiteHouse = u.match(/whitehouse\.gov\/wp-content\/uploads\/\d{4}\/\d{2}\/[^/?#]*?_(\d{9,12})_o\.jpe?g/i) ?? u.match(/\/photos\/handouts\/official-whitehouse-(\d{9,12})\.jpg$/);
  if (whiteHouse) return `flickr:${whiteHouse[1]}`;
  const kremlin = u.match(/static\.kremlin\.ru\/media\/events\/photos\/big2x\/([A-Za-z0-9]{16,})\.jpg/) ?? u.match(/\/photos\/handouts\/official-kremlin-([A-Za-z0-9]{16,})\.jpg$/);
  if (kremlin) return `kremlin:${kremlin[1]}`;
  // Japan's prime minister's office (its topic and frame), India's (PIB's date and number, the original or its light copy)
  // and the European Commission's (its photograph's reference), at the office or kept on the site.
  const kantei = u.match(/kantei\.go\.jp\/contents\/topics\/(\d+)_ext_\d+_(\d+)\.jpe?g/i) ?? u.match(/\/photos\/handouts\/official-kantei-(\d+)-(\d+)\.jpg$/);
  if (kantei) return `kantei:${kantei[1]}-${kantei[2]}`;
  const pib = u.match(/(?:pmindia\.gov\.in\/wp-content\/uploads\/\d{4}\/\d{2}\/H|static\.pib\.gov\.in\/.*\/T)(\d{9,})\.(?:jpe?g|JPG)/i) ?? u.match(/\/photos\/handouts\/official-pmindia-(\d{9,})\.jpg$/);
  if (pib) return `pib:${pib[1]}`;
  const ec = u.match(/avservices\/repository\/photo\/.*\/(P-\d{6}_\d{2}-\d{2})_\d{2}-/) ?? u.match(/\/photos\/handouts\/official-ec-(P-\d{6}_\d{2}-\d{2})\.jpg$/);
  if (ec) return `ec:${ec[1]}`;
  // Argentina's presidency (its month folder and file name), and an office's Flickr photograph kept on the site, which is
  // that Flickr photograph.
  const casaRosada = u.match(/casarosada\.gob\.ar\/images\/(\d{6})\/([\w.-]+?)\.(?:jpe?g|png)/i) ?? u.match(/\/photos\/handouts\/official-casarosada-(\d{6})-([\w.-]+?)\.jpg$/);
  if (casaRosada) return `casarosada:${casaRosada[1]}-${casaRosada[2]}`;
  // Italy's government and Spain's, by their files' own names.
  const governo = u.match(/governo\.it\/sites\/governo\.it\/files\/(?:styles\/[^/]+\/public\/)?(?:field\/image\/)?([\w.-]+?)\.(?:jpe?g|png)/i) ?? u.match(/\/photos\/handouts\/official-governo-([\w.-]+?)\.jpg$/);
  if (governo) return `governo:${governo[1]}`;
  const moncloa = u.match(/lamoncloa\.gob\.es\/multimedia\/fotos\/.*?\/([\w.-]+?)\.jpe?g/i) ?? u.match(/\/photos\/handouts\/official-moncloa-([\w.-]+?)\.jpg$/);
  if (moncloa) return `moncloa:${moncloa[1].toLowerCase()}`;
  const flickrKept = u.match(/\/photos\/handouts\/official-flickr-(\d{9,12})\.jpg$/);
  if (flickrKept) return `flickr:${flickrKept[1]}`;
  const pexels =u.match(/images\.pexels\.com\/photos\/(\d+)\//i);
  if (pexels) return `pexels:${pexels[1]}`;
  const unsplash = u.match(/images\.unsplash\.com\/(photo-[\w-]+)/i);
  if (unsplash) return `unsplash:${unsplash[1]}`;
  return `url:${u.replace(/[?#].*$/, "")}`;
}

/**
 * How long a used photograph rests before it may run again (the owner, 2026-11-19, on the Anthropic IPO story run as text
 * while Commons held eight photographs of Dario Amodei at TechCrunch Disrupt 2023, each dropped because two September
 * stories ran one frame of that shoot: "we will run out of free photos this way, how can we still re-use photos we used
 * before but in a way that the reader does not notice?", then "Yes, 30 and 90 days", and the same day "should we make it
 * shorter like 14 and 30 days? since we are relying on free photos only?", "Yes, make it 14 and 30 days"). A reader
 * meets two stories side by side on the front and the section pages, which turn over within days; «اقرأ أيضاً» prints
 * headlines only, and a listing prints one photograph once (firstPictures(), src/lib/articles.ts). Another frame of a
 * shoot may run once the story that runs one is SHOOT_REST_DAYS old, after the pass's unused photographs; the same
 * photograph once it is PHOTO_REST_DAYS old, and only as the last pass before a story runs without one (findImage()).
 */
export const SHOOT_REST_DAYS = 14;
export const PHOTO_REST_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/**
 * The repeat guard's list for the picture desk (findImage()'s `exclude`), from the published stories' photographs
 * (`stories`: { url, at: a time in milliseconds }) and this run's own picks (`recent`), as seen from `now`: the story
 * being pictured (its own date when an older story is pictured again). Each photograph is judged by its youngest use. A
 * bare address: the photograph and its whole shoot are out (younger than SHOOT_REST_DAYS, a run's own pick, an undated
 * story, a handout kept on the site); «photo:» the photograph alone; «rested:» the photograph, which may come back last.
 */
export function usedPhotos(stories, now = Date.now(), recent = []) {
  const youngest = new Map();
  const take = (url, at) => {
    const key = photoKey(url);
    if (!key) return;
    const prev = youngest.get(key);
    const age = Number.isFinite(at) ? Math.abs(now - at) : 0;
    if (!prev || age < prev.age) youngest.set(key, { url: String(url).trim(), age });
  };
  for (const s of stories) take(s?.url, s?.at);
  for (const url of recent) take(url, now);
  const out = new Set();
  for (const { url, age } of youngest.values()) {
    if (age < SHOOT_REST_DAYS * DAY || !/^(?:https?:)?\/\//.test(url)) out.add(url);
    else out.add(`${age < PHOTO_REST_DAYS * DAY ? "photo" : "rested"}:${url}`);
  }
  return out;
}

/**
 * The stories whose photograph another story ran under any of its addresses fewer than PHOTO_REST_DAYS before them; the
 * older keeps it. `stories`: { slug, at (a time in milliseconds), image: { url } }.
 */
export function sharedPhotos(stories) {
  const last = new Map();
  const out = [];
  for (const s of [...stories].sort((a, b) => a.at - b.at)) {
    const key = photoKey(s.image?.url);
    if (!key) continue;
    const before = last.get(key);
    if (before && !(s.at - before.at >= PHOTO_REST_DAYS * DAY)) out.push({ slug: s.slug, keeps: before.slug });
    else last.set(key, { slug: s.slug, at: s.at });
  }
  return out;
}

/**
 * The ids of the stories in a listing that print their photograph: the first in the listing's order to carry each one,
 * under any of its addresses (firstPictures(), src/lib/articles.ts). A photograph that runs again 30 days on would
 * otherwise print twice on its subject's page when the two stories store it at two widths or hosts.
 * @param {{ id: string, url?: string | null }[]} items
 * @returns {Set<string>}
 */
export function firstOfEachPhoto(items) {
  const seen = new Set();
  const ids = new Set();
  for (const { id, url } of items) {
    const key = photoKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ids.add(id);
  }
  return ids;
}

/**
 * The sections whose pieces carry no photograph: «مدخل إلى الاقتصاد» (explainers, economists' ideas, paper readings). The
 * owner, 2026-11-20, on the first «الفكر الاقتصادي» piece and its fast-food photograph: "i do not think we need pictures in
 * the intro to economy part ... we can only rely on graphs, tables, mathematics, analysis etc ... the intro to economy
 * section should not be treated as normal news section articles". The newsroom picks none for them (run.mjs), the
 * morning round never fills one (backfill-images.mjs), and the site prints none, the published pieces' included
 * (src/lib/articles.ts), so their figures, tables and worked examples carry the page. One list for all three.
 */
export const PHOTO_FREE_SECTIONS = new Set(["explainers"]);
/** @param {string | undefined | null} section */
export const photoFree = (section) => PHOTO_FREE_SECTIONS.has(String(section ?? ""));
