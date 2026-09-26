/**
 * The source evidence a story relied on, kept as it read at publication (the owner, 2026-09-26: "Persist the source
 * evidence actually used ... Verify that the evidence can still be retrieved when the original page changes or is
 * unavailable"). The same night the corrections editor could not read two of a story's sources (one page answered 403,
 * another refused robots), and the second look cannot tell a page that changed after publication from a figure the
 * story never had a source for, unless it can see what the source said then.
 *
 * What is kept is the evidence, not the article: this repository is public, and the site never reproduces its sources
 * (a first version that kept whole pages on a branch of it was withdrawn within the hour). For each source: its
 * address, names, dates and the time it was fetched, and the passages the story rests on, each source sentence the
 * check before publication quoted for a claim with the sentence before and after it, and every source sentence that
 * carries one of the story's figures. For each sentence of the story: the check's verdict and the source sentence it
 * quoted. One small compressed file a story, evidence/<slug>.json.gz, committed with the story; written once, at
 * publication, and never replaced by a later reading.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { extractNumbers } from "./util.mjs";

export const SNAPSHOT_DIR = path.join(process.cwd(), "evidence");
/** At most this much text a source: passages, never the page. */
const MAX_PASSAGES_CHARS = 4000;

const fileOf = (slug, dir) => path.join(dir, `${slug}.json.gz`);
const sentencesOf = (text) => String(text ?? "").replace(/\s+/g, " ").split(/(?<=[.؟!?])\s+/).map((s) => s.trim()).filter(Boolean);
const squash = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

/** The figures a reader would check: decimals, and whole numbers of 100 or more that are not years. */
function figuresOf(text) {
  return [...extractNumbers(text)].filter((n) => {
    const v = Number(n);
    return Number.isFinite(v) && (n.includes(".") || (v >= 100 && !(Number.isInteger(v) && v >= 1900 && v <= 2100)));
  });
}

/**
 * The passages of one source the story rests on: each quoted sentence with its neighbours, then each sentence that
 * carries one of the story's figures; in the source's own order, at most MAX_PASSAGES_CHARS.
 */
export function passagesOf(text, quotes, storyFigures) {
  const sentences = sentencesOf(text);
  const keep = new Set();
  for (const q of quotes) {
    const probe = squash(q).slice(0, 60);
    if (!probe) continue;
    const i = sentences.findIndex((s) => s.includes(probe) || probe.includes(s.slice(0, 60)));
    if (i >= 0) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < sentences.length) keep.add(j);
  }
  const wanted = new Set(storyFigures);
  sentences.forEach((s, i) => {
    if (figuresOf(s).some((f) => wanted.has(f))) keep.add(i);
  });
  let out = "";
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (out.length + sentences[i].length > MAX_PASSAGES_CHARS) break;
    out += `${out ? " " : ""}${sentences[i]}`;
  }
  return out;
}

/**
 * Saves a story's evidence. Never overwrites: the first copy is the publication's. `storyText` is the story as published
 * (for its figures); `checks` the check before publication's verdicts (sentence, source number, quote). `kind`
 * "backfill" marks a copy taken later, for a story published before copies were kept.
 */
export async function saveSnapshot({ slug, title, publishedAt = null, sources, checks = [], storyText = "", dir = SNAPSHOT_DIR, kind = "publication" }) {
  const file = fileOf(slug, dir);
  if (existsSync(file)) return file;
  const storyFigures = figuresOf(storyText);
  const record = {
    slug,
    title,
    publishedAt,
    savedAt: new Date().toISOString(),
    kind,
    sources: sources.map((s, i) => ({
      url: s.url ?? null,
      name: s.sourceName ?? s.name ?? null,
      nameEn: s.sourceNameEn ?? s.nameEn ?? null,
      title: s.title ?? null,
      publishedAt: s.publishedAt ?? null,
      fetchedAt: s.fetchedAt ?? null,
      lang: s.lang ?? null,
      passages: passagesOf(s.text, checks.filter((c) => Number(c.source) === i + 1 && c.quote).map((c) => c.quote), storyFigures),
    })),
    claims: checks.map((c) => ({ field: c.field, sentence: c.sentence, verdict: c.verdict, status: c.status, source: c.source ?? null, quote: c.quote ?? "" })),
  };
  await mkdir(dir, { recursive: true });
  await writeFile(file, gzipSync(Buffer.from(JSON.stringify(record))));
  return file;
}

/** A story's publication evidence, or null. */
export function loadSnapshot(slug, { dir = SNAPSHOT_DIR } = {}) {
  try {
    const file = fileOf(slug, dir);
    if (existsSync(file)) return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
  } catch {
    /* a copy that cannot be read counts as none */
  }
  return null;
}

/** The saved passages of one source, matched by its address, as `text` for the readers of lib/factcheck.mjs. */
export function snapshotSource(snapshot, url) {
  const s = snapshot?.sources?.find((x) => x.url === url);
  return s && s.passages ? { ...s, text: s.passages, summary: "" } : null;
}
