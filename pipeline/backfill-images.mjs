/**
 * Finds a licensed photograph for every published story that has none, the way the newsroom
 * now does for new stories (specific subjects first, then a generic illustration of the place,
 * institution or sector), and writes it into the article's frontmatter.
 *
 * Usage: node pipeline/backfill-images.mjs [--dry-run] [--limit=N] [--redo=slug,slug]
 * Reads OPENROUTER_API_KEY from the environment or from .env.
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

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const redoArg = args.find((a) => a.startsWith("--redo="));
/** Slugs whose current picture should be replaced (comma-separated). */
const REDO = new Set(redoArg ? redoArg.slice(7).split(",").map((s) => s.trim()).filter(Boolean) : []);
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
  const raw = await readFile(full, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) continue;
  const data = YAML.parse(match[1]);
  const redo = REDO.has(data.slug);
  if (data.image && !redo) continue;
  if (redo && data.image) {
    used.delete(data.image.url);
    data.image = null;
  }
  tried += 1;
  log(`${file}: searching`);
  const draft = { title: data.title, subtitle: data.subtitle, lede: data.lede, imageQueries: [], tags: data.tags ?? [], regions: data.regions ?? [] };
  const story = { angle: String(data.whyItMatters ?? "").slice(0, 300) };
  let image = null;
  try {
    image = await pickImage({ draft, story, log, exclude: used });
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
  log(`${file}: "${image.title}" (${image.license})`);
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
