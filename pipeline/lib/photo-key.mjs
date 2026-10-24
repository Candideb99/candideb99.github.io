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
 * The stories whose photograph an older story already runs, under any of its addresses; the oldest keeps it. `stories`:
 * { slug, at (a time in milliseconds), image: { url } }.
 */
export function sharedPhotos(stories) {
  const first = new Map();
  const out = [];
  for (const s of [...stories].sort((a, b) => a.at - b.at)) {
    const key = photoKey(s.image?.url);
    if (!key) continue;
    if (first.has(key)) out.push({ slug: s.slug, keeps: first.get(key) });
    else first.set(key, s.slug);
  }
  return out;
}
