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
  const pexels = u.match(/images\.pexels\.com\/photos\/(\d+)\//i);
  if (pexels) return `pexels:${pexels[1]}`;
  const unsplash = u.match(/images\.unsplash\.com\/(photo-[\w-]+)/i);
  if (unsplash) return `unsplash:${unsplash[1]}`;
  return `url:${u.replace(/[?#].*$/, "")}`;
}

/**
 * How long a used photograph rests before it may run again (the owner, 2026-11-19, on the Anthropic IPO story run as text
 * while Commons held eight photographs of Dario Amodei at TechCrunch Disrupt 2023, each dropped because two September
 * stories ran one frame of that shoot: "we will run out of free photos this way, how can we still re-use photos we used
 * before but in a way that the reader does not notice?", then "Yes, 30 and 90 days"). A reader notices a repeat where two
 * stories stand side by side: the front, a section, a subject page, «اقرأ أيضاً». Another frame of a shoot may run once the
 * story that runs one is SHOOT_REST_DAYS old, after the shoot's unused photographs of every other kind; the same
 * photograph once it is PHOTO_REST_DAYS old, and only as the last pass before a story runs without one (findImage()).
 */
export const SHOOT_REST_DAYS = 30;
export const PHOTO_REST_DAYS = 90;
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
