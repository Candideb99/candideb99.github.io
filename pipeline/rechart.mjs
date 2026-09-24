#!/usr/bin/env node
/**
 * Draws a published story's chart again, from its own text and sources, under the chart rule every writer now
 * has (CHART_RULE in pipeline/lib/write.mjs). Made for the owner's note of 2026-09-24 on a chart of Egypt's
 * monthly inflation at -0.4, 0 and 0.1: "people usually accustomed to 10%, not 0.1".
 *
 *   node pipeline/rechart.mjs --slug=a-b-c --issue="…"      one story
 *   add --dry-run to see the new chart without writing it
 *
 * Nothing is drawn by hand. The model proposes a chart from the story's text and its sources fetched again;
 * code then holds it to what a chart is here: it must pass normalizeChart (three categories or more, every
 * series complete), and every figure in it must stand in the story or its sources. A chart that fails keeps the
 * old one. Only the chart field changes; no correction note is printed, since no fact of the story changes.
 */
import "./lib/env.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { chat } from "./lib/llm.mjs";
import { extractArticle } from "./lib/extract.mjs";
import { normalizeChart } from "./lib/write.mjs";
import { ungroundedNumbers } from "./lib/util.mjs";
import { ARTICLES_DIR } from "./lib/article.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const DRY = args.includes("--dry-run");
const SLUG = option("slug");
const ISSUE = option("issue");
const log = (line) => console.log(`[rechart] ${line}`);
if (!SLUG) {
  console.error('usage: node pipeline/rechart.mjs --slug=… [--issue="…"] [--dry-run]');
  process.exit(2);
}

const RULE =
  "A chart shows the measure readers know, in the unit the text uses: the annual inflation rate (14.5%), never the month-on-month change (0.1%) unless the story is about that change; a rate's or a price's level (19%, 105 دولارات), not its change in basis points or cents; a percentage as a percentage (14.5, not 0.145). A few figures that make the story's point beat a long series of a side indicator: a central bank's policy rate beside annual and core inflation shows its real rate at a glance. Use \"line\" for one measure over at least three dates and \"bar\" for figures compared side by side; at most 3 series, 3 to 12 categories, every series with one value per category.";

const file = path.join(ARTICLES_DIR, `${SLUG}.md`);
const raw = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
if (!match) throw new Error(`${SLUG}: no front matter`);
const doc = YAML.parseDocument(match[1]);
const data = doc.toJS();
const body = match[2].trim();

log(`${SLUG}: fetching ${data.sources?.length ?? 0} source(s)`);
const sources = [];
for (const s of data.sources ?? []) {
  if (!s.url || s.url.startsWith("/")) continue;
  const fetched = await extractArticle(s.url, { log });
  sources.push({ name: s.name ?? "", title: s.title ?? "", text: fetched.ok ? fetched.text : "" });
}
const storyText = [data.title, data.subtitle, data.lede, data.whyItMatters, body, ...(data.keyFacts ?? []).map((k) => `${k.label} ${k.value}`)].join("\n");
const grounding = [storyText, ...sources.map((s) => `${s.title}\n${s.text}`)];

const user = `THE STORY
${storyText}

ITS SOURCES (fetched again)
${sources.map((s, i) => `[${i + 1}] ${s.name} — ${s.title}\n${s.text.slice(0, 6000)}`).join("\n\n") || "(none could be fetched; use the story's own figures)"}

THE CHART IT RUNS NOW
${JSON.stringify(data.chart ?? null)}

${ISSUE ? `WHAT IS WRONG WITH IT\n${ISSUE}\n\n` : ""}TASK
Draw the chart this story should run. ${RULE} Every figure must appear in the story or its sources exactly; labels in Arabic; the source is the publisher of the figures. If the story holds no three comparable figures that make its point, answer {"chart": null}.
Answer with one JSON object: {"chart": {"type": "bar" | "line", "title": "Arabic chart title (what is measured)", "unit": "Arabic unit, e.g. %", "source": "publisher", "categories": ["..."], "series": [{"name": "Arabic series name", "values": [numbers]}]}}`;

const { data: answer, model } = await chat({
  role: "writer",
  system: "You are the graphics editor of خازندار, an Arabic economics news website. You draw a story's chart from its own figures. Reply with one JSON object only.",
  user,
  temperature: 0.1,
  maxTokens: 2000,
  timeoutMs: 240000,
  log,
  validate: (d) => {
    if (!d || typeof d !== "object" || !("chart" in d)) throw new Error("no chart field");
  },
});

const report = { startedAt: new Date().toISOString(), slug: SLUG, issue: ISSUE, dryRun: DRY, before: data.chart ?? null, model };
const chart = normalizeChart(answer.chart);
const problems = [];
if (!chart) problems.push("the proposal is not a chart this site can draw (three categories or more, every series complete)");
else {
  const figures = [chart.title, chart.unit, ...chart.categories, ...chart.series.flatMap((s) => [s.name, ...s.values])].join(" ");
  const bad = ungroundedNumbers(figures, grounding, { ignoreYears: false });
  if (bad.length) problems.push(`figures neither in the story nor in its sources: ${bad.join(", ")}`);
  const values = chart.series.flatMap((s) => s.values);
  if (/تضخم/.test(`${chart.title} ${chart.series.map((s) => s.name).join(" ")}`) && values.every((v) => Math.abs(v) < 1.5)) problems.push("still the monthly change of inflation");
}
report.after = chart;
report.problems = problems;
log(`${SLUG}: ${problems.length ? `refused (${problems.join("; ")})` : DRY ? "would redraw" : "redrawn"}\n    ${JSON.stringify(chart)}`);
if (!problems.length && !DRY) {
  doc.set("chart", doc.createNode(chart));
  await writeFile(file, `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n\n${body}\n`);
}
const runs = path.join(process.cwd(), "pipeline", "runs");
await mkdir(runs, { recursive: true });
await writeFile(path.join(runs, `rechart-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2));
