#!/usr/bin/env node
/**
 * Gives published pieces a chart of official data (pipeline/lib/datacharts.mjs): Claude chooses from the menu
 * of IMF and World Bank indicators, code fetches the figures, and a piece that nothing on the menu serves keeps
 * running without one. Made for the explainers, which carried no charts until 2026-09-24 (the owner: "explainers
 * usually add graphs etc").
 *
 *   node pipeline/datachart.mjs --explainers            every explainer without a chart
 *   node pipeline/datachart.mjs --slugs=a,b             named pieces
 *   add --dry-run to see each chart without writing it
 *
 * Only the chart field is written. No fact of the piece changes, so no note is printed.
 */
import "./lib/env.mjs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { pickDataChart } from "./lib/datacharts.mjs";
import { ARTICLES_DIR } from "./lib/article.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const DRY = args.includes("--dry-run");
const SLUGS = option("slugs").split(",").map((s) => s.trim()).filter(Boolean);
const EXPLAINERS = args.includes("--explainers");
const log = (line) => console.log(`[datachart] ${line}`);
if (!SLUGS.length && !EXPLAINERS) {
  console.error("usage: node pipeline/datachart.mjs --explainers | --slugs=a,b [--dry-run]");
  process.exit(2);
}

let drawn = 0;
for (const file of (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md"))) {
  const full = path.join(ARTICLES_DIR, file);
  const raw = (await readFile(full, "utf8")).replace(/\r\n/g, "\n");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) continue;
  const doc = YAML.parseDocument(match[1]);
  const data = doc.toJS();
  const wanted = SLUGS.length ? SLUGS.includes(data.slug) : data.kind === "explainer" && !data.chart;
  if (!wanted || data.draft) continue;
  const body = match[2].trim();
  const { chart } = await pickDataChart({ draft: { title: data.title, subtitle: data.subtitle, lede: data.lede, body }, log: (l) => log(`${data.slug.slice(0, 40)}: ${l}`) });
  if (!chart) continue;
  drawn += 1;
  log(`${data.slug}: ${DRY ? "would draw" : "drew"} «${chart.title}» ${JSON.stringify(chart.series.map((s) => s.values))}`);
  if (DRY) continue;
  doc.set("chart", doc.createNode(chart));
  await writeFile(full, `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n\n${body}\n`);
}
log(`done: ${drawn} chart(s)${DRY ? " (dry run)" : ""}`);
