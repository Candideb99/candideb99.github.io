#!/usr/bin/env node
/**
 * Rewrites the captions of published photographs the way the desks write them (CAPTION_RULE in
 * pipeline/lib/images.mjs): what the photo shows and, when its file says so, where; never the sky,
 * the weather, light, colours or composition. The owner, 2026-09-23, on «مصفاة نفط تحت سماء ملبدة
 * بالغيوم»: "a human writer would not describe the sky".
 *
 *   node pipeline/recaption-images.mjs              every published photo
 *   node pipeline/recaption-images.mjs --dry-run    show old and new, write nothing
 *   node pipeline/recaption-images.mjs --limit=10   the ten newest
 *   node pipeline/recaption-images.mjs --slugs=a,b  named articles only
 *   node pipeline/recaption-images.mjs --spellings  the house spellings («أمريكي»، «ترامب») in every caption, no model
 *
 * Nothing is edited by hand: the caption comes from the file's own record and the story, is checked in
 * code (Arabic, at most twelve words, nothing painted), and the frontmatter is rewritten through the YAML
 * document so every other field keeps its formatting. An illustrative photo keeps its «صورة تعبيرية».
 * A photo for which no clean caption comes back keeps its old one and is listed in the report.
 */
import "./lib/env.mjs";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { writeCaption, captionFlaws, placedAbroad, ILLUSTRATIVE } from "./lib/images.mjs";
import { ARTICLES_DIR } from "./lib/article.mjs";
import { fixNames } from "./lib/copydesk.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const LIMIT = Number(option("limit")) || 0;
const SLUGS = option("slugs").split(",").map((s) => s.trim()).filter(Boolean);
const log = (line) => console.log(`[captions] ${line}`);
const CACHE = path.join(process.cwd(), "pipeline", ".cache", "commons-meta.json");
const cache = existsSync(CACHE) ? JSON.parse(await readFile(CACHE, "utf8")) : {};

function fileTitle(url) {
  const m = String(url).match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
  return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : "";
}

/** The file's own record from Commons (cached with the image audit's cache); politely retried. */
async function commonsMeta(title) {
  if (!title) return {};
  if (cache[title]) return cache[title];
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", titles: `File:${title}`, prop: "imageinfo", iiprop: "extmetadata", iiextmetadatafilter: "ImageDescription|ObjectName|DateTimeOriginal|Categories", format: "json" })) api.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, attempt ? 8000 * attempt : 800));
    try {
      const r = await fetch(api, { headers: { "User-Agent": "Khazendar captions (khazendar.pages.dev)" }, signal: AbortSignal.timeout(20000) });
      const body = JSON.parse(await r.text());
      const x = Object.values(body.query?.pages ?? {})[0]?.imageinfo?.[0]?.extmetadata ?? {};
      const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
      return (cache[title] = { description: strip(x.ImageDescription?.value), name: strip(x.ObjectName?.value), date: strip(x.DateTimeOriginal?.value), categories: strip(x.Categories?.value) });
    } catch {
      /* "too many requests" arrives as plain text: wait and try again */
    }
  }
  return {};
}

const files = (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md"));
const queue = [];
for (const file of files) {
  const raw = await readFile(path.join(ARTICLES_DIR, file), "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) continue;
  const doc = YAML.parseDocument(match[1]);
  const slug = String(doc.get("slug") ?? "");
  const url = doc.getIn(["image", "url"]);
  if (!url || doc.get("draft")) continue;
  if (SLUGS.length && !SLUGS.includes(slug)) continue;
  const data = doc.toJS();
  queue.push({ file, match, doc, slug, url: String(url), alt: String(doc.getIn(["image", "alt"]) ?? ""), title: String(doc.get("title") ?? ""), tags: data.tags ?? [], regions: data.regions ?? [], publishedAt: String(doc.get("publishedAt") ?? "") });
}
queue.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
// `--spellings`: the copy desk's spelling table («أمريكي»، «ترامب») over every caption, in code, no model. Captions
// had never passed through it: eleven printed «الأميركية» or «ترمب» on 2026-09-24.
if (args.includes("--spellings")) {
  let fixed = 0;
  for (const a of queue) {
    const next = fixNames(a.alt);
    if (next === a.alt) continue;
    log(`${DRY ? "WOULD" : "FIXED"} ${a.slug.slice(0, 50)}: ${a.alt} → ${next}`);
    fixed += 1;
    if (DRY) continue;
    a.doc.setIn(["image", "alt"], next);
    await writeFile(path.join(ARTICLES_DIR, a.file), `---\n${a.doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n${a.match[2]}`);
  }
  log(`done: ${fixed} caption(s) put in the house spelling${DRY ? " (dry run, nothing written)" : ""}`);
  process.exit(0);
}
// A caption that already keeps the rule is not written again (the owner, 2026-09-23: no tokens spent
// editing what is already edited). Code decides which ones break it, for free; --all or --slugs overrides.
const ALL = args.includes("--all");
function breaksTheRule(alt) {
  const core = alt.replace(`(${ILLUSTRATIVE})`, "").trim();
  return !core || core.split(/\s+/).filter(Boolean).length > 12 || captionFlaws(core).length > 0 || !/[؀-ۿ]/.test(core);
}
const pending = ALL || SLUGS.length ? queue : queue.filter((a) => breaksTheRule(a.alt));
if (pending.length < queue.length) log(`${queue.length - pending.length} caption(s) already keep the rule and are left as they are (--all to write them again)`);
const todo = LIMIT ? pending.slice(0, LIMIT) : pending;
log(`${todo.length} caption(s) to write${DRY ? " (dry run)" : ""}`);
if (!todo.length) process.exit(0);

const report = { startedAt: new Date().toISOString(), dryRun: DRY, items: [] };
let changed = 0;
for (const a of todo) {
  const current = a.alt.replace(`(${ILLUSTRATIVE})`, "").trim();
  const title = fileTitle(a.url);
  // A photo from another library (Flickr, Pexels, Unsplash) has no Commons record to write from: its caption stays.
  if (!title) {
    report.items.push({ slug: a.slug, before: a.alt, after: null, note: "not a Commons file; kept the caption" });
    log(`KEPT  ${a.slug.slice(0, 50)}: not a Commons file`);
    continue;
  }
  const meta = await commonsMeta(title);
  // A photo from outside the countries the story names runs as an illustration: no place in its caption.
  const elsewhere = placedAbroad({ title, description: meta.description, categories: meta.categories }, { title: a.title, tags: a.tags, regions: a.regions });
  const illustrative = a.alt.includes(ILLUSTRATIVE) || Boolean(elsewhere);
  const written = await writeCaption({ file: { title, description: meta.description, categories: meta.categories }, story: a.title, current, illustrative, log });
  if (!written) {
    report.items.push({ slug: a.slug, before: a.alt, after: null, note: "no clean caption came back; kept the old one" });
    log(`KEPT  ${a.slug.slice(0, 50)}: ${a.alt}`);
    continue;
  }
  const next = illustrative ? `${written} (${ILLUSTRATIVE})` : written;
  report.items.push({ slug: a.slug, before: a.alt, after: next, flawsBefore: captionFlaws(a.alt) });
  log(`${a.alt === next ? "SAME " : "NEW  "} ${a.slug.slice(0, 50)}\n        was: ${a.alt}\n        now: ${next}`);
  if (a.alt === next || DRY) continue;
  a.doc.setIn(["image", "alt"], next);
  await writeFile(path.join(ARTICLES_DIR, a.file), `---\n${a.doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n${a.match[2]}`);
  changed += 1;
}
await mkdir(path.dirname(CACHE), { recursive: true });
await writeFile(CACHE, JSON.stringify(cache, null, 1));
const runs = path.join(process.cwd(), "pipeline", "runs");
await mkdir(runs, { recursive: true });
const out = path.join(runs, `recaption-${report.startedAt.replace(/[:.]/g, "-")}.json`);
await writeFile(out, JSON.stringify(report, null, 2));
log(`done: ${changed} caption(s) rewritten${DRY ? " (dry run, nothing written)" : ""}; report ${path.relative(process.cwd(), out)}`);
