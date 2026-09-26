/**
 * The source evidence a story was written and checked from, kept as it read at publication (the owner, 2026-09-26:
 * "Persist the source evidence actually used ... Verify that the evidence can still be retrieved when the original
 * page changes or is unavailable"). The same night the corrections editor could not read two of a story's sources (one
 * page answered 403, another refused robots), and the second look cannot tell a page that changed after publication
 * from a figure the story never had a source for, unless it can see what the source said then.
 *
 * One compressed file a story, evidence/<slug>.json.gz: each source's address, name, date, the time it was fetched, and
 * the text the writer and the check before publication read (at most 9,000 characters a source, as they did), plus the
 * check's verdict on every sentence with the source sentence it quoted. The folder is not part of the site's branch:
 * the newsroom workflow pushes it to the repository's own `evidence` branch (no other service, nothing billed), and the
 * readers here look in the local folder first, then in that branch (refs/remotes/origin/evidence). Written once, at
 * publication; a later re-reading of a source never replaces it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export const SNAPSHOT_DIR = path.join(process.cwd(), "evidence");
export const SNAPSHOT_REF = "refs/remotes/origin/evidence";

const fileOf = (slug, dir) => path.join(dir, `${slug}.json.gz`);

/**
 * Saves a story's evidence as it stands at publication. Never overwrites: the first copy is the publication's. `kind`
 * "backfill" marks a copy taken later for a story published before copies were kept (its sources as they read then).
 */
export async function saveSnapshot({ slug, title, publishedAt = null, sources, checks = [], dir = SNAPSHOT_DIR, kind = "publication" }) {
  const file = fileOf(slug, dir);
  if (existsSync(file)) return file;
  const record = {
    slug,
    title,
    publishedAt,
    savedAt: new Date().toISOString(),
    kind,
    sources: sources.map((s) => ({
      url: s.url ?? null,
      name: s.sourceName ?? s.name ?? null,
      nameEn: s.sourceNameEn ?? s.nameEn ?? null,
      title: s.title ?? null,
      publishedAt: s.publishedAt ?? null,
      fetchedAt: s.fetchedAt ?? null,
      lang: s.lang ?? null,
      text: String(s.text ?? "").slice(0, 9000),
      summary: String(s.summary ?? "").slice(0, 2000),
    })),
    // The check before publication's verdict on each sentence, with the source sentence it quoted.
    claims: checks.map((c) => ({ field: c.field, sentence: c.sentence, verdict: c.verdict, status: c.status, source: c.source ?? null, quote: c.quote ?? "" })),
  };
  await mkdir(dir, { recursive: true });
  await writeFile(file, gzipSync(Buffer.from(JSON.stringify(record))));
  return file;
}

/** A story's publication evidence: the local folder first, then the repository's evidence branch; null if neither. */
export function loadSnapshot(slug, { dir = SNAPSHOT_DIR, ref = SNAPSHOT_REF } = {}) {
  try {
    const file = fileOf(slug, dir);
    if (existsSync(file)) return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
    const shown = spawnSync("git", ["show", `${ref}:${slug}.json.gz`], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
    if (shown.status === 0 && shown.stdout?.length) return JSON.parse(gunzipSync(shown.stdout).toString("utf8"));
  } catch {
    /* a copy that cannot be read counts as none */
  }
  return null;
}

/** The saved text of one source, matched by its address. */
export const snapshotSource = (snapshot, url) => snapshot?.sources?.find((s) => s.url === url) ?? null;
