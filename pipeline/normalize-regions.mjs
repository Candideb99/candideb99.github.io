#!/usr/bin/env node
/**
 * Maps every published article's region tags to the paper's desks (src/data/regions.json).
 * Metadata only; no prose is touched. Run once after the desks were introduced, and again
 * whenever the desk list changes.
 *
 *   node pipeline/normalize-regions.mjs [--dry-run]
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalRegions } from "./lib/regions.mjs";

const DRY = process.argv.includes("--dry-run");
const dir = path.join(process.cwd(), "content", "articles");
let changed = 0;
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".md"))) {
  const full = path.join(dir, file);
  const raw = await readFile(full, "utf8");
  const match = raw.match(/^regions:\n((?:  - .*\n)+)/m);
  if (!match) continue;
  const before = [...match[1].matchAll(/^  - (.*)$/gm)].map((m) => m[1].trim().replace(/^"(.*)"$/, "$1"));
  const after = canonicalRegions(before);
  if (!after.length || after.join("|") === before.join("|")) continue;
  const block = `regions:\n${after.map((r) => `  - ${r}\n`).join("")}`;
  console.log(`${file}: ${before.join("، ")} → ${after.join("، ")}`);
  changed++;
  if (!DRY) await writeFile(full, raw.replace(match[0], block), "utf8");
}
console.log(`${DRY ? "would change" : "changed"} ${changed} article(s)`);
