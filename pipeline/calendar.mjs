#!/usr/bin/env node
/**
 * The economic calendar (`src/data/calendar.json`): the dated decisions and releases the site prints in الأجندة, read
 * from the institutions' own schedule pages, never from memory. The sources, what each is read for and the ones that
 * refuse the reader are in `pipeline/lib/calendar.mjs`.
 *
 * Best effort, like the market quotes: a source that cannot be read keeps its stored events, the script never fails
 * a build, and a date that does not parse is dropped rather than guessed.
 *
 *   node pipeline/calendar.mjs            refresh src/data/calendar.json
 *   node pipeline/calendar.mjs --check    print the coming events and exit
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { SOURCES, readSource, buildCalendar } from "./lib/calendar.mjs";

const OUT = path.resolve("src/data/calendar.json");
const CHECK = process.argv.includes("--check");

async function main() {
  let previous = { events: [] };
  try {
    previous = JSON.parse(await readFile(OUT, "utf8"));
  } catch {}
  const readings = new Map();
  const failed = [];
  // The sources are different sites: read together, a slow one costs the run its own wait, not everyone's.
  await Promise.all(
    SOURCES.map(async (source) => {
      try {
        const reading = await readSource(source, undefined, (line) => console.log(line));
        readings.set(source.id, reading);
        console.log(`calendar: ${source.id}: ${reading.events.length} events`);
      } catch (error) {
        failed.push(`${source.id}: ${error.message}`);
      }
    }),
  );
  const data = buildCalendar(previous, readings);
  if (CHECK) {
    for (const e of data.events.slice(0, 40)) console.log(`${e.date}  ${e.time ?? "         "}  ${e.title}`);
  } else {
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
  }
  console.log(`calendar: ${data.events.length} events, ${readings.size}/${SOURCES.length} sources fresh${failed.length ? `; failed: ${failed.sort().join("; ")}` : ""}`);
}

main().catch((error) => {
  console.error(`calendar: ${error.message || error}`);
  process.exit(0);
});
