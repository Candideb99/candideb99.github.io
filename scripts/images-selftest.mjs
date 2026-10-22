#!/usr/bin/env node
/**
 * The picture desk, tested on cases whose right answer is known (69 checks), with scripted stand-ins for Claude, Wikimedia Commons,
 * the other libraries and the thumbnails: no model call, no network. Written 2026-09-28 after the owner asked for the
 * image engine to be stress-tested ("it might still be buggy"), so that the cascade's order, its place filter, the
 * repeat guard, its behaviour when a service fails, and the reading of accented names cannot regress unseen. The gate
 * runs it (scripts/gate.mjs).
 *
 *   node scripts/images-selftest.mjs
 */
import { withStandIns, pickImage, namesAPlace, seriesKey, storyText, offeredSourcePhotos, placedAbroad, closeUpOfMaterial, creditedBody, handoutFault, fold, frontOfBuilding, stockFault, aboutBuildings, captionFlaws, ILLUSTRATIVE } from "../pipeline/lib/images.mjs";

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
async function scenario({ draft, world = {}, libs = {}, plan, judge, verify = () => "RIGHT", brief = null, byText = null, sources = [], exclude = new Set(), lastResort = { scene: null, country: null, institution: null, city: null }, handout = null, handoutWidth = 975, photoDir = null }) {
  const searched = [];
  const calls = [];
  const judgePrompts = [];
  const verifyPrompts = [];
  const inlined = [];
  const saved = [];
  const restore = withStandIns({
    fetchHandout: async (url) => ({ width: handoutWidth, height: 557, savedWidth: Math.min(handoutWidth, 1280), savedHeight: 557, buffer: Buffer.from("x"), preview: "data:image/jpeg;base64,AAAA", url }),
    saveHandout: async (got, file) => { saved.push(file); },
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
        // A judge may answer { choice, says }: whether the photograph says the story's point (messageNote()).
        const said = judge(titlesIn(user), user);
        data = typeof said === "object" ? { alt: "صورة اختبار", reason: "test", ...said } : { choice: said, alt: "صورة اختبار", reason: "test" };
      } else if (system.includes("wire captions")) {
        calls.push("judge-by-text");
        data = { choice: (byText ?? (() => 1))(titlesIn(user), user), alt: "صورة اختبار", reason: "test" };
      } else if (user.includes("The outlet credits it to")) {
        calls.push("handout");
        data = handout ?? { news_photo: true, this_story: true, watermark: false, clear: true, caption_ar: "جانب من الاجتماع", credit_ar: "وزارة البترول المصرية", reason: "test" };
      } else if (system.includes("strict newspaper picture editor")) {
        calls.push(`verify:${fileNameIn(user)}`);
        verifyPrompts.push(user);
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
    const image = await pickImage({ draft, story: { angle: "" }, log, exclude, sources, photoDir });
    return { image, searched, calls, inlined, judgePrompts, verifyPrompts, saved };
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
    plan: planFor({ places: ["New Administrative Capital", "New Capital"], place_queries: ["New Administrative Capital"], message: "developers' money stays with each project" }),
    world: { "New Administrative Capital": [bonn, cbd], "construction site Egypt": [dahab] },
    judge: pickTitle("Central business district"),
  });
  check("the place tier picks the New Capital's business district", r.image?.title, cbd.title);
  check(
    "every judge is told what the picture should say and the publication standard",
    [r.judgePrompts.every((p) => p.includes("WHAT THE PICTURE SHOULD SAY: developers' money stays with each project")), r.judgePrompts.every((p) => p.includes("PUBLICATION STANDARD"))],
    [true, true],
  );
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
    [r.judgePrompts[0]?.includes("THE SOURCES' OWN PHOTOGRAPH shows: trucks queue at a port yard"), r.judgePrompts[0]?.includes("never chosen, whatever the story")],
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
// D2. No pass takes a skyline, and none is searched (the stress test of 2026-09-28: the Cairo Tower ran under a rate
// decision; then a Nile corniche, which the last resort had still been allowed, after the governor and a snapshot of notes
// were refused). The last resort still finds the institution itself.
{
  const skyline = file("6th of October Bridge and Cairo Tower (14802847662).jpg", { categories: "Cairo Tower|Skylines of Cairo" });
  const cbe = file("Central Bank of Egypt, Cairo.jpg", { categories: "Central Bank of Egypt" });
  const r = await scenario({
    draft: { ...developers, title: "البنك المركزي المصري يثبت أسعار الفائدة للمرة الخامسة" },
    plan: planFor({ queries: ["vegetable market Cairo"], places: [], place_queries: [] }),
    world: { "vegetable market Cairo": [], "Cairo skyline": [skyline], "Central Bank of Egypt headquarters": [cbe] },
    lastResort: { scene: null, country: "Egypt", institution: "Central Bank of Egypt", city: "Cairo" },
    judge: (titles) => titles.findIndex((t) => t.includes("Central Bank")) + 1,
    verify: (name, prompt) => (prompt.includes("central bank is acceptable ONLY") && !name.includes("Tower") ? "GENERIC_OK" : "WRONG_SUBJECT"),
  });
  check("no pass is offered a skyline, and none is searched", [r.judgePrompts.every((p) => p.includes("never chosen, whatever the story")), r.searched.some((q) => /skyline|panorama/i.test(q))], [true, false]);
  check("the last resort still finds the central bank itself", r.image?.title, cbe.title);
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

// A source's relevant photograph may show the story's own person at work. The source reader already
// supplies their name; the collection stage used to discard it by banning all named people in this tier.
{
  const trump = file("President Donald Trump signs an order in the Oval Office 2026.jpg", { categories: "Donald Trump|Oval Office|United States" });
  const tusk = file("President Donald Tusk at a signing in the Oval Office 2026.jpg", { categories: "Donald Tusk|United States" });
  const r = await scenario({
    draft: { ...developers, title: "ترامب يصدر قراراً بشأن عقوبات النفط", tags: ["ترامب", "الولايات المتحدة"], regions: ["الأمريكتان"] },
    plan: planFor({ queries: [], place: ["United States"], people: ["Donald Trump"], focus: "people", places: [], place_queries: [] }),
    sources: [{ ogImage: "https://src.test/photos/signing.jpg", sourceNameEn: "Source", title: "Sanctions decision" }],
    brief: { photos: [{ n: 1, news: true, shows: "Donald Trump signing an order at his desk", people: ["Donald Trump"] }], best: 1, queries: ["Donald Trump Oval Office"] },
    world: { "Donald Trump Oval Office": [tusk, trump] },
    judge: pickTitle("Donald Trump"),
  });
  check("the source-photo tier can select the story's own person at work", r.image?.title, trump.title);
  check("sharing a first name never makes another official the story's person", r.judgePrompts.some((p) => p.includes(tusk.title)), false);
}

// The Fertiglobe story (2026-10-18): a close-up of fertilizer granules shows no country, so the country rule does not
// refuse it and it runs as an illustration; the second check sees the frame, and a frame it calls UNCLEAR (a hazy mine
// gate that needs its caption) is refused and never offered again.
{
  check("granules are a close-up of a material", closeUpOfMaterial({ title: "DAP (Diammonium Phosphate) Granules (3).jpg", description: "DAP fertilizer granules" }), true);
  check("a mine and a banknote are not", [closeUpOfMaterial({ title: "Phosphate mine (52726859085).jpg" }), closeUpOfMaterial({ title: "Egyptian pound banknotes close-up.jpg" })], [false, false]);
  const fertilizer = { ...developers, title: "فيرتيجلوب تدرس إنشاء مجمع أسمدة فوسفاتية في مصر", tags: ["مصر", "الأسمدة"], imageQueries: ["fertilizer granules"] };
  const granules = file("DAP (Diammonium Phosphate) Granules (3).jpg", { description: "DAP fertilizer granules in a hand", categories: "Fertilizers in India" });
  const r = await scenario({ draft: fertilizer, plan: planFor({ queries: ["fertilizer granules"] }), world: { "fertilizer granules": [granules] }, judge: pickTitle("Granules") });
  check("a close-up placed abroad survives the country rule and runs as an illustration", [r.image?.title, String(r.image?.alt ?? "").includes(ILLUSTRATIVE)], [granules.title, true]);
  check("the second check is shown the frame and may call it UNCLEAR", r.calls.some((c) => c.startsWith("verify:")) && r.judgePrompts.length > 0, true);
  const gate = file("Phosphate mine (52726859085).jpg", { description: "Gate of a phosphate mine, Egypt", categories: "Mines in Egypt" });
  const prompts = [];
  const u = await scenario({
    draft: { ...fertilizer, imageQueries: ["phosphate mine Egypt"] },
    plan: planFor({ queries: ["phosphate mine Egypt"] }),
    world: { "phosphate mine Egypt": [gate], "construction site Egypt": [gate] },
    judge: pickTitle("Phosphate mine"),
    verify: (name, user) => (prompts.push(user), name.includes("Phosphate mine") ? "UNCLEAR" : "RIGHT"),
  });
  check("a frame the check calls UNCLEAR is refused and never offered again", [u.image?.title ?? null, u.calls.filter((c) => c === `verify:${gate.title}`).length], [null, 1]);
  check("the check that refused it had the frame and the UNCLEAR rule", prompts.some((p) => p.includes("UNCLEAR: the photograph itself is attached")), true);
}

// Handouts (the owner, 2026-10-18: "yes, use handouts credited to official sources"): a source's photograph is taken
// only when the outlet credits an official body or a company the story names; never an agency's, the outlet's own, an
// archive, an uncredited one or a small one; it comes before every library and is kept on the site, credited.
{
  check(
    "the credited body is read as outlets write it",
    [
      creditedBody({ credit: "الصورة من وزارة البترول المصرية" }),
      creditedBody({ caption: "Egypt's Petroleum Ministry/Handout via REUTERS" }),
      creditedBody({ caption: "Al Jaber at the signing. Photo: ADNOC" }),
      creditedBody({ caption: "جانب من الاجتماع" }),
    ],
    ["وزارة البترول المصرية", "Egypt's Petroleum Ministry", "ADNOC", ""],
  );
  const story = { title: "وزير البترول يبحث مع «فيرتيجلوب» إنشاء مجمع للأسمدة في مصر", lede: "بحث وزير البترول مع رئيس «فيرتيجلوب».", body: "قالت وزارة البترول في بيان إن...", tags: ["مصر"] };
  const ministry = { url: "https://cdn.test/meeting.jpeg", credit: "الصورة من وزارة البترول المصرية", caption: "", width: 975 };
  check(
    "only an official, related, large-enough credit passes",
    [
      handoutFault(ministry, { story, source: { sourceName: "سي إن بي سي عربية", title: "مصر تبحث مع فيرتيغلوب" } }),
      handoutFault({ ...ministry, credit: "الصورة من رويترز" }, { story }) ?? "",
      handoutFault({ ...ministry, caption: "صورة أرشيفية" }, { story }) ?? "",
      handoutFault({ ...ministry, credit: "الصورة من وزارة الصحة" }, { story }) ?? "",
      handoutFault({ ...ministry, width: 600 }, { story }) ?? "",
      handoutFault({ ...ministry, credit: "" , caption: "جانب من الاجتماع" }, { story }) ?? "",
    ].map((x) => (x === null ? "ok" : x.split(" ")[0])),
    ["ok", "credited", "the", "«وزارة", "too", "no"],
  );
  const draft = { ...developers, ...story, kind: "news" };
  const sources = [{ sourceNameEn: "CNBC Arabia", sourceName: "سي إن بي سي عربية", title: "مصر تبحث مع فيرتيغلوب", url: "https://www.cnbcarabia.com/158331", photos: [ministry] }];
  const r = await scenario({ draft, sources, photoDir: "C:/site/public/photos/handouts", plan: planFor(), world: {}, judge: () => 1 });
  check(
    "a credited handout comes before every library, kept on the site and credited to the ministry",
    [r.image?.basis, /^\/photos\/handouts\/[0-9a-f]{12}\.jpg$/.test(r.image?.url ?? ""), r.image?.credit, r.image?.foundOn, r.saved.length, r.searched.length, r.calls.includes("planner")],
    ["handout", true, "وزارة البترول المصرية", "https://www.cnbcarabia.com/158331", 1, 0, false],
  );
  const w = await scenario({ draft, sources, photoDir: "C:/site/public/photos/handouts", handout: { news_photo: true, this_story: true, watermark: true, clear: true, caption_ar: "جانب من الاجتماع", credit_ar: "وزارة البترول", reason: "logo" }, plan: planFor(), world: { "construction site Egypt": [dahab] }, judge: pickTitle("Dahab") });
  check("a watermarked handout is refused and the cascade goes on", [w.image?.basis ?? null, w.saved.length, w.calls.includes("planner")], [null, 0, true]);
  const s = await scenario({ draft, sources, handoutWidth: 640, plan: planFor(), world: {}, judge: () => 1 });
  check("a handout under 700 pixels is never looked at", [s.calls.includes("handout"), s.image?.basis ?? null], [false, null]);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. The front page's cover of 2026-10-22 (the owner: "picture choices is still bit poor"): a Barclays branch under the
// bank's job cuts, the Shanghai exchange's tower under a bear market, Morocco's parliament under its growth target, a
// phone of app icons under Meta's $25bn penalty, a Saudia airliner under the Future Investment Initiative's postponement.
{
  check(
    "a branch, an exchange's or a parliament's building and a skyline are building fronts",
    [
      frontOfBuilding({ title: "Barclays Bank, West Kirby.jpg", categories: "Barclays branches in England|Bank buildings in Merseyside" }),
      frontOfBuilding({ title: "Shanghai Stock Exchange 2.jpg", description: "The Shanghai Stock Exchange building in Lujiazui" }),
      frontOfBuilding({ title: "Moroccan Parliament Building.jpg" }),
      frontOfBuilding({ title: "Modern skyscrapers of Shenzhen skyline by the waterfront" }),
    ],
    [true, true, true, true],
  );
  check(
    "a trading floor, a port, a shipyard and a branch line are not",
    [
      frontOfBuilding({ title: "Traders on the floor of the New York Stock Exchange.jpg" }),
      frontOfBuilding({ title: "Porte-conteneurs Maersk Congo Tanger med.jpg", categories: "Port of Tanger Med" }),
      frontOfBuilding({ title: "Ship building at Hyundai Heavy Industries, Ulsan.jpg" }),
      frontOfBuilding({ title: "Train on the Rhymney branch line.jpg" }),
    ],
    [false, false, false, false],
  );
  check(
    "a phone of app icons, a defunct service and a gavel are stock clichés; a product in use is not",
    [
      Boolean(stockFault({ title: "Close-up of hand holding smartphone showing social media apps like Facebook and Instagram." })),
      Boolean(stockFault({ title: "Social Networks", categories: "facebook, instagram, twitter, pinterest" })),
      Boolean(stockFault({ title: "Google+ icon on a phone" })),
      Boolean(stockFault({ title: "Judge's gavel on a desk" })),
      Boolean(stockFault({ title: "Customers try the iPhone 17 at an Apple Store in Dubai.jpg" })),
    ],
    [true, true, true, true, false],
  );
  check(
    "«الدار البيضاء» (Casablanca) is a name, not a painted colour; «جدار أبيض» still paints",
    [captionFlaws("خضراوات معروضة في سوق الجميعة بحي درب السلطان بالدار البيضاء"), captionFlaws("مصنع خلف جدار أبيض")],
    [[], ["أبيض"]],
  );
  check(
    "a story about property may run buildings; «المقرر» (scheduled) is not «المقر» (headquarters)",
    [
      aboutBuildings({ title: "مسودة قانون تلزم المطورين العقاريين بحساب لكل مشروع", tags: ["القطاع العقاري"] }),
      aboutBuildings({ title: "باركليز يلغي 5 آلاف وظيفة مع توسعه في الذكاء الاصطناعي", subtitle: "الوظائف المقرر إلغاؤها", tags: ["باركليز"] }),
    ],
    [true, false],
  );
}
const barclays = {
  ...developers,
  title: "باركليز يلغي 5 آلاف وظيفة مع توسعه في الذكاء الاصطناعي",
  subtitle: "ألغى البنك نحو ألف وظيفة في النصف الأول",
  tags: ["باركليز", "بريطانيا", "الذكاء الاصطناعي"],
  regions: ["أوروبا"],
  section: "companies",
};
const branchFront = file("Barclays Bank, West Kirby.jpg", { categories: "Barclays branches in England" });
const office = file("Staff at work in an open-plan office in London, England.jpg", { categories: "Offices in London" });
// M. The sources' photograph of a branch front is no brief, and no branch front reaches a judge; the search for what the
// story says (office staff) is made and its photograph runs.
{
  const r = await scenario({
    draft: barclays,
    plan: planFor({ queries: ["bank branch England"], place: ["United Kingdom", "England", "London"], message: "Barclays trades office staff for AI", message_queries: ["office staff London"] }),
    sources: [{ ogImage: "https://src.test/photos/branch.jpg", sourceNameEn: "BBC News", title: "Barclays cutting 5,000 jobs" }],
    brief: { photos: [{ n: 1, news: true, shows: "The Barclays name and eagle logo sign on the red-brick facade of a Barclays bank branch in the UK", people: [] }], best: 1, queries: ["Barclays branch sign"] },
    world: { "Barclays branch sign": [branchFront], "bank branch England": [branchFront], "office staff London": [office] },
    judge: (titles) => (titles.length ? 1 : 0),
    verify: () => "GENERIC_OK",
  });
  check("a branch front is no brief and never reaches a judge; office staff at work run", [r.searched.includes("Barclays branch sign"), r.judgePrompts.some((p) => p.includes(branchFront.title)), r.image?.title], [false, false, office.title]);
  check("every judge has the building-front and stock rules", r.judgePrompts.every((p) => p.includes("NO BUILDING FRONTS") && p.includes("NO STOCK CLICHÉS")), true);
  check("the second check no longer calls a company's building GENERIC_OK, and may call a frame AMATEUR or STOCK", [r.verifyPrompts.some((p) => p.includes("the named company's or ministry's building")), r.verifyPrompts.every((p) => p.includes("AMATEUR") && p.includes("STOCK"))], [false, true]);
}
// N. A photograph that only names the topic waits in reserve while the later passes look for one that says the point.
{
  const port = file("Port of Tanger Med container terminal, Morocco.jpg", { categories: "Port of Tanger Med|Ports of Morocco" });
  const souk = file("Shoppers at a vegetable market in Casablanca, Morocco.jpg", { categories: "Markets in Casablanca" });
  const morocco = { ...developers, title: "الحكومة المغربية تستهدف نمواً بمتوسط 5% سنوياً بين 2027 و2031", tags: ["المغرب", "النمو الاقتصادي"], regions: ["مصر والمغرب العربي"] };
  const plan = planFor({ queries: ["vegetable market Morocco"], place: ["Morocco", "Casablanca"], places: ["Tanger Med"], place_queries: ["Tanger Med"], message: "Morocco promises faster growth and more household support", message_queries: ["shoppers market Casablanca"] });
  const world = { "Tanger Med": [port], "shoppers market Casablanca": [souk], "vegetable market Morocco": [souk] };
  const says = await scenario({ draft: morocco, plan, world, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: titles[0] === souk.title }), verify: () => "GENERIC_OK" });
  check("the place's port only names the topic and waits, checked; the market that says the point is searched and runs", [says.image?.title, says.calls.filter((c) => c.startsWith("verify:"))], [souk.title, [`verify:${port.title}`, `verify:${souk.title}`]]);
  check("the second check reads the whole-economy rule the planner and the judge read", [says.verifyPrompts.every((p) => p.includes("economy as a whole") && p.includes("container port")), says.judgePrompts.every((p) => p.includes("economy as a whole"))], [true, true]);
  const none = await scenario({ draft: morocco, plan, world, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: false }), verify: () => "GENERIC_OK" });
  check("when nothing says it, the first photograph of the topic runs, checked once", [none.image?.title, none.calls.filter((c) => c.startsWith("verify:")).length], [port.title, 1]);
  // A held photograph the check refuses brings its companions back: Morocco's dry run lost Tanger Med's port to an amateur
  // market snapshot that was refused only after the port's shortlist had been passed over (2026-10-22).
  const snapshot = file("New market in Tata, Morocco.jpg", { categories: "Markets in Morocco" });
  const back = await scenario({
    draft: morocco,
    plan: { ...plan, places: [], place_queries: [], message_queries: [], queries: ["market port Morocco"] },
    world: { "market port Morocco": [snapshot, port] },
    judge: (titles) => ({ choice: titles.length ? 1 : 0, says: false }),
    verify: (name) => (name.includes("Tata") ? "AMATEUR" : "GENERIC_OK"),
  });
  check("a held photograph the check refuses brings its companions back, and the port runs", back.image?.title, port.title);
  // Every search of a pass is made: Morocco's first two searches filled the pass and «Tanger Med container port», its
  // fourth, was never asked (2026-10-22).
  const stalls = Array.from({ length: 8 }, (_, i) => file(`Olive stall in a market in Marrakesh ${i + 1}.jpg`, { categories: "Markets in Morocco" }));
  const crowd = Array.from({ length: 8 }, (_, i) => file(`Shoppers in a market in Fes ${i + 1}.jpg`, { categories: "Markets in Morocco" }));
  const wide = await scenario({
    draft: morocco,
    plan: { ...plan, places: [], place_queries: [], message_queries: [], queries: ["market stall Morocco", "market shoppers Morocco", "pensioners Morocco", "Tanger Med container port"] },
    world: { "market stall Morocco": stalls, "market shoppers Morocco": crowd, "Tanger Med container port": [port] },
    judge: (titles) => titles.findIndex((t) => t.includes("Tanger")) + 1,
    verify: () => "GENERIC_OK",
  });
  check("every search of a pass is made, and the port it finds can run", [wide.searched.includes("Tanger Med container port"), wide.image?.title], [true, port.title]);
  const noMessage = await scenario({ draft: morocco, plan: { ...plan, message: "" }, world, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: false }), verify: () => "GENERIC_OK" });
  check("with no message from the planner the first fitting photograph runs, as before", noMessage.image?.title, port.title);
}
// O. Meta's penalty: the phone of app icons never reaches a judge, and the story's own people may appear in the search for
// what it says (a chief executive answering for the matter), named to every judge.
{
  const meta = { ...developers, title: "قاضٍ في نيو مكسيكو يلزم «ميتا» بدفع 25 مليار دولار عن مخالفات الخصوصية", tags: ["ميتا", "الولايات المتحدة"], regions: ["الأمريكتان"], section: "companies" };
  const phone = { ...file("Close-up of hand holding smartphone showing social media apps like Facebook and Instagram."), url: "https://images.pexels.com/photos/8488289/phone.jpeg" };
  const hearing = file("CEO Mark Zuckerberg testifies before the Senate, Washington, D.C., 2018.jpg", { categories: "Mark Zuckerberg|United States Senate", date: "2018-04-10" });
  const r = await scenario({
    draft: meta,
    plan: planFor({ queries: ["Facebook app phone"], place: ["United States"], people: ["Mark Zuckerberg", "Raúl Torrez"], focus: "subject", message: "a state court makes Meta pay for misleading users about their data", message_queries: ["Mark Zuckerberg testifies Senate"] }),
    libs: { "Facebook app phone": [phone] },
    world: { "Mark Zuckerberg testifies Senate": [hearing] },
    judge: pickTitle("Zuckerberg"),
    verify: () => "RIGHT",
  });
  check("the phone of app icons is never shown; the chief executive at a hearing on the matter runs", [r.judgePrompts.some((p) => p.includes(phone.title)), r.image?.title], [false, hearing.title]);
  check("the judges and the second check know the story's people", [r.judgePrompts[0]?.includes("Mark Zuckerberg, Raúl Torrez"), r.verifyPrompts[0]?.includes("Mark Zuckerberg, Raúl Torrez")], [true, true]);
}
// P. A story about an event is pictured by an earlier edition of the event, which the generic passes drop as "people and
// banners"; it runs as a file photo.
{
  const fii = { ...developers, title: "السعودية تؤجل مؤتمر مبادرة مستقبل الاستثمار إلى 2027 مع تصاعد هجمات الحوثيين", tags: ["السعودية", "مبادرة مستقبل الاستثمار"], regions: ["الخليج"] };
  const session = file("Opening panel at the 2024 FII conference, Riyadh.jpg", { categories: "Future Investment Initiative|Riyadh", date: "2024-10-29" });
  const r = await scenario({
    draft: fii,
    plan: planFor({ queries: ["investment conference Saudi Arabia"], place: ["Saudi Arabia", "Riyadh"], event: ["Future Investment Initiative", "FII"], event_queries: ["FII Riyadh"], message: "Houthi attacks push Riyadh's investment forum off this year's calendar" }),
    world: { "FII Riyadh": [session], "investment conference Saudi Arabia": [session] },
    judge: pickTitle("FII"),
    verify: () => "RIGHT",
  });
  check("the forum's earlier edition runs, marked as a file photo", [r.image?.title, /2024|أرشيفية/.test(String(r.image?.alt ?? ""))], [session.title, true]);
  check("its judge and second check know the story's own event", [r.judgePrompts[0]?.includes("THE STORY'S OWN EVENT"), r.verifyPrompts[0]?.includes("earlier edition of that same event")], [true, true]);
}
// Q. An exchange or a business district is never the story's place; the last resort follows no company to its headquarters.
{
  const csi = { ...developers, title: "المؤشر الرئيسي للأسهم الصينية يدخل السوق الهابطة بخسارة 20% من ذروته", tags: ["الصين", "الأسهم"], regions: ["آسيا"], section: "markets" };
  const r = await scenario({
    draft: csi,
    plan: planFor({ queries: ["stock investors China"], place: ["China", "Shanghai"], places: ["Shanghai Stock Exchange", "Lujiazui financial district"], place_queries: ["Shanghai Stock Exchange", "Lujiazui financial district"] }),
    world: {},
    judge: () => 0,
  });
  check("the exchange's building is not searched as the story's place", r.searched.includes("Shanghai Stock Exchange"), false);
  const b = await scenario({ draft: barclays, plan: planFor({ queries: ["bank office England"] }), world: {}, judge: () => 0, lastResort: { scene: "bank office", country: "United Kingdom", institution: "Barclays", city: "London" } });
  check("the last resort searches no company's headquarters", b.searched.some((q) => /headquarters|building/i.test(q)), false);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
