#!/usr/bin/env node
/**
 * The picture desk, tested on cases whose right answer is known (261 checks), with scripted stand-ins for Claude, Wikimedia Commons,
 * the other libraries and the thumbnails: no model call, no network. Written 2026-09-28 after the owner asked for the
 * image engine to be stress-tested ("it might still be buggy"), so that the cascade's order, its place filter, the
 * repeat guard, its behaviour when a service fails, and the reading of accented names cannot regress unseen. The gate
 * runs it (scripts/gate.mjs).
 *
 *   node scripts/images-selftest.mjs
 */
import { withStandIns, pickImage, standInUnplaced, placedAtHome, neutralQueries, simplerQueries, headlinePeople, headlineCompany, namesCompany, namesBrand, namesPerson, namesAPlace, seriesKey, marketCity, namesHub, hubByCity, recentHubs, storyText, offeredSourcePhotos, placedAbroad, closeUpOfMaterial, creditedBody, handoutFault, fold, frontOfBuilding, stockFault, aboutBuildings, captionFlaws, photoRules, publishedFault, treasuryStory, arabicSearches, sniffImage, noveltyFault, groundedClaimant, stampedSource, officialSourcesFor, officialEventFits, officeOwn, countriesByName, RATE_DECISION, ILLUSTRATIVE } from "../pipeline/lib/images.mjs";
import { parseKremlinList, parseKremlinPhotos, parseWhiteHouseList, parseWhiteHousePhotos, englishDate, kanteiActionsPath, parseKanteiList, parseKanteiPhotos, parsePmIndiaGallery, parseEcReportages, parseEcPhotos, parseRssItems, parseCasaRosadaPhotos, parseFlickrFeed, flickrLicence, withEnglishCountries, OFFICIAL_SOURCES, HELD_SOURCES } from "../pipeline/lib/official-photos.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { photoKey, sharedPhotos } from "../pipeline/lib/photo-key.mjs";
import { BAD_TITLE, badTitle, cleanArtist, creditName, attributionLine, searchCommons } from "../pipeline/lib/commons.mjs";

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
const egyptStory = { title: "مسودة قانون مصرية تلزم المطورين العقاريين بحساب لكل مشروع", tags: ["مصر", "القطاع العقاري"], regions: ["مصر"] };
check("a file from Cairo, Illinois is abroad for an Egyptian story", placedAbroad({ title: "Old Cairo Junior High School, Cairo, Illinois.jpg" }, egyptStory), "United States");
check("«Cairo, IL» and «Alexandria, Virginia» are American", [placedAbroad({ title: "Old Cairo Junior High School, Pine Street, Cairo, IL.jpg" }, egyptStory), placedAbroad({ title: "Alexandria, Virginia waterfront.jpg" }, egyptStory)], ["United States", "United States"]);
check("Egypt's own Cairo and Alexandria stay home", [placedAbroad({ title: "Cairo Tower, Cairo, Egypt.jpg" }, egyptStory), placedAbroad({ title: "Corniche of Alexandria.jpg" }, egyptStory)], [null, null]);
check("«Tbilisi, Georgia» is not read as an American state", placedAbroad({ title: "Tbilisi, Georgia old town.jpg" }, egyptStory), null);
// The regions whose press joined on 2026-11-19: a Kazakh story refuses Tashkent and keeps Almaty, a Philippine one
// refuses Bangkok (the old lists knew none of these countries, so no photograph was ever placed abroad for them).
{
  const kazakh = { title: "المركزي الكازاخستاني يرفع الفائدة إلى 18%", tags: ["كازاخستان"], regions: ["آسيا"] };
  const philippine = { title: "الفلبين ترفع الفائدة للمرة الثانية", tags: ["الفلبين"], regions: ["آسيا"] };
  check("Central and Southeast Asia's countries place a photograph", [
    placedAbroad({ title: "Tashkent City business district.jpg" }, kazakh), placedAbroad({ title: "Almaty financial centre.jpg" }, kazakh),
    placedAbroad({ title: "Bangkok stock exchange building.jpg" }, philippine),
  ], ["Uzbekistan", null, "Thailand"]);
  const kenyan = { title: "المركزي الكيني يثبت الفائدة", tags: ["كينيا"], regions: ["أفريقيا"] };
  check("a Kenyan story keeps Nairobi and refuses Accra", [placedAbroad({ title: "Nairobi central business district.jpg" }, kenyan), placedAbroad({ title: "Accra Makola market.jpg" }, kenyan)], [null, "Ghana"]);
  const mozambican = { title: "موزمبيق تعدل موازنتها", tags: ["موزمبيق"], regions: ["أفريقيا"] };
  check("a Mozambican story keeps Maputo and refuses Harare; Hong Kong is China's", [placedAbroad({ title: "Maputo port.jpg" }, mozambican), placedAbroad({ title: "Harare street.jpg" }, mozambican), placedAbroad({ title: "Hong Kong skyline.jpg" }, { title: "أسهم هونغ كونغ تتراجع", tags: ["هونغ كونغ"] })], [null, "Zimbabwe", null]);
  check("a Taiwanese story keeps Taipei and refuses Shanghai; a Bangladeshi one refuses Colombo", [placedAbroad({ title: "Taipei 101 and Xinyi district.jpg" }, { title: "صادرات تايوان تقفز", tags: ["تايوان"] }), placedAbroad({ title: "Shanghai port.jpg" }, { title: "صادرات تايوان تقفز", tags: ["تايوان"] }), placedAbroad({ title: "Colombo port.jpg" }, { title: "صادرات الملابس البنغلاديشية", tags: ["بنغلاديش"] })], [null, "China", "Sri Lanka"]);
  // 2026-11-21: the Balkans' and Somalia's own press joined the sources.
  const greek = { title: "اليونان تبيع سندات لأجل 10 سنوات", tags: ["اليونان"], regions: ["أوروبا"] };
  check("a Greek story keeps Piraeus and refuses Bucharest and a Serbian market; a Somali one keeps Mogadishu", [
    placedAbroad({ title: "Piraeus container terminal.jpg" }, greek), placedAbroad({ title: "Bucharest Victoria Square.jpg" }, greek),
    placedAbroad({ title: "x.jpg", description: "Serbian farmers market in the morning" }, greek),
    placedAbroad({ title: "Mogadishu port.jpg" }, { title: "الصومال تطرد سفير الإمارات", tags: ["الصومال"] }),
  ], [null, "Romania", "Serbia", null]);
  // 2026-11-23: Portugal's own press joined the sources, and Azerbaijan's beside Armenia.
  const portuguese = { title: "البرلمان البرتغالي يقر موازنة 2027", tags: ["البرتغال"], regions: ["أوروبا"] };
  check("a Portuguese story keeps Lisbon and refuses Madrid and a Spanish market; an Azerbaijani one refuses Yerevan", [
    placedAbroad({ title: "Lisbon Praça do Comércio.jpg" }, portuguese), placedAbroad({ title: "Madrid Gran Vía.jpg" }, portuguese),
    placedAbroad({ title: "x.jpg", description: "Portuguese fish market in the morning" }, portuguese),
    placedAbroad({ title: "Yerevan Republic Square.jpg" }, { title: "أذربيجان تفتح ممر زنغزور", tags: ["أذربيجان"] }),
  ], [null, "Spain", null, "Armenia"]);
  // The same day: Ireland, the Baltic states and the Sahel. Not «Niger» bare: the Niger Delta is Nigeria's.
  const irish = { title: "أيرلندا تسجل فائضاً في الموازنة", tags: ["أيرلندا"], regions: ["أوروبا"] };
  const nigerian = { title: "نيجيريا ترفع إنتاج النفط", tags: ["نيجيريا"], regions: ["أفريقيا"] };
  check("an Irish story keeps Dublin and refuses Riga; a Nigerian one keeps the Niger Delta; a Malian one refuses Ouagadougou", [
    placedAbroad({ title: "Dublin Docklands.jpg" }, irish), placedAbroad({ title: "Riga old town.jpg" }, irish),
    placedAbroad({ title: "Oil field in the Niger Delta.jpg" }, nigerian),
    placedAbroad({ title: "Ouagadougou central market.jpg" }, { title: "مالي تعلق تصاريح الذهب", tags: ["باماكو"] }),
  ], [null, "Latvia", null, "Burkina Faso"]);
}
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
async function scenario({ draft, world = {}, categoryWorld = {}, libs = {}, plan, judge, verify = () => "RIGHT", brief = null, byText = null, sources = [], exclude = new Set(), lastResort = { scene: null, country: null, institution: null, city: null }, handout = null, handoutWidth = 975, photoDir = null, recentHubs = [], official = {} }) {
  const searched = [];
  const calls = [];
  const judgePrompts = [];
  const verifyPrompts = [];
  const plannerPrompts = [];
  const inlined = [];
  const saved = [];
  const officialReads = [];
  const restore = withStandIns({
    // A head of state's office's pages (officialPhoto()): what each address answers, null for any other.
    officialRead: async (url) => (officialReads.push(url), official[url] ?? null),
    fetchHandout: async (url) => ({ width: handoutWidth, height: 557, savedWidth: Math.min(handoutWidth, 1280), savedHeight: 557, buffer: Buffer.from("x"), preview: "data:image/jpeg;base64,AAAA", url }),
    saveHandout: async (got, file) => { saved.push(file); },
    searchCommons: async (query) => {
      searched.push(query);
      return (world[query] ?? []).map((f) => ({ ...f }));
    },
    searchCommonsCategory: async (name) => {
      searched.push(`category:${name}`);
      return (categoryWorld[name] ?? []).map((f) => ({ ...f }));
    },
    searchLibraries: async (query) => (libs[query] ?? []).map((f) => ({ library: "pexels", ...f })),
    inlineImage: async (url) => {
      inlined.push(url);
      return "data:image/jpeg;base64,AAAA";
    },
    noteUse: async () => {},
    // The stories published with a city's business district (hubRationed()); never the real articles on disk.
    recentHubs: async () => recentHubs,
    chat: async (opts) => {
      const { system = "", user = "", role } = opts;
      let data;
      if (system.includes("choosing stock photographs")) {
        calls.push("planner");
        plannerPrompts.push(user);
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
  // What the desk reports to a caller that remembers searches (pickImage's `onError`).
  const errors = [];
  try {
    // IMAGES_SELFTEST_LOG=1 prints the desk's own log for every case.
    const log = process.env.IMAGES_SELFTEST_LOG ? (line) => console.log(`      ${line}`) : () => {};
    const image = await pickImage({ draft, story: { angle: "" }, log, exclude, sources, photoDir, onError: (error) => errors.push(error) });
    return { image, searched, calls, inlined, judgePrompts, verifyPrompts, plannerPrompts, saved, errors, officialReads };
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
  regions: ["مصر"],
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
// G2. The neutral pass looks at the stock libraries first, three looks: Saudi output's return to pre-war levels ran as
// text with 32 Pexels oil photographs unseen behind Commons' place-bound files (2026-11-11).
{
  const commons = Array.from({ length: 12 }, (_, i) => file(`Construction site snapshot ${i + 1}.jpg`, { categories: "Construction" }));
  const stock = Array.from({ length: 7 }, (_, i) => file(`Construction site stock frame ${i + 1}.jpg`, { description: "A construction site with cranes" }));
  const r = await scenario({
    draft: developers,
    plan: planFor({ queries: ["construction site Egypt"], places: [], place_queries: [] }),
    world: { "construction site Egypt": [], "construction site": commons },
    libs: { "construction site": stock },
    judge: (titles, prompt) => (prompt.includes("LAST PASS") ? titles.findIndex((t) => t.includes("stock frame 7")) + 1 : 0),
    verify: (name, prompt) => (prompt.includes("LAST-PASS") ? "GENERIC_OK" : "WRONG_SUBJECT"),
  });
  const first = r.judgePrompts.find((p) => p.includes("LAST PASS"));
  check("the neutral pass shows the stock libraries' frames first, over three looks", [r.image?.title, titlesIn(first ?? "").filter((t) => t.includes("stock frame")).length], [stock[6].title, 3]);
}
// G3. A pass's later searches read the libraries' answers too, however many files Commons had: Pexels' «oil field»
// photographs were fetched and thrown away because it was the pass's fifth search and Commons had ten (2026-11-11).
{
  const snaps = Array.from({ length: 6 }, (_, i) => file(`Cement mixer snapshot ${i + 1}.jpg`, { categories: "Construction" }));
  const frame = file("Cement mixer stock frame.jpg", { description: "A cement mixer at work" });
  const r = await scenario({
    draft: developers,
    plan: planFor({ queries: ["construction site Egypt", "building crane Egypt", "cement mixer Egypt"], places: [], place_queries: [] }),
    world: { "cement mixer": snaps },
    libs: { "cement mixer": [frame] },
    judge: (titles, prompt) => (prompt.includes("LAST PASS") ? titles.findIndex((t) => t.includes("stock frame")) + 1 : 0),
    verify: (name, prompt) => (prompt.includes("LAST-PASS") ? "GENERIC_OK" : "WRONG_SUBJECT"),
  });
  check("a pass's third search still reads the libraries' answer when Commons had five files or more", r.image?.title, frame.title);
}
// G4. The stand-in for an incident (the owner, 2026-11-12, on a night container port with an «LNG» tanker under the attack
// on an unidentified ADNOC vessel: "confusing and not really suitable").
{
  const adnoc = { title: "سفينة تابعة لأدنوك تتضرر في هجوم داخل المياه الإقليمية الإماراتية", subtitle: "", lede: "أكدت الشركة أن إحدى سفنها تضررت.", body: "فقرة.", tags: ["الإمارات", "الشحن البحري"], regions: ["الخليج"], kind: "news", section: "energy", imageQueries: [] };
  const unplaced = { title: "Vibrant night view of a cargo port with ships and cranes", description: "", categories: "" };
  check(
    "a stand-in whose record places it nowhere is one; a file placed at home, the company's own, or under a world story is not",
    [standInUnplaced(unplaced, adnoc), standInUnplaced({ title: "Oil tanker off Fujairah, United Arab Emirates.jpg" }, adnoc), standInUnplaced(unplaced, { ...adnoc, regions: ["عالمي"] }), standInUnplaced({ title: "Port of Rotterdam tanker.jpg" }, adnoc)],
    [true, false, false, true],
  );
  check(
    "an illustration is never searched by the incident: «damaged oil tanker» is «oil tanker», and the plain thing at sea is kept",
    neutralQueries(["damaged oil tanker", "burning tanker Gulf of Oman", "tanker attack", "tanker ship at sea", "oil tanker UAE"], ["UAE", "Gulf of Oman"]),
    ["oil tanker", "tanker ship sea"],
  );
  const night = file("Tanker at an oil terminal at night, Egypt.jpg", { categories: "Ports of Egypt" });
  const day = file("Tanker at an oil terminal, Egypt.jpg", { categories: "Ports of Egypt" });
  const stock = file("Oil tanker under way.jpg", { description: "An oil tanker at sea" });
  const egypt = { ...developers, title: "مصر ترفع صادراتها من النفط الخام", subtitle: "", tags: ["مصر", "النفط"] };
  const placed = await scenario({ draft: egypt, plan: planFor({ queries: ["oil terminal tanker Egypt"], places: [], place_queries: [] }), world: { "oil terminal tanker Egypt": [night, day] }, judge: (titles) => (titles.length ? 1 : 0), verify: () => "GENERIC_OK" });
  check("a record that calls itself a night view comes after the daylight frame, and a stand-in placed at home keeps its plain caption", [titlesIn(placed.judgePrompts[0])[0], placed.image?.title, String(placed.image?.alt ?? "").includes(ILLUSTRATIVE)], [day.title, day.title, false]);
  const loose = await scenario({ draft: egypt, plan: planFor({ queries: ["oil tanker"], places: [], place_queries: [] }), world: { "oil tanker": [stock] }, judge: (titles) => (titles.length ? 1 : 0), verify: () => "GENERIC_OK" });
  check("a stand-in no record places in the story's country runs as «صورة تعبيرية»", [loose.image?.title, String(loose.image?.alt ?? "").includes(ILLUSTRATIVE)], [stock.title, true]);
  check(
    "every judge and the check are told: daylight, and no stand-in of a kind the story does not state",
    [placed.judgePrompts.every((p) => p.includes("DAYLIGHT.") && p.includes("A KIND THE STORY DOES NOT STATE")), placed.verifyPrompts.every((p) => p.includes("lights and their glare") && p.includes("plainly of one particular kind"))],
    [true, true],
  );
}
// G5. A country's own markets (the owner, 2026-11-15, on generic vegetables under Saudi inflation: "there are no saudi
// markets pictures?"). They existed; the search lost them twice before any judge looked.
{
  check(
    "a search that finds nothing keeps its place and gives up its modifier; its one-word form is a site's own name, never a noun, a country or a sea",
    [simplerQueries("food market Saudi Arabia"), simplerQueries("Riyadh grocery market"), simplerQueries("Yanbu oil tanker Red Sea"), simplerQueries("petrochemical plant Jubail"), simplerQueries("Sharara oilfield"), simplerQueries("Egyptian pound banknotes"), simplerQueries("construction site Egypt")],
    [["market Saudi Arabia", "food market"], ["market Riyadh", "Riyadh grocery"], ["tanker Yanbu Red Sea", "Yanbu oil"], ["plant Jubail", "petrochemical plant", "Jubail"], ["Sharara"], ["banknotes Egyptian", "Egyptian pound"], ["site Egypt", "construction site"]],
  );
  const saudi = { title: "التضخم السعودي يتباطأ إلى أدنى مستوى في 6 أشهر عند 1.7%", subtitle: "مع تباطؤ أسعار الأغذية والإيجارات", lede: "تباطأ التضخم السنوي في السعودية.", body: "فقرة.", tags: ["السعودية", "التضخم"], regions: ["الخليج"], kind: "news", section: "economy", imageQueries: [] };
  const home = file("Vegetable market and its shoppers, Jeddah, Saudi Arabia.jpg", { categories: "Jeddah" });
  const dublin = file("Moore Street food market.jpg", { categories: "Markets in Dublin" });
  const fallback = await scenario({
    draft: saudi,
    plan: planFor({ queries: ["food market Saudi Arabia"], place: ["Saudi Arabia", "Riyadh", "Jeddah"], places: [], place_queries: [] }),
    world: { "market Saudi Arabia": [home], "food market": [dublin] },
    judge: (titles) => (titles.length ? 1 : 0),
    verify: () => "GENERIC_OK",
  });
  check("an empty search is asked again with the country kept, before the world's", [fallback.image?.title, fallback.searched.includes("market Saudi Arabia"), fallback.searched.includes("food market")], [home.title, true, false]);
  // The category the planner names holds ten photographs; the one of the story's subject is its oldest upload.
  const walls = Array.from({ length: 9 }, (_, i) => file(`Old town gate ${i + 1}, Hofuf, Saudi Arabia.jpg`, { categories: "Markets in Saudi Arabia", date: "2024-03-01" }));
  const fruit = file("Fruit and vegetable market with shoppers, Taif, Saudi Arabia.jpg", { categories: "Markets in Saudi Arabia", date: "2015-03-22" });
  const browsed = await scenario({
    draft: saudi,
    plan: planFor({ queries: ["vegetable market Saudi Arabia"], place: ["Saudi Arabia", "Riyadh"], places: ["Batha"], place_queries: ["Batha"], categories: ["Markets in Saudi Arabia"] }),
    categoryWorld: { "Markets in Saudi Arabia": [...walls, fruit] },
    judge: (titles) => titles.findIndex((t) => t.includes("Fruit and vegetable market")) + 1,
    verify: () => "RIGHT",
  });
  check("a browsed category gives the judges the files of the story's subject, however old their upload", browsed.image?.title, fruit.title);
  check(
    "the place tier's judge is told the browsed categories are the story's place for a national figure, and to choose the clearest snapshot over none",
    [browsed.judgePrompts[0].includes("under the categories this desk opened for the story (Markets in Saudi Arabia)"), browsed.judgePrompts.every((p) => p.includes("never none in the hope of a later search"))],
    [true, true],
  );
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
  // A search a failed model call cut short is reported, never taken for "nothing fits": the morning round remembered such
  // a story as searched in full and never searched it again (a review of 2026-11-01). A search that ran to the end and
  // found nothing reports nothing, and neither does a failure on the way to a photo.
  check("a failed planner's empty search is reported to the caller", none.errors.length, 1);
  const judged = await scenario({ draft: developers, plan: planFor({ queries: ["construction site Egypt"], places: [], place_queries: [] }), world: { "construction site Egypt": [dahab], "construction site": [dahab] }, judge: "throw", byText: () => 0 });
  check("a failed judge's empty search is reported too", [judged.image, judged.errors.length > 0], [null, true]);
  const searchedAll = await scenario({ draft: developers, plan: planFor({ queries: ["construction site Egypt"], places: [], place_queries: [] }), world: { "construction site Egypt": [dahab], "construction site": [dahab] }, judge: () => 0 });
  check("a search that ran to the end and found nothing reports no failure", [searchedAll.image, searchedAll.errors.length], [null, 0]);
  check("a failed planner whose story still found a photo reports no failure", r.errors.length, 0);
}
// I. A person with accents in her name is the news: she is searched, found and chosen.
{
  const kaya = file("Fatma Betül Sayan Kaya in 2025.jpg", { date: "2025-03-01" });
  const r = await scenario({
    draft: { ...developers, title: "نائبة رئيس حزب العدالة والتنمية التركي تستقيل مع اتساع أزمة الصناديق", tags: ["تركيا"], regions: ["الشرق الأوسط"] },
    plan: planFor({ queries: ["Borsa Istanbul trading floor"], place: ["Turkey", "Istanbul"], people: [{ name: "Fatma Betül Sayan Kaya", ar: "فاطمة بتول صايان قايا", headline: "نائبة رئيس حزب العدالة والتنمية التركي" }], focus: "people" }),
    world: { "Fatma Betül Sayan Kaya 2026": [], "Fatma Betül Sayan Kaya": [kaya] },
    judge: pickTitle("Kaya"),
    verify: () => "RIGHT",
  });
  check("an accented name survives the planner and her photo is chosen", r.image?.title, kaya.title);
}
// I2. A surname alone is not the person (2026-10-30): «Lorie Logan» of the Dallas Fed brought the town of Logan, West
// Virginia, through the Arabic search shortened to «لوغان», and a diorama whose record names a Lorie Shaull and Logan.
{
  const town = file("Logan-downtown-from-hospital-wv.jpg", { date: "2018-05-01", description: "مدينة لوغان، فيرجينيا الغربية" });
  const diorama = file("Nutshell Studies of Unexplained Death, Blue Bedroom diorama.jpg", { date: "2024-05-01", description: "Photographed by Lorie Shaull, Logan collection" });
  const her = file("Dallas Fed President Lorie K. Logan speaks, 2025.jpg", { date: "2025-04-01" });
  const r = await scenario({
    draft: { ...developers, title: "رئيسة فيدرالي دالاس لوري لوغان ترى حاجة إلى رفع الفائدة", tags: ["الفيدرالي الأمريكي"], regions: ["أمريكا الشمالية"] },
    plan: planFor({ queries: [], place: ["United States"], people: [{ name: "Lorie Logan", ar: "لوري لوغان", headline: "لوري لوغان" }], focus: "people" }),
    world: { "Lorie Logan 2026": [diorama], "Lorie Logan": [her, diorama], "لوري لوغان": [], "لوغان": [town] },
    judge: (titles) => titles.findIndex((t) => t.includes("Lorie K. Logan")) + 1,
    verify: () => "RIGHT",
  });
  check("a person's search is never cut to the surname, and a file naming only the surname never reaches the judge", [r.searched.includes("لوغان"), r.judgePrompts.some((p) => p.includes("Nutshell") || p.includes("Logan-downtown")), r.image?.title], [false, false, her.title]);
  check("a name with an initial, and a rank with the surname, name the person; the surname or the first name elsewhere does not", [namesPerson(fold("Dallas Fed President Lorie K. Logan"), "Lorie Logan"), namesPerson(fold("secretary kerry poses"), "John Kerry", [["kerry", "poses"]]), namesPerson(fold("Logan, West Virginia"), "Lorie Logan"), namesPerson(fold("Photographed by Lorie Shaull, Logan collection"), "Lorie Logan"), namesPerson(fold("ناجي عيسى مع جيرمي برنت"), "ناجي محمد عيسى")], [true, true, false, false, true]);
}
// J. «Erdogan» in a file name is Erdoğan; a file that pairs him with someone else is not taken for another man alone.
{
  const ascii = file("President Recep Tayyip Erdogan speaks in Ankara, 2025.jpg", { date: "2025-06-01" });
  const withOther = file("President Erdoğan meets Chancellor Scholz, 2025.jpg", { date: "2025-06-01" });
  const r = await scenario({
    draft: { ...developers, title: "أردوغان يعلن حزمة لدعم الليرة التركية", tags: ["تركيا"], regions: ["الشرق الأوسط"] },
    plan: planFor({ queries: [], place: ["Turkey"], people: [{ name: "Recep Tayyip Erdoğan", ar: "رجب طيب أردوغان", headline: "أردوغان" }], focus: "people" }),
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
    searchCommonsCategory: async () => {
      throw new Error("ECONNRESET");
    },
    searchLibraries: async () => {
      throw new Error("429 Too Many Requests");
    },
    inlineImage: async () => null,
    noteUse: async () => {},
    recentHubs: async () => [],
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
    plan: planFor({ queries: [], place: ["United States"], people: [{ name: "Donald Trump", ar: "دونالد ترامب", headline: "ترامب" }], focus: "people", places: [], place_queries: [] }),
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
      creditedBody({ caption: "وزير البترول يتفقد بدء أعمال الحفر بحقل «نرجس» للغاز بالبحر المتوسط (وزارة البترول)" }),
    ],
    ["وزارة البترول المصرية", "Egypt's Petroleum Ministry", "ADNOC", "", "وزارة البترول"],
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
      handoutFault({ ...ministry, credit: "", caption: "جانب من اجتماع وزير البترول (وزارة البترول)" }, { story }),
      handoutFault({ ...ministry, credit: "", caption: "ناقلة غاز طبيعي مسال تمر على طول ساحل سنغافورة (رويترز)" }, { story }) ?? "",
      handoutFault({ ...ministry, credit: "", caption: "مقر الوزارة (أرشيفية)" }, { story }) ?? "",
      handoutFault({ ...ministry, credit: "", caption: "جانب من الاجتماع (الشرق الأوسط)" }, { story, source: { sourceName: "الشرق الأوسط" } }) ?? "",
    ].map((x) => (x === null ? "ok" : x.split(" ")[0])),
    ["ok", "credited", "the", "«وزارة", "too", "no", "ok", "credited", "the", "credited"],
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
  // A company's office towers from its press kit are a building's front (2PointZero, 2026-10-30).
  const f = await scenario({ draft, sources, photoDir: "C:/site/public/photos/handouts", handout: { news_photo: true, this_story: true, watermark: false, clear: true, front: true, caption_ar: "مقر الشركة", credit_ar: "الشركة", reason: "towers" }, plan: planFor(), world: { "construction site Egypt": [dahab] }, judge: pickTitle("Dahab") });
  check("a handout of a building's front is refused and the cascade goes on", [f.image?.basis ?? null, f.saved.length, f.calls.includes("planner")], [null, 0, true]);
  const s = await scenario({ draft, sources, handoutWidth: 640, plan: planFor(), world: {}, judge: () => 1 });
  check("a handout under 700 pixels is never looked at", [s.calls.includes("handout"), s.image?.basis ?? null], [false, null]);
  // One another story runs is passed over and the next one is read (a review of 2026-11-01: the tier chose the first,
  // the cascade then found it taken, and the story ran as text with the second never tried).
  const second = { ...ministry, url: "https://cdn.test/meeting-2.jpeg" };
  const kept = (url) => `/photos/handouts/${createHash("sha1").update(url).digest("hex").slice(0, 12)}.jpg`;
  const d = await scenario({ draft, sources: [{ ...sources[0], photos: [ministry, second] }], photoDir: "C:/site/public/photos/handouts", exclude: new Set([kept(ministry.url)]), plan: planFor(), world: {}, judge: () => 0 });
  check("a handout another story runs is passed over and the next one taken", [d.image?.basis ?? null, d.image?.url ?? null], ["handout", kept(second.url)]);
}

// A file one search drops for naming too little of it is still read by the next search of the pass (a review of
// 2026-11-01: a tanker dropped by a refinery search was skipped under "oil tanker", where it fits).
{
  const saudiOil = { ...developers, title: "صادرات النفط السعودية ترتفع في أكتوبر", subtitle: "", lede: "ارتفعت صادرات النفط السعودية.", body: "فقرة من المتن.", tags: ["السعودية", "النفط"], regions: ["الخليج"] };
  const tanker = file("Oil tanker at sea.jpg", { categories: "Oil tankers" });
  const r = await scenario({ draft: saudiOil, plan: planFor({ queries: ["crude refinery pipeline", "oil tanker"], place: ["Saudi Arabia"] }), world: { "crude refinery pipeline": [tanker], "oil tanker": [tanker] }, judge: pickTitle("tanker") });
  check("a file one search drops is still read by the next", r.image?.title ?? null, tanker.title);
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
    "a Panoramio file is not a panorama; a panorama still is",
    [
      frontOfBuilding({ title: "Oil pipe lines in saudi Arabia - panoramio.jpg" }),
      frontOfBuilding({ title: "Total satorp refinery flare - panoramio.jpg" }),
      frontOfBuilding({ title: "Hoboken Terminal June 2015 panorama 2.jpg" }),
      frontOfBuilding({ title: "Panoramic view of Doha.jpg" }),
    ],
    [false, false, true, true],
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
  const morocco = { ...developers, title: "الحكومة المغربية تستهدف نمواً بمتوسط 5% سنوياً بين 2027 و2031", tags: ["المغرب", "النمو الاقتصادي"], regions: ["المغرب العربي"] };
  const plan = planFor({ queries: ["vegetable market Morocco"], place: ["Morocco", "Casablanca"], places: ["Tanger Med"], place_queries: ["Tanger Med"], message: "Morocco promises faster growth and more household support", message_queries: ["shoppers market Casablanca"] });
  const world = { "Tanger Med": [port], "shoppers market Casablanca": [souk], "vegetable market Morocco": [souk] };
  const says = await scenario({ draft: morocco, plan, world, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: titles[0] === souk.title }), verify: () => "GENERIC_OK" });
  check("the place's port only names the topic and waits, checked; the market that says the point is searched and runs", [says.image?.title, says.calls.filter((c) => c.startsWith("verify:"))], [souk.title, [`verify:${port.title}`, `verify:${souk.title}`]]);
  check("the second check reads the whole-economy rule the planner and the judge read", [says.verifyPrompts.every((p) => p.includes("economy as a whole") && p.includes("container port")), says.judgePrompts.every((p) => p.includes("economy as a whole"))], [true, true]);
  const none = await scenario({ draft: morocco, plan, world, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: false }), verify: () => "GENERIC_OK" });
  check("when nothing says it, the first photograph of the topic runs, checked once", [none.image?.title, none.calls.filter((c) => c.startsWith("verify:")).length], [port.title, 1]);
  // One found after it is no longer thrown away unseen (the Bank of Japan's market street, held from the first pass, beat
  // the governor's 2026 photograph found later, 2026-10-30): the two are compared at the end, and the better runs, checked.
  const compared = await scenario({
    draft: morocco,
    plan,
    world,
    judge: (titles, prompt) => (prompt.includes("Photograph 1 is the one held so far") ? { choice: titles.indexOf(souk.title) + 1, says: false } : { choice: titles.length ? 1 : 0, says: false }),
    verify: () => "GENERIC_OK",
  });
  check(
    "a photograph of the topic found after the one held is compared with it at the end, and runs when it is better",
    [compared.image?.title, compared.calls.filter((c) => c.startsWith("verify:")), compared.judgePrompts.filter((p) => p.includes("Photograph 1 is the one held so far")).length],
    [souk.title, [`verify:${port.title}`, `verify:${souk.title}`], 1],
  );
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
  // The owner, 2026-11-09, on Dukan Dam under the drone attack on the Khor Mor gas field: "why not choose صورة تعبيرية of
  // other gas fields?". No free photograph of Khor Mor exists; the desk held the dam, a site the story names only as the
  // ministry's stopgap, and the illustration pass came after a held photograph and never ran. An illustration of the
  // story's own subject is now set beside the one held, and the comparison may choose it.
  {
    const dam = file("Dukan Dam, Sulaymaniyah, Iraqi Kurdistan.jpg", { categories: "Dukan Dam|Dams in Iraq" });
    const plant = file("Gas field processing plant at Kimanis, Sabah, Malaysia.jpg", { categories: "Gas plants in Malaysia" });
    const kurdistan = { ...developers, title: "كردستان العراق تفقد بين 2500 و2800 ميغاواط بعد هجوم على حقل كورمور للغاز", subtitle: "الوزارة تعتزم تشغيل محطتي دوكان ودربنديخان الكهرومائيتين", tags: ["العراق", "إقليم كردستان", "الغاز الطبيعي"], regions: ["المشرق وإيران وتركيا"], section: "energy" };
    const plan = planFor({ queries: ["gas field Kurdistan"], place: ["Iraq", "Kurdistan"], places: ["Dukan Dam"], place_queries: ["Dukan Dam"], message: "One drone strike on the Khor Mor gas field cut off most of Kurdistan's electricity" });
    const world = { "Dukan Dam": [dam], "gas field": [plant] };
    // The check took the dam for the story's own site (RIGHT), as the real one did; the illustration it checks is a
    // stand-in of the sector (GENERIC_OK).
    const asReal = (name) => (name.includes("Dukan") ? "RIGHT" : "GENERIC_OK");
    const drawn = await scenario({
      draft: kurdistan,
      plan,
      world,
      judge: (titles, prompt) => (prompt.includes("Photograph 1 is the one held so far") ? { choice: titles.indexOf(plant.title) + 1, says: false } : { choice: titles.length ? 1 : 0, says: false }),
      verify: asReal,
    });
    const comparison = drawn.judgePrompts.find((p) => p.includes("Photograph 1 is the one held so far")) ?? "";
    check(
      "an illustration of the story's own subject is set beside the photograph held, and runs, marked, when the comparison prefers it",
      [drawn.image?.title, drawn.image?.alt?.includes(ILLUSTRATIVE), drawn.calls.includes("judge-neutral"), /Photograph 2 would run as an illustration/.test(comparison), drawn.calls.filter((c) => c.startsWith("verify:"))],
      [plant.title, true, true, true, [`verify:${dam.title}`, `verify:${plant.title}`]],
    );
    const kept = await scenario({ draft: kurdistan, plan, world, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: false }), verify: asReal });
    check("the photograph held still runs when the comparison keeps it", [kept.image?.title, kept.image?.alt?.includes(ILLUSTRATIVE)], [dam.title, false]);
    check(
      "the planner, every judge and the second check are told a site named only as the response is not the story's",
      [drawn.judgePrompts.every((p) => p.includes("names only on the side")), drawn.verifyPrompts.every((p) => p.includes("names only on the side"))],
      [true, true],
    );
    // A stand-in of the story's own sector held (GENERIC_OK) is never set beside another from elsewhere: the analysis of
    // Saudi ports of 9 November swapped its anonymous container port for a Maersk ship photographed in Slovenia, which the
    // check had refused forty seconds before, captioned «سفينة حاويات تابعة لشركة ميرسك» (2026-11-10).
    const cranes = file("Container cranes at a bustling port during sunset.jpg", { categories: "Container terminals" });
    const maersk = file("MAERSK HANOI Container Ship (Port Koper SIKOP, 2023).jpg", { categories: "Port of Koper|Maersk Line" });
    const ports = { ...developers, title: "مكاسب الموانئ السعودية من تحويل الشحن مرتبطة باستمرار تعطل هرمز", subtitle: "", tags: ["السعودية", "الموانئ"], regions: ["الخليج"], section: "economy", kind: "analysis" };
    const standIn = await scenario({
      draft: ports,
      plan: planFor({ queries: ["container port Saudi Arabia"], place: ["Saudi Arabia"], places: [], place_queries: [], message: "Saudi Red Sea ports are busy with rerouted cargo" }),
      world: { "container port Saudi Arabia": [cranes], "container port": [maersk] },
      judge: (titles, prompt) => (prompt.includes("Photograph 1 is the one held so far") ? { choice: titles.indexOf(maersk.title) + 1, says: false } : { choice: titles.length ? 1 : 0, says: false }),
      verify: () => "GENERIC_OK",
    });
    check("a stand-in of the story's own sector held is never set beside an illustration from elsewhere", [standIn.image?.title, standIn.calls.includes("judge-neutral")], [cranes.title, false]);
    check(
      "an illustration's caption names no company, and the check refuses one that does",
      drawn.verifyPrompts.filter((p) => p.includes("LAST PASS") || /would run as an illustration/.test(p)).every((p) => p.includes("operator, owner, airline or company")) && drawn.verifyPrompts.some((p) => p.includes("operator, owner, airline or company the story does not name")),
      true,
    );
    // The illustration's search can bring back the photograph held itself, at its own address or as its Flickr copy; the
    // comparison maps its choice back by address, read "keep the one held" as the illustration, and ran the story's own
    // photograph captioned «صورة تعبيرية» (a review of 2026-11-10).
    const field = file("Khor Mor gas field, Iraqi Kurdistan (52345678901).jpg", { categories: "Khor Mor gas field|Natural gas fields in Iraq" });
    const fieldOnFlickr = { ...file("Khor Mor gas field"), url: "https://live.staticflickr.com/65535/52345678901_0a1b2c3d4e_b.jpg", library: "flickr", pageUrl: "https://www.flickr.com/photos/tester/52345678901" };
    const ownField = planFor({ queries: ["gas field Kurdistan"], place: ["Iraq", "Kurdistan"], places: ["Khor Mor gas field"], place_queries: ["Khor Mor gas field"], message: "One drone strike on the Khor Mor gas field cut off most of Kurdistan's electricity" });
    const asField = (name) => (name.includes("Khor Mor") ? "RIGHT" : "GENERIC_OK");
    const sameAddress = await scenario({ draft: kurdistan, plan: ownField, world: { "Khor Mor gas field": [field], "gas field": [field] }, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: false }), verify: asField });
    const flickrCopy = await scenario({
      draft: kurdistan,
      plan: ownField,
      world: { "Khor Mor gas field": [field] },
      libs: { "gas field": [fieldOnFlickr] },
      judge: (titles, prompt) => ({ choice: prompt.includes("Photograph 1 is the one held so far") ? 2 : titles.length ? 1 : 0, says: false }),
      verify: asField,
    });
    check(
      "the illustration's search never brings back the photograph held, under any address",
      [sameAddress.image?.title, sameAddress.image?.alt?.includes(ILLUSTRATIVE), sameAddress.calls.filter((c) => c.startsWith("verify:")).length, flickrCopy.image?.title, flickrCopy.image?.alt?.includes(ILLUSTRATIVE), flickrCopy.calls.filter((c) => c.startsWith("verify:")).length],
      [field.title, false, 1, field.title, false, 1],
    );
  }
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
    plan: planFor({ queries: ["Facebook app phone"], place: ["United States"], people: [{ name: "Mark Zuckerberg", ar: "مارك زوكربيرغ", headline: "ميتا" }, { name: "Raúl Torrez", ar: "راؤول توريز", headline: "" }], focus: "subject", message: "a state court makes Meta pay for misleading users about their data", message_queries: ["Mark Zuckerberg testifies Senate"] }),
    libs: { "Facebook app phone": [phone] },
    world: { "Mark Zuckerberg testifies Senate": [hearing] },
    judge: pickTitle("Zuckerberg"),
    verify: () => "RIGHT",
  });
  check("the phone of app icons is never shown; the chief executive at a hearing on the matter runs", [r.judgePrompts.some((p) => p.includes(phone.title)), r.image?.title], [false, hearing.title]);
  check("the judges and the second check know the headline's people, and the official the headline does not name as a side figure", [r.judgePrompts[0]?.includes("(Mark Zuckerberg)"), r.verifyPrompts[0]?.includes("(Mark Zuckerberg)"), r.judgePrompts[0]?.includes("not in its headline: Raúl Torrez")], [true, true, true]);
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

// R. Only the headline's people are pictured (the owner, 2026-10-24: a story headlined on Libya's parliament accepting the
// central bank governor's resignation ran the head of the State Council, named only in its standfirst). A person leads when
// the headline carries the words quoted for them or their Arabic surname; the governor's photograph, titled in Arabic, is found.
{
  const title = "رئاسة البرلمان الليبي تقبل مبدئياً استقالة محافظ المصرف المركزي";
  const listed = [
    { name: "Naji Issa", ar: "ناجي محمد عيسى", headline: "محافظ المصرف المركزي" },
    { name: "Mohamed Takala", ar: "محمد تكالة", headline: "" },
    { name: "Aguila Saleh", ar: "عقيلة صالح", headline: "رئاسة البرلمان الليبي" },
  ];
  const split = headlinePeople(title, listed);
  check("the headline's governor and parliament lead; the State Council's head is a side figure", [split.lead.map((p) => p.name), split.side.map((p) => p.name)], [["Naji Issa", "Aguila Saleh"], ["Mohamed Takala"]]);
  check("words the headline does not carry make no one its subject", headlinePeople(title, [{ name: "Mohamed Takala", ar: "محمد تكالة", headline: "المجلس الأعلى للدولة" }]).lead.length, 0);
  check("an Arabic surname in the headline is enough", headlinePeople("أردوغان يعلن حزمة لدعم الليرة", [{ name: "Recep Tayyip Erdoğan", ar: "رجب طيب أردوغان", headline: "" }]).lead.length, 1);
  // A name that itself begins with ب ل ك ف و, after «و» (2026-11-20): both sides had lost one letter, so «وبوتين» read
  // «بوتين» and «بوتين» read «وتين», and Putin, Lagarde, Krueger were side figures; «كارد» and «وارد» both read «ارد».
  const leads = (title, p) => headlinePeople(title, [p]).lead.length;
  check(
    "a name after «و» that begins with a clitic's letter is the headline's person; an office after «ل» too; «كارد» is not «وارد»",
    [
      leads("ترامب وبوتين يبحثان العقوبات على النفط", { name: "Vladimir Putin", ar: "فلاديمير بوتين", headline: "بوتين" }),
      leads("باول ولاغارد يحذران من عودة التضخم", { name: "Christine Lagarde", ar: "كريستين لاغارد", headline: "" }),
      leads("لماذا لم يُفقِد رفعُ الحد الأدنى للأجور العمالَ وظائفهم في دراسة كارد وكروغر؟", { name: "Alan Krueger", ar: "آلان كروغر", headline: "كروغر" }),
      leads("صندوق النقد يسلّم رسالة لوزير المالية المصري", { name: "Ahmed Kouchouk", ar: "أحمد كجوك", headline: "وزير المالية" }),
      leads("الدولار وارد من الخارج بكثافة", { name: "David Card", ar: "ديفيد كارد", headline: "" }),
    ],
    [1, 1, 1, 1, 0],
  );
  const libya = { ...developers, title, subtitle: "تكليف فوزي أبوخزام بتسيير مهام المصرف مؤقتاً، ورئيس مجلس الدولة يؤيد التكليف", tags: ["ليبيا", "مصرف ليبيا المركزي"], regions: ["المغرب العربي"] };
  const issa = file("ناجي عيسى مع جيرمي برنت.jpg", { date: "2025-02-11" });
  const takala = file("Mohammed Takala - 2023.jpg", { date: "2023-11-20" });
  const r = await scenario({
    draft: libya,
    plan: planFor({ queries: [], place: ["Libya", "Tripoli"], people: listed.slice(0, 2), focus: "people" }),
    world: { "ناجي محمد عيسى": [issa], "Mohamed Takala": [takala], "Mohamed Takala 2026": [takala] },
    judge: pickTitle("عيسى"),
    verify: () => "RIGHT",
  });
  check("the side figure is never searched; the governor, titled in Arabic, is found and runs", [r.searched.some((q) => /Takala/.test(q)), r.image?.title], [false, issa.title]);
  check("every judge is told the side figure is not the story's subject", r.judgePrompts.every((p) => p.includes("not in its headline: Mohamed Takala")), true);
}

// S. A photograph another story runs is never offered again under another of its addresses (2026-10-24: Duqm's port ran on
// two stories, the Oman story's copy stored as thumb.wikimedia.org/…?utm_source=…, the desk offering upload.wikimedia.org/…).
{
  const duqm = "%D9%85%D9%8A%D9%86%D8%A7%D8%A1_%D8%A7%D9%84%D8%AF%D9%82%D9%85_%D8%A7%D9%84%D8%AC%D8%AF%D9%8A%D8%AF.jpg";
  const forms = [
    `https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e3/${duqm}/1280px-${duqm}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`,
    `https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/${duqm}/960px-${duqm}`,
    `https://upload.wikimedia.org/wikipedia/commons/e/e3/${decodeURIComponent(duqm)}`,
  ];
  check("one Commons file under two hosts, two widths and both encodings is one photograph", new Set(forms.map(photoKey)).size, 1);
  check(
    "two Commons names that differ in case after the first letter are two photographs",
    photoKey("https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Riyadh_skyline.jpg/1280px-Riyadh_skyline.jpg") === photoKey("https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Riyadh_Skyline.jpg/1280px-Riyadh_Skyline.jpg"),
    false,
  );
  check(
    "a Flickr or Pexels photograph is its number, whatever its size",
    ["https://live.staticflickr.com/3790/12001284873_5581f12f6c_b.jpg", "https://farm4.staticflickr.com/3790/12001284873_5581f12f6c_z.jpg", "https://images.pexels.com/photos/36563588/pexels-photo-36563588.jpeg?auto=compress&cs=tinysrgb&w=1280", "https://images.pexels.com/photos/36563588/pexels-photo-36563588.jpeg?w=940"].map(photoKey),
    ["flickr:12001284873", "flickr:12001284873", "pexels:36563588", "pexels:36563588"],
  );
  // One photograph under two identities (the audit of 31 October): a Commons file imported from Flickr is that Flickr
  // photograph, and a crop of a file is the file.
  check(
    "a Commons file carrying a Flickr number is that Flickr photo; a crop is its file",
    [
      photoKey("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Samco_Redwood_crude_oil_tanker_%2814783173609%29.jpg/960px-Samco_Redwood_crude_oil_tanker_%2814783173609%29.jpg"),
      photoKey("https://live.staticflickr.com/3906/14783173609_0a1b2c3d4e_b.jpg"),
      photoKey("https://upload.wikimedia.org/wikipedia/commons/a/ab/Mark_Zuckerberg_F8_2018_Keynote_(cropped).jpg") === photoKey("https://upload.wikimedia.org/wikipedia/commons/c/cd/Mark_Zuckerberg_F8_2018_Keynote.jpg"),
      seriesKey("Mark Zuckerberg F8 2018 Keynote (cropped).jpg") === seriesKey("Mark Zuckerberg F8 2018 Keynote.jpg"),
    ],
    ["flickr:14783173609", "flickr:14783173609", true, true],
  );
  // The New Capital's district, published under the old host with a written comma, is offered again in the upload form.
  const oldForm = cbd.url.replace("https://upload.wikimedia.org", "https://thumb.wikimedia.org").replace(/%2C/g, ",") + "?utm_source=commons.wikimedia.org&utm_content=thumbnail";
  const r = await scenario({
    draft: developers,
    plan: planFor({ places: ["New Administrative Capital"], place_queries: ["New Administrative Capital"] }),
    world: { "New Administrative Capital": [cbd], "construction site Egypt": [dahab] },
    judge: (titles) => (titles.length ? 1 : 0),
    verify: () => "GENERIC_OK",
    exclude: new Set([oldForm]),
  });
  check("a photograph published under another address is passed over for the next tier", r.image?.title, dahab.title);
  // The morning round's net: the newer of two stories sharing a photograph is given another; the older keeps it.
  const at = (iso) => Date.parse(iso);
  check(
    "the newer of two stories sharing a photograph is the one re-picked",
    sharedPhotos([
      { slug: "explainer", at: at("2026-09-27T10:48:02Z"), image: { url: forms[1] } },
      { slug: "oman", at: at("2026-09-07T13:50:31Z"), image: { url: forms[0] } },
      { slug: "budget", at: at("2026-10-17T23:19:19Z"), image: { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Treasury_sign.jpg/1280px-Treasury_sign.jpg" } },
      { slug: "text-only", at: at("2026-10-18T00:00:00Z"), image: null },
    ]),
    [{ slug: "explainer", keeps: "oman" }],
  );
}

// U. A picture editor's search (2026-10-25: the Iraq–IMF story ran without a photograph while a 2024 photograph of a crowded
// Shorja market sat on Commons). Soldiers never reach the judge of a civilian story; a Commons category the planner names
// is looked through, and a photograph found only there, titled in Arabic, runs.
{
  const iraq = { ...developers, title: "العراق يطلب بحث برنامج تمويلي محتمل مع صندوق النقد الدولي", subtitle: "", tags: ["العراق", "صندوق النقد الدولي"], regions: ["المشرق وإيران وتركيا"] };
  check(
    "soldiers, a patrol or a DoD photograph are refused on a civilian story; a marine terminal is not soldiers",
    [Boolean(publishedFault({ title: "Market patrol in Baghdad DVIDS151101.jpg" }, iraq)), Boolean(publishedFault({ title: "Troops Strengthen Local Baghdad Market.jpg" }, iraq)), Boolean(publishedFault({ title: "Defense.gov News Photo 050109-A-2703S-015.jpg" }, iraq)), publishedFault({ title: "Marine terminal at Fujairah.jpg" }, iraq)],
    [true, true, true, null],
  );
  const patrol = file("Market patrol in Baghdad DVIDS151101.jpg", { categories: "Markets in Baghdad", date: "2009-03-02" });
  const souq = file("سوق السراجين 2017.jpg", { categories: "Markets in Baghdad", date: "2017-12-29" });
  const r = await scenario({
    draft: iraq,
    plan: planFor({ queries: [], place: ["Iraq", "Baghdad"], places: [], place_queries: [], categories: ["Markets in Baghdad"] }),
    world: {},
    categoryWorld: { "Markets in Baghdad": [patrol, souq] },
    judge: (titles) => (titles.length ? 1 : 0),
    verify: () => "GENERIC_OK",
  });
  check(
    "a category is looked through; the patrol never reaches the judge and the souq, found only there, runs",
    [r.searched.includes("category:Markets in Baghdad"), r.judgePrompts.some((p) => p.includes("Market patrol")), r.image?.title],
    [true, false, souq.title],
  );
}

// T. The audit of printed photographs reads the desk's own rulebook (photoRules(), audit mode) and the desk's checks in code
// (publishedFault()), not a copy of its own that still took a capital's skyline for a whole economy (2026-10-24).
{
  const economy = { title: "كيف يحدد التصنيف السيادي كلفة اقتراض عُمان؟", subtitle: "", lede: "ليد", body: "نص", tags: ["عمان"], regions: ["الخليج"], kind: "explainer" };
  const rules = photoRules({ draft: economy, image: { title: "Duqm DryDock.jpg" }, lastResort: true, audit: true });
  check(
    // A skyline is refused in every pass but the city pass (2026-11-07), which runs only under a city's own stock market.
    "the audit is told the desk's rules: no skyline but the city pass's, how an economy and a concept are pictured, the headline's people",
    [rules.includes("is WRONG_SUBJECT in this pass, whatever the story (only the city pass, under a story about a city's own stock market"), rules.includes("pictured by that country's economic life at work"), rules.includes("This piece explains or analyses a concept"), rules.includes("the people its headline names or refers to"), rules.includes("skyline or central bank is acceptable ONLY")],
    [true, true, true, true, false],
  );
  check("another outlet's name or logo in the frame is refused by desk and audit alike", [rules.includes("another news outlet's or broadcaster's name or logo in the frame"), photoRules({ draft: economy, image: {} }).includes("another news outlet's or broadcaster's name or logo in the frame")], [true, true]);
  check(
    "the desk's own rubric carries none of the audit's notes",
    [photoRules({ draft: economy, image: {} }).includes("the people its headline names or refers to"), photoRules({ draft: economy, image: {} }).includes("photographed in the Canaries")],
    [false, false],
  );
  const story = { title: "شركات أمريكية ترفع أسعارها", subtitle: "", tags: ["الولايات المتحدة"] };
  check(
    "a printed front, an archival frame, a scan and a warship fail the desk's code; a central bank's building and a Panoramio pipeline do not",
    [
      Boolean(publishedFault({ title: "Department of the Treasury sign Washington DC 2025-12-17.jpg", description: "The Treasury building" }, story)),
      Boolean(publishedFault({ title: "Wall Street traders 1998.jpg", date: "1998-03-02" }, story)),
      Boolean(publishedFault({ title: "100 dollar note obverse.jpg" }, story)),
      Boolean(publishedFault({ title: "USS Porter in the Strait of Hormuz.jpg" }, story)),
      publishedFault({ title: "Federal Reserve Board building, Washington.jpg" }, story),
      publishedFault({ title: "Oil pipe lines in saudi Arabia - panoramio.jpg" }, story),
    ],
    [true, true, true, true, null, null],
  );
}

// U. Three search faults of 2026-10-27, each of which kept a fitting photograph from every judge: the title filter
// matched inside words and refused every «banknotes» photograph; «gold bullion bars» dropped files that say «ingot» or
// «bar»; a library's photograph was measured against Commons' last shortened phrase («exchange») instead of the phrase
// the library was asked, and one Openverse found by the phrase's first words needs only a third of it.
{
  check(
    "the title filter keeps photographs whose titles hold a refused word inside another, and banknotes in hand",
    ["Vegetable market in Cairo.jpg", "Photograph of traders.jpg", "Covered market Tunis.jpg", "Egyptian pound banknotes in hand.jpg", "The Egyptian Exchange logo.png", "Map of Egypt.jpg"].map((t) => BAD_TITLE.test(t)),
    [false, false, false, false, true, true],
  );
  // A logo photographed where a reader meets it is the brand pass's picture; a logo by itself is still a graphic (a review
  // of 2026-11-01: «BP logo at petrol station» was dropped at the search, «BP sign…» kept).
  check(
    "a photograph of a logo on a forecourt, a sign or a vehicle passes; a logo alone does not",
    ["BP logo at petrol station.jpg", "Shell logo on a station sign.jpg", "Etihad logo on an aircraft tail.jpg", "BP logo.jpg", "The Egyptian Exchange logo.png", "Map of Egypt with BP logo.jpg"].map(badTitle),
    [false, false, false, true, true, true],
  );
  const realCommonsFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ query: { pages: { 7: { title: "File:BP logo at petrol station.jpg", index: 1, imageinfo: [{ mime: "image/jpeg", width: 1600, height: 1067, url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/BP_logo_at_petrol_station.jpg", thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/BP_logo_at_petrol_station.jpg/1280px-BP_logo_at_petrol_station.jpg", thumbwidth: 1280, thumbheight: 853, timestamp: "2024-05-01T00:00:00Z", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" }, Artist: { value: "Tester" } } }] } } } }), { status: 200, headers: { "content-type": "application/json" } });
  let forecourt = [];
  try {
    forecourt = (await searchCommons("BP sign")).map((f) => f.title);
  } finally {
    globalThis.fetch = realCommonsFetch;
  }
  check("the Commons search keeps the photograph of a logo on a forecourt", forecourt, ["BP logo at petrol station.jpg"]);
  const gold = { ...developers, title: "الذهب ينهي الأسبوع دون 4000 دولار للأوقية", tags: ["الذهب"], regions: ["عالمي"] };
  const ingots = file("Gold Ingots on white background.jpg");
  const vault = file("400-oz-Gold-Bars-AB-01.jpg", { categories: "Gold as an investment|Bank vaults|Gold ingots" });
  const r = await scenario({
    draft: gold,
    plan: planFor({ queries: ["gold bullion bars"], place: [] }),
    world: { "gold bullion bars": [ingots, vault] },
    judge: pickTitle("400-oz"),
    verify: () => "GENERIC_OK",
  });
  check("gold bars that say «ingot» or «bar» reach the judge for «gold bullion bars»", [r.judgePrompts.some((p) => p.includes(ingots.title)), r.image?.title], [true, vault.title]);
  const pound = { ...developers, title: "الجنيه المصري يهبط إلى مستوى قياسي", tags: ["الجنيه المصري", "مصر"] };
  const notes = { ...file("Egyptian pounds", { date: "2009-08-20" }), library: "flickr", searched: "Egyptian pound" };
  const p = await scenario({
    draft: pound,
    plan: planFor({ queries: ["Egyptian pound dollar exchange"] }),
    libs: { "Egyptian pound dollar exchange": [notes] },
    judge: pickTitle("Egyptian pounds"),
    verify: () => "GENERIC_OK",
  });
  check("a library's photograph is measured against the phrase it was asked, at a third when Openverse shortened it", p.image?.title, notes.title);
  const students = { ...file("IMG_1945", { categories: "afs, egypt, egyptian, exchange, students" }), library: "flickr", searched: "Egyptian Exchange" };
  const s = await scenario({
    draft: pound,
    plan: planFor({ queries: ["Egyptian Exchange trading floor"] }),
    libs: { "Egyptian Exchange trading floor": [students] },
    judge: () => 1,
    verify: () => "GENERIC_OK",
  });
  check("exchange students found by «Egyptian Exchange» never reach the judge for its trading floor", s.judgePrompts.some((x) => x.includes("IMG_1945")), false);
}

// V. Credits that printed words which are not a name (2026-10-28): a licence sentence in a file's Artist field, found
// in the blind photo test, and twenty published credits with a placeholder, a label, a talk link, a wiki, a Flickr
// city with its state, a derivative's second author, emoji and doubled marks. Each case is a published credit or a
// file's real record.
{
  check(
    "a credit's author is the name alone",
    [
      "Photographer: Mosbatho",
      "mo -- ( Talk",
      "Mo7amedsalim at Arabic Wikipedia",
      "NASA Goddard Space Flight Center from Greenbelt, MD, USA",
      "Original: NASA Johnson Space Center Derivative work: Nythar",
      "Chepry 💬 ( Andrzej Barabasz ) 📷 🇵🇱",
      "Oleksiy Yeshtokyn,🌻🇺🇦🌻",
      "Samuel King Jr. Jr.",
      "Bilal  Ahmed",
      "SilBaBum _",
      "© Raimond Spekking / CC BY-SA 4.0 (via Wikimedia Commons)",
    ].map(cleanArtist),
    ["Mosbatho", "mo", "Mo7amedsalim", "NASA Goddard Space Flight Center", "NASA Johnson Space Center", "Chepry (Andrzej Barabasz)", "Oleksiy Yeshtokyn", "Samuel King Jr.", "Bilal Ahmed", "SilBaBum", "Raimond Spekking"],
  );
  check(
    "a licence sentence or a placeholder is no name, and names that only look like one stay whole",
    ["You may select the license of your choice.", "Public domain: Use pics for any purpose", "[null Courtesy]", "Unknown photographer", "Free To Use Sounds", "CC Chapman", "Byron Smith", "Se.By."].map(cleanArtist),
    ["", "", "", "", "Free To Use Sounds", "CC Chapman", "Byron Smith", "Se.By."],
  );
  const v = (value) => ({ value });
  check(
    "a Commons file's credit is its Artist field, else the attribution asked for, else the body a release names",
    [
      { Artist: v("You may select the license of your choice."), Attribution: v('<a href="https://www.tasnimnews.ir">Tasnim News Agency</a>') },
      { Artist: v("[null Courtesy]"), Credit: v("<table><tr><td>This image was released by the United States Department of Defense with the ID 260604-D-D0477-1112 (next) .</td></tr></table>") },
      { Artist: v('<a href="https://www.flickr.com/people/102748040@N03">Public domain: Use pics for any purpose</a>'), Credit: v("<a>Samco Redwood crude oil tanker</a>") },
      { Artist: v("CEphoto, Uwe Aranas"), Attribution: v("CEphoto, Uwe Aranas or alternatively © CEphoto, Uwe Aranas") },
    ].map(creditName),
    ["Tasnim News Agency", "United States Department of Defense", "", "CEphoto, Uwe Aranas"],
  );
  check(
    "a library photograph with no photographer named is credited to the library once",
    [attributionLine({ library: "pexels", artist: "" }), attributionLine({ library: "pexels", artist: "Tom Fisk" }), attributionLine({ artist: "", license: "CC BY 2.0" })],
    ["بيكسلز", "Tom Fisk · بيكسلز", "Wikimedia Commons · CC BY 2.0 · ويكيميديا كومنز"],
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The company's own news (the owner, 2026-10-30, on BP's 18-year profit high under a stock refinery: "would not a picture
// that shows the company logo be better for this article?"). Its brand has a pass of its own; its sites abroad are its own;
// a camera's category is not a place.
{
  const bpDraft = { title: "أرباح «بي بي» البريطانية تقفز إلى أعلى مستوى منذ 18 عاماً", subtitle: "بفضل هوامش التكرير", lede: "قفز الربح.", body: "فقرة.", tags: ["بي بي", "التكرير"], regions: ["أوروبا"], kind: "news", section: "companies", imageQueries: [] };
  const kwinana = file("BP Oil Refinery Jetty, Kwinana, January 2024 01.jpg", { categories: "2024 at BP Oil Refinery Jetty, Kwinana|Germany photos taken with Canon PowerShot SX60 HS|January 2024 in Kwinana, Western Australia" });
  check("a camera's category is not where the photograph was taken", placedAbroad(kwinana, { title: "ألمانيا تخفض توقعات النمو", tags: ["ألمانيا"] }), "Australia");
  check(
    "the company's own site abroad is home under its own news, and only there",
    [placedAbroad(kwinana, { ...bpDraft, imageCompany: "BP" }), placedAbroad(kwinana, bpDraft)],
    [null, "Australia"],
  );
  check(
    "the planner's company holds only when the headline names it",
    [headlineCompany(bpDraft.title, { name: "BP", headline: "«بي بي»" })?.name ?? null, headlineCompany(bpDraft.title, { name: "Shell", headline: "شل" }), headlineCompany(bpDraft.title, null)],
    ["BP", null, null],
  );
  check(
    "a company is named as a whole word, a short name in either case",
    [namesCompany({ title: "Shell petrol station, Dubai.jpg" }, "Shell"), namesCompany({ title: "Seashell on a beach.jpg" }, "Shell"), namesCompany({ title: "bp pulse charger.jpg" }, "BP"), namesCompany({ title: "BPCL fuel depot.jpg" }, "BP")],
    [true, false, true, false],
  );
  // The review of 2026-10-30: a name that is also a word or a place is not the company without one of its own things.
  check(
    "a name that is a word or a place is not the company: a fruit tree, a beach, an arm, a mountain gap",
    [namesCompany({ title: "Apple tree in bloom, Normandy.jpg" }, "Apple"), namesCompany({ title: "Shell Beach, Western Australia.jpg" }, "Shell"), namesCompany({ title: "Raised arm.jpg" }, "Arm"), namesCompany({ title: "Mountain gap at dawn.jpg" }, "Gap"), namesCompany({ title: "x.jpg", categories: "Shell Beach|BP petrol stations in Australia" }, "BP"), namesCompany({ title: "Apple tree" }, "Apple", { query: true })],
    [false, false, false, false, true, true],
  );
  check(
    "a camera's tag is dropped alone: the library's other tags still place the photograph",
    placedAbroad({ title: "Refinery at dusk", categories: "Germany, Hamburg, refinery, taken with iPhone" }, { title: "مصر ترفع إنتاج التكرير", tags: ["مصر"] }),
    "Germany",
  );
  const branchSign = file("Barclays bank branch sign, Leeds.jpg", { categories: "Barclays branches in England" });
  check(
    "the audit's code leaves the company's own sign to the judge under its own news, and still drops a front otherwise",
    [publishedFault(branchSign, { title: "باركليز تلغي 5 آلاف وظيفة", imageCompany: "Barclays" }), Boolean(publishedFault(branchSign, { title: "باركليز تلغي 5 آلاف وظيفة" }))],
    [null, true],
  );

  const generic = file("Coryton Oil Refinery, Essex.jpg", { categories: "Oil refineries in England" });
  const whiting = file("BP Whiting Refinery, Indiana.jpg", { categories: "Whiting, Indiana|Oil refineries in Indiana" });
  const station = { ...file("Illuminated BP gas station at night in Melbourne"), url: "https://images.pexels.com/photos/32133560/bp.jpeg", description: "Illuminated BP gas station at night in Melbourne, Australia." };
  const pko = file("Bank PKO BP w Białymstoku.jpg", { categories: "PKO Bank Polski" });
  const plan = { queries: ["oil refinery"], place: ["United Kingdom", "British"], people: [], focus: "subject", places: [], place_queries: [], message: "BP's refineries made its biggest profit in 18 years", message_queries: ["BP refinery"], company: { name: "BP", headline: "بي بي" }, brand_queries: ["BP gas station", "BP sign", "Shell station"] };

  // Its own refinery in the United States reaches the judge under its own news, and runs captioned where it is.
  const own = await scenario({ draft: bpDraft, plan, world: { "BP refinery": [whiting], "oil refinery": [generic] }, judge: (titles) => ({ choice: pickTitle("Whiting")(titles), says: true }), verify: () => "RIGHT" });
  const without = await scenario({ draft: bpDraft, plan: { ...plan, company: null }, world: { "BP refinery": [whiting], "oil refinery": [generic] }, judge: (titles) => ({ choice: pickTitle("Whiting")(titles), says: true }), verify: () => "RIGHT" });
  check("the company's own refinery abroad reaches the judge and runs as itself", [own.image?.title, own.image?.alt?.includes(ILLUSTRATIVE)], [whiting.title, false]);
  check("…but not when the story is not that company's own", without.judgePrompts.some((p) => p.includes("Whiting")), false);
  check("every judge and the second check are told the company's sites are its own", [own.judgePrompts.every((p) => p.includes("THE STORY'S COMPANY: BP")), own.verifyPrompts.every((p) => p.includes("THE STORY'S COMPANY: BP"))], [true, true]);

  // No photograph says its point and none is its own: its brand, from wherever, before the stand-in waiting in reserve.
  const brandJudge = (titles, prompt) => (prompt.includes("THE COMPANY'S OWN BRAND") ? pickTitle("gas station")(titles) : { choice: pickTitle("Coryton")(titles), says: false });
  const r = await scenario({ draft: bpDraft, plan, world: { "oil refinery": [generic], "BP sign": [pko] }, libs: { "BP gas station": [station] }, judge: brandJudge, verify: () => "RIGHT" });
  check("the brand pass runs BP's forecourt, not the stand-in refinery in reserve", [r.image?.title, r.image?.alt?.includes(ILLUSTRATIVE)], [station.title, false]);
  const brandPrompt = r.judgePrompts.find((p) => p.includes("THE COMPANY'S OWN BRAND")) ?? "";
  check("the brand judge may take a logo from anywhere, and is told to refuse a former one", [brandPrompt.includes("logos as the main subject"), brandPrompt.includes("WHERE IT WAS TAKEN"), brandPrompt.includes("former logo")], [false, false, true]);
  check("a brand search must name the company", r.searched.includes("Shell station"), false);
  const wrongCompany = await scenario({ draft: bpDraft, plan: { ...plan, company: { name: "Shell", headline: "شل" } }, world: { "oil refinery": [generic] }, libs: { "BP gas station": [station] }, judge: brandJudge, verify: () => "RIGHT" });
  check("a company the headline does not name gets no brand pass", wrongCompany.judgePrompts.some((p) => p.includes("THE COMPANY'S OWN BRAND")), false);

  // The sign before the station (the owner, 2026-10-30: "some photos are very unclear or too far away"): the brand judge is
  // shown the files that call themselves a sign first, whatever order the search gave.
  const far = file("BP Petrol Station, Welling - geograph.org.uk - 2545993.jpg");
  const sign = file("BP sign on the A1, Chesterton - geograph.org.uk - 6236712.jpg");
  const order = await scenario({ draft: bpDraft, plan: { ...plan, brand_queries: ["BP gas station", "BP sign"] }, world: { "oil refinery": [generic], "BP gas station": [far], "BP sign": [sign] }, judge: brandJudge, verify: () => "RIGHT" });
  check("the brand judge sees the sign before the station", titlesIn(order.judgePrompts.find((p) => p.includes("THE COMPANY'S OWN BRAND")) ?? "").slice(0, 2), [sign.title, far.title]);

  // Its head office, searched in code (2026-11-06): the planner asked for "JPMorgan Chase sign" and "JPMorgan Chase bank",
  // Commons holds neither phrase, and the brand's name over the entrance of 270 Park Avenue was never seen.
  const jpmDraft = { title: "جي بي مورغان يدرج الصكوك السعودية في مؤشره لسندات الأسواق الناشئة من 2027", subtitle: "ثمانية إصدارات بالريال تدخل المؤشر على مدى 10 أشهر", lede: "أعلن بنك جي بي مورغان الأمريكي أنه سيدرج الصكوك الحكومية السعودية في مؤشره.", body: "فقرة.", tags: ["جي بي مورغان", "السعودية"], regions: ["الخليج"], kind: "news", section: "markets", imageQueries: [] };
  const hq = file("JPMorgan Chase - 270 Park Avenue (55283843744).jpg", { description: "Wide steps lead to the glass-fronted JPMorgan Chase entrance at 270 Park Avenue. A sweeping metal canopy projects over the doors and lobby.", categories: "270 Park Avenue (2021–present)|Office buildings in New York City photographed in 2026", date: "2026-05-18" });
  const jpmPlan = { queries: ["Saudi riyal banknotes"], place: ["Saudi Arabia", "Saudi"], people: [], focus: "subject", places: [], place_queries: [], company: { name: "JPMorgan Chase", headline: "جي بي مورغان" }, brand_queries: ["JPMorgan Chase sign", "JPMorgan Chase bank"] };
  const atHq = await scenario({ draft: jpmDraft, plan: jpmPlan, world: { "JPMorgan Chase headquarters": [hq] }, judge: (titles, prompt) => (prompt.includes("THE COMPANY'S OWN BRAND") ? pickTitle("270 Park")(titles) : 0), verify: () => "RIGHT" });
  check("the brand pass also looks at the company's head office, and its name over the door runs", [atHq.searched.includes("JPMorgan Chase headquarters"), atHq.image?.title], [true, hq.title]);
  check("an entrance names the company as its own", [namesCompany(hq, "JPMorgan Chase"), namesCompany({ title: "Chase Lake entrance.jpg" }, "JPMorgan Chase")], [true, false]);

  // The owner, 2026-11-19, on the IMF's staff agreement with Egypt run as text ("yes, change the rule"): a world body's own
  // news has the brand pass too, its name or seal over its own headquarters' entrance, and its loan finances the treasury,
  // so no port is searched as its place.
  const imfDraft = { title: "صندوق النقد يتفق مع مصر على مراجعتين تتيحان لها 2.3 مليار دولار", subtitle: "المبلغ يشمل الشريحة الأخيرة من برنامج قيمته 8 مليارات دولار", lede: "توصّل فريق خبراء صندوق النقد الدولي إلى اتفاق مع مصر.", body: "فقرة.", tags: ["صندوق النقد الدولي", "مصر"], regions: ["مصر"], kind: "news", section: "economy", imageQueries: [] };
  const imfHq = file("International Monetary Fund (IMF) (53844898894).jpg", { description: "Washington, DC", categories: "CC-BY-2.0|International Monetary Fund headquarters", date: "2024-06-21" });
  const imfPlan = { queries: ["Egyptian pounds"], place: ["Egypt", "Egyptian"], people: [], focus: "subject", places: [], place_queries: [], company: { name: "International Monetary Fund", headline: "صندوق النقد", also: ["IMF"] }, brand_queries: ["International Monetary Fund headquarters"] };
  const imf = await scenario({ draft: imfDraft, plan: imfPlan, world: { "International Monetary Fund headquarters": [imfHq] }, judge: (titles, prompt) => (prompt.includes("THE COMPANY'S OWN BRAND") ? pickTitle("53844898894")(titles) : 0), verify: () => "RIGHT" });
  const planner = imf.plannerPrompts[0] ?? "";
  check(
    "a world body's own news: the planner may name it for the brand pass, a loan to the state has no port for its place, and its entrance runs",
    [planner.includes("or ONE world body's own (the IMF"), planner.includes("an IMF programme, trade figures"), planner.includes("a tranche or a programme review of the IMF"), imf.image?.title, imf.judgePrompts.some((p) => p.includes("ONE company's or ONE world body's own news"))],
    [true, false, true, imfHq.title, true],
  );
  check("the IMF's headquarters names it as its own, and «IMF» alone does not", [namesBrand(imfHq, ["International Monetary Fund", "IMF"]), namesBrand({ title: "IMF.jpg" }, ["International Monetary Fund", "IMF"])], [true, false]);

  // The owner, 2026-11-07: "i bet there are many free to use photos of jp morgan, why the search results were so limited?"
  // Its brand's other names count, its own Commons categories are browsed, this year's photographs are asked for first,
  // and its name readable over its own entrance is its own site, not a front («yes run it»).
  check(
    "the planner's other names for the brand are kept, cleaned, never the name itself",
    headlineCompany(jpmDraft.title, { name: "JPMorgan Chase", headline: "جي بي مورغان", also: ["J.P. Morgan", "Chase", "JPMorgan Chase", "<b>x</b>", "Chase"] })?.also,
    ["J.P. Morgan", "Chase"],
  );
  const jpmNames = ["JPMorgan Chase", "J.P. Morgan", "Chase"];
  check(
    "a Chase branch names the company by its other name; a chief justice and an arena called Chase do not",
    [namesBrand({ title: "A Chase bank location in Birmingham, Alabama.jpg" }, jpmNames), namesBrand({ title: "Salmon P. Chase, Chief Justice.jpg" }, jpmNames), namesBrand({ title: "Chase Center, San Francisco.jpg" }, jpmNames)],
    [true, false, false],
  );
  const branch = file("A Chase bank location in Birmingham, Alabama.jpg", { categories: "Chase Bank", date: "2026-10-23" });
  const viaCategory = await scenario({
    draft: jpmDraft,
    plan: { ...jpmPlan, company: { name: "JPMorgan Chase", headline: "جي بي مورغان", also: ["Chase"] }, brand_queries: ["JPMorgan Chase sign"], brand_categories: ["Chase Bank", "Salmon P. Chase"] },
    categoryWorld: { "Chase Bank": [branch] },
    judge: (titles, prompt) => (prompt.includes("THE COMPANY'S OWN BRAND") ? pickTitle("Birmingham")(titles) : 0),
    verify: () => "RIGHT",
  });
  check(
    "the brand pass browses the company's own category, asks for this year's photographs first, and runs a branch filed under its other name",
    [viaCategory.searched.includes("category:Chase Bank"), viaCategory.searched.includes("category:Salmon P. Chase"), viaCategory.searched.some((q) => /^JPMorgan Chase sign 20\d\d$/.test(q)), viaCategory.image?.title],
    [true, false, true, branch.title],
  );
  const brandJudgePrompt = viaCategory.judgePrompts.find((p) => p.includes("THE COMPANY'S OWN BRAND")) ?? "";
  check(
    "every judge and the check are told the brand's other names and that its name readable over its own entrance is its own site",
    [brandJudgePrompt.includes("«Chase»"), brandJudgePrompt.includes("over the entrance of its own head office or branch"), viaCategory.verifyPrompts.some((p) => p.includes("over the entrance of its own head office or branch") && p.includes("cannot be read at a glance"))],
    [true, true, true],
  );
}

// «CEO of JPMorgan Chase» is no person called Chase (2026-11-06): the CEO's own photograph was dropped as someone else's.
// A person named after a place still is one («Prime Minister of India Narendra Modi»).
{
  const draft = { title: "ديمون يحذر من تباطؤ الاقتصاد الأمريكي", subtitle: "", lede: "قال جيمي ديمون الرئيس التنفيذي لجي بي مورغان إن الاقتصاد يتباطأ.", body: "فقرة.", tags: ["جي بي مورغان"], regions: ["عالمي"], kind: "news", section: "economy", imageQueries: [] };
  const ceo = file("Jamie Dimon, CEO of JPMorgan Chase.jpg", { date: "2024-01-09" });
  const modi = file("Prime Minister of India Narendra Modi with Jamie Dimon.jpg", { date: "2024-06-20" });
  const plan = { queries: ["bank trading floor"], place: [], people: [{ name: "Jamie Dimon", ar: "جيمي ديمون", headline: "ديمون" }], focus: "people", places: [], place_queries: [] };
  const r = await scenario({ draft, plan, world: { "Jamie Dimon": [modi, ceo] }, judge: pickTitle("CEO of"), verify: () => "RIGHT" });
  check("a name after «CEO of» is the company's, and the CEO's own photograph runs; a prime minister of a country is still a person", [r.image?.title, r.judgePrompts.some((p) => titlesIn(p).includes(modi.title))], [ceo.title, false]);
}

// Amateur photographs are the last resort (the owner, 2026-10-30: "make amateur photos last resort, and optimize for clear
// photos"): a snapshot the second check calls AMATEUR is held back, and runs only when no professional photograph is found.
{
  const draft = { title: "مصافي النفط تعمل بطاقتها القصوى", subtitle: "", lede: "قفزت هوامش التكرير.", body: "فقرة.", tags: ["النفط"], regions: ["عالمي"], kind: "news", section: "energy", imageQueries: [] };
  const snap = file("Refinery seen from the road.jpg");
  const pro = file("Refinery towers at dusk.jpg");
  // The held frame is read again with the standard set aside (the audit of 31 October): here its subject is right.
  const amateurVerdict = (name, prompt) => (name.includes("from the road") && !prompt.includes("already known to be a snapshot") ? "AMATEUR" : "RIGHT");
  const alone = await scenario({ draft, plan: { queries: ["oil refinery"], place: [], people: [], focus: "subject", places: [], place_queries: [] }, world: { "oil refinery": [snap] }, judge: (titles) => (titles.length ? 1 : 0), verify: amateurVerdict });
  check("with nothing professional, the snapshot held back runs at the end", alone.image?.title, snap.title);
  const both = await scenario({ draft, plan: { queries: ["oil refinery"], place: [], people: [], focus: "subject", places: [], place_queries: [] }, world: { "oil refinery": [snap, pro] }, judge: (titles) => (titles.length ? 1 : 0), verify: amateurVerdict });
  check("a professional photograph found later runs before it", both.image?.title, pro.title);
  // AMATEUR is one word and says nothing of the subject: a snapshot of the wrong subject is not held, and nothing runs.
  const wrong = await scenario({ draft, plan: { queries: ["oil refinery"], place: [], people: [], focus: "subject", places: [], place_queries: [] }, world: { "oil refinery": [snap] }, judge: (titles) => (titles.length ? 1 : 0), verify: (name, prompt) => (prompt.includes("already known to be a snapshot") ? "WRONG_SUBJECT" : "AMATEUR") });
  check("a snapshot whose subject the second reading refuses is not held back", [wrong.image?.title ?? null, wrong.calls.filter((c) => c.startsWith("verify:")).length >= 2], [null, true]);
  // A held frame read RECAPTION fits under a caption that names too much: its caption is written again, as the main path
  // does, and it is held (the Jubail refinery under Saudi Arabia's GDP was dropped as "not held back either", 2026-11-01).
  const recaption = await scenario({ draft, plan: { queries: ["oil refinery"], place: [], people: [], focus: "subject", places: [], place_queries: [] }, world: { "oil refinery": [snap] }, judge: (titles) => (titles.length ? 1 : 0),
    verify: (name, prompt) => (!prompt.includes("already known to be a snapshot") ? "AMATEUR" : prompt.includes("Caption the paper would print: طائرة إيرباص A321neo") ? "RIGHT" : "RECAPTION") });
  check("a held snapshot read RECAPTION is recaptioned and held, and runs", [recaption.image?.title ?? null, recaption.calls.includes("caption")], [snap.title, true]);
  check("every judge is told amateur photographs come last, and to prefer the nearest, clearest subject", [both.judgePrompts.every((p) => p.includes("AMATEUR LAST")), both.judgePrompts.every((p) => p.includes("nearest, largest and sharpest"))], [true, true]);
  // Not a stand-in: a snapshot its judge found only names the story's topic, in a pass that looks for its point, is not held,
  // and the story runs as text (the owner, 2026-11-07, of a night snapshot of a housing compound in Dubai Investments Park,
  // palms filling the frame, under DIP Holding's IPO: «i do not think the picture posted here is suitable»).
  const pointed = { queries: ["oil refinery"], place: [], people: [], focus: "subject", places: [], place_queries: [], message: "refiners earn their widest margins in years" };
  const topicOnly = await scenario({ draft, plan: pointed, world: { "oil refinery": [snap] }, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: false }), verify: amateurVerdict });
  const saysIt = await scenario({ draft, plan: pointed, world: { "oil refinery": [snap] }, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: true }), verify: amateurVerdict });
  check("a snapshot that only names the story's topic is not held back and the story runs as text; one that says its point still is", [topicOnly.image?.title ?? null, saysIt.image?.title ?? null], [null, snap.title]);
  // The company's own brand is what its pass is for (no gate): its sign as a snapshot is still held, as the owner asked on
  // 2026-10-30 ("make amateur photos last resort").
  const bp = { ...draft, title: "أرباح «بي بي» تقفز إلى أعلى مستوى في 18 عاماً" };
  const signSnap = file("BP sign on the A1, Chesterton - geograph.org.uk - 6236712.jpg");
  const brandSnap = await scenario({ draft: bp, plan: { ...pointed, company: { name: "BP", headline: "بي بي" }, brand_queries: ["BP sign"] }, world: { "BP sign": [signSnap] }, judge: (titles) => ({ choice: titles.length ? 1 : 0, says: false }), verify: (name, prompt) => (prompt.includes("already known to be a snapshot") ? "RIGHT" : "AMATEUR") });
  check("a snapshot of the company's own brand is still held back and runs", brandSnap.image?.title ?? null, signSnap.title);
}

// A real photograph before a stand-in from nowhere (the owner, 2026-11-15, shown stock vegetables beside two fruit markets
// in Taif under Saudi inflation, asked whether a clear but amateur photograph from the story's own country should run
// before a stock illustration: "Yes, real one first"). Every other held snapshot still comes after the illustration.
{
  const saudi = { title: "التضخم السعودي يتباطأ إلى أدنى مستوى في 6 أشهر عند 1.7%", subtitle: "مع تباطؤ أسعار الأغذية والإيجارات", lede: "تباطأ التضخم السنوي في السعودية.", body: "فقرة.", tags: ["السعودية", "التضخم"], regions: ["الخليج"], kind: "news", section: "economy", imageQueries: [] };
  const market = file("Fruit and vegetable market, Taif, Saudi Arabia.jpg", { categories: "Retail in Saudi Arabia", date: "2011-11-09" });
  const dusk = file("Fruit and vegetable market at dusk.jpg", { date: "2011-11-09" });
  const stock = file("Colourful vegetable market stall.jpg", { description: "Fresh vegetables at a market stall" });
  const stock2 = file("Vegetable market crates.jpg", { description: "Crates of vegetables at a market" });
  const plan = planFor({ queries: ["vegetable market Saudi Arabia"], place: ["Saudi Arabia", "Riyadh"], places: [], place_queries: [], message: "Saudi households pay only a little more for food" });
  const snapshot = (name, prompt) => ((name.includes("Taif") || name.includes("at dusk")) && !prompt.includes("already known to be a snapshot") ? "AMATEUR" : "GENERIC_OK");
  const judge = (titles) => {
    const own = titles.findIndex((t) => t.includes("Taif") || t.includes("at dusk"));
    return own >= 0 ? { choice: own + 1, says: true } : { choice: titles.length ? 1 : 0, says: false };
  };
  check("a file's record places it in the story's country, at its company, or nowhere", [placedAtHome(market, saudi), placedAtHome(dusk, saudi), placedAtHome(market, { ...saudi, regions: ["عالمي"] }), placedAtHome(file("Markets of Cairo, Egypt.jpg"), saudi)], [true, false, false, false]);
  const alone = await scenario({ draft: saudi, plan, world: { "vegetable market Saudi Arabia": [market], "vegetable market": [stock] }, judge, verify: snapshot });
  check(
    "a held snapshot of the story's own country runs before the illustration from elsewhere, which is not looked for, and says it is a file photograph",
    [alone.image?.title, alone.calls.includes("judge-neutral"), String(alone.image?.alt ?? "").includes("أرشيفية"), String(alone.image?.alt ?? "").includes(ILLUSTRATIVE)],
    [market.title, false, true, false],
  );
  const reserved = await scenario({ draft: saudi, plan, world: { "vegetable market Saudi Arabia": [market, stock2] }, judge, verify: snapshot });
  check("and before a stand-in from nowhere that an earlier pass kept in reserve", reserved.image?.title, market.title);
  // A judge says of any market under a price index that it names the topic: at home it is still read, and held when clear.
  const topicJudge = (titles, prompt) => {
    const said = judge(titles, prompt);
    return { ...said, says: false };
  };
  const topicHome = await scenario({ draft: saudi, plan, world: { "vegetable market Saudi Arabia": [market], "vegetable market": [stock] }, judge: topicJudge, verify: snapshot });
  const unclearHome = await scenario({ draft: saudi, plan, world: { "vegetable market Saudi Arabia": [market], "vegetable market": [stock] }, judge: topicJudge, verify: (name, prompt) => (name.includes("Taif") ? (prompt.includes("already known to be a snapshot") ? "UNCLEAR" : "AMATEUR") : "GENERIC_OK") });
  check(
    "a snapshot of the story's own country that only names its topic is held when its second reading finds it clear, and dropped when it does not",
    [topicHome.image?.title, unclearHome.image?.title, topicHome.verifyPrompts.some((p) => p.includes("It must be CLEAR to run at all"))],
    [market.title, stock.title, true],
  );
  const unplaced = await scenario({ draft: saudi, plan, world: { "vegetable market Saudi Arabia": [dusk], "vegetable market": [stock] }, judge, verify: snapshot });
  check("a held snapshot no record places in the story's country still comes after the illustration", [unplaced.image?.title, String(unplaced.image?.alt ?? "").includes(ILLUSTRATIVE)], [stock.title, true]);
}

// Morocco's own markets (the owner, 2026-11-20, on a Pexels seller at an Indonesian market run as «صورة تعبيرية» under
// «التضخم في المغرب يتسارع إلى 1.9% في أكتوبر»: "the picture did not build actual relation to Moroccan people … I would have
// preferred a photo with no people in this case … if it is a bug, then fix it at the source"). The run log showed the
// country's markets lost before any judge saw them, and our own rules inviting a stranger's face into a stand-in.
{
  const { collect, strangerFace } = await import("../pipeline/lib/images.mjs");
  const { usedPhotos } = await import("../pipeline/lib/photo-key.mjs");
  const morocco = { title: "التضخم في المغرب يتسارع إلى 1.9% في أكتوبر، الأعلى منذ فبراير 2025", subtitle: "النقل يقفز 11.6% على أساس سنوي", lede: "ارتفع الرقم الاستدلالي للأثمان عند الاستهلاك في المغرب 1.9%.", body: "فقرة.", tags: ["المغرب", "التضخم"], regions: ["المغرب العربي"], kind: "news", section: "economy", imageQueries: [] };
  const stock = (title) => ({ ...file(title), description: title, library: "pexels" });
  const seller = stock("Local woman selling fresh vegetables at an Indonesian market");
  const produce = stock("Fresh vegetables piled in crates at a market stall");
  // (1) The country reader: a library's adjective before a place, the Maghreb's cities and French names, «Türkiye».
  check(
    "an adjective before a place places a photograph, and the Maghreb's cities do; an adjective alone does not",
    [
      placedAbroad(seller, morocco),
      placedAtHome({ title: "Colorful fruit stand in Marrakech offering a variety of fresh produce" }, morocco),
      placedAtHome({ title: '"A Moroccan traditional market called "Souk.jpg' }, morocco),
      placedAtHome({ title: "Légumes exposés.jpg", description: "légumes exposés à Souk Jmiaa à Derb Sultan Casablanca Maroc" }, morocco),
      placedAbroad({ title: "Turkish coffee and Japanese cars at a market in Casablanca" }, morocco),
      placedAbroad({ title: "Colorful crates of fruits on display at a street market in İzmir, Türkiye" }, morocco),
      placedAbroad({ title: "A Latin American street market at dusk" }, morocco),
    ],
    ["Indonesia", true, true, true, null, "Turkey", null],
  );
  // (2) A rank inside a place's name: «Derb Sultan Casablanca» was a person called Casablanca, «Queen Victoria Market» one
  // called Victoria; a person beside a city still is one.
  const derb = file("Légumes exposés.jpg", { description: "légumes exposés à Souk Jmiaa à  Derb Sultan Casablanca Maroc", date: "2025-04-13" });
  const queenVic = file("Melbourne (AU), Queen Victoria Market -- 2019 -- 1542.jpg", { date: "2019-05-01" });
  const modi = file("Prime Minister Modi Mumbai 2025.jpg", { date: "2025-05-01" });
  // (3) The everyday market's kin: a souk is a market, produce is vegetables.
  const souk = stock("Colorful Moroccan souk stalls in Marrakech bustling with local vendors");
  const stand = stock("Colorful fruit stand in Marrakech offering a variety of fresh produce");
  const world = { "Derb Sultan": [derb], market: [queenVic], Mumbai: [modi] };
  const restore = withStandIns({ searchCommons: async (q) => world[q] ?? [], searchCommonsCategory: async () => [], searchLibraries: async (q) => (q === "Moroccan market" ? [souk] : q === "vegetable market Morocco" ? [stand] : []) });
  try {
    const quiet = () => {};
    const [atDerb, markets, mumbai, kin] = [
      await collect(["Derb Sultan"], quiet, { perQuery: 10, max: 20, people: "none", places: ["Derb Sultan"], simplify: false }),
      await collect(["market"], quiet, { perQuery: 10, max: 20, people: "none" }),
      await collect(["Mumbai"], quiet, { perQuery: 10, max: 20, people: "none", simplify: false }),
      await collect(["Moroccan market", "vegetable market Morocco"], quiet, { perQuery: 10, max: 20, people: "none", place: ["Morocco", "Moroccan"], libraries: true }),
    ];
    check(
      "a rank inside a place's name is no person, a person beside a city still is, and a souk or a stand of produce fits a market search",
      [atDerb.map((c) => c.title), markets.map((c) => c.title), mumbai.length, kin.map((c) => c.title).sort()],
      [[derb.title], [queenVic.title], 0, [stand.title, souk.title].sort()],
    );
  } finally {
    restore();
  }
  // (4) No stranger's face in a stand-in, in code: a person as the frame's subject, placed nowhere in the story's country.
  check(
    "a stranger's face is read from the record; hands, a person at home, a named person and a world story are not one",
    [
      strangerFace(seller, morocco),
      strangerFace(stock("Woman's hands holding vegetables at an Indonesian market"), morocco),
      strangerFace(stock("A vendor weighing tomatoes at a market in Rabat"), morocco),
      strangerFace(stock("Close-up of a hand holding a green fuel nozzle"), morocco),
      strangerFace(seller, { ...morocco, tags: ["الأسواق الناشئة"], title: "أسعار الغذاء العالمية ترتفع", regions: ["عالمي"] }),
      strangerFace(stock("Prime Minister Aziz Akhannouch talks to a vendor"), morocco),
    ],
    [true, false, false, false, false, false],
  );
  const plan = planFor({ queries: ["vegetable market Morocco"], place: ["Morocco", "Moroccan", "Casablanca", "Rabat"], places: [], place_queries: [] });
  const first = (titles) => (titles.length ? 1 : 0);
  const neutral = await scenario({ draft: morocco, plan, libs: { "vegetable market": [seller, produce] }, judge: first, verify: () => "GENERIC_OK" });
  check(
    "the neutral pass never shows a judge a stranger's face, and its judge and check are told why",
    [neutral.image?.title, neutral.judgePrompts.some((p) => p.includes("Local woman selling")), neutral.judgePrompts.every((p) => !p.includes("LAST PASS") || p.includes("no stranger's face")), neutral.verifyPrompts.every((p) => p.includes("a stranger's face"))],
    [produce.title, false, true, true],
  );
  // The second check reads it in code for a frame that can only stand in, never for one placed in the story's country.
  const placedNowhere = await scenario({ draft: morocco, plan, libs: { "vegetable market Morocco": [produce] }, judge: first, verify: () => "GENERIC_OK" });
  const casablanca = stock("Vegetable stall at a market in Casablanca");
  const placedHome = await scenario({ draft: morocco, plan, libs: { "vegetable market Morocco": [casablanca] }, judge: first, verify: () => "GENERIC_OK" });
  check(
    "the check of a stand-in from nowhere names a stranger's face; the check of a photograph from the story's country does not",
    [placedNowhere.verifyPrompts.some((p) => p.includes("which can therefore only stand in")), placedHome.verifyPrompts.some((p) => p.includes("which can therefore only stand in")), placedHome.image?.title],
    [true, false, casablanca.title],
  );
  // (5) A photograph of the story's own country another story ran 30 days ago or more comes before an illustration from
  // elsewhere: the Moroccan souk had waited behind the neutral pass.
  const day = 24 * 60 * 60 * 1000;
  const ranSouk = file('"A Moroccan traditional market called "Souk.jpg', { description: 'This is an image with the theme "Farm to Plate"', date: "2025-04-10" });
  const rested = await scenario({ draft: morocco, plan, world: { "vegetable market Morocco": [ranSouk] }, libs: { "vegetable market": [produce] }, judge: first, verify: () => "GENERIC_OK", exclude: usedPhotos([{ url: ranSouk.url, at: Date.now() - 40 * day }]) });
  check(
    "a rested photograph of the story's own country runs before the illustration, which is not looked for",
    [rested.image?.title, rested.calls.includes("judge-neutral"), String(rested.image?.alt ?? "").includes(ILLUSTRATIVE)],
    [ranSouk.title, false, false],
  );
}

// The city pass (the owner, 2026-11-07, of Bloomberg's Downtown Dubai under DIP Holding's offering: "why not then use dubai
// city photo like bloomberg did?"; then: only economic hubs a reader knows the city by "without reading captions", never
// "city photos everywhere", and nothing approved by hand). Only a story about a city's own stock market, only files naming
// its business landmarks, never two in two days, no snapshot held.
{
  check("the stock-market stories of a hub city, and nothing else", [
    marketCity({ title: "طرح «دي آي بي هولدينغ» في دبي يجمع 1.9 مليار درهم" })?.city,
    marketCity({ title: "سهم بنك القاهرة يرتفع 7% في أولى جلسات تداوله بالبورصة المصرية" })?.city,
    marketCity({ title: "مؤشر الأسهم السعودية يقفز 3.4% في أكبر مكسب يومي منذ أكثر من عام" })?.city,
    marketCity({ title: "طرح «أكوا» السعودية في سوق دبي المالي" })?.city,
    marketCity({ title: "أرباح الدار ترتفع 19% في 9 أشهر رغم تراجع مبيعاتها في الإمارات" }),
    marketCity({ title: "«أرادَ» الإماراتية تدخل السوق السعودية بمشروع في الرياض قيمته 13.7 مليار درهم" }),
    marketCity({ title: "«إنسكايل» تجمع 3.36 مليار دولار بمشاركة مجلس أبوظبي للاستثمار قبل طرحها العام", subtitle: "صندوق التحوط «ثيرد بوينت» قاد جولة سندات تتحول إلى أسهم مع إتمام الطرح العام الأولي" }),
    marketCity({ title: "دبي تطرح مناقصة لتوسعة المترو" }),
    marketCity({ title: "سهم جيو يقفز 27% في أول تداول بعد أكبر طرح أولي في الهند" }),
    marketCity({ title: "أرامكو السعودية تدرج أسهماً في بورصة لندن" }),
  ], ["Dubai", "Cairo", "Riyadh", "Dubai", null, null, null, null, null, null]);
  const dip = { title: "طرح «دي آي بي هولدينغ» في دبي يجمع 1.9 مليار درهم", subtitle: "الأسهم المطروحة قائمة تبيعها الشركة الأم", lede: "حدّدت الشركة السعر النهائي لطرحها في سوق دبي المالي.", body: "فقرة.", tags: ["الإمارات", "سوق دبي المالي"], regions: ["الخليج"], kind: "news", section: "markets", imageQueries: [] };
  const plan = { queries: ["stock exchange traders"], place: ["United Arab Emirates", "UAE", "Emirati", "Dubai"], people: [], focus: "subject", places: [], place_queries: [], message: "investors buy a fifth of DIP Holding for its dividends" };
  const burj = file("Burj Khalifa and the Downtown Dubai skyline, 2024.jpg", { categories: "Downtown Dubai|Burj Khalifa", date: "2024-03-01" });
  const creek = file("Abra boats on Dubai Creek.jpg", { categories: "Dubai Creek" });
  const marina = file("Dubai Marina towers at dusk.jpg", { categories: "Dubai Marina" });
  const world = { "Burj Khalifa Downtown Dubai": [creek, burj], "Sheikh Zayed Road Dubai": [marina] };
  const hubJudge = (titles, prompt) => (prompt.includes("THE CITY'S BUSINESS DISTRICT") ? pickTitle("Burj Khalifa")(titles) : 0);
  const r = await scenario({ draft: dip, plan, world, judge: hubJudge, verify: () => "RIGHT" });
  const hubPrompt = r.judgePrompts.find((p) => p.includes("THE CITY'S BUSINESS DISTRICT")) ?? "";
  check("a Dubai stock-market story with nothing of its own runs Downtown Dubai, marked with its city and as a file photo", [r.image?.title, r.image?.hub, r.image?.alt?.includes("أرشيفية")], [burj.title, "Dubai", true]);
  check("only files naming the city's business landmarks reach its judge, who is not told that no skyline ever runs", [titlesIn(hubPrompt), hubPrompt.includes("is never chosen, whatever the story")], [[burj.title], false]);
  check("its categories are browsed, and the second check is told the city pass's exception", [r.searched.includes("category:Downtown Dubai"), r.verifyPrompts.some((p) => p.includes("So is Dubai's business district"))], [true, true]);
  const company = await scenario({ draft: { ...dip, title: "أرباح الدار ترتفع 19% في 9 أشهر رغم تراجع مبيعاتها في الإمارات", subtitle: "" }, plan, world, judge: hubJudge, verify: () => "RIGHT" });
  check("a company's own results get no city pass, and run as text", [company.searched.includes("Burj Khalifa Downtown Dubai"), company.image?.title ?? null], [false, null]);
  const rationed = await scenario({ draft: dip, plan, world, judge: hubJudge, verify: () => "RIGHT", recentHubs: [{ at: Date.now() - 10 * 3_600_000, slug: "saudi-index", hub: "Riyadh" }] });
  const later = await scenario({ draft: dip, plan, world, judge: hubJudge, verify: () => "RIGHT", recentHubs: [{ at: Date.now() - 50 * 3_600_000, slug: "saudi-index", hub: "Riyadh" }] });
  check("never two city photographs in two days: one ten hours ago rations it, one fifty hours ago does not", [rationed.searched.includes("Burj Khalifa Downtown Dubai"), rationed.image?.title ?? null, later.image?.title], [false, null, burj.title]);
  const snapshot = await scenario({ draft: dip, plan, world, judge: hubJudge, verify: (name, prompt) => (prompt.includes("already known to be a snapshot") ? "RIGHT" : "AMATEUR") });
  check("a snapshot of the city is never held back for it", snapshot.image?.title ?? null, null);
  const printed = { title: "Burj Khalifa and the Downtown Dubai skyline, 2024.jpg", categories: "Downtown Dubai", hub: "Dubai" };
  check("the audit holds a printed city photograph to the city pass's rules, and the code does not call it a front", [photoRules({ draft: dip, image: printed, audit: true }).includes("So is Dubai's business district"), publishedFault(printed, dip), publishedFault({ ...printed, hub: undefined }, dip) !== null], [true, null, true]);
  check("a file names the city's landmark; a creek does not", [namesHub(burj, hubByCity("Dubai")), namesHub(creek, hubByCity("Dubai"))], [true, false]);
  // The limit reads the stories as the newsroom and the morning round write them (YAML), so yesterday's city photo is seen.
  const tmp = mkdtempSync(path.join(tmpdir(), "khz-hubs-"));
  try {
    const at = "2026-11-07T08:00:00.000Z";
    const story = (image) => `---\n${YAML.stringify({ title: "عنوان", publishedAt: at, image, sources: [] }, { lineWidth: 0 }).trimEnd()}\n---\nفقرة.\n`;
    writeFileSync(path.join(tmp, "a.md"), story({ url: "https://x/1.jpg", alt: "أفق مدينة الكويت (أرشيفية)", credit: "c", hub: "Kuwait City" }));
    writeFileSync(path.join(tmp, "b.md"), story({ url: "https://x/2.jpg", alt: "ناقلة نفط", credit: "c" }));
    writeFileSync(path.join(tmp, "c.md"), story(null));
    check("the stories published with a city photograph are read back from their files, and only they", recentHubs(tmp).map((h) => [h.slug, h.hub, h.at]), [["a", "Kuwait City", Date.parse(at)]]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// V. The state's own accounts (the owner, 2026-10-31: a crowded Cairo street market, Ataba in 2019 under a phone billboard,
// ran under Egypt's budget deficit, the planner having made Ataba the story's place). No place tier, no search for a market,
// a street or a port, no market file before a judge or past the code; a market stays for what households pay.
{
  const budget = { ...developers, title: "عجز موازنة مصر يتقلص إلى 1.3% من الناتج في أول شهرين من عامها المالي", subtitle: "الإيرادات الضريبية تنمو 23.8% في يوليو وأغسطس", tags: ["مصر", "عجز الموازنة"], imageQueries: ["Cairo street shoppers", "Egyptian pound banknotes"] };
  check(
    "the state's accounts are read from the headline: a budget, the public debt, tax revenue; not a balance sheet, state banks, a subsidy or a dek",
    [
      treasuryStory(budget),
      treasuryStory({ title: "عجز الموازنة الأمريكية يقترب من تريليوني دولار في 2026" }),
      treasuryStory({ title: "الدين العام لمصر يرتفع إلى 12 تريليون جنيه" }),
      treasuryStory({ title: "الحصيلة الضريبية في السعودية تقفز 20%" }),
      treasuryStory({ title: "بكين تضخ 360 مليار يوان في ثماني مؤسسات مالية حكومية" }),
      treasuryStory({ title: "أرامكو تعزز الميزانية العمومية بإصدار سندات" }),
      treasuryStory({ title: "موازنة مصر الجديدة تخفض دعم الخبز" }),
      treasuryStory({ title: "«أنجلو جولد أشانتي» تطلب التنقيب عن الذهب", subtitle: "رصدت الشركة ميزانية بملايين الدولارات" }),
    ],
    [true, true, true, true, false, false, false, false],
  );
  // A review of 2026-10-31: household costs read as parts of words and anywhere in the headline hid four budgets, and a
  // company's rating with its nationality passed as the state's.
  check(
    "a budget is the state's despite «بدعم», «مرسوم» or oil prices in a cause; «عجزاً مالياً» is a deficit; a company's rating is not",
    [
      treasuryStory({ title: "هيلي يعد بدعم النمو في موازنة 28 أكتوبر مع التمسك بالانضباط المالي" }),
      treasuryStory({ title: "عجز موازنة السعودية يتسع 20% مع تراجع أسعار النفط" }),
      treasuryStory({ title: "الكويت تسجل عجزاً مالياً بقيمة 5 مليارات دينار" }),
      treasuryStory({ title: "مرسوم الميزانية يرفع الإنفاق العام" }),
      treasuryStory({ title: "فيتش تحوّل نظرتها المستقبلية لتصنيف فرنسا إلى سلبية مع تفاقم الدين" }),
      treasuryStory({ title: "فيتش تخفض تصنيف «أرامكو» السعودية" }),
      treasuryStory({ title: "موديز ترفع تصنيف البنك الأهلي السعودي" }),
      treasuryStory({ title: "مصر ترفع أسعار الوقود وتخفض عجز الموازنة" }),
    ],
    [true, true, true, true, true, false, false, false],
  );
  const iraq = { ...developers, title: "العراق يطلب بحث برنامج تمويلي محتمل مع صندوق النقد الدولي", tags: ["العراق"] };
  check(
    "a market fails the desk's code under the state's accounts only; a stock market is no market",
    [Boolean(publishedFault({ title: "Vegetable market in Cairo.jpg" }, budget)), Boolean(publishedFault({ title: "Street view", categories: "Markets in Cairo" }, budget)), publishedFault({ title: "Egyptian stock market traders.jpg" }, budget), publishedFault({ title: "Vegetable market in Baghdad.jpg" }, iraq)],
    [true, true, null, null],
  );
  const ataba = file("My photography of the Attaba area in Cairo (Egypt) in 2019.jpg", { categories: "Ataba" });
  const stalls = file("Vegetable market in Cairo 2024.jpg", { categories: "Markets in Cairo" });
  const notes = file("Egyptian pound notes in hand 2025.jpg", { categories: "Banknotes of Egypt" });
  const r = await scenario({
    draft: budget,
    plan: planFor({ queries: ["Cairo market shoppers", "Egyptian pounds"], places: ["Ataba"], place_queries: ["Ataba market Cairo"], categories: ["Markets in Cairo"], message_queries: ["vegetable market Cairo", "counting Egyptian pounds"] }),
    world: { "Ataba market Cairo": [ataba], Ataba: [ataba], "Cairo street shoppers": [stalls], "Cairo market shoppers": [stalls], "vegetable market Cairo": [stalls], "Egyptian pounds": [stalls, notes], "counting Egyptian pounds": [notes] },
    categoryWorld: { Ataba: [ataba], "Markets in Cairo": [stalls] },
    judge: (titles) => (titles.length ? 1 : 0),
    verify: () => "GENERIC_OK",
  });
  check(
    "a budget story searches no place, market or street; no market reaches a judge; the country's money runs",
    [r.searched.filter((q) => /ataba|market|street|category:/i.test(q)), r.judgePrompts.some((p) => p.includes("Vegetable market") || p.includes("Attaba")), r.image?.title],
    [[], false, notes.title],
  );
  check(
    "an advertisement for a brand the story does not name is refused by every judge and by the second check",
    [r.judgePrompts.length > 0 && r.judgePrompts.every((p) => p.includes("an advertisement, a billboard or a shop sign")), photoRules({ draft: budget, image: {} }).includes("an advertisement, a billboard or a shop sign")],
    [true, true],
  );
}

// W. One Pexels shoot is one picture: Qatar's LNG deal and the analysis beside it ran 38646186 and 38646168, the same carrier
// at the same sunset (2026-10-29).
{
  const lng = { ...developers, title: "قطر للطاقة توقع عقداً لتوريد الغاز المسال 20 عاماً", tags: ["قطر"], regions: ["الخليج"] };
  const sibling = { ...file("LNG carrier ship at sunset in the ocean"), url: "https://images.pexels.com/photos/38646168/pexels-photo-38646168.jpeg", library: "pexels" };
  const other = { ...file("LNG carrier ship at a loading terminal"), url: "https://images.pexels.com/photos/31000000/pexels-photo-31000000.jpeg", library: "pexels" };
  const r = await scenario({
    draft: lng,
    plan: planFor({ queries: ["LNG carrier ship"], place: [] }),
    libs: { "LNG carrier ship": [sibling, other] },
    exclude: new Set(["https://images.pexels.com/photos/38646186/pexels-photo-38646186.jpeg?auto=compress&cs=tinysrgb&w=1280"]),
    judge: (titles) => (titles.length ? 1 : 0),
    verify: () => "GENERIC_OK",
  });
  check("a frame of the Pexels shoot another story runs never reaches the judge; another photograph runs", [r.judgePrompts.some((p) => p.includes("at sunset")), r.image?.url], [false, other.url]);
}

// The owner, 2026-11-19, on the Anthropic IPO run as text while eight photographs of Dario Amodei at TechCrunch Disrupt
// 2023 were dropped because two September stories ran one frame each ("Yes, 30 and 90 days", then "Yes, make it 14 and 30
// days"): another frame of a shoot may run once the story that ran one is 14 days old, the same photograph once it is 30
// days old, and only as the last pass before none.
{
  const { usedPhotos, sharedPhotos, firstOfEachPhoto } = await import("../pipeline/lib/photo-key.mjs");
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-11-19T03:00:00Z");
  const at = (n) => `https://upload.wikimedia.org/wikipedia/commons/a/ab/Rest_${n}.jpg`;
  const thumb4 = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Rest_4.jpg/1280px-Rest_4.jpg";
  const used = usedPhotos(
    [
      { url: at(1), at: now - 5 * day },
      { url: at(2), at: now - 20 * day },
      { url: at(3), at: now - 40 * day },
      { url: at(4), at: now - 40 * day },
      { url: thumb4, at: now - 5 * day },
      { url: "/photos/handouts/abc.jpg", at: now - 200 * day },
      { url: at(6), at: NaN },
      { url: at(7), at: now - 200 * day },
    ],
    now,
    [at(7)],
  );
  check(
    "a used photograph rests by its youngest use: its shoot 14 days, itself 30; a handout, an undated story and a run's own pick stay out",
    [used.has(at(1)), used.has(`photo:${at(2)}`), used.has(`rested:${at(3)}`), used.has(thumb4), used.has("/photos/handouts/abc.jpg"), used.has(at(6)), used.has(at(7)), used.size],
    [true, true, true, true, true, true, true, 7],
  );
  const story = (slug, days) => ({ slug, at: now + days * day, image: { url: at(9) } });
  check("one photograph on two stories 30 days apart is no repeat; a third 10 days after the second is", sharedPhotos([story("a", 0), story("b", 35), story("c", 45)]), [{ slug: "c", keeps: "b" }]);
  check(
    "a listing prints a photograph once under any of its addresses",
    [...firstOfEachPhoto([{ id: "new", url: thumb4 }, { id: "old", url: at(4) }, { id: "other", url: at(1) }, { id: "none", url: null }])],
    ["new", "other"],
  );

  const amodei = { ...developers, title: "أنثروبيك تجمع 81.3 مليار دولار في أكبر طرح أولي بالتاريخ", tags: ["أنثروبيك"], regions: ["الأمريكتان"] };
  const plan = planFor({ queries: [], place: ["United States"], people: [{ name: "Dario Amodei", ar: "داريو أمودي", headline: "أنثروبيك" }], focus: "people" });
  const ran = file("Dario Amodei at TechCrunch Disrupt 2023 03.jpg", { date: "2023-09-20" });
  const other = file("Dario Amodei at TechCrunch Disrupt 2023 05.jpg", { date: "2023-09-20" });
  const frame = (days) => scenario({ draft: amodei, plan, world: { "Dario Amodei": [other] }, judge: (titles) => (titles.length ? 1 : 0), verify: () => "RIGHT", exclude: usedPhotos([{ url: ran.url, at: Date.now() - days * day }]) });
  const [fortnight, week] = [await frame(20), await frame(5)];
  check("another frame of a shoot runs once the story that ran one is 14 days old, never before", [fortnight.image?.title, week.image?.title ?? null], [other.title, null]);

  const tankers = { ...developers, title: "أسعار شحن ناقلات النفط ترتفع إلى أعلى مستوى في عام", tags: ["النفط"], regions: ["عالمي"], imageQueries: [] };
  const tankerPlan = planFor({ queries: ["oil tanker"], place: [] });
  const rested = file("Crude oil tanker at sea.jpg", { date: "2024-03-01" });
  const fresh = file("Oil tanker sailing at dawn.jpg", { date: "2025-03-01" });
  const again = (days, world) => scenario({ draft: tankers, plan: tankerPlan, world, judge: (titles) => (titles.length ? 1 : 0), verify: () => "GENERIC_OK", exclude: usedPhotos([{ url: rested.url, at: Date.now() - days * day }]) });
  const [old, young, beside] = [await again(40, { "oil tanker": [rested] }), await again(20, { "oil tanker": [rested] }), await again(40, { "oil tanker": [rested, fresh] })];
  check(
    "the same photograph runs again 30 days on, only when nothing else is found; never at 20 days",
    [old.image?.title, young.image?.title ?? null, beside.image?.title, beside.judgePrompts.some((p) => p.includes("Crude oil tanker"))],
    [rested.title, null, fresh.title, false],
  );
}

// X. A person's own photograph found by the search in Arabic is theirs: «سوندار بيتشاي» shares no word with «Google CEO
// Sundar Pichai», and the people pass dropped him as "not the story's people" (the audit of 2026-10-31).
{
  const { collect } = await import("../pipeline/lib/images.mjs");
  const pichai = file("Google CEO Sundar Pichai and Supermodel Karlie Kloss.jpg", { description: "Google CEO Sundar Pichai at an event, 2024" });
  const restore = withStandIns({ searchCommons: async (q) => (/[؀-ۿ]/.test(q) ? [pichai] : []), searchCommonsCategory: async () => [], searchLibraries: async () => [] });
  try {
    const found = await collect(["Sundar Pichai", "سوندار بيتشاي"], () => {}, { perQuery: 10, max: 20, people: "by-query", together: ["Sundar Pichai", "سوندار بيتشاي"], fronts: true, simplify: "names" });
    check("a person's own photograph found by the Arabic search is kept", found.map((f) => f.title), [pichai.title]);
  } finally {
    restore();
  }
}

// Y. The smaller picture faults of the audit of 2026-10-31.
{
  check("compound Arabic names stay whole", [arabicSearches("حسن عبد الله"), arabicSearches("عبد الرحمن بن سعيد آل خليفة")], [["حسن عبد الله"], ["عبد الرحمن بن سعيد آل خليفة", "عبد الرحمن آل خليفة"]]);
  check("a JPEG served as bare bytes is read by its opening bytes; a page is not", [sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), sniffImage(Buffer.from("<html>"))], ["image/jpeg", null]);
  check(
    "a decision on rates is read from the headline; officials' remarks and a market's expectations are not one",
    [RATE_DECISION.test("المركزي المصري يرفع الفائدة 100 نقطة أساس في أول زيادة منذ مارس 2024"), RATE_DECISION.test("المركزي الإماراتي يبقي سعر الأساس عند 3.90% بعد تثبيت الفيدرالي"), RATE_DECISION.test("مسؤولان في الفيدرالي الأمريكي يريان حاجة إلى رفع الفائدة مجدداً"), RATE_DECISION.test("ضغط السياسيين على الفيدرالي طلباً للتيسير يخفض توقعات الفائدة القريبة")],
    [true, true, false, false],
  );
  const fed = { ...developers, title: "مسؤولان في الفيدرالي الأمريكي يريان حاجة إلى رفع الفائدة مجدداً", tags: ["الاحتياطي الفيدرالي"], regions: ["الأمريكتان"] };
  const r = await scenario({ draft: fed, plan: planFor({ queries: ["traders screens"], place: [] }), world: {}, judge: () => 0, lastResort: { scene: null, country: "United States", institution: "Federal Reserve", city: null } });
  check("a central bank's building is searched only under its own decision", r.searched.some((q) => /Federal Reserve/.test(q)), false);
  // Pakistan's State Bank under its own rate rise is a central bank (the audit of 31 October: it was "not a central bank").
  const sbp = { ...developers, title: "المركزي الباكستاني يرفع الفائدة إلى 12% في أول زيادة منذ أبريل", tags: ["باكستان"], regions: ["آسيا"] };
  const p = await scenario({ draft: sbp, plan: planFor({ queries: ["traders screens"], place: [] }), world: {}, judge: () => 0, lastResort: { scene: null, country: "Pakistan", institution: "State Bank of Pakistan", city: null } });
  check("Pakistan's State Bank is searched under its own rate decision", p.searched.some((q) => /State Bank of Pakistan/.test(q)), true);
  const marked = await scenario({ draft: { ...sbp, title: "المركزي الباكستاني يُثبّت الفائدة عند 12%" }, plan: planFor({ queries: ["traders screens"], place: [] }), world: {}, judge: () => 0, lastResort: { scene: null, country: "Pakistan", institution: "State Bank of Pakistan", city: null } });
  check("…and so it is when the decision carries its vowel marks («يُثبّت»)", marked.searched.some((q) => /State Bank of Pakistan/.test(q)), true);
  // A commercial bank and a tower called Sama are no central bank (a review of 2026-10-31); SAMA's own building is.
  const cbe = { ...developers, title: "المركزي المصري يثبت الفائدة", tags: ["مصر"] };
  check(
    "the National Bank of Egypt and Sama Tower are fronts; the Central Bank of Egypt and SAMA are central banks",
    ["National Bank of Egypt headquarters, Cairo.jpg", "Sama Tower, Dubai skyline.jpg", "Central Bank of Egypt headquarters, Cairo.jpg", "SAMA headquarters, Riyadh.jpg"].map((title) => Boolean(publishedFault({ title }, cbe))),
    [true, true, false, false],
  );
  // A sovereign rating and the state's own deficit are its accounts (the audit of 31 October); a company's rating, a
  // trade deficit and a bond yield are not.
  check(
    "a sovereign rating and the state's deficit are the state's accounts; a company's rating, a trade deficit, a yield are not",
    ["موديز تبقي تصنيف فرنسا عند Aa3 مع نظرة سلبية", "«ستاندرد آند بورز» تثبّت تصنيف السعودية الائتماني مع نظرة مستقرة", "العجز المالي في المغرب يبلغ 4%", "الحكومة المغربية تتوقع بلوغ العجز سقفه البالغ 3% في 2026", "موديز ترفع تصنيف أرامكو", "العجز التجاري لمصر يتسع", "عائد السندات الفرنسية يتجاوز 5%"].map((title) => treasuryStory({ title })),
    [true, true, true, true, false, false, false],
  );
  const mines = { title: "الحرس الثوري: ألغام بحرية تفجّر 3 ناقلات نفط جنوبي مضيق هرمز", subtitle: "", tags: [] };
  const rates = { ...developers, title: "المركزي المصري يرفع الفائدة 100 نقطة أساس في أول زيادة منذ مارس 2024", tags: ["مصر"] };
  const money = await scenario({ draft: rates, plan: planFor({ queries: ["counting Egyptian pounds", "Egyptian pound notes"], place: ["Egypt", "Egyptian", "Cairo"] }), world: {}, judge: () => 0 });
  check("the last neutral pass keeps a currency's country", money.searched.filter((q) => /^(?:counting pounds|pound notes)$/.test(q)), []);
  check("a story of mines and the Revolutionary Guard may show the Guard's boats", publishedFault({ title: "Iranian IRGC speedboat approaching US vessels (1).jpg", description: "Iranian naval forces" }, mines), null);
}

// Openverse down (2026-10-30): six searches of one pass, every one timing out. Three go out; the breaker opens on the third
// failure and the three queued behind them are never sent. Counted after the turn was handed on, all six went out. Last in
// this file: the breaker it opens rests Openverse for ten minutes in this process.
{
  const { searchOpenverse } = await import("../pipeline/lib/photolibs.mjs");
  const realFetch = globalThis.fetch;
  let sent = 0;
  // Healthy first, one failure among the answers: every search is still sent.
  let answered = 0;
  globalThis.fetch = async () => {
    answered += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (answered === 2) throw new Error("The operation was aborted due to timeout");
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await Promise.all(["m n", "o p", "q r", "s t", "u v", "w x"].map((q) => searchOpenverse(q, { log: () => {} })));
  } finally {
    globalThis.fetch = realFetch;
  }
  check("Openverse answering, with one timeout among its answers: every search is sent", answered, 6);
  globalThis.fetch = async () => {
    sent += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    throw new Error("The operation was aborted due to timeout");
  };
  try {
    await Promise.all(["a b", "c d", "e f", "g h", "i j", "k l"].map((q) => searchOpenverse(q, { log: () => {} })));
  } finally {
    globalThis.fetch = realFetch;
  }
  check("Openverse timing out: three searches are sent, and none queued behind them once the breaker opens", sent, 3);
}

// A market of one traditional product is folklore under an economy's figures (the owner, 2026-11-01, on a date market
// under Saudi Arabia's third-quarter GDP: "not the best choice in my opinion"); a story about that product keeps it.
{
  const gdp = { title: "انكماش الاقتصاد السعودي يتباطأ إلى 3.8% في الربع الثالث", subtitle: "الناتج نما 1.3% بقيادة الأنشطة النفطية", lede: "انكمش الناتج المحلي الإجمالي الحقيقي للسعودية 3.8%.", body: "" };
  const dates = { title: "صادرات السعودية من التمور ترتفع 12% في 9 أشهر", subtitle: "", lede: "ارتفعت صادرات التمور السعودية.", body: "" };
  const souq = { title: "Vibrant scene of a traditional date market in Saudi Arabia with shoppers", description: "", categories: "" };
  check("a date market under Saudi GDP is folklore", Boolean(noveltyFault(souq, gdp)), true);
  check("its Arabic caption is read too («سوق للتمور»)", Boolean(noveltyFault({ title: "Market scene", alt: "بائع ومتسوقون في سوق للتمور في السعودية" }, gdp)), true);
  check("a date market under a story about dates stays", noveltyFault(souq, dates), null);
  check("an everyday market of many goods is not folklore («Shorja market»)", noveltyFault({ title: "Shoppers at Shorja market, Baghdad, 2024" }, gdp), null);
  check("«المستمر» is not dates", noveltyFault(souq, { ...gdp, lede: "مع النمو المستمر للأنشطة غير النفطية" }) !== null, true);
}

// An armed group's claim with nothing of what it hit to show: its spokesman, as the desks run him, the last picture before
// text (the owner, 2026-11-05: "what if what it hits is not available? then maybe use the spokesperson?"); and never a
// photograph with another's stamp on it ("i do not want pictures to have other agencies logos on it or logos like getty
// image etc").
{
  const houthi = {
    ...developers,
    title: "الحوثيون يعلنون استهداف منشآت نفطية في رأس تنورة",
    subtitle: "أرامكو لم تعلق على الإعلان",
    lede: "قال المتحدث العسكري باسم الحوثيين يحيى سريع إن الجماعة استهدفت منشآت نفطية في رأس تنورة.",
    tags: ["السعودية", "الحوثيون", "النفط"],
    regions: ["الخليج"],
    section: "energy",
  };
  const saree = { name: "Yahya Saree", ar: "يحيى سريع", headline: "الحوثيون" };
  check("the spokesman the story names, beside a group its headline names, is the claimant", groundedClaimant(houthi, saree)?.name, "Yahya Saree");
  check(
    "a spokesman the story and its sources never name is not (he may have left the post); nor is one whose group the headline does not name",
    [groundedClaimant({ ...houthi, lede: "أعلنت الجماعة استهداف منشآت نفطية." }, saree), groundedClaimant({ ...houthi, title: "أرامكو: منشآت رأس تنورة تعمل بصورة طبيعية" }, saree)],
    [null, null],
  );
  check("his Latin name in a source counts; «سريع» as an adjective does not", [groundedClaimant({ ...houthi, lede: "أعلنت الجماعة الهجوم." }, saree, [{ text: "Houthi military spokesman Yahya Saree said the group fired drones." }])?.name, groundedClaimant({ ...houthi, lede: "أعلنت الجماعة الهجوم بعد ارتفاع سريع للتوتر." }, saree)], ["Yahya Saree", null]);
  check(
    "the agencies that stamp their photographs are read from a file's record",
    [stampedSource({ categories: "CC-BY-4.0|Hossein Mohebi|Photos from Mehrnews.com" }), stampedSource({ categories: "2025 in Yemen|Photos from Tasnim News Agency" }), stampedSource({ categories: "Oil terminals in Saudi Arabia", artist: "Tester" })],
    ["Mehrnews", "Tasnim News", ""],
  );
  // A place or a given name is no agency (the review of 2026-11-06): Isna on the Nile, a photographer called Tasnim.
  check("«Isna» the town and a photographer called Tasnim are no agencies", [stampedSource({ categories: "Isna|Temples in Egypt" }), stampedSource({ artist: "Tasnim Ahmed" })], ["", ""]);
  // A rank in the planner's Arabic name, and the spokesman listed among the story's people too (the same review).
  check("«العميد يحيى سريع» finds «يحيى سريع» in the story", groundedClaimant(houthi, { ...saree, ar: "العميد يحيى سريع" })?.name, "Yahya Saree");
  // A group whose name begins with a clitic's letter, after «و» in the headline (2026-11-20): «وكتائب» had read «كتائب»
  // and the quoted «كتائب» «تائب».
  const kataib = { ...houthi, title: "الجيش العراقي وكتائب حزب الله يتبادلان الاتهامات بعد هجوم على حقل غاز", lede: "قال المسؤول الأمني في كتائب حزب الله أبو علي العسكري إن الكتائب لم تنفذ الهجوم." };
  check("a group named after «و» whose name begins with «ك» is the headline's group", groundedClaimant(kataib, { name: "Abu Ali al-Askari", ar: "أبو علي العسكري", headline: "كتائب حزب الله" })?.name, "Abu Ali al-Askari");
  const stampedFile = { title: "2026. Yahya Saree.jpg", categories: "2025 in Yemen|Photos from Tasnim News Agency" };
  const withSpokesman = photoRules({ draft: houthi, image: stampedFile, people: ["Yahya Saree"], known: ["Yahya Saree"], thumbnail: "data:image/jpeg;base64,AAAA", claimant: "Yahya Saree" });
  const without = photoRules({ draft: houthi, image: { title: "Ras Tanura.jpg" }, thumbnail: "data:image/jpeg;base64,AAAA" });
  check(
    "the second check takes the spokesman only in his pass, refuses a stamp it sees, and is told to look for one on an agency's file",
    [withSpokesman.includes("So is Yahya Saree"), withSpokesman.includes("an armed group's spokesman, commander or fighters"), without.includes("an armed group's spokesman, commander or fighters"), withSpokesman.includes("- WATERMARK:"), withSpokesman.includes("comes from Tasnim"), without.includes("comes from")],
    [true, false, true, true, true, false],
  );

  const terminal = file("Ras Tanura oil terminal, Saudi Arabia.jpg", { categories: "Ras Tanura|Oil terminals in Saudi Arabia" });
  const portrait = file("2026. Yahya Saree.jpg", { categories: "2025 in Yemen|Photos from Tasnim News Agency", date: "2026-05-02" });
  const world = { "oil terminal Saudi Arabia": [terminal], "Yahya Saree 2026": [portrait], "Yahya Saree": [portrait] };
  const plan = planFor({ queries: ["oil terminal Saudi Arabia"], place: ["Saudi Arabia"], claimant: saree });
  const choose = (titles) => titles.findIndex((t) => t.includes("Ras Tanura") || t.includes("Saree")) + 1;
  const hit = await scenario({ draft: houthi, plan, world, judge: choose, verify: () => "RIGHT" });
  check("what the attack hit runs when it passes, and the spokesman is never searched", [hit.image?.title, hit.searched.some((q) => q.includes("Saree"))], [terminal.title, false]);
  const refusedHit = (name) => (name.includes("Ras Tanura") ? "WRONG_SUBJECT" : "RIGHT");
  const last = await scenario({ draft: houthi, plan, world, judge: choose, verify: refusedHit });
  check(
    "nothing of what it hit passes: the spokesman runs, marked as a file photo, and his check is told he is this pass's subject",
    [last.image?.title, String(last.image?.alt ?? "").includes("أرشيفية"), last.verifyPrompts.some((p) => p.includes("File name: 2026. Yahya Saree.jpg") && p.includes("So is Yahya Saree")), last.judgePrompts.some((p) => p.includes("THE GROUP'S SPOKESMAN"))],
    [portrait.title, true, true, true],
  );
  // The real planner spelled him «Yahya Sare'e», and Commons files him as «Yahya Saree» (2026-11-05).
  const spelled = await scenario({ draft: houthi, plan: { ...plan, claimant: { ...saree, name: "Yahya Sare'e" } }, world, judge: choose, verify: refusedHit });
  check("a planner's apostrophe («Yahya Sare'e») does not lose him: the plain spelling is searched first", [spelled.image?.title, spelled.searched.includes("Yahya Saree 2026")], [portrait.title, true]);
  // The review of 2026-11-06: every pass before his calls him WRONG_SUBJECT, and that refusal hid him from his own pass;
  // and his record's «military spokesman» dropped him as a warship.
  const ownPassOnly = (name, prompt) => (name.includes("Saree") && prompt.includes("So is Yahya Saree") ? "RIGHT" : "WRONG_SUBJECT");
  const statement = file("2026. Yahya Saree.jpg", { categories: "2025 in Yemen", date: "2026-05-02", description: "Yahya Saree reads a statement in Sanaa" });
  const foundEarly = await scenario({
    draft: houthi,
    plan: { ...plan, queries: ["oil terminal Saudi Arabia", "Houthi statement Sanaa"] },
    world: { "oil terminal Saudi Arabia": [terminal], "Houthi statement Sanaa": [statement], "Yahya Saree 2026": [statement], "Yahya Saree": [statement] },
    judge: (titles) => titles.findIndex((t) => t.includes("Saree")) + 1 || choose(titles),
    verify: ownPassOnly,
  });
  const military = file("2026. Yahya Saree.jpg", { categories: "2025 in Yemen", date: "2026-05-02", description: "Yahya Saree, the Houthi military spokesman, reads a statement in Sanaa" });
  const inUniform = await scenario({ draft: houthi, plan, world: { ...world, "Yahya Saree 2026": [military], "Yahya Saree": [military] }, judge: choose, verify: ownPassOnly });
  check(
    "his photograph refused by an earlier pass still runs in his own, and «military spokesman» in its record does not drop it",
    [foundEarly.image?.title, foundEarly.calls.filter((c) => c === "verify:2026. Yahya Saree.jpg").length >= 2, inUniform.image?.title],
    [portrait.title, true, military.title],
  );
  const alsoPeople = await scenario({ draft: houthi, plan: { ...plan, people: [{ name: "Yahya Saree", ar: "يحيى سريع", headline: "الحوثيون" }], focus: "people" }, world, judge: choose, verify: () => "RIGHT" });
  check("a spokesman the planner also lists among the story's people is not searched ahead of what his group hit", [alsoPeople.image?.title, alsoPeople.searched.some((q) => q.includes("Saree"))], [terminal.title, false]);
  const unnamed = await scenario({ draft: { ...houthi, lede: "أعلنت الجماعة استهداف منشآت نفطية في رأس تنورة." }, plan, world, judge: choose, verify: refusedHit });
  check("a spokesman the story does not name is never searched, and the story runs as text", [unnamed.image, unnamed.searched.some((q) => q.includes("Saree"))], [null, false]);

  // A refusal for a stamp is a refusal for what the frame shows: the neutral last pass never offers it again.
  const iran = { ...developers, title: "صادرات النفط الإيرانية ترتفع إلى 1.8 مليون برميل يومياً", tags: ["إيران", "النفط"], regions: ["المشرق وإيران وتركيا"], section: "energy" };
  const stampedTanker = file("Oil tanker at Kharg island 2026.jpg", { categories: "Kharg Island|Photos from Tasnim News Agency" });
  const r = await scenario({
    draft: iran,
    plan: planFor({ queries: ["oil tanker Iran"], place: ["Iran"] }),
    world: { "oil tanker Iran": [stampedTanker], "oil tanker": [stampedTanker] },
    judge: pickTitle("Kharg"),
    verify: (name) => (name.includes("Kharg") ? "WATERMARK" : "RIGHT"),
  });
  check(
    "a stamped frame is refused once and never offered again, and every judge is told no other name may be stamped on the picture",
    [r.image, r.calls.filter((c) => c.startsWith("verify:")).length, r.judgePrompts.every((p) => p.includes("NO OTHER NAME STAMPED ON THE PICTURE"))],
    [null, 1, true],
  );
  // 2026-11-06: a crane under a holding company's results, Nakilat's «موزة» under the attack on its «المايده», and
  // rescuers in rubble under a development loan, all passed by the check.
  const strictRules = photoRules({ draft: iran, image: { title: "x.jpg" }, thumbnail: "data:x" });
  const neutralRules = photoRules({ draft: iran, image: { title: "x.jpg" }, thumbnail: "data:x", neutral: true });
  check(
    "every judge and the check hold one sector for many news, another named vessel (not in the neutral pass), and people in distress under money",
    [r.judgePrompts.every((p) => p.includes("ONE SECTOR FOR MANY") && (p.includes("LAST PASS") || p.includes("THE STORY'S OWN VESSEL"))), strictRules.includes("a scene of one business or sector standing for news that spans several"), strictRules.includes("another named ship, aircraft or rig"), neutralRules.includes("another named ship, aircraft or rig"), strictRules.includes("People in distress")],
    [true, true, true, false, true],
  );
}

// Heads of state's own photographers (the owner, 2026-11-21, on the US-China-Russia summit: "these countries must have
// published images", then "Yes, build it"). The summit story ran Trump stepping off his aircraft while the Kremlin had
// posted the three leaders' meeting hours before. Pages trimmed from the offices' own markup of 21 November.
{
  const KR = "http://en.kremlin.ru";
  const WH = "https://www.whitehouse.gov";
  const krItem = (id, title, date, { place = "Shenzhen", photos = 0 } = {}) =>
    `<div class="hentry h-entry hentry_event" data-id="${id}" itemscope="itemscope" role="listitem"> <h3 class="hentry__title"> <a href="/events/president/news/${id}" rel="bookmark"><span class="entry-title p-name" itemprop="name">${title}</span> <span class="hentry__meta"> <time class="published dt-published" datetime="${date}" itemprop="datePublished">${date}, 11:30</time> <span class="hentry__location p-location">${place}</span> </span> </a> </h3> <div class="hentry__assets">${photos ? ` <a href="/events/president/news/${id}/photos" itemprop="url" class="tabs_photo item" title="Related photos" rel="bookmark" hidden> <i><span class="tabs__count">${photos}</span></i> </a>` : ""} </div> </div>`;
  const krList = [
    krItem(900, "Meeting with President of China and President of the United States", "2026-11-19", { photos: 2 }),
    krItem(899, "Conversation with President of Tajikistan Emomali Rahmon", "2026-11-18", { photos: 1 }),
    krItem(898, "Greetings to the Transport of Russia Forum", "2026-11-18"),
    krItem(850, "Meeting with Security Council members", "2026-11-01", { photos: 4, place: "Moscow" }),
  ].join("\n");
  const slide = (caption, n) => `<div class="slide" data-cycle-desc="${caption}"> <div class="slider__block" data-text="${caption}"> <img src="http://static.kremlin.ru/media/events/photos/big/SmallCopyNumber00${n}.jpg" srcset="http://static.kremlin.ru/media/events/photos/big2x/LargeCopyNumber00${n}.jpg 2x" width="940" height="580" alt="${caption}"/> </div> </div>`;
  const krEvent = `<div class="read__lead entry-summary p-summary" itemprop="description"><p>A trilateral meeting between President of Russia Vladimir Putin, President of China Xi Jinping and US President Donald Trump took place on the sidelines of the APEC Summit in Shenzhen.</p></div> ${slide("With President of the People&#8217;s Republic of China Xi Jinping and President of the United States Donald Trump.", 1)} ${slide("Before the meeting.", 2)}`;
  const whItem = (slug, cover) => `<li data-wp-key="post-template-item-1" class="wp-block-post gallery"> <div class="wp-block-cover"><a class="wp-block-cover__action" href="${WH}/gallery/${slug}/"></a><img width="1024" height="683" src="${WH}/wp-content/uploads/2026/11/cover_o.jpg?w=1024" class="wp-post-image" alt="${cover}" /></div></li>`;
  const whList = [
    whItem("president-donald-j-trump-visits-china-november-18-19-2026", "President Donald J. Trump participates in a trilateral meeting with Russian President Vladimir Putin and Chinese President Xi Jinping at Kylin Villa in Shenzhen, China, Thursday, November 19, 2026. (Official White House Photo by Daniel Torok)"),
    whItem("president-donald-j-trump-signs-executive-orders-november-20-2026", "President Donald J. Trump signs executive orders in the Oval Office, Friday, November 20, 2026. (Official White House Photo by Molly Riley)"),
  ].join("\n");
  const whImg = (file, w, h, alt) => `<figure class="wp-block-image size-large"><img decoding="async" height="${h}" width="${w}" data-id="1" src="${WH}/wp-content/uploads/2026/11/${file}?w=1200" alt="${alt}" class="wp-image-1 wh-gallery-lightbox-image" /></figure>`;
  const whGallery = [
    whImg("p20261119dt-0839_55662874378_o.jpg", 1200, 800, "President Donald J. Trump participates in a trilateral meeting with Russian President Vladimir Putin and Chinese President Xi Jinping at Kylin Villa in Shenzhen, China, Thursday, November 19, 2026. (Official White House Photo by Daniel Torok)"),
    // A pool photographer's frame the site reposts, and a portrait frame: never offered.
    whImg("pool_55660000001_o.jpg", 1200, 800, "President Donald J. Trump shakes hands with Chinese President Xi Jinping. (AP Photo/Mark Schiefelbein)"),
    whImg("p20261119dt-0900_55662874399_o.jpg", 1200, 1800, "President Donald J. Trump walks with Chinese President Xi Jinping. (Official White House Photograph by Daniel Torok)"),
  ].join("\n");
  const [whSource, krSource] = OFFICIAL_SOURCES;
  const krEvents = parseKremlinList(krList);
  check("the Kremlin's list gives its events with photographs, with their dates and places", krEvents.map((e) => [e.id, e.date, e.place, e.photos]), [["900", "2026-11-19", "Shenzhen", 2], ["899", "2026-11-18", "Shenzhen", 1], ["850", "2026-11-01", "Moscow", 4]]);
  const krPhotos = parseKremlinPhotos(krEvent, krEvents[0], krSource);
  check(
    "a Kremlin event's frames: the caption, the 940 copy to judge, the 1880 copy to keep, its credit and where it is kept",
    [krPhotos.length, krPhotos[0].title, krPhotos[0].thumb.endsWith("/big/SmallCopyNumber001.jpg"), krPhotos[0].url.endsWith("/big2x/LargeCopyNumber001.jpg"), [krPhotos[0].width, krPhotos[0].height], krPhotos[0].description.includes("Xi Jinping"), krPhotos[0].pageUrl, attributionLine(krPhotos[0]), krPhotos[0].stored],
    [2, "With President of the People’s Republic of China Xi Jinping and President of the United States Donald Trump.", true, true, [1880, 1160], true, `${KR}/events/president/news/900/photos`, "kremlin.ru · CC BY 4.0 · الكرملين", "official-kremlin-LargeCopyNumber001.jpg"],
  );
  const whEvents = parseWhiteHouseList(whList);
  check("the White House's galleries, dated by their own addresses", whEvents.map((e) => [e.date, e.title]), [["2026-11-19", "President Donald J Trump Visits China"], ["2026-11-20", "President Donald J Trump Signs Executive Orders"]]);
  const whPhotos = parseWhiteHousePhotos(whGallery, whEvents[0], whSource);
  check(
    "a White House gallery gives only its own photographers' landscape frames, credited to the photographer, kept under the Flickr number",
    [whPhotos.length, whPhotos[0]?.artist, attributionLine(whPhotos[0] ?? {}), whPhotos[0]?.stored, whPhotos[0]?.title.includes("Official White House")],
    [1, "Daniel Torok", "Daniel Torok · Public domain · البيت الأبيض", "official-whitehouse-55662874378.jpg", false],
  );
  check("a date written out, a range's last day, none", [englishDate("Thursday, November 19, 2026"), englishDate("visits-china-november-18-19-2026"), englishDate("veterans-day-2026")], ["2026-11-19", "2026-11-19", null]);
  const commonsCopy = file("Xi–Putin–Trump summit - P20261119DT-0839 (55662874378).jpg").url;
  check(
    "a White House frame, its copy kept on the site and its Commons copy are one photograph; so are a Kremlin frame and its kept copy",
    [photoKey(whPhotos[0]?.url), photoKey("/photos/handouts/official-whitehouse-55662874378.jpg"), photoKey(commonsCopy), photoKey(krPhotos[0].url) === photoKey(`/photos/handouts/${krPhotos[0].stored}`)],
    ["flickr:55662874378", "flickr:55662874378", "flickr:55662874378", true],
  );
  const summit = {
    title: "ترامب وشي وبوتين يعتزمون زيادة إنتاج المشتقات النفطية وإمداداتها",
    subtitle: "تعهد ثلاثي خلال قمة شنتشن",
    lede: "اتفق الرؤساء الثلاثة خلال اجتماعهم في شنتشن على زيادة إنتاج المشتقات.",
    body: "فقرة من المتن.",
    tags: ["المشتقات النفطية", "الولايات المتحدة", "الصين", "روسيا"],
    regions: ["عالمي", "آسيا"],
    kind: "news",
    section: "energy",
    publishedAt: "2026-11-19T11:54:48Z",
    imageQueries: [],
  };
  check(
    "an office is read when its leader is the headline's: by the planner's names, by the Arabic name alone, never for another leader",
    [officialSourcesFor(summit, []).map((s) => s.id), officialSourcesFor({ title: "الصين تخفض الفائدة" }, ["Donald J. Trump"]).map((s) => s.id), officialSourcesFor({ title: "شي يدعو إلى التعاون" }, ["Xi Jinping"]).map((s) => s.id)],
    [["whitehouse", "kremlin"], ["whitehouse"], []],
  );
  const home = { title: "ترامب يدرس حظر صادرات الديزل", tags: ["الولايات المتحدة"], regions: ["الولايات المتحدة"] };
  check(
    "an office's event is the story's when it names another of its people, another of its countries or its own event; never the office's own country alone",
    [
      officialEventFits(whEvents[0], { source: whSource, draft: summit, others: ["Xi Jinping", "Vladimir Putin"] }),
      officialEventFits(krEvents[0], { source: krSource, draft: summit, others: [] }),
      officialEventFits(krEvents[1], { source: krSource, draft: summit, others: ["Xi Jinping"] }),
      officialEventFits({ title: "Plenary session of the APEC Summit", place: "Shenzhen" }, { source: krSource, draft: { title: "بوتين يدعو إلى تجارة حرة", tags: ["روسيا"] }, events: ["APEC Summit 2026"] }),
      officialEventFits({ title: "Plenary session of the Leaders' Summit", place: "Moscow" }, { source: krSource, draft: { title: "بوتين يدعو إلى تجارة حرة", tags: ["روسيا"] }, events: ["Leaders' Summit"] }),
      officialEventFits(whEvents[1], { source: whSource, draft: home, others: [] }),
      officialEventFits(whEvents[0], { source: whSource, draft: home, others: [] }),
    ],
    ["it names Xi Jinping", "it names China", null, "it names APEC", null, null, null],
  );
  const official = { [`${KR}/events/president/news`]: krList, [`${KR}/events/president/news/900`]: krEvent, [`${WH}/gallery/`]: whList, [`${WH}/gallery/president-donald-j-trump-visits-china-november-18-19-2026/`]: whGallery };
  const summitPlan = planFor({
    queries: ["oil refinery"],
    place: [],
    focus: "people",
    people: [
      { name: "Donald Trump", ar: "دونالد ترامب", headline: "ترامب" },
      { name: "Xi Jinping", ar: "شي جين بينغ", headline: "شي" },
      { name: "Vladimir Putin", ar: "فلاديمير بوتين", headline: "بوتين" },
    ],
  });
  {
    const r = await scenario({ draft: summit, plan: summitPlan, official, photoDir: "C:/site/public/photos/handouts", judge: pickTitle("trilateral") });
    check(
      "the summit runs the White House's own frame of the three leaders, kept on the site and credited to its photographer, before any library is searched",
      [r.image?.basis, r.image?.url, r.image?.credit, r.image?.license, r.image?.pageUrl, r.saved.map((p) => path.basename(p)), r.searched.length, r.judgePrompts[0]?.includes("THE OFFICES' OWN PHOTOGRAPHS")],
      ["official", "/photos/handouts/official-whitehouse-55662874378.jpg", "Daniel Torok · Public domain · البيت الأبيض", "Public domain", `${WH}/gallery/president-donald-j-trump-visits-china-november-18-19-2026/`, ["official-whitehouse-55662874378.jpg"], 0, true],
    );
    check(
      "the judge sees the frames naming most of the headline's people first, and never the pool photographer's or a portrait",
      [titlesIn(r.judgePrompts[0]).slice(0, 2).map((t) => t.split(" ").slice(0, 4).join(" ")), r.judgePrompts.some((p) => p.includes("AP Photo") || p.includes("walks with"))],
      [["President Donald J. Trump", "With President of the"], false],
    );
  }
  {
    // A story that ran the White House frame's Commons copy a week ago keeps it: the Kremlin's frame runs instead.
    const r = await scenario({ draft: summit, plan: summitPlan, official, photoDir: "C:/site/public/photos/handouts", exclude: new Set([commonsCopy]), judge: () => 1 });
    check("a frame another story runs as its Commons copy is never offered again; the other office's frame runs", [r.image?.url, r.image?.credit], ["/photos/handouts/official-kremlin-LargeCopyNumber001.jpg", "kremlin.ru · CC BY 4.0 · الكرملين"]);
  }
  {
    // A Trump story about a decision at home: one listing read, no gallery opened, no judge shown an office's frame.
    const r = await scenario({ draft: { ...summit, title: "ترامب يدرس حظر صادرات الديزل", tags: ["الولايات المتحدة"], regions: ["الولايات المتحدة"] }, plan: planFor({ queries: ["diesel pump"], place: [], people: [{ name: "Donald Trump", ar: "دونالد ترامب", headline: "ترامب" }], focus: "subject" }), official, judge: () => 0 });
    check("a story about something done at home reads one listing and shows no office's frame", [r.officialReads, r.judgePrompts.some((p) => p.includes("THE OFFICES' OWN PHOTOGRAPHS"))], [[`${WH}/gallery/`], false]);
  }
  {
    // The offices do not answer: the cascade goes on to the Commons people search, as before.
    const r = await scenario({ draft: summit, plan: summitPlan, official: {}, judge: () => 0 });
    check("offices that do not answer leave the cascade as it was", [r.image?.basis ?? null, r.officialReads.length > 0, r.searched.some((q) => q.startsWith("Donald Trump Xi Jinping"))], [null, true, true]);
  }
  {
    // The judge refuses the occasion (the story reports something else): no photograph is kept, the cascade goes on.
    const r = await scenario({ draft: summit, plan: summitPlan, official, photoDir: "C:/site/public/photos/handouts", judge: () => 0 });
    check("a judge who refuses the offices' frames keeps none of them", [r.image?.basis ?? null, r.saved.length, r.searched.length > 0], [null, 0, true]);
  }
}

// Japan's, India's and the European Commission's offices (the owner, 2026-11-21: "add the other offices too, ukraine, EU,
// india, japan"). Pages and answers trimmed from the offices' own of 21 November. Ukraine's presidency and the European
// Council wall off every automated reader and are not in the registry.
{
  const byId = Object.fromEntries([...OFFICIAL_SOURCES, ...HELD_SOURCES].map((s) => [s.id, s]));
  const KANTEI = "https://japan.kantei.go.jp";
  const kanteiHome = `<a href="/105/actions/index.html">Prime Minister in Action</a> <a href="/105/speech/index.html">Speeches</a>`;
  const kanteiItem = (href, title, date, desc) => `<li class="list-photo__item"> <a class="list-photo__link" href="${href}"> <div class="list-photo__media"> <img alt="x" src="/contents/topics/1_ext_29_0.jpg" class="list-photo__image" width="480" height="320"> </div> <div class="list-photo__content"> <div class="list-photo__heading"> <p class="list-photo__title">${title}</p> <time class="list-photo__date" datetime="${date}"> ${date} </time> </div> <p class="list-photo__description">${desc}</p> </div> </a> </li>`;
  const kanteiList = [
    kanteiItem("/105/actions/202611/19apec.html", "APEC Economic Leaders’ Meeting and Other Events (2)", "2026-11-19", "On November 19, 2026 (local time), Prime Minister Takaichi, who was visiting Shenzhen, the People&#39;s Republic of China, attended the APEC Economic Leaders’ Meeting."),
    kanteiItem("/105/actions/202611/18apec.html", "Japan-China Summit Meeting", "2026-11-18", "Prime Minister Takaichi held a summit meeting with President Xi Jinping."),
    kanteiItem("/105/actions/202611/12teigen.html", "Courtesy Call from the Keidanren", "2026-11-12", "Prime Minister Takaichi received a courtesy call from the Keidanren."),
    kanteiItem("/105/actions/202610/30cabinet.html", "Cabinet Meeting", "2026-10-30", "Prime Minister Takaichi attended the cabinet meeting."),
  ].join("\n");
  const kanteiFigure = (n, caption, w = 980, h = 654) => `<figure class="carousel__item swiper-slide" data-slide-label="${n}/2"> <div class="carousel__media"> <img alt="${caption}" src="/contents/topics/32011_ext_8_${n}.jpg" class="carousel__image" width="${w}" height="${h}"> </div> <figcaption class="carousel__caption">${caption}</figcaption> </figure>`;
  const kanteiPage = `${kanteiFigure(1, "Prime Minister Takaichi being welcomed by President Xi Jinping (1)")}${kanteiFigure(2, "Family photo (portrait)", 654, 980)}`;
  check("Japan's office: its actions page is found from its home page, never by a cabinet number written in code", kanteiActionsPath(kanteiHome), "/105/actions/index.html");
  const kanteiEvents = parseKanteiList(kanteiList);
  check("Japan's office lists its events with their dates and the description that names who was met", [kanteiEvents.length, kanteiEvents[1].title, kanteiEvents[1].date, kanteiEvents[1].summary.includes("Xi Jinping"), kanteiEvents[0].url], [4, "Japan-China Summit Meeting", "2026-11-18", true, `${KANTEI}/105/actions/202611/19apec.html`]);
  const kanteiPhotos = parseKanteiPhotos(kanteiPage, kanteiEvents[1], byId.kantei);
  check(
    "a Japanese event's landscape frames, credited to the office under its licence and kept under the topic's own number",
    [kanteiPhotos.length, kanteiPhotos[0].url, kanteiPhotos[0].width, attributionLine(kanteiPhotos[0]), kanteiPhotos[0].stored, photoKey(kanteiPhotos[0].url) === photoKey(`/photos/handouts/${kanteiPhotos[0].stored}`)],
    [1, `${KANTEI}/contents/topics/32011_ext_8_1.jpg`, 980, "Prime Minister's Office of Japan · PDL 1.0 · مكتب رئيس وزراء اليابان", "official-kantei-32011-1.jpg", true],
  );
  check(
    "a prime minister the registry does not name yet is the office's own when most of its events name her; a guest is not",
    [officeOwn("Shigeru Ishiba", byId.kantei, [{ title: "a", summary: "Prime Minister Ishiba met…" }, { title: "b", summary: "Prime Minister Ishiba attended…" }, { title: "c", summary: "Prime Minister Ishiba received…" }, { title: "d", summary: "a cabinet meeting" }]), officeOwn("Sanae Takaichi", byId.kantei, []), officeOwn("Xi Jinping", byId.kantei, kanteiEvents)],
    [true, true, false],
  );
  // India: the gallery's groups, PIB's light copy for the judge, the original kept.
  const pmLink = (group, file, caption, event) => `<a data-fancybox="gallery${group}" href="https://www.pmindia.gov.in/wp-content/uploads/2026/11/${file}" data-caption="${caption}" title="${caption}" id="1" onmouseover="this.title='${event}'" onclick="this.title='${caption}'" > <div class="photo"> <img src="https://www.pmindia.gov.in/wp-content/uploads/2026/11/${file}" alt="${caption}"> </div> </a>`;
  const pmGallery = [
    `<a class="group1168 fancybox" data-fancybox="gallery1168" href="https://www.pmindia.gov.in/wp-content/uploads/2025/12/02.jpg" data-caption=" " title=" " id="16605130"></a>`,
    pmLink(16983339, "H20261120220723.jpeg", "PM with the leaders at the First SCO Civilisational Dialogue Forum in New Delhi on November 20, 2026.", "PM participates in the First Shanghai Cooperation Organisation (SCO) Civilisational Dialogue Forum at Purana Qila, in New Delhi (November 20, 2026)"),
    pmLink(16983339, "H20261120220732.jpeg", "PM took a walkthrough of the exhibition at Purana Qila on November 20, 2026.", "PM participates in the First Shanghai Cooperation Organisation (SCO) Civilisational Dialogue Forum at Purana Qila, in New Delhi (November 20, 2026)"),
    pmLink(16980001, "H20261117220329.jpeg", "PM at the 23rd India-ASEAN Summit in Manila.", "PM participates in the 23rd India-ASEAN Summit in Manila (November 17, 2026)"),
  ].join("\n");
  const pmEvents = parsePmIndiaGallery(pmGallery);
  const pmPhotos = await byId.pmindia.photos(pmEvents[0], { read: async () => null });
  check(
    "India's gallery groups its photographs by event, dated, and shows the judge PIB's light copy while the original is kept",
    [pmEvents.map((e) => [e.title, e.date, e.photos.length]), pmPhotos[1].thumb, pmPhotos[1].thumbAlt, attributionLine(pmPhotos[1]), pmPhotos[1].stored, photoKey(pmPhotos[1].thumb) === photoKey(pmPhotos[1].url)],
    [
      [["PM participates in the First Shanghai Cooperation Organisation (SCO) Civilisational Dialogue Forum at Purana Qila, in New Delhi", "2026-11-20", 2], ["PM participates in the 23rd India-ASEAN Summit in Manila", "2026-11-17", 1]],
      "https://static.pib.gov.in/WriteReadData/Gallery/PhotoGallery/2026/Nov/T20261120220732.JPG",
      "https://www.pmindia.gov.in/wp-content/uploads/2026/11/H20261120220732.jpeg",
      "PIB · Free reuse with credit · مكتب رئيس وزراء الهند",
      "official-pmindia-20261120220732.jpg",
      true,
    ],
  );
  // The European Commission: its interface's answers, the Union's own work only.
  const euHolders = { year: "2026", holders: [{ language: "EN", content: "European Union" }], scopes: [] };
  const reportage = (ref, title, start, extra = {}) => ({ reference: ref, type: "REPORTAGE", titles: [{ language: "EN", content: title }], summaries: [], personalities: [], locations: [], copyright: euHolders, startDateTime: start, photosCount: 4, ...extra });
  const ecList = JSON.stringify({ completeItemsCount: 3, items: [
    reportage("P-071029", "Visit of Dan Jørgensen, European Commissioner, to Poland", "2026-11-18T23:00:00.000Z", { personalities: [{ title: "Dan Jørgensen" }, { title: "Andrzej Domański" }], locations: [{ titles: [{ language: "EN", content: "Poland" }] }] }),
    reportage("P-071075", "Participation of Ursula von der Leyen in a summit in London", "2026-11-19T23:00:00.000Z", { locations: [{ titles: [{ language: "EN", content: "United Kingdom" }] }] }),
    reportage("P-071080", "A broadcaster's interview", "2026-11-19T23:00:00.000Z", { copyright: { year: "2026", holders: [{ language: "EN", content: "Euronews" }], scopes: [] } }),
  ] });
  const ecEventsRead = parseEcReportages(ecList);
  check("the Commission's reportages: the Union's own only, dated in Brussels, its people named", [ecEventsRead.map((e) => [e.id, e.date]), ecEventsRead[0].summary.includes("Andrzej Domański"), ecEventsRead[0].url], [[["P-071029", "2026-11-19"], ["P-071075", "2026-11-20"]], true, "https://audiovisual.ec.europa.eu/en/media/photo/P-071029"]);
  const sizes = (n, w = 1200, h = 892) => [{ quality: "HIGH", path: `/07/10/29/P-071029_00-0${n}_02-HIGH-1.jpg`, width: w, height: h }, { quality: "MEDIUM", path: `/07/10/29/P-071029_00-0${n}_03-MED-1.jpg`, width: 800, height: 594 }];
  const ecPhoto = (n, extra = {}) => ({ reference: `P-071029/00-0${n}`, summaries: [{ language: "EN", content: `Andrzej Domanski and Dan Jørgensen (${n})` }], ccBy: [{ version: `P-071029/00-0${n}` }], copyright: { holders: [], scopes: [] }, imagesByQualities: sizes(n), cooperators: [{ name: "Janek Skarzynski", roles: [{ roleKey: "PHOTOGRAPHER" }] }], ...extra });
  const ecDetail = JSON.stringify({ reference: "P-071029", photos: [ecPhoto(1), ecPhoto(2, { ccBy: [] }), ecPhoto(3, { copyright: { holders: [{ language: "EN", content: "Reuters" }], scopes: [] } }), ecPhoto(4, { imagesByQualities: sizes(4, 800, 1200) })] });
  const ecPhotosRead = parseEcPhotos(ecDetail, ecEventsRead[0], byId.ec);
  check(
    "a Commission reportage gives only its CC BY, Union-held, landscape frames: 800 pixels to judge, 1200 kept, «© European Union»",
    [ecPhotosRead.length, ecPhotosRead[0].thumb.includes("_03-MED-"), ecPhotosRead[0].url.includes("_02-HIGH-"), attributionLine(ecPhotosRead[0]), ecPhotosRead[0].stored, photoKey(ecPhotosRead[0].url) === photoKey(`/photos/handouts/${ecPhotosRead[0].stored}`)],
    [1, true, true, "© European Union, 2026 · CC BY 4.0 · المفوضية الأوروبية", "official-ec-P-071029_00-01.jpg", true],
  );
  check(
    "an office is read by the headline's own title for its holder, a Commission official's name or the Commission, and never for an ordinary story",
    [officialSourcesFor({ title: "رئيسة الوزراء اليابانية تتعهد بحزمة تحفيز" }).map((s) => s.id), officialSourcesFor({ title: "فون دير لاين: الاتحاد سيرد على الرسوم" }).map((s) => s.id), officialSourcesFor({ title: "المفوضية الأوروبية تقترح رسوماً على الصلب" }).map((s) => s.id), officialSourcesFor({ title: "مودي يلتقي بوتين" }).map((s) => s.id), officialSourcesFor({ title: "أسعار النفط ترتفع" }).map((s) => s.id)],
    [["kantei"], ["ec"], ["ec"], ["kremlin", "pmindia"], []],
  );
  const poland = { title: "المفوضية الأوروبية وبولندا تبحثان تمويل الطاقة", tags: ["الاتحاد الأوروبي", "بولندا"] };
  check(
    "an event matches the countries a story names one by one, never every European country its EU tag stands for",
    [[...countriesByName(poland)], officialEventFits(ecEventsRead[0], { source: byId.ec, draft: poland, others: [] }), officialEventFits(ecEventsRead[1], { source: byId.ec, draft: poland, others: [] })],
    [["Poland"], "it names Poland", null],
  );
  // The cascade: a Japanese summit story runs the office's own frame of the meeting.
  {
    const draft = { title: "رئيسة الوزراء اليابانية وشي يتفقان على استئناف الحوار الاقتصادي", subtitle: "لقاء على هامش قمة آسيا والمحيط الهادئ", lede: "اتفقت رئيسة الوزراء اليابانية ساناي تاكايتشي والرئيس الصيني شي جين بينغ على استئناف الحوار.", body: "فقرة.", tags: ["اليابان", "الصين"], regions: ["آسيا"], kind: "news", section: "economy", publishedAt: "2026-11-19T09:00:00Z", imageQueries: [] };
    const official = { [`${KANTEI}/`]: kanteiHome, [`${KANTEI}/105/actions/index.html`]: kanteiList, [`${KANTEI}/105/actions/202611/18apec.html`]: kanteiPage };
    const plan = planFor({ queries: ["Japan China trade"], place: [], focus: "people", people: [{ name: "Sanae Takaichi", ar: "ساناي تاكايتشي", headline: "رئيسة الوزراء اليابانية" }, { name: "Xi Jinping", ar: "شي جين بينغ", headline: "شي" }] });
    const r = await scenario({ draft, plan, official, photoDir: "C:/site/public/photos/handouts", judge: () => 1 });
    check("a Japanese summit story runs the office's own frame of the meeting, kept on the site, before any library", [r.image?.basis, r.image?.url, r.image?.credit, r.searched.length], ["official", "/photos/handouts/official-kantei-32011-1.jpg", "Prime Minister's Office of Japan · PDL 1.0 · مكتب رئيس وزراء اليابان", 0]);
  }
}

// Argentina's presidency and the Flickr reader (the owner, 2026-11-21: "build the Flickr reader with the UK … how about
// argentina and brazil official offices … also important countries like canada and mexico"). Of those, Argentina's
// licence is free; the UK's Flickr photographs turned CC BY-NC-ND 4.0, Brazil's site is no-derivatives, Mexico's and
// Canada's forbid commercial reuse. Ecuador's presidency posts on Flickr in the public domain.
{
  const byId = Object.fromEntries(OFFICIAL_SOURCES.map((s) => [s.id, s]));
  check(
    "the registry holds Argentina and Ecuador, and never the UK, Brazil, Mexico or Canada, whose licences forbid an advertised site's use",
    [Boolean(byId.casarosada), Boolean(byId.ecuador), OFFICIAL_SOURCES.some((s) => /uk|britain|brazil|planalto|mexic|canad/i.test(`${s.id} ${s.officeEn}`))],
    [true, true, false],
  );
  check(
    "a Spanish title names its countries in the English the matcher reads",
    [withEnglishCountries("Reunión del Presidente con su par de Estados Unidos y el canciller de Brasil"), withEnglishCountries("Día de la Soberanía Nacional")],
    ["Reunión del Presidente con su par de Estados Unidos y el canciller de Brasil (United States, Brazil)", "Día de la Soberanía Nacional"],
  );
  const rss = `<rss><channel><item>
    <title>Discurso del Presidente Javier Milei en el lanzamiento oficial de Tesla en la Argentina</title>
    <link>https://www.casarosada.gob.ar/slider-principal/51440-discurso-del-presidente-javier-milei-en-el-lanzamiento-oficial-de-tesla-en-la-argentina</link>
    <description><![CDATA[]]></description>
    <pubDate>Sat, 21 Nov 2026 02:30:34 +0000</pubDate>
  </item></channel></rss>`;
  const items = parseRssItems(rss);
  check("Casa Rosada's feed: each event's title, page and its Buenos Aires date (02:30 UTC is the evening before there)", [items.length, items[0].date, items[0].link.endsWith("tesla-en-la-argentina")], [1, "2026-11-20", true]);
  const event = { id: items[0].link, title: items[0].title, date: items[0].date, place: "", summary: items[0].title, url: items[0].link };
  const page = `<meta property="og:image" content="https://www.casarosada.gob.ar/images/202611/teslamilei.jpg" /><meta name="description" content="El Presidente encabezó el lanzamiento de Tesla en la Argentina." />`;
  const cr = parseCasaRosadaPhotos(page, event, byId.casarosada);
  check(
    "an Argentine event's main photograph, credited to Casa Rosada under its licence and kept under its own name",
    [cr.length, cr[0].url, attributionLine(cr[0]), cr[0].stored, photoKey(cr[0].url) === photoKey(`/photos/handouts/${cr[0].stored}`)],
    [1, "https://www.casarosada.gob.ar/images/202611/teslamilei.jpg", "Casa Rosada · CC BY 2.5 AR · الرئاسة الأرجنتينية", "official-casarosada-202611-teslamilei.jpg", true],
  );
  check(
    "an office's event naming the story's company is its occasion (the president launching Tesla's cars in Argentina)",
    [officialEventFits(event, { source: byId.casarosada, draft: { title: "تسلا تبدأ بيع سياراتها في الأرجنتين", tags: ["الأرجنتين"], imageCompany: "Tesla" }, others: [] }), officialEventFits(event, { source: byId.casarosada, draft: { title: "ميلي يخفض الضرائب على الصادرات", tags: ["الأرجنتين"] }, others: [] })],
    ["it names Tesla", null],
  );
  // Flickr: the feed's frames grouped by event, and each frame's own licence read before it is offered.
  const feed = JSON.stringify({ items: [
    { title: "PRESIDENTE DANIEL NOBOA EN AZUAY", link: "https://www.flickr.com/photos/presidenciaecuador/55663376880/", media: { m: "https://live.staticflickr.com/65535/55663376880_865841ba31_m.jpg" }, date_taken: "2026-11-19T10:00:00-08:00", description: "<p>Presidencia posted a photo:</p> Encuentro con empresarios de China" },
    { title: "PRESIDENTE DANIEL NOBOA EN AZUAY", link: "https://www.flickr.com/photos/presidenciaecuador/55663376881/", media: { m: "https://live.staticflickr.com/65535/55663376881_aaaaaaaaaa_m.jpg" }, date_taken: "2026-11-19T10:05:00-08:00", description: "" },
    { title: "DSC_0001", link: "https://www.flickr.com/photos/presidenciaecuador/1/", media: { m: "https://live.staticflickr.com/65535/1111111111_bbbbbbbbbb_m.jpg" }, date_taken: "2026-11-19T10:05:00-08:00", description: "" },
  ] });
  const fe = parseFlickrFeed(feed);
  check("a Flickr feed's frames are grouped by their event's title, a camera's file name is no event, and Spanish countries are read", [fe.length, fe[0].photos.length, fe[0].date, fe[0].summary.includes("(China)")], [1, 2, "2026-11-19", true]);
  check(
    "a frame's licence is read from its own page: public domain and CC BY pass, CC BY-NC-ND and all rights reserved do not",
    [flickrLicence('{"license":10,"x":1}'), flickrLicence('"license":4'), flickrLicence('"license":16'), flickrLicence('"license":0'), flickrLicence("no licence")],
    ["Public domain", "CC BY 2.0", null, null, null],
  );
  const pages = { "https://www.flickr.com/photos/presidenciaecuador/55663376880/": '{"license":10}', "https://www.flickr.com/photos/presidenciaecuador/55663376881/": '{"license":16}' };
  const fl = await byId.ecuador.photos(fe[0], { read: async (u) => pages[u] ?? null });
  check(
    "only the frame under a free licence is offered, at 640 pixels to judge and 1024 to keep, credited with its own licence",
    [fl.length, fl[0].thumb.endsWith("_z.jpg"), fl[0].url.endsWith("_b.jpg"), attributionLine(fl[0]), fl[0].stored, photoKey(fl[0].url) === photoKey(`/photos/handouts/${fl[0].stored}`)],
    [1, true, true, "Presidencia de la República del Ecuador · Public domain · الرئاسة الإكوادورية", "official-flickr-55663376880.jpg", true],
  );
  // Italy (CC BY 3.0, photographs included) and Spain (reuse authorised, third parties' excepted: only Moncloa's own frames).
  const { parseGovernoPhotos, parseMoncloaPhotos } = await import("../pipeline/lib/official-photos.mjs");
  const itEvent = { id: "x", title: "Riunione della Coalizione dei Volenterosi con gli Stati Uniti", date: "2026-11-19", place: "", summary: withEnglishCountries("Riunione della Coalizione dei Volenterosi con gli Stati Uniti"), url: "https://www.governo.it/it/articolo/x/1" };
  const it = parseGovernoPhotos(`<meta property="og:image" content="https://www.governo.it/sites/governo.it/files/field/image/DSC00881_pp.jpg" />`, itEvent, byId.governo);
  const itLogo = parseGovernoPhotos(`<meta property="og:image" content="https://www.governo.it/sites/governo.it/files/stemma_repubblica.png" />`, itEvent, byId.governo);
  check(
    "Italy's article photograph is credited to Palazzo Chigi under CC BY; the emblem on a decree is no photograph; Italian countries are read",
    [it.length, attributionLine(it[0]), photoKey(it[0].url) === photoKey(`/photos/handouts/${it[0].stored}`), itLogo.length, itEvent.summary.endsWith("(United States)")],
    [1, "Palazzo Chigi · CC BY 3.0 · الحكومة الإيطالية", true, 0, true],
  );
  const img = (file, author, w = 2000, h = 1333) => `{"@id":"https://www.lamoncloa.gob.es/multimedia/fotos/presidente/publishingimages/2026/${file}.jpg","@type":"ImageObject","position":1,"url":"https://www.lamoncloa.gob.es/x","contentUrl":"https://www.lamoncloa.gob.es/multimedia/fotos/presidente/PublishingImages/2026/${file}.jpg","thumbnailUrl":"https://www.lamoncloa.gob.es/x?RenditionID=33","name":"Pedro S&aacute;nchez recibe al presidente de Brasil.","author":{"@type":"Person","name":"${author}"},"width":"${w}","height":"${h}"}`;
  const esEvent = { id: "y", title: "Pedro Sánchez se reúne con el presidente de Brasil", date: "2026-11-16", place: "", summary: "", url: "https://www.lamoncloa.gob.es/y.aspx" };
  const es = parseMoncloaPhotos(`[${img("161126-sanchez-visita-lula6", "Pool Moncloa/Fernando Calvo")},${img("161126-sanchez-reunion-lula", "EFE/ Mariscal")},${img("161126-vertical", "Pool Moncloa/Fernando Calvo", 1333, 2000)}]`, esEvent, byId.moncloa);
  check(
    "Spain's gallery gives only its own photographers' landscape frames, never the agency's",
    [es.map((p) => p.artist), attributionLine(es[0] ?? {}), es[0]?.thumb.endsWith("?RenditionID=34")],
    [["Pool Moncloa/Fernando Calvo"], "Pool Moncloa/Fernando Calvo · Reuse authorised · الحكومة الإسبانية", true],
  );
  // Romania (reproduction authorised with the source): its photo section, read page by page.
  const { parseGovRoList, parseGovRoPhotos, dayMonthYear } = await import("../pipeline/lib/official-photos.mjs");
  const list = parseGovRoList(`<a href="https://gov.ro/en/media/photo/prime-minister-luca-niculescu-meets-the-president-of-the-united-states&amp;page=1">x</a><a href="https://gov.ro/en/media/photo/prime-minister-luca-niculescu-meets-the-president-of-the-united-states&amp;page=1">y</a>`);
  const roEvent = { ...list[0], date: dayMonthYear("Published 19 Nov 2026, 14:00"), summary: list[0]?.title };
  const ro = parseGovRoPhotos(`<img src="https://gov.ro/fisiere/galerie_foto/1795095832big_6.jpeg"><a href="https://gov.ro/fisiere/galerie_foto/1795095832original_6.jpeg">`, roEvent, byId.govro);
  check(
    "Romania's photo section: one event per page, titled with its capitals, dated, its original frame kept and its large copy judged",
    [list.length, list[0]?.title, roEvent.date, ro.length, ro[0]?.thumb.includes("big_6"), attributionLine(ro[0] ?? {}), photoKey(ro[0]?.url) === photoKey(`/photos/handouts/${ro[0]?.stored}`), officialEventFits(roEvent, { source: byId.govro, draft: { title: "رومانيا والولايات المتحدة", tags: ["رومانيا", "الولايات المتحدة"] }, others: [] })],
    [1, "Prime Minister Luca Niculescu Meets The President of The United States", "2026-11-19", 1, true, "Government of Romania · Reproduction authorised · الحكومة الرومانية", true, "it names United States"],
  );
}

console.log(failed ?`\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
