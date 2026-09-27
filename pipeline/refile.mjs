#!/usr/bin/env node
/**
 * Moves a published story to the section its subject belongs to, by the filing guide in src/data/sections.json. Made
 * for the audit of 2026-09-27 (the owner: "posting info that does not match category"), which found six stories the
 * free models had filed from 7 to 19 September under a section their subject does not belong to: a US–Denmark security
 * pact under energy, an air-traffic outage under companies, a PIF property company under markets.
 *
 *   node pipeline/refile.mjs --file=list.json      [{ "slug", "section", "reason" }]
 *   node pipeline/refile.mjs --slug=… --section=… --reason="…"
 *   add --dry-run to see the moves without writing them
 *
 * Only the `section` field changes (the story's address stays /articles/<slug>/); no note is printed, since no fact
 * changes. A news story never goes to a hub section. The moves are kept in pipeline/runs/refile-*.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { ARTICLES_DIR } from "./lib/article.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const DRY = args.includes("--dry-run");
const sections = JSON.parse(await readFile(path.join(process.cwd(), "src", "data", "sections.json"), "utf8"));
const NEWS = new Set(sections.filter((s) => s.guide).map((s) => s.id));

const items = option("file") ? JSON.parse(await readFile(option("file"), "utf8")) : option("slug") ? [{ slug: option("slug"), section: option("section"), reason: option("reason") }] : [];
if (!items.length) {
  console.error('usage: node pipeline/refile.mjs --file=list.json | --slug=… --section=… --reason="…" [--dry-run]');
  process.exit(2);
}

const report = { at: new Date().toISOString(), dryRun: DRY, moves: [] };
for (const { slug, section, reason } of items) {
  const file = path.join(ARTICLES_DIR, `${slug}.md`);
  let raw;
  try {
    raw = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  } catch {
    console.log(`${slug}: no such story`);
    continue;
  }
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const data = YAML.parse(m[1]);
  if ((data.kind ?? "news") !== "news" || !NEWS.has(section)) {
    console.log(`${slug}: refused (${!NEWS.has(section) ? `"${section}" is not a news section` : `a ${data.kind} stays in its hub`})`);
    continue;
  }
  if (data.section === section) continue;
  if (!reason) {
    console.log(`${slug}: refused (a move says why)`);
    continue;
  }
  const front = m[1].replace(/^section: .*$/m, () => `section: ${section}`);
  if (YAML.parse(front).section !== section) {
    console.log(`${slug}: the section line is not in the expected form; left for a person`);
    continue;
  }
  report.moves.push({ slug, from: data.section, to: section, reason });
  console.log(`${slug}: ${data.section} → ${section} (${reason})`);
  if (!DRY) await writeFile(file, raw.replace(m[1], () => front), "utf8");
}
if (!DRY && report.moves.length) {
  const runs = path.join(process.cwd(), "pipeline", "runs");
  await mkdir(runs, { recursive: true });
  await writeFile(path.join(runs, `refile-${report.at.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2));
}
console.log(`${DRY ? "would move" : "moved"} ${report.moves.length} stor${report.moves.length === 1 ? "y" : "ies"}`);
