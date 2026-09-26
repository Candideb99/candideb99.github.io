#!/usr/bin/env node
/**
 * Applies the key-facts box rule (lib/keyfacts.mjs) to the published stories: under «الأرقام» a value that carries no
 * figure (a place, a company, a weekday, a verdict) or is a date leaves the box, and the fact stays in the story's
 * text. An explainer's box, its glossary under «مفاهيم أساسية», is not touched. Code only, no model; only the keyFacts
 * block of the front matter changes, and every other field is checked to read back unchanged. No correction note and
 * no update stamp: no fact of the story changes. Run on 2026-09-27, after the owner found «بغداد ومسقط» and «النجف»
 * under «الأرقام»; run again whenever the rule changes.
 *
 *   node pipeline/keyfacts.mjs [--dry-run]
 */
import { isDeepStrictEqual } from "node:util";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { boxFacts, isDateValue } from "./lib/keyfacts.mjs";

const DRY = process.argv.includes("--dry-run");
const dir = path.join(process.cwd(), "content", "articles");
let stories = 0;
let removed = 0;
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".md")).sort()) {
  const full = path.join(dir, file);
  const raw = (await readFile(full, "utf8")).replace(/\r\n/g, "\n");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) continue;
  const data = YAML.parse(match[1]);
  const facts = Array.isArray(data.keyFacts) ? data.keyFacts : [];
  const kept = boxFacts(facts, data.kind ?? "news");
  if (kept.length === facts.length) continue;
  const block = match[1].match(/^keyFacts:\n(?: {2}.*\n)*/m);
  if (!block) {
    console.log(`${file}: the keyFacts block is not in the expected form; left for a person`);
    continue;
  }
  // Replacer functions, so a "$" in a value or a source title is never read as a replacement pattern.
  const front = match[1].replace(block[0], () => YAML.stringify({ keyFacts: kept }, { lineWidth: 0 }));
  const reread = YAML.parse(front);
  if (!isDeepStrictEqual({ ...reread, keyFacts: null }, { ...data, keyFacts: null }) || !isDeepStrictEqual(reread.keyFacts, kept)) {
    console.log(`${file}: the rewritten front matter does not read back as expected; left for a person`);
    continue;
  }
  const out = facts.filter((f) => !kept.includes(f));
  stories += 1;
  removed += out.length;
  console.log(`${file} (${data.kind ?? "news"}): ${out.map((f) => `«${f.label}: ${f.value}» (${isDateValue(f.value, f.label) ? "a date" : "no figure"})`).join("، ")}${kept.length ? "" : " — the box is now empty"}`);
  if (!DRY) await writeFile(full, raw.replace(match[1], () => front.replace(/\n$/, "")), "utf8");
}
console.log(`${DRY ? "would take" : "took"} ${removed} value(s) out of ${stories} box(es)`);
