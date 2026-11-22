/**
 * «من زمن الفكرة» (pipeline/lib/exhibits.mjs, 2026-11-22): the public-domain rule decides its known cases, every drawing
 * in the ideas catalogue is free, kept on the site at the size its record says, captioned and credited, and the
 * article page prints it by the piece's idea. Fails on the code before it, which has no exhibits.mjs.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exhibitOf, inPublicDomain, printable } from "../pipeline/lib/exhibits.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
let passed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

/** A JPEG's width and height from its frame header (SOF0-SOF3). */
function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    i += 2 + length;
  }
  return null;
}

// 1. The rule: published 95 years before this year began, and the artist dead 70 full years (or no artist, 120 years).
check("Glackens's 1912 cover (d. 1933) is free in 2026", inPublicDomain({ published: 1912, artistDied: 1933 }, 2026), true);
check("Udo Keppler (d. 1956) waits for 2027", inPublicDomain({ published: 1912, artistDied: 1956 }, 2026), false);
check("…and is free in 2027", inPublicDomain({ published: 1912, artistDied: 1956 }, 2027), true);
check("a 1931 publication is not yet free in the US in 2026", inPublicDomain({ published: 1931, artistDied: 1900 }, 2026), false);
check("…and is in 2027", inPublicDomain({ published: 1931, artistDied: 1900 }, 2027), true);
check("an unsigned 1873 engraving is free", inPublicDomain({ published: 1873 }, 2026), true);
check("an unsigned 1920 drawing is not taken (its artist may have lived on)", inPublicDomain({ published: 1920 }, 2026), false);
check("a record without its year is not free", inPublicDomain({ artistDied: 1800 }, 2026), false);
check("a death year that is not a year is not free", inPublicDomain({ published: 1880, artistDied: "1890" }, 2026), false);

// 2. The catalogue: every drawing printable, kept on the site at its recorded size, captioned in Arabic.
const catalogue = JSON.parse(readFileSync(path.join(ROOT, "pipeline", "ideas.json"), "utf8"));
const withExhibit = catalogue.ideas.filter((i) => i.exhibit);
check("the catalogue holds drawings", withExhibit.length >= 5, true);
for (const idea of withExhibit) {
  const e = idea.exhibit;
  check(`${idea.id}: printable`, printable(e), true);
  const file = path.join(ROOT, "public", e.file);
  check(`${idea.id}: its copy is on the site`, existsSync(file), true);
  if (!existsSync(file)) continue;
  check(`${idea.id}: its copy is the size its record says`, jpegSize(readFileSync(file)), { width: e.width, height: e.height });
  check(`${idea.id}: its copy is light enough for a page`, statSync(file).size <= 300 * 1024, true);
  check(`${idea.id}: its caption is whole, in Arabic`, /[؀-ۿ]/.test(e.caption) && !/…|\.\.\./.test(e.caption) && e.caption.length >= 60 && e.caption.length <= 420, true);
  check(`${idea.id}: its picture's description is short`, e.alt.length >= 15 && e.alt.length <= 120, true);
  check(`${idea.id}: the page finds it by the idea`, exhibitOf(idea.id), e);
}

// 3. The lookup: none for an idea without one, an unknown idea, or a drawing not yet free.
check("an idea without a drawing prints none", exhibitOf("akerlof-lemons"), undefined);
check("an unknown idea prints none", exhibitOf("no-such-idea"), undefined);
check("no idea prints none", exhibitOf(undefined), undefined);
const keppler = { ...withExhibit[0].exhibit, artistDied: 1956, published: 1912 };
check("a drawing not yet free is not printed", exhibitOf("x", { ideas: [{ id: "x", exhibit: keppler }], year: 2026 }), undefined);
check("…and is the year it is", exhibitOf("x", { ideas: [{ id: "x", exhibit: keppler }], year: 2027 }), keppler);
check("a copy outside the site's exhibits folder is not printed", printable({ ...withExhibit[0].exhibit, file: "https://example.com/x.jpg" }), false);
check("a drawing without its credit is not printed", printable({ ...withExhibit[0].exhibit, credit: "Bernhard Gillam" }), false);

// 4. The page prints it, by the piece's idea and for an idea piece only, and never as the piece's photograph.
const page = readFileSync(path.join(ROOT, "src", "pages", "articles", "[slug].astro"), "utf8");
check("the article page reads the drawing by the piece's idea", /d\.kind === "idea" \? exhibitOf\(d\.idea\?\.id\)/.test(page), true);
check("the article page prints it", /<Exhibit exhibit=\{exhibit\} \/>/.test(page), true);
check("the drawing never becomes the page's sharing image", /ogImage = [^\n]*exhibit/.test(page), false);

console.log(`exhibits self-test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
