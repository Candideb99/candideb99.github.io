#!/usr/bin/env node
/**
 * The picture desk, tested on cases whose right answer is known (35 checks), with scripted stand-ins for Claude, Wikimedia Commons,
 * the other libraries and the thumbnails: no model call, no network. Written 2026-09-28 after the owner asked for the
 * image engine to be stress-tested ("it might still be buggy"), so that the cascade's order, its place filter, the
 * repeat guard, its behaviour when a service fails, and the reading of accented names cannot regress unseen. The gate
 * runs it (scripts/gate.mjs).
 *
 *   node scripts/images-selftest.mjs
 */
import { withStandIns, pickImage, namesAPlace, seriesKey, storyText, offeredSourcePhotos, placedAbroad, fold, ILLUSTRATIVE } from "../pipeline/lib/images.mjs";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. The pure rules.
check("a New Capital file names its place", namesAPlace({ title: "Central business district, New Administrative Capital.jpg" }, ["New Administrative Capital"]), true);
check("the short name counts as a place", namesAPlace({ title: "The Government District, New Capital 1.jpg" }, ["New Capital"]), true);
check("«New Cairo» is not «Cairo, IL»", namesAPlace({ title: "Old Cairo Junior High School, Pine Street, Cairo, IL.jpg" }, ["New Cairo"]), false);
check("«Tenth of Ramadan» is «10th of Ramadan City»", namesAPlace({ title: "10th of Ramadan City industrial zone.jpg" }, ["Tenth of Ramadan"]), true);
check("a German tower is not the New Capital's", namesAPlace({ title: "Bonn, Post-Tower -- 2017 -- 2128.jpg" }, ["New Administrative Capital"]), false);
check(
  "numbered frames of one scene are one series",
  [seriesKey("Central business district 1, New Administrative Capital.jpg"), seriesKey("Central business district, New Administrative Capital.jpg")],
  ["series:central business district new administrative capital", "series0:central business district new administrative capital"],
);
check("a date is not a frame number", seriesKey("NEW_YORK_STOCK_EXCHANGE_20240521.jpg"), "series0:new york stock exchange");
check("a name that is mostly numbers has no series", seriesKey("DSC 0808 (1) (1).jpg"), "");
check("accents fold for matching", [fold("Recep Tayyip Erdoğan"), fold("Mehmet Şimşek"), fold("İstanbul")], ["recep tayyip erdogan", "mehmet simsek", "istanbul"]);
check(
  "the whole story is read, without markdown",
  storyText({ lede: "ليد", body: "فقرة **أولى** [رابط](https://x.test)\n\n| a | b |\n|---|---|\n\n## عنوان\nثانية", whyItMatters: "لأن", keyFacts: [{ label: "رقم", value: "5" }] }),
  "Lede: ليد\nBody: فقرة أولى رابط عنوان ثانية\nWhy it matters: لأن\nFigures: رقم: 5",
);
check(
  "an outlet's logo and a repeated photo are not offered",
  offeredSourcePhotos([{ ogImage: "https://x.test/logo.png" }, { ogImage: "https://x.test/a.jpg", sourceNameEn: "A" }, { ogImage: "https://x.test/a.jpg" }, { ogImage: "/relative.jpg" }]).map((p) => p.url),
  ["https://x.test/a.jpg"],
);
const egyptStory = { title: "مسودة قانون مصرية تلزم المطورين العقاريين بحساب لكل مشروع", tags: ["مصر", "القطاع العقاري"], regions: ["مصر والمغرب العربي"] };
check("a file from Cairo, Illinois is abroad for an Egyptian story", placedAbroad({ title: "Old Cairo Junior High School, Cairo, Illinois.jpg" }, egyptStory), "United States");
check("«Cairo, IL» and «Alexandria, Virginia» are American", [placedAbroad({ title: "Old Cairo Junior High School, Pine Street, Cairo, IL.jpg" }, egyptStory), placedAbroad({ title: "Alexandria, Virginia waterfront.jpg" }, egyptStory)], ["United States", "United States"]);
check("Egypt's own Cairo and Alexandria stay home", [placedAbroad({ title: "Cairo Tower, Cairo, Egypt.jpg" }, egyptStory), placedAbroad({ title: "Corniche of Alexandria.jpg" }, egyptStory)], [null, null]);
check("«Tbilisi, Georgia» is not read as an American state", placedAbroad({ title: "Tbilisi, Georgia old town.jpg" }, egyptStory), null);
check("«Houston, TX» is home for an American story", placedAbroad({ title: "Houston, TX refinery.jpg" }, { title: "وقود الديزل في الولايات المتحدة", tags: ["الولايات المتحدة"], regions: ["الأمريكتان"] }), null);

// ---------------------------------------------------------------------------------------------------------------
// 2. The cascade, on scripted stand-ins.
const file = (title, extra = {}) => ({
  title,
  description: extra.description ?? "",
  categories: extra.categories ?? "",
  url: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(title.replace(/ /g, "_"))}/1280px-${encodeURIComponent(title.replace(/ /g, "_"))}`,
  width: 1280,
  height: 853,
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  artist: "Tester",
  date: extra.date ?? "2024-05-12",
  uploaded: "2024-05-12",
  pageUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,
});
const titlesIn = (prompt) => [...String(prompt).matchAll(/^(\d+)\. "(.+?)" —/gm)].map((m) => m[2]);
const fileNameIn = (prompt) => String(prompt).match(/^File name: (.*)$/m)?.[1] ?? "";

/**
 * Runs pickImage in a scripted world. `world` maps a Commons search to its files; `plan` is the planner's answer (or
 * "throw"); `judge(titles, prompt)` returns the 1-based choice or 0; `verify(fileName, prompt)` returns a verdict or
 * throws; `brief` is the source-photo reader's answer. Returns the photo, every search asked, and the calls made.
 */
async function scenario({ draft, world = {}, libs = {}, plan, judge, verify = () => "RIGHT", brief = null, byText = null, sources = [], exclude = new Set(), lastResort = { scene: null, country: null, institution: null, city: null } }) {
  const searched = [];
  const calls = [];
  const judgePrompts = [];
  const inlined = [];
  const restore = withStandIns({
    searchCommons: async (query) => {
      searched.push(query);
      return (world[query] ?? []).map((f) => ({ ...f }));
    },
    searchLibraries: async (query) => (libs[query] ?? []).map((f) => ({ ...f, library: "pexels" })),
    inlineImage: async (url) => {
      inlined.push(url);
      return "data:image/jpeg;base64,AAAA";
    },
    noteUse: async () => {},
    chat: async (opts) => {
      const { system = "", user = "", role } = opts;
      let data;
      if (system.includes("choosing stock photographs")) {
        calls.push("planner");
        if (plan === "throw") throw new Error("Claude failed for role writer");
        data = plan;
      } else if (system.includes("You name places")) {
        calls.push("last-resort");
        data = lastResort;
      } else if (user.includes("sources ran with their own reports")) {
        calls.push("brief");
        if (brief === "throw") throw new Error("Claude failed for role vision");
        data = brief ?? { photos: [{ n: 1, news: false, shows: "", people: [] }], best: 0, queries: [] };
      } else if (role === "vision" && user.includes("Candidate photographs")) {
        calls.push(user.includes("LAST PASS") ? "judge-neutral" : "judge");
        judgePrompts.push(user);
        if (judge === "throw") throw new Error("Claude failed for role vision");
        data = { choice: judge(titlesIn(user), user), alt: "صورة اختبار", reason: "test" };
      } else if (system.includes("wire captions")) {
        calls.push("judge-by-text");
        data = { choice: (byText ?? (() => 1))(titlesIn(user), user), alt: "صورة اختبار", reason: "test" };
      } else if (system.includes("strict newspaper picture editor")) {
        calls.push(`verify:${fileNameIn(user)}`);
        data = { verdict: verify(fileNameIn(user), user), reason: "test" };
      } else if (system.includes("photo captions")) {
        calls.push("caption");
        data = { alt: user.includes("Name only what the story itself names") ? "طائرة إيرباص A321neo" : "صورة اختبار" };
      } else {
        throw new Error(`unexpected call: ${system.slice(0, 60)}`);
      }
      opts.validate?.(data);
      return { data, model: "stand-in" };
    },
  });
  try {
    // IMAGES_SELFTEST_LOG=1 prints the desk's own log for every case.
    const log = process.env.IMAGES_SELFTEST_LOG ? (line) => console.log(`      ${line}`) : () => {};
    const image = await pickImage({ draft, story: { angle: "" }, log, exclude, sources });
    return { image, searched, calls, inlined, judgePrompts };
  } finally {
    restore();
  }
}

const developers = {
  title: "مسودة قانون مصرية تلزم المطورين العقاريين بحساب مصرفي منفصل لكل مشروع",
  subtitle: "تحظر إنفاق أموال العملاء خارج المشروع",
  lede: "تلزم المسودة كل مطور عقاري في مصر بحساب مستقل لكل مشروع.",
  body: "فقرة من المتن.",
  tags: ["مصر", "القطاع العقاري"],
  regions: ["مصر والمغرب العربي"],
  kind: "news",
  section: "economy",
  imageQueries: [],
};
const planFor = (over = {}) => ({ queries: ["construction site Egypt"], place: ["Egypt", "Cairo"], people: [], focus: "subject", places: [], place_queries: [], ...over });
const cbd = file("Central business district, New Administrative Capital.jpg", { categories: "Iconic Tower|Central business district, New Administrative Capital" });
const bonn = file("Bonn, Post-Tower -- 2017 -- 2128.jpg", { categories: "Post Tower|Buildings in Germany" });
const dahab = file("Construction site in Dahab, Egypt.jpg", { categories: "Construction in Egypt" });
const pickTitle = (needle) => (titles) => titles.findIndex((t) => t.includes(needle)) + 1;

// A. The story's own place comes first, and only files that name it reach the judge.
{
  const r = await scenario({
    draft: developers,
    plan: planFor({ places: ["New Administrative Capital", "New Capital"], place_queries: ["New Administrative Capital"] }),
    world: { "New Administrative Capital": [bonn, cbd], "construction site Egypt": [dahab] },
    judge: pickTitle("Central business district"),
  });
  check("the place tier picks the New Capital's business district", r.image?.title, cbd.title);
  check("a file that does not name the place never reaches the judge; the later tiers are never asked", [r.calls.includes("brief"), r.searched.includes("construction site Egypt")], [false, false]);
}
// B. A frame of a series another story runs is never repeated; the cascade moves on to the next tier.
{
  const used = file("Central business district 1, New Administrative Capital.jpg");
  const r = await scenario({
    draft: developers,
    plan: planFor({ places: ["New Administrative Capital"], place_queries: ["New Administrative Capital"] }),
    world: { "New Administrative Capital": [cbd], "construction site Egypt": [dahab] },
    judge: (titles) => (titles.length ? 1 : 0),
    verify: () => "GENERIC_OK",
    exclude: new Set([used.url]),
  });
  check("another frame of a series a story runs is passed over for the next tier", r.image?.title, dahab.title);
}
// C. «New Cairo» never fetches Cairo, Illinois.
{
  const illinois = file("Old Cairo Junior High School, Pine Street and 24th Street, Cairo, IL.jpg", { categories: "Cairo, Illinois" });
  const r = await scenario({
    draft: developers,
    plan: planFor({ places: ["New Cairo"], place_queries: ["New Cairo"] }),
    world: { "New Cairo": [illinois], "construction site Egypt": [dahab] },
    judge: (titles) => (titles.some((t) => t.includes("Illinois") || t.includes("IL.jpg")) ? 1 : titles.length ? 1 : 0),
    verify: () => "GENERIC_OK",
  });
  check("a Cairo, IL school never reaches the judge", r.image?.title, dahab.title);
}
// D. Nothing at the place: the sources' own photograph is the brief; an outlet's logo is never read.
{
  const trucks = file("Trucks at Sokhna port, Egypt.jpg", { categories: "Ain Sokhna|Ports of Egypt" });
  const r = await scenario({
    draft: { ...developers, title: "المنطقة الاقتصادية لقناة السويس تطلق ساحة رقمية للشاحنات في ميناء السخنة المصري", tags: ["مصر"] },
    plan: planFor({ queries: [], places: [], place_queries: [] }),
    sources: [
      { ogImage: "https://src.test/photos/trucks.jpg", sourceNameEn: "Al-Borsa", title: "t" },
      { ogImage: "https://src.test/static/logo.png", sourceNameEn: "Other", title: "t" },
    ],
    brief: { photos: [{ n: 1, news: true, shows: "trucks queue at a port yard", people: [] }], best: 1, queries: ["port trucks Egypt"] },
    world: { "port trucks Egypt": [trucks] },
    judge: pickTitle("Trucks"),
    verify: () => "RIGHT",
  });
  check("the sources' photograph leads to trucks at an Egyptian port", r.image?.title, trucks.title);
  check("the outlet's logo is never downloaded", r.inlined.some((u) => u.includes("logo")), false);
  check(
    "the sources'-photo pass tells its judge the subject it may take, and that a skyline is not this pass's",
    [r.judgePrompts[0]?.includes("THE SOURCES' OWN PHOTOGRAPH shows: trucks queue at a port yard"), r.judgePrompts[0]?.includes("never chosen in this pass")],
    [true, true],
  );
}
// D3. Location before likeness: the sources'-photo pass takes only the story's own country; an unplaced tanker waits and
// the country pass finds Oman's own port (the stress test of 2026-09-28).
{
  const tanker = { ...file("Ships anchored off the coast at sunset"), url: "https://images.pexels.com/photos/1/tanker.jpeg" };
  const salalah = file("Port of Salalah container terminal, Oman.jpg", { categories: "Port of Salalah|Ports of Oman" });
  const r = await scenario({
    draft: { ...developers, title: "ستاندرد آند بورز ترفع توقعات نمو الاقتصاد العماني في 2026", tags: ["عمان"], regions: ["الخليج"] },
    plan: planFor({ queries: ["container port Oman"], place: ["Oman", "Omani", "Salalah"], places: [], place_queries: [] }),
    sources: [{ ogImage: "https://src.test/photos/ships.jpg", sourceNameEn: "The National", title: "t" }],
    brief: { photos: [{ n: 1, news: true, shows: "ships anchored off the Omani coast", people: [] }], best: 1, queries: ["ships anchored off Muscat"] },
    libs: { "ships anchored off Muscat": [tanker] },
    world: { "container port Oman": [salalah] },
    judge: (titles) => (titles.length ? 1 : 0),
    verify: () => "GENERIC_OK",
  });
  check("an unplaced likeness waits; Oman's own port is chosen", r.image?.title, salalah.title);
}
// D2. A skyline is the last resort's alone (the stress test of 2026-09-28: the Cairo Tower ran under a rate decision).
{
  const skyline = file("6th of October Bridge and Cairo Tower (14802847662).jpg", { categories: "Cairo Tower|Skylines of Cairo" });
  const cbe = file("Central Bank of Egypt, Cairo.jpg", { categories: "Central Bank of Egypt" });
  const r = await scenario({
    draft: { ...developers, title: "البنك المركزي المصري يثبت أسعار الفائدة للمرة الخامسة" },
    plan: planFor({ queries: ["vegetable market Cairo"], places: [], place_queries: [] }),
    world: { "vegetable market Cairo": [], "Cairo skyline": [skyline], "Central Bank of Egypt headquarters": [cbe] },
    lastResort: { scene: null, country: "Egypt", institution: "Central Bank of Egypt", city: "Cairo" },
    judge: (titles, prompt) => (prompt.includes("This is the last resort") ? titles.findIndex((t) => t.includes("Central Bank")) + 1 || 1 : 0),
    verify: (name, prompt) => (prompt.includes("skyline or central bank is acceptable ONLY") ? "GENERIC_OK" : "WRONG_SUBJECT"),
  });
  check("only the last resort is offered the capital's skyline", [r.judgePrompts.filter((p) => p.includes("This is the last resort")).length > 0, r.judgePrompts.filter((p) => !p.includes("This is the last resort") && !p.includes("LAST PASS")).every((p) => p.includes("never chosen in this pass"))], [true, true]);
  check("the last resort still prefers the central bank to the skyline", r.image?.title, cbe.title);
}
// E. The second check fails closed: a refused or unchecked photo never runs, and the next choice is judged.
{
  const alt = file("Residential towers under construction in New Cairo, Egypt.jpg", { categories: "New Cairo|Construction in Egypt" });
  const r = await scenario({
    draft: developers,
    plan: planFor({ places: ["New Cairo"], place_queries: ["New Cairo"] }),
    world: { "New Cairo": [dahab, alt] },
    judge: (titles) => titles.findIndex((t) => t.includes("Residential")) + 1 || 1,
    verify: (name) => {
      if (name.includes("Residential")) throw new Error("critic unavailable");
      return "RIGHT";
    },
  });
  check("an unchecked photo is refused, never published", r.image?.title === alt.title, false);
}
// F. The vision model is down: the metadata judge chooses.
{
  const r = await scenario({
    draft: developers,
    plan: planFor({ places: ["New Administrative Capital"], place_queries: ["New Administrative Capital"] }),
    world: { "New Administrative Capital": [cbd] },
    judge: "throw",
    byText: () => 1,
  });
  check("without vision the metadata judge still chooses", [r.image?.title, String(r.image?.model ?? "").includes("(metadata)")], [cbd.title, true]);
}
// G. Every pass refuses: the neutral illustration runs, captioned as one.
{
  const plant = file("Concrete columns at a building site.jpg", { categories: "Construction" });
  const r = await scenario({
    draft: developers,
    plan: planFor({ queries: ["construction site Egypt"], places: [], place_queries: [] }),
    world: { "construction site Egypt": [], "construction site": [plant] },
    judge: (titles, prompt) => (prompt.includes("LAST PASS") ? 1 : 0),
    verify: (name, prompt) => (prompt.includes("LAST-PASS") ? "GENERIC_OK" : "WRONG_SUBJECT"),
  });
  check("the neutral pass runs its frame as «صورة تعبيرية»", [r.image?.title, String(r.image?.alt ?? "").includes(ILLUSTRATIVE)], [plant.title, true]);
}
// H. The planner fails: the writer's own searches still find a photo; with none, the story runs without one.
{
  const r = await scenario({
    draft: { ...developers, imageQueries: ["construction site Egypt"] },
    plan: "throw",
    world: { "construction site Egypt": [dahab] },
    judge: () => 1,
    verify: () => "GENERIC_OK",
  });
  check("a failed planner leaves the writer's searches", r.image?.title, dahab.title);
  const none = await scenario({ draft: developers, plan: "throw", world: {}, judge: () => 0 });
  check("with no searches at all the story runs without a photo, no crash", none.image, null);
}
// I. A person with accents in her name is the news: she is searched, found and chosen.
{
  const kaya = file("Fatma Betül Sayan Kaya in 2025.jpg", { date: "2025-03-01" });
  const r = await scenario({
    draft: { ...developers, title: "نائبة رئيس حزب العدالة والتنمية التركي تستقيل مع اتساع أزمة الصناديق", tags: ["تركيا"], regions: ["الشرق الأوسط"] },
    plan: planFor({ queries: ["Borsa Istanbul trading floor"], place: ["Turkey", "Istanbul"], people: ["Fatma Betül Sayan Kaya"], focus: "people" }),
    world: { "Fatma Betül Sayan Kaya 2026": [], "Fatma Betül Sayan Kaya": [kaya] },
    judge: pickTitle("Kaya"),
    verify: () => "RIGHT",
  });
  check("an accented name survives the planner and her photo is chosen", r.image?.title, kaya.title);
}
// J. «Erdogan» in a file name is Erdoğan; a file that pairs him with someone else is not taken for another man alone.
{
  const ascii = file("President Recep Tayyip Erdogan speaks in Ankara, 2025.jpg", { date: "2025-06-01" });
  const withOther = file("President Erdoğan meets Chancellor Scholz, 2025.jpg", { date: "2025-06-01" });
  const r = await scenario({
    draft: { ...developers, title: "أردوغان يعلن حزمة لدعم الليرة التركية", tags: ["تركيا"], regions: ["الشرق الأوسط"] },
    plan: planFor({ queries: [], place: ["Turkey"], people: ["Recep Tayyip Erdoğan"], focus: "people" }),
    world: { "Recep Tayyip Erdoğan 2026": [withOther, ascii], "Recep Tayyip Erdoğan": [] },
    judge: (titles) => titles.findIndex((t) => t.includes("speaks")) + 1,
    verify: () => "RIGHT",
  });
  check("«Erdogan» matches «Erdoğan»; the file with Scholz is not the pick", r.image?.title, ascii.title);
}

// L. The right frame under a caption that names too much is recaptioned and checked again, not thrown away (the stress
// test of 2026-09-28: four A321neo photographs refused for naming their airlines).
{
  const plane = file("AirAsia Airbus A321neo climbing after take-off.jpg", { categories: "Airbus A321neo|AirAsia" });
  const r = await scenario({
    draft: { ...developers, title: "عيب في هيكل طائرات إيرباص A321neo يهبط بأسهم الشركة", tags: ["إيرباص"], regions: ["أوروبا"] },
    plan: planFor({ queries: ["Airbus A321neo"], place: [], places: [], place_queries: [] }),
    world: { "Airbus A321neo": [plane] },
    judge: () => 1,
    verify: (name, prompt) => (prompt.includes("Caption the paper would print: طائرة إيرباص A321neo") ? "RIGHT" : "RECAPTION"),
  });
  check("a caption that named the airline is rewritten and the photo runs", [r.image?.title, r.image?.alt], [plane.title, "طائرة إيرباص A321neo"]);
}
// K. Every library down at once: the desk returns no photo and never throws (the newsroom calls it after the story is
// written and checked; an exception here would throw that work away).
{
  const restore = withStandIns({
    searchCommons: async () => {
      throw new Error("ECONNRESET");
    },
    searchLibraries: async () => {
      throw new Error("429 Too Many Requests");
    },
    inlineImage: async () => null,
    noteUse: async () => {},
    chat: async (opts) => {
      const data = opts.system.includes("choosing stock photographs") ? planFor({ places: ["New Capital"], place_queries: ["New Capital"] }) : { scene: "construction site", country: "Egypt", institution: null, city: null };
      opts.validate?.(data);
      return { data, model: "stand-in" };
    },
  });
  let outcome;
  try {
    outcome = await pickImage({ draft: developers, story: {}, log: () => {}, exclude: new Set() });
  } catch (error) {
    outcome = `threw: ${error.message}`;
  } finally {
    restore();
  }
  check("every library down: no photo, and no exception", outcome, null);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
