#!/usr/bin/env node
/**
 * Saves the source evidence of stories published before it was kept at publication (lib/snapshots.mjs, from
 * 2026-09-26): each source fetched now, marked kind "backfill" with the time it was read. A backfilled story had no
 * check before publication, so no quoted sentences: the passages kept are the source sentences that carry the story's
 * figures. The second look and the corrections editor read them if a page later changes or disappears. No model call.
 * A story that already has its evidence keeps it. The files are committed with the stories (evidence/).
 *
 *   node pipeline/backfill-evidence.mjs [--days=7]
 */
import "./lib/env.mjs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { ARTICLES_DIR } from "./lib/article.mjs";
import { extractArticle } from "./lib/extract.mjs";
import { CHECKABLE_KINDS } from "./lib/factcheck.mjs";
import { loadSnapshot, saveSnapshot } from "./lib/snapshots.mjs";

const days = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 7);
const since = Date.now() - days * 864e5;
let saved = 0;
let skipped = 0;
for (const file of (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md"))) {
  const raw = (await readFile(path.join(ARTICLES_DIR, file), "utf8")).replace(/\r\n/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) continue;
  let d;
  try {
    d = YAML.parse(m[1]);
  } catch {
    continue;
  }
  const slug = String(d?.slug ?? file.replace(/\.md$/, ""));
  if (!d || d.draft || !CHECKABLE_KINDS.has(d.kind ?? "news") || Date.parse(d.publishedAt) < since) continue;
  if (loadSnapshot(slug)) {
    skipped += 1;
    continue;
  }
  const sources = [];
  for (const s of d.sources ?? []) {
    if (!s.url || String(s.url).startsWith("/")) continue;
    const got = await extractArticle(s.url, { maxChars: 9000 });
    sources.push({ url: s.url, sourceName: s.name, sourceNameEn: s.nameEn, title: s.title, publishedAt: s.publishedAt ?? null, lang: s.lang ?? null, text: got.ok ? got.text : "", fetchedAt: got.ok ? new Date().toISOString() : null });
  }
  if (!sources.some((s) => s.text)) continue;
  const storyText = [d.title, d.subtitle, d.lede, d.whyItMatters, ...(d.keyFacts ?? []).map((k) => `${k.label} ${k.value}`), m[2]].join("\n");
  await saveSnapshot({ slug, title: d.title, publishedAt: d.publishedAt, sources, storyText, kind: "backfill" });
  saved += 1;
  console.log(`[evidence] ${slug}: ${sources.filter((s) => s.text).length} of ${sources.length} source(s) saved`);
}
console.log(`[evidence] ${saved} stor${saved === 1 ? "y" : "ies"} saved, ${skipped} already had a copy (last ${days} days)`);
