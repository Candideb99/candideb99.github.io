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

// 5. The newsroom's own drawing (pipeline/lib/exhibit-desk.mjs): the record read in code, then the desk with stand-ins
// for Commons, the thumbnails and Claude. Fails on the code before it, which has no exhibit-desk.mjs.
const desk = await import("../pipeline/lib/exhibit-desk.mjs");
const { drawingFault, publishedYear, deathYear, artistName, cropBox, findExhibit, outside } = desk;
check("a date read at its latest year", [publishedYear("c1883"), publishedYear("[between 1880 and 1890]"), publishedYear("")], [1883, 1890, null]);
check("an artist's death year from the Library's record", [deathYear("Gillam, Bernhard, 1856-1896, artist"), deathYear("J. Ottman Lithographic Company.; Pughe, J. S. (John S.), 1870-1909, artist"), deathYear("Edward Williams Clay (d. 1857)"), deathYear("Miscellaneous Items in High Demand, PPOC, Library of Congress")], [1896, 1909, 1857, null]);
check("an artist's name as a credit prints it", [artistName("Gillam, Bernhard, 1856-1896, artist"), artistName("J. Ottman Lithographic Company.; Pughe, J. S. (John S.), 1870-1909, artist"), artistName("Miscellaneous Items in High Demand, PPOC, Library of Congress")], ["Bernhard Gillam", "J. S. Pughe", ""]);
const gillam = { title: "The protectors of our industries - Gillam LCCN94507245.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File%3AThe_protectors.jpg", thumb: "https://upload.wikimedia.org/x/960px-a.jpg", mime: "image/jpeg", width: 1024, height: 815, license: "Public domain", artist: "Gillam, Bernhard, 1856-1896, artist", date: "1883", description: "1 print : chromolithograph.", categories: "Images from the Library of Congress|Puck, 1883" };
check("a free cartoon of 1883 may run", drawingFault(gillam, 2026), "");
check("Udo Keppler (d. 1956) may not yet", drawingFault({ ...gillam, artist: "Keppler, Udo J., 1872-1956, artist", date: "1912" }, 2026), "its artist died in 1956");
check("an anti-Chinese cartoon never reaches the judge", drawingFault({ ...gillam, title: "Anti-Chinese Wall cartoon Puck 1882.jpg" }, 2026), "a people, a race or a religion as its subject");
check("a caricature of a religion never reaches the judge", drawingFault({ ...gillam, categories: "Puck, 1890|Jews in caricature" }, 2026), "a people, a race or a religion as its subject");
check("a photograph is no drawing", drawingFault({ ...gillam, description: "1 photograph : glass negative." }, 2026), "a photograph");
check("a record that says no drawing is not taken", drawingFault({ ...gillam, title: "Bank building.jpg", description: "A bank.", categories: "Banks" }, 2026), "not a drawing by its record");
check("a TIFF is not kept", drawingFault({ ...gillam, mime: "image/tiff" }, 2026), "not a JPEG");
check("a NonCommercial licence is refused", drawingFault({ ...gillam, license: "CC BY-NC 4.0" }, 2026), "licence CC BY-NC 4.0");
check("a drawing of 1931 is not yet free in the US", drawingFault({ ...gillam, date: "1931", artist: "Gillam, Bernhard, 1856-1896, artist" }, 2026), "published 1931");
check("an unsigned drawing of 1920 is not taken", drawingFault({ ...gillam, artist: "Miscellaneous Items in High Demand, PPOC, Library of Congress", date: "1920" }, 2026), "unsigned, published 1920");
check("a named artist without a death year, 1890: not taken", drawingFault({ ...gillam, artist: "Goussier", date: "1890" }, 2026), "its artist's death unknown (1890)");
check("…but 1762 is", drawingFault({ ...gillam, artist: "Goussier", date: "1762" }, 2026), "");
check("a small file is not kept", drawingFault({ ...gillam, width: 600, height: 480 }, 2026), "too small");
check("a crop of borders is taken", cropBox({ left: 0.05, top: 0.08, right: 0.05, bottom: 0.15 }), { left: 0.05, top: 0.08, right: 0.05, bottom: 0.15 });
check("a crop into the drawing is not", [cropBox({ left: 0.4 }), cropBox({ left: 0.2, right: 0.2, top: 0.2 }), cropBox(null)], [null, null, null]);

const sharp = (await import("sharp")).default;
const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 230, g: 220, b: 200 } } }).jpeg().toBuffer();
const real = { ...outside };
const calls = [];
let judgeSaw = null;
const anti = { ...gillam, title: "Anti-Chinese Wall cartoon Puck 1882.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File%3AAnti.jpg" };
const keppler2 = { ...gillam, title: "The two-faced protectionist - Kep.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File%3AKep.jpg", artist: "Keppler, Udo J., 1872-1956, artist", date: "1912" };
function stand({ plan, judge }) {
  calls.length = 0;
  judgeSaw = null;
  outside.search = async () => [anti, keppler2, gillam];
  outside.browse = async () => [gillam];
  outside.inline = async () => "data:image/jpeg;base64,AAAA";
  outside.fetchBytes = async () => jpeg;
  outside.chat = async (o) => {
    calls.push(o.role);
    if (o.role === "vision") {
      judgeSaw = { images: o.images.length, user: o.user };
      if (judge instanceof Error) throw judge;
      return { data: judge };
    }
    return { data: plan };
  };
}
const draft = { title: "لماذا تُفقر الحماية الجمركية العامل؟", subtitle: "", lede: "نص", body: "نص" };
const freeIdea = { id: "no-drawing-idea", economists: [{ ar: "س", en: "Someone" }], year: 1900, work: "A work" };
const plan = { fits: true, show: "workers carrying the rich", searches: ["Puck cartoon workers"], categories: ["Puck (magazine)"] };
check("a search loses its years and keeps four words", [desk.plainerSearch("minimum wage cartoon 1913"), desk.plainerSearch("Anti-Corn Law League cartoon Punch 1846")], ["minimum wage cartoon", "Anti-Corn Law League cartoon"]);
const pick = { choice: 1, why: "it shows it", caption_ar: "رسم ساخر من مجلة «باك» الأمريكية عام 1883.", alt_ar: "أثرياء فوق طوف يحمله عمال", crop: { left: 0.05, top: 0.05, right: 0.05, bottom: 0.1 } };
const { mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const scratch = mkdtempSync(path.join(tmpdir(), "exhibit-desk-"));
try {
  stand({ plan, judge: pick });
  check("an idea with the catalogue's drawing is not searched", [await findExhibit({ draft, idea: { id: "marx-capital" }, slug: "x", dir: scratch }), calls.length], [null, 0]);
  stand({ plan: { fits: false }, judge: pick });
  check("a piece no drawing fits gets none, in one call", [await findExhibit({ draft, idea: freeIdea, slug: "x", dir: scratch }), calls], [null, ["editor"]]);
  stand({ plan, judge: pick });
  const kept = await findExhibit({ draft, idea: freeIdea, slug: "protection-wages-abc123", dir: scratch, year: 2026 });
  check("the judge sees only the drawings the code let through", [judgeSaw?.images, /Anti-Chinese|two-faced/.test(judgeSaw?.user ?? "")], [1, false]);
  check("the chosen drawing is printable", printable(kept, 2026), true);
  check("…kept on the site under the piece's address", [kept?.file, existsSync(path.join(scratch, "protection-wages-abc123.jpg"))], ["/photos/exhibits/protection-wages-abc123.jpg", true]);
  check("…cropped and no wider than the page needs", jpegSize(readFileSync(path.join(scratch, "protection-wages-abc123.jpg"))), { width: kept?.width, height: kept?.height });
  check("…credited with its artist and holder, marked the newsroom's", [kept?.credit, kept?.artistDied, kept?.published, kept?.chosenBy], ["Bernhard Gillam · ملكية عامة · مكتبة الكونغرس", 1896, 1883, "newsroom"]);
  stand({ plan, judge: { choice: 0, why: "none shows it" } });
  check("a judge who takes none leaves the piece without one", await findExhibit({ draft, idea: freeIdea, slug: "x", dir: scratch }), null);
  stand({ plan, judge: new Error("the model is down") });
  check("a failed call loses the drawing, never the piece", await findExhibit({ draft, idea: freeIdea, slug: "x", dir: scratch }), null);
  stand({ plan, judge: pick });
  const dry = await findExhibit({ draft, idea: freeIdea, slug: "dry-run-piece", dir: null, year: 2026 });
  check("a dry run keeps nothing on the site", [Boolean(dry), existsSync(path.join(scratch, "dry-run-piece.jpg"))], [true, false]);
} finally {
  Object.assign(outside, real);
  rmSync(scratch, { recursive: true, force: true });
}

// 6. The piece's file carries the newsroom's drawing (an idea only), and the page prints it after the catalogue's.
const { serializeArticle } = await import("../pipeline/lib/article.mjs");
const piece = (kind) => serializeArticle({ draft: { title: "ع", subtitle: "", lede: "ل", body: "م", keyFacts: [], whyItMatters: "", tags: [], regions: [], exhibit: withExhibit[0].exhibit }, slug: "s", section: "explainers", sources: [], image: null, models: {}, quality: {}, kind });
check("an idea piece's file carries its drawing", /\nexhibit:/.test(piece("idea")), true);
check("an explainer's never does", /\nexhibit:/.test(piece("explainer")), false);
check("the page falls back to the newsroom's drawing", /exhibitOf\(d\.idea\?\.id\) \?\? \(printable\(d\.exhibit\)/.test(page), true);

console.log(`exhibits self-test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
