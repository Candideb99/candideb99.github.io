#!/usr/bin/env node
/**
 * Audits every live article's photograph against the story it illustrates.
 *
 *   node pipeline/audit-images.mjs            # judge every live article, write pipeline/runs/image-audit.json
 *   node pipeline/audit-images.mjs --limit=20 # the newest N only
 *   node pipeline/audit-images.mjs --slugs=a,b # these stories only (after a re-pick)
 *
 * For each article it fetches the Commons file's own title and description (cached in
 * pipeline/.cache/commons-meta.json), and asks a text model one question: does this photograph
 * belong with this story? The failure this exists to catch, 2026-09-22: a story about Treasury
 * Secretary Bessent meeting He Lifeng ran a 2014 photo of John Kerry meeting Liu Yandong, because
 * the setting matched and nobody read the file's name. A photo that shows an identifiable person the
 * story does not mention is WRONG, however well the room matches.
 *
 * Since 2026-10-24 it holds a printed photograph to the desk's own rules (photoRules(), the rubric of the second check
 * before publication, and publishedFault(), the desk's checks in code), reads the whole story as the desk does and looks
 * at the frame itself. Its own copy of the rules had fallen behind: it still took a capital's skyline and a ministry's
 * building for a story about a whole economy, knew nothing of how an economy, a concept, prices or trade are pictured,
 * and judged from the file's record alone (a New York shop under a large Chinese sign passed).
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
const { photoRules, publishedFault, placedAbroad, ILLUSTRATIVE, noveltyFault, closeUpOfMaterial, storyText, inlineImage } = await import("./lib/images.mjs");
const ARTICLES = path.join(root, "content", "articles");
const CACHE = path.join(root, "pipeline", ".cache", "commons-meta.json");
const OUT = path.join(root, "pipeline", "runs", "image-audit.json");
const args = process.argv.slice(2);
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1]) || 0;
const SLUGS = new Set((args.find((a) => a.startsWith("--slugs=")) ?? "").slice(8).split(",").map((s) => s.trim()).filter(Boolean));
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
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) continue;
  const d = YAML.parse(m[1]);
  if (d.draft || !d.image?.url) continue;
  articles.push({ file: f, slug: d.slug, title: d.title, subtitle: d.subtitle ?? "", lede: d.lede ?? "", body: m[2], whyItMatters: d.whyItMatters ?? "", keyFacts: d.keyFacts ?? [], tags: d.tags ?? [], regions: d.regions ?? [], sources: (d.sources ?? []).map((s) => s.title).slice(0, 5), url: d.image.url, alt: d.image.alt ?? "", publishedAt: String(d.publishedAt), kind: d.kind ?? "news", section: d.section });
}
articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
const chosen = SLUGS.size ? articles.filter((a) => SLUGS.has(a.slug)) : articles;
const todo = LIMIT ? chosen.slice(0, LIMIT) : chosen;
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
  // The story as the desk reads it (storyText(): lede, body, «لماذا يهمّ», box), and the photograph as it would read a
  // candidate: its record, the caption printed and, since the second check looks at the frame, the frame itself.
  const draft = { title: a.title, subtitle: a.subtitle, lede: a.lede, body: a.body, whyItMatters: a.whyItMatters, keyFacts: a.keyFacts, tags: a.tags, regions: a.regions, kind: a.kind, section: a.section };
  const record = { title: fileTitle ?? "", description: meta.description, categories: meta.categories, date: meta.date, alt: a.alt };
  const illustrative = a.alt.includes(ILLUSTRATIVE);
  const thumbnail = await inlineImage(String(a.url).replace(/\/1280px-/, "/500px-").replace(/([?&]w=)\d+/, "$1500"));
  const user = `STORY (Arabic economics newspaper):
Headline: ${a.title}
Standfirst: ${a.subtitle}
${storyText(draft, 1500)}
Tags: ${a.tags.join(", ")}
Regions: ${a.regions.join(", ") || "unknown"}
Source headlines: ${a.sources.join(" | ")}

PHOTOGRAPH the story currently runs with:
File name: ${fileTitle ?? "(unknown)"}
Description: ${meta.description || "(none)"}
Categories: ${meta.categories || "(none)"}
Date: ${meta.date || "(unknown)"}
Caption the paper printed: ${a.alt}

${photoRules({ draft, image: record, neutral: illustrative, thumbnail, lastResort: true, audit: true })}Return JSON: {"verdict":"RIGHT|GENERIC_OK|${illustrative ? "" : "RECAPTION|"}STALE_EVENT|WRONG_SUBJECT|WRONG_PERSON|UNSERIOUS|STOCK${thumbnail ? "|AMATEUR|UNCLEAR" : ""}","people_in_photo":"<names the file, the description or the frame give, or none>","own_company":"<the company whose own news the headline is, when the frame shows its own brand or site, or none>","reason":"<one short English sentence>"}`;
  try {
    const { data, model } = await chat({ role: "critic", system: "You are a strict newspaper picture editor. Answer with one JSON object only.", user, images: thumbnail ? [thumbnail] : [], json: true, maxTokens: 300, temperature: 0, log: () => {} });
    let verdict = String(data.verdict ?? "").toUpperCase();
    const passed = verdict === "GENERIC_OK" || verdict === "RIGHT" || verdict === "RECAPTION";
    // The desk's checks in code, which override a model that passes: where the file places the photograph (never for an
    // illustration, a close-up of a material or the story's own people, as the desk exempts them), a curiosity, and what
    // the desk drops before any judge (publishedFault(): a front or a skyline, a stock cliché, a scan, an archival frame).
    const people = String(data.people_in_photo ?? "").trim();
    // The story's own company too (AUDIT_BRAND): its brand and its sites are its own wherever they stand (2026-10-30).
    const company = String(data.own_company ?? "").trim();
    const theirOwn = verdict === "RIGHT" && ((people && !/^none\b/i.test(people)) || (company && !/^none\b/i.test(company)));
    const abroad = illustrative || closeUpOfMaterial(record) || theirOwn ? null : placedAbroad(record, draft);
    const odd = noveltyFault(record, draft);
    const fault = publishedFault(record, draft);
    if (passed && abroad) {
      verdict = "WRONG_SUBJECT";
      data.reason = `The file places the photo in ${abroad}, a country the story does not name (checked in code; the model said ${String(data.verdict)}).`;
    } else if (passed && odd) {
      verdict = "UNSERIOUS";
      data.reason = `The photo shows «${odd}», which the story is not about (checked in code; the model said ${String(data.verdict)}).`;
    } else if (passed && fault) {
      verdict = /cliché|icons|defunct/.test(fault) ? "STOCK" : "WRONG_SUBJECT";
      data.reason = `${fault[0].toUpperCase()}${fault.slice(1)} (checked in code, as the desk drops it; the model said ${String(data.verdict)}).`;
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
// A --slugs or --limit run re-judges those stories in the last audit and keeps every other entry of a story still photographed.
const judged = new Set(results.map((r) => r.slug));
const earlier = (SLUGS.size || LIMIT) && existsSync(OUT) ? JSON.parse(await readFile(OUT, "utf8")).results ?? [] : [];
const kept = earlier.filter((r) => !judged.has(r.slug) && articles.some((a) => a.slug === r.slug));
await writeFile(OUT, JSON.stringify({ at: new Date().toISOString(), results: [...kept, ...results] }, null, 2));
const counts = {};
for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
log(`done: ${JSON.stringify(counts)} → ${path.relative(root, OUT)}`);
