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
// The judge runs on the free chain whatever the paper's provider is: 125 small verdicts are not worth
// the owner's Claude allowance, and the audit must run the same from a plain shell as from the desk.
for (const line of existsSync(path.join(root, ".env")) ? readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith("#") && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.KHAZENDAR_PROVIDER = "openrouter";
const { chat } = await import("./lib/llm.mjs");
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
  articles.push({ file: f, slug: d.slug, title: d.title, subtitle: d.subtitle ?? "", lede: d.lede ?? "", tags: d.tags ?? [], sources: (d.sources ?? []).map((s) => s.title).slice(0, 5), url: d.image.url, alt: d.image.alt ?? "", publishedAt: String(d.publishedAt) });
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
- WRONG_SUBJECT: the photo shows a different event, place, company, product or country than the story.
- STALE_EVENT: the photo depicts a specific past event that the story is not about (an old summit, an old ceremony), not just an old photo of a place.
- GENERIC_OK: a neutral photo of the right place, institution, sector or object (a skyline, a headquarters, a refinery, an oil tanker, a trading floor) — acceptable.
- RIGHT: shows the actual people, place or event of the story.
Return JSON: {"verdict":"RIGHT|GENERIC_OK|STALE_EVENT|WRONG_SUBJECT|WRONG_PERSON","people_in_photo":"<names the file/description implies, or none>","reason":"<one short English sentence>"}`;
  try {
    const { data, model } = await chat({ role: "critic", system: "You are a strict newspaper picture editor. Answer with one JSON object only.", user, json: true, maxTokens: 300, temperature: 0, log: () => {} });
    const verdict = String(data.verdict ?? "").toUpperCase();
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
