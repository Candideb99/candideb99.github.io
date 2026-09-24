#!/usr/bin/env node
/**
 * Audits every live article's photograph against the story it illustrates.
 *
 *   node pipeline/audit-images.mjs            # judge every live article, write pipeline/runs/image-audit.json
 *   node pipeline/audit-images.mjs --limit=20 # the newest N only
 *
 * For each article it fetches the Commons file's own title and description (cached in
 * pipeline/.cache/commons-meta.json), and asks a text model one question: does this photograph
 * belong with this story? The failure this exists to catch, 2026-09-22: a story about Treasury
 * Secretary Bessent meeting He Lifeng ran a 2014 photo of John Kerry meeting Liu Yandong, because
 * the setting matched and nobody read the file's name. A photo that shows an identifiable person the
 * story does not mention is WRONG, however well the room matches.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
// The judge is Claude, like every model call since 2026-09-24 (the owner: «abandon free models and use claude
// only»); the audit reads .env itself so it runs the same from a plain shell as from the desk.
for (const line of existsSync(path.join(root, ".env")) ? readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith("#") && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { chat } = await import("./lib/llm.mjs");
// The same geography rule the newsroom's picture checks read (2026-09-23): one rule, not two copies,
// and the same check in code, which overrides a model that passes a photo its own file places abroad.
const { PLACE_RULE, placedAbroad, ILLUSTRATIVE } = await import("./lib/images.mjs");
const ARTICLES = path.join(root, "content", "articles");
const CACHE = path.join(root, "pipeline", ".cache", "commons-meta.json");
const OUT = path.join(root, "pipeline", "runs", "image-audit.json");
const args = process.argv.slice(2);
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1]) || 0;
const log = (m) => console.log(`[audit] ${m}`);

function fileTitleFromUrl(url) {
  const m = String(url).match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
  return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : null;
}
async function commonsMeta(fileTitle, cache) {
  if (cache[fileTitle]) return cache[fileTitle];
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.searchParams.set("action", "query");
  api.searchParams.set("titles", `File:${fileTitle}`);
  api.searchParams.set("prop", "imageinfo");
  api.searchParams.set("iiprop", "extmetadata");
  api.searchParams.set("iiextmetadatafilter", "ImageDescription|ObjectName|DateTimeOriginal|Categories");
  api.searchParams.set("format", "json");
  const r = await fetch(api, { headers: { "User-Agent": "Khazendar image audit (khazendar.pages.dev)" }, signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  const page = Object.values(j.query?.pages ?? {})[0];
  const x = page?.imageinfo?.[0]?.extmetadata ?? {};
  const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
  const meta = { description: strip(x.ImageDescription?.value), name: strip(x.ObjectName?.value), date: strip(x.DateTimeOriginal?.value), categories: strip(x.Categories?.value) };
  cache[fileTitle] = meta;
  return meta;
}

const cache = existsSync(CACHE) ? JSON.parse(await readFile(CACHE, "utf8")) : {};
const files = (await readdir(ARTICLES)).filter((f) => f.endsWith(".md"));
const articles = [];
for (const f of files) {
  const raw = await readFile(path.join(ARTICLES, f), "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) continue;
  const d = YAML.parse(m[1]);
  if (d.draft || !d.image?.url) continue;
  articles.push({ file: f, slug: d.slug, title: d.title, subtitle: d.subtitle ?? "", lede: d.lede ?? "", tags: d.tags ?? [], regions: d.regions ?? [], sources: (d.sources ?? []).map((s) => s.title).slice(0, 5), url: d.image.url, alt: d.image.alt ?? "", publishedAt: String(d.publishedAt) });
}
articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
const todo = LIMIT ? articles.slice(0, LIMIT) : articles;
log(`${todo.length} articles to judge`);

const results = [];
for (const a of todo) {
  const fileTitle = fileTitleFromUrl(a.url);
  let meta = { description: "", name: "", date: "", categories: "" };
  try {
    if (fileTitle) meta = await commonsMeta(fileTitle, cache);
  } catch (e) {
    log(`${a.slug}: commons metadata failed (${e.message.slice(0, 60)})`);
  }
  const user = `STORY (Arabic economics newspaper):
Headline: ${a.title}
Standfirst: ${a.subtitle}
Lede: ${a.lede}
Tags: ${a.tags.join(", ")}
Source headlines: ${a.sources.join(" | ")}

PHOTOGRAPH the story currently runs with:
File name: ${fileTitle ?? "(unknown)"}
Commons description: ${meta.description || "(none)"}
Commons date: ${meta.date || "(unknown)"}
Categories: ${meta.categories || "(none)"}
Caption the paper printed: ${a.alt}

Judge whether this photograph belongs with this story, as a strict picture editor would:
- WRONG_PERSON: the photo shows an identifiable person (a politician, official, executive) who is NOT one of the people the story is about, even if the setting is similar. This is the gravest error.
- WRONG_SUBJECT: a different country or city than the story's; a different company or institution; a different sector, including a neighbouring one (electricity pylons on a gas story, a highway on a port story); a military vessel or weapon for a non-military story; a scene that merely lies NEAR the subject (a beach, a park, a street, a metro station, a coastline beside a refinery or port; a satellite view of a whole country); a landmark, flag, sign or building in the frame that identifies a country the story does not mention; a caption that names a place, company or person the story does not mention; a city skyline, panorama or street scene on a story about ONE company, plant, project, product, deal, commodity or technology (a Cairo panorama on a battery-plant story, a San Francisco skyline on an AI-company story). If your reason would contain "loosely", "broadly", "tangentially", "not specifically" or "reasonably", the verdict is WRONG_SUBJECT.
- STALE_EVENT: the photo depicts a specific past event that the story is not about (an old summit, an old ceremony), not just an old photo of a place.
- GENERIC_OK: a neutral illustration whose frame shows the story's OWN institution or sector itself: the named company's or ministry's building, the sector's own object (a battery production line, a data-centre hall, an LNG tanker, a refinery, a pipeline, a trading floor, a port crane, a factory line, a branch of the named bank). The named capital's skyline or central bank is acceptable ONLY for a story about the country's economy as a whole (inflation, growth, budget, currency, rates, sovereign rating, trade balance, jobs). An anonymous scene of the story's sector — a production line, a refinery, a tanker at sea, a container port, a trading floor, a server hall — is acceptable as a stock photograph is, under the rule below: for a story about one country, only when nothing (the file name, description, categories or caption) places it in another country.
- RIGHT: shows the actual people, place or event of the story.
${a.alt.includes(ILLUSTRATIVE) ? `The paper captions this photograph «${ILLUSTRATIVE}» (illustrative): it was chosen because no photograph from the story's own country passed. Judge it by what readers see (the frame as the file describes it, and the caption), not by where the file says it was taken: WRONG_SUBJECT only if the frame shows readable signs, lettering, a landmark, a flag, a skyline or a street, or the caption names a place.` : PLACE_RULE}
Return JSON: {"verdict":"RIGHT|GENERIC_OK|STALE_EVENT|WRONG_SUBJECT|WRONG_PERSON","people_in_photo":"<names the file/description implies, or none>","reason":"<one short English sentence>"}`;
  try {
    const { data, model } = await chat({ role: "critic", system: "You are a strict newspaper picture editor. Answer with one JSON object only.", user, json: true, maxTokens: 300, temperature: 0, log: () => {} });
    let verdict = String(data.verdict ?? "").toUpperCase();
    const abroad = a.alt.includes(ILLUSTRATIVE) ? null : placedAbroad({ title: fileTitle, description: meta.description, categories: meta.categories }, { title: a.title, tags: a.tags, regions: a.regions });
    if (abroad && (verdict === "GENERIC_OK" || verdict === "RIGHT")) {
      verdict = "WRONG_SUBJECT";
      data.reason = `The file places the photo in ${abroad}, a country the story does not name (checked in code; the model said ${String(data.verdict)}).`;
    }
    results.push({ slug: a.slug, file: a.file, title: a.title, image: a.url, fileTitle, verdict, people: data.people_in_photo ?? "", reason: data.reason ?? "", model });
    log(`${verdict.padEnd(13)} ${a.slug.slice(0, 48).padEnd(50)} ${String(data.reason ?? "").slice(0, 90)}`);
  } catch (e) {
    results.push({ slug: a.slug, file: a.file, title: a.title, image: a.url, fileTitle, verdict: "UNJUDGED", reason: e.message.slice(0, 120) });
    log(`UNJUDGED      ${a.slug.slice(0, 48)} ${e.message.slice(0, 80)}`);
  }
}
await mkdir(path.dirname(CACHE), { recursive: true });
await writeFile(CACHE, JSON.stringify(cache, null, 1));
await writeFile(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const counts = {};
for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
log(`done: ${JSON.stringify(counts)} → ${path.relative(root, OUT)}`);
