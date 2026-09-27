#!/usr/bin/env node
/**
 * Looks at every published photograph beside its headline and asks one question: would it make a serious economics
 * website look unserious? The owner, 2026-09-27, on a horse-drawn fuel cart at a Cairo filling station under an
 * analysis of Egypt's central bank: "some pictures are laughable and do not make the website look serious". The other
 * audit (audit-images.mjs) reads each file's record; this one looks at the picture itself, six at a time, with the
 * picture desk's GRAVITY_RULE, and `noveltyFault()` reads the file name and the caption in code.
 *
 *   node pipeline/audit-gravity.mjs [--limit=N]    writes pipeline/runs/gravity-audit.json
 *
 * The photos it finds unserious are re-picked by `node pipeline/backfill-images.mjs --redo=<slugs>`, under the same
 * rule; a story for which nothing serious is found runs without a photograph.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
for (const line of existsSync(path.join(root, ".env")) ? readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith("#") && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { chat } = await import("./lib/llm.mjs");
const { GRAVITY_RULE, noveltyFault, inlineImage } = await import("./lib/images.mjs");

const ARTICLES = path.join(root, "content", "articles");
const OUT = path.join(root, "pipeline", "runs", "gravity-audit.json");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1]) || 0;
const log = (m) => console.log(`[gravity] ${m}`);

const articles = [];
for (const f of (await readdir(ARTICLES)).filter((x) => x.endsWith(".md"))) {
  const m = (await readFile(path.join(ARTICLES, f), "utf8")).replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) continue;
  const d = YAML.parse(m[1]);
  if (d.draft || !d.image?.url) continue;
  const file = decodeURIComponent(String(d.image.pageUrl ?? d.image.url).split(/File:|File%3A|\//i).pop() ?? "").replace(/_/g, " ");
  articles.push({ slug: d.slug, kind: d.kind ?? "news", title: d.title, subtitle: d.subtitle ?? "", lede: d.lede ?? "", body: m[2], url: d.image.url, alt: d.image.alt ?? "", file, publishedAt: String(d.publishedAt) });
}
articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
const todo = LIMIT ? articles.slice(0, LIMIT) : articles;
log(`${todo.length} photographs to look at`);

// A small copy is enough to judge what a frame shows: Commons serves 500 pixels, the other libraries their own size.
const small = (url) => String(url).replace(/\/(?:960|1280)px-/, "/500px-");
const results = [];
for (let i = 0; i < todo.length; i += 6) {
  const batch = [];
  const images = [];
  for (const a of todo.slice(i, i + 6)) {
    const data = await inlineImage(small(a.url), log);
    if (!data) {
      results.push({ slug: a.slug, verdict: "UNSEEN", reason: "the photograph could not be fetched" });
      continue;
    }
    batch.push(a);
    images.push(data);
  }
  if (!batch.length) continue;
  const user = `Each photograph below runs beside its headline on خازندار, an Arabic economics news website read by professionals.
${batch.map((a, n) => `${n + 1}. Headline: ${a.title}\n   Caption printed under it: ${a.alt || "(none)"}`).join("\n")}

Judge each photograph by this rule alone, as the paper's chief picture editor:
${GRAVITY_RULE}
A plain, ordinary news photograph of the subject (a building, a port, a refinery, pumps, a market, traders, officials) is SERIOUS even when it is dull. UNSERIOUS is for a frame that would make the website look unserious next to its headline.
Return JSON: {"verdicts":[{"n":1,"verdict":"SERIOUS|UNSERIOUS","reason":"<one short English sentence>"}]} with one entry for each of the ${batch.length} photographs, in order.`;
  let verdicts = [];
  try {
    const { data } = await chat({
      role: "vision",
      system: "You are the chief picture editor of an Arabic economics newspaper. Reply with one JSON object only.",
      user,
      images,
      temperature: 0,
      maxTokens: 1500,
      timeoutMs: 180000,
      log: () => {},
      validate: (d) => {
        if (!Array.isArray(d?.verdicts) || d.verdicts.length !== batch.length) throw new Error(`expected ${batch.length} verdicts`);
      },
    });
    verdicts = data.verdicts;
  } catch (error) {
    log(`batch ${i / 6 + 1}: the look failed (${String(error.message).split("\n")[0]})`);
  }
  batch.forEach((a, n) => {
    const v = verdicts[n] ?? {};
    let verdict = String(v.verdict ?? "UNJUDGED").toUpperCase();
    let reason = String(v.reason ?? "");
    // The file's own name or the caption naming a curiosity the story is not about decides it in code.
    const odd = noveltyFault({ title: a.file, alt: a.alt }, a);
    if (odd && verdict !== "UNSERIOUS") {
      reason = `the file or the caption names «${odd}», which the story is not about (checked in code; the look said ${verdict})`;
      verdict = "UNSERIOUS";
    }
    results.push({ slug: a.slug, kind: a.kind, title: a.title, image: a.url, caption: a.alt, verdict, reason });
    log(`${verdict.padEnd(10)} ${a.slug.slice(0, 52).padEnd(54)} ${reason.slice(0, 100)}`);
  });
}
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const unserious = results.filter((r) => r.verdict === "UNSERIOUS");
const counts = {};
for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
log(`done: ${JSON.stringify(counts)} → ${path.relative(root, OUT)}`);
if (unserious.length) log(`re-pick them: node pipeline/backfill-images.mjs --redo=${unserious.map((r) => r.slug).join(",")}`);
