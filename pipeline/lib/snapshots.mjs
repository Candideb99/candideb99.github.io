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
import { extractNumbers, sourceNumbers } from "./util.mjs";

export const SNAPSHOT_DIR = path.join(process.cwd(), "evidence");
/** At most this much text a source: passages, never the page. */
const MAX_PASSAGES_CHARS = 4000;

const fileOf = (slug, dir) => path.join(dir, `${slug}.json.gz`);
/**
 * A page's sentences. A reader often glues them («…to 84.8.Weaker demand…», as the quote matcher found on 2026-10-27):
 * a full stop followed straight by a letter ends a sentence too, a decimal does not, and neither does an initial
 * («Lisa D. Cook» was saved cut in two). A page whose text came as one run had kept 7 "sentences" in 8,269 characters.
 */
const sentencesOf = (text) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<![\s.(][A-Z]\.)(?<=[.؟!?])(?:\s+|(?=[A-Z؀-ۿ«"]))/u)
    .map((s) => s.trim())
    .filter(Boolean);
const squash = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
/** A sentence longer than this is a run the splitter could not open: a quote in it keeps a window around itself. */
const LONG_SENTENCE = 700;

/**
 * The figures a reader would check: decimals, and whole numbers of 100 or more that are not years. A source's sentence
 * is read as its language writes figures (`sourceNumbers`: a Turkish «4,2» carries the story's 4.2, 2026-10-25).
 */
function figuresOf(text, read = extractNumbers) {
  return [...read(text)].filter((n) => {
    const v = Number(n);
    return Number.isFinite(v) && (n.includes(".") || (v >= 100 && !(Number.isInteger(v) && v >= 1900 && v <= 2100)));
  });
}

/**
 * The passages of one source the story rests on: each quoted sentence with its neighbours first, then each sentence that
 * carries one of the story's figures, within MAX_PASSAGES_CHARS; printed in the source's own order, the quotes the
 * page's sentences do not hold as written after them.
 *
 * Until 2026-10-31 a quoted sentence could be lost, and with it the second look's protection (settleChanged and
 * settleDrift read these passages): a dangling `else` dropped every quote the sentences did not hold as written, the
 * figure sentences filled the cap in page order before the quotes, and the first piece too long for what was left ended
 * the copy (143 of 1,775 quotes found at publication were missing; a BBC source was saved empty).
 */
export function passagesOf(text, quotes, storyFigures) {
  const sentences = sentencesOf(text);
  // The quoted sentences first, then the sentence either side of each: kept in one set in page order, the neighbours of
  // early quotes used up the room before later quotes were reached (a review of 2026-10-31: the Hespress source of the
  // Morocco trade story lost a quoted sentence carrying 750.56 and 597.64, figures the story prints).
  const quoted = new Set();
  const near = new Set();
  // A quote the page's sentences do not contain as written (a quote across two sentences, a page cut differently), or
  // one inside a sentence too long to keep, is kept as the check quoted it: it is the evidence either way.
  const loose = [];
  for (const q of quotes) {
    const probe = squash(q).slice(0, 60);
    if (!probe) continue;
    const i = sentences.findIndex((s) => s.includes(probe) || probe.includes(s.slice(0, 60)));
    if (i < 0 || sentences[i].length > LONG_SENTENCE) {
      loose.push(squash(q));
      continue;
    }
    quoted.add(i);
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < sentences.length && sentences[j].length <= LONG_SENTENCE) near.add(j);
  }
  const wanted = new Set(storyFigures);
  const figured = [];
  sentences.forEach((s, i) => {
    if (!quoted.has(i) && !near.has(i) && s.length <= LONG_SENTENCE && figuresOf(s, sourceNumbers).some((f) => wanted.has(f))) figured.push(i);
  });
  let room = MAX_PASSAGES_CHARS;
  const fits = (piece) => piece.length + 1 <= room && (room -= piece.length + 1, true);
  const take = new Set([...quoted].sort((a, b) => a - b).filter((i) => fits(sentences[i])));
  const extra = [...new Set(loose)].filter((q) => !take.size || ![...take].some((i) => sentences[i].includes(q))).filter(fits);
  for (const i of [...near].sort((a, b) => a - b)) if (!take.has(i) && fits(sentences[i])) take.add(i);
  for (const i of figured) if (fits(sentences[i])) take.add(i);
  return [...[...take].sort((a, b) => a - b).map((i) => sentences[i]), ...extra].join(" ");
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
      sourceKind: s.kind ?? null,
      discoveredFrom: s.discoveredFrom ?? null,
      passages: passagesOf(s.text, checks.filter((c) => Number(c.sourceN ?? c.source) === i + 1 && c.quote).map((c) => c.quote), storyFigures),
    })),
    claims: checks.map((c) => ({ field: c.field, sentence: c.sentence, verdict: c.verdict, status: c.status, source: c.sourceN ?? c.source ?? null, quote: c.quote ?? "" })),
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
