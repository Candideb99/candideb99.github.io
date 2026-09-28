/**
 * Finds a licensed photograph for every published story that has none, the way the newsroom
 * now does for new stories (the cascade of lib/images.mjs findImage(): the story's people when they are
 * the news, its own place, the subject of its sources' photographs, then the subject in its country and
 * a neutral illustration), reading the whole story and its sources' pages again, and writes it into the
 * article's frontmatter.
 *
 * Usage: node pipeline/backfill-images.mjs [--dry-run] [--limit=N] [--redo=slug,slug] [--only=slug,slug] [--no-sources]
 * Its model calls go to Claude (CLAUDE_CODE_OAUTH_TOKEN, from the environment or from .env).
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { ARTICLES_DIR } from "./lib/article.mjs";

const root = process.cwd();
try {
  const env = await readFile(path.join(root, ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env: rely on the environment */
}

const { pickImage } = await import("./lib/images.mjs");
const { extractArticle } = await import("./lib/extract.mjs");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
/** `--no-sources`: pick without reading the sources' pages again (their text for the planner, their lead photographs for
 *  lib/images.mjs sourceBrief(), the cascade's second tier). */
const NO_SOURCES = args.includes("--no-sources");
/** `--as-new` (with --dry-run): judge each story as if it were new (see below); never writes. */
const AS_NEW = args.includes("--as-new");
if (AS_NEW && !DRY_RUN) {
  console.error("--as-new is for dry runs only: a story's own photo would be chosen again and written");
  process.exit(1);
}
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const redoArg = args.find((a) => a.startsWith("--redo="));
/** Slugs whose current picture should be replaced (comma-separated). */
const REDO = new Set(redoArg ? redoArg.slice(7).split(",").map((s) => s.trim()).filter(Boolean) : []);
/** `--only=slug,slug`: work on these stories alone, instead of every story that has no picture. */
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = new Set(onlyArg ? onlyArg.slice(7).split(",").map((s) => s.trim()).filter(Boolean) : []);
const log = (message) => console.log(`[backfill ${new Date().toISOString().slice(11, 19)}] ${message}`);

const files = (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md")).sort();
const used = new Set();
for (const file of files) {
  const raw = await readFile(path.join(ARTICLES_DIR, file), "utf8");
  const url = raw.match(/^image:\r?\n  url: (\S+)/m)?.[1];
  if (url) used.add(url);
}
let tried = 0;
let found = 0;
for (const file of files) {
  if (tried >= LIMIT) break;
  const full = path.join(ARTICLES_DIR, file);
  let raw;
  try {
    raw = await readFile(full, "utf8");
  } catch {
    continue; // unpublished while this run was going
  }
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) continue;
  const data = YAML.parse(match[1]);
  if (ONLY.size && !ONLY.has(data.slug)) continue;
  const redo = REDO.has(data.slug);
  if (data.image && !redo) continue;
  // A photo being replaced stays excluded: a re-pick is never the same picture (2026-09-27, the gravity audit's
  // replacements; it used to be freed, so the judge could choose it again). `--as-new` (dry runs only, for testing
  // the desk): the story is judged as the newsroom would judge it new, its own photo a candidate like any other, and
  // no other story's refusals carried over.
  const own = data.image?.url;
  if (redo && data.image) data.image = null;
  tried += 1;
  log(`${file}: searching`);
  // The whole story, as the newsroom hands it to the picture desk: its body, «لماذا يهمّ» and box, not the headline alone.
  const draft = { title: data.title, subtitle: data.subtitle, lede: data.lede, body: match[2], whyItMatters: data.whyItMatters, keyFacts: data.keyFacts ?? [], imageQueries: [], tags: data.tags ?? [], regions: data.regions ?? [], kind: data.kind, section: data.section };
  const story = { angle: String(data.whyItMatters ?? "").slice(0, 300) };
  // The sources' pages, read again: their text for the planner and their lead photographs for the cascade's second tier
  // (never republished).
  const sources = [];
  for (const s of NO_SOURCES ? [] : (data.sources ?? []).slice(0, 4)) {
    if (!/^https?:\/\//.test(String(s.url ?? ""))) continue;
    const page = await extractArticle(s.url, { log });
    if (page.ogImage || page.text) sources.push({ sourceName: s.name, sourceNameEn: s.nameEn, title: s.title, url: s.url, ogImage: page.ogImage ?? "", text: page.ok ? page.text : "" });
  }
  let image = null;
  try {
    const exclude = AS_NEW ? new Set([...used].filter((u) => u !== own && !String(u).startsWith("title:") && !String(u).startsWith("series"))) : used;
    image = await pickImage({ draft, story, log, exclude, sources });
  } catch (error) {
    log(`${file}: failed (${error.message.split("\n")[0]})`);
  }
  if (!image) {
    log(`${file}: no suitable photo${redo ? "; the old picture is removed" : ""}`);
    if (redo && !DRY_RUN) await writeFile(full, `---
${YAML.stringify(data, { lineWidth: 0 }).trimEnd()}
---
${match[2]}`);
    continue;
  }
  found += 1;
  used.add(image.url);
  log(`${file}: "${image.title}" (${image.license})${DRY_RUN ? ` ${image.url}\n    caption: ${image.alt}\n    credit: ${image.credit}` : ""}`);
  if (DRY_RUN) continue;
  data.image = {
    url: image.url,
    width: image.width,
    height: image.height,
    alt: image.alt,
    credit: image.credit,
    license: image.license,
    licenseUrl: image.licenseUrl || undefined,
    pageUrl: image.pageUrl,
  };
  data.models = { ...(data.models ?? {}), vision: image.model };
  const yaml = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  await writeFile(full, `---\n${yaml}\n---\n${match[2]}`);
}
log(`done: ${found} of ${tried} stories got a photo${DRY_RUN ? " (dry run, nothing written)" : ""}`);
