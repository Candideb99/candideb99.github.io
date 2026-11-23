/**
 * Codex's review of 2026-11-23, the weighting and ranking of news: which stories a run takes, in which order, and which
 * lead the front and the week's review. No network and no model. Each behavioural case fails on the code before; the
 * run's own steps and the site's two rules (TypeScript over the site's content) are held by their source lines.
 */
import { readFileSync } from "node:fs";
import { rotationSwap, sportCap, selectStories, quietPlaces, TIE_RANK } from "../pipeline/lib/select.mjs";
import { worldAreasNamed, countriesNamed } from "../pipeline/lib/regions.mjs";
import { weekStories, WEEK_ANALYSES } from "../pipeline/lib/article.mjs";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
}
const source = (file) => readFileSync(file, "utf8");
const pick = (headlineHint, importance, extra = {}) => ({ ids: [headlineHint], section: "economy", importance, headlineHint, regions: [], tie: "", rotation: "", sport: false, ...extra });
const names = (list) => list.map((s) => s.headlineHint);

// 1. A rotation story never takes a place by its score: only rotationSwap() runs one.
const run = source("pipeline/run.mjs");
check("the run's first choice, its section-only choice and both balances leave the rotation stories to the rotation",
  [/const ordinary = stories\.filter\(\(s\) => !s\.rotation\);\s*let chosen = ordinary\.filter\(/.test(run), /chosen = ordinary\.filter\(\(s\) => SECTIONS\.includes/.test(run), (run.match(/const pick = ordinary\.find\(/g) ?? []).length, /let chosen = stories\.filter/.test(run)],
  [true, true, 2, false]);

// 2. Among equals, the story nearer the Arab reader.
const editor = (stories) => async ({ user, validate }) => { editor.prompt = user; const data = { stories }; validate?.(data); return { data, model: "stand-in" }; };
const candidates = ["c1", "c2", "c3"].map((id) => ({ id, title: id, sourceNameEn: "BBC", reliability: 2, kind: "news", lang: "en", publishedAt: new Date().toISOString() }));
const sections = JSON.parse(source("src/data/sections.json"));
const lines = [];
const ranked = await selectStories({
  candidates, recentTitles: [], sections, limit: 1, log: (l) => lines.push(l),
  chatWith: editor([
    { ids: ["c1"], section: "companies", importance: 7, headline_hint: "شركة أمريكية ترفع توزيعاتها", tie: "none", news_value: "ضخامة" },
    { ids: ["c2"], section: "economy", importance: 7, headline_hint: "أوكرانيا تزيد صادرات القمح إلى مصر", tie: "direct", news_value: "تأثير، قرب، آنية" },
    { ids: ["c3"], section: "economy", importance: 8, headline_hint: "قرار للفيدرالي", tie: "global", news_value: "تأثير، أهمية، آنية" },
  ]),
});
check("of two stories at 7, the one with a direct tie to the Arab reader comes before the one with none; a higher score still leads",
  names(ranked.stories), ["قرار للفيدرالي", "أوكرانيا تزيد صادرات القمح إلى مصر", "شركة أمريكية ترفع توزيعاتها"]);
// 7. The brief's three news values: said in the log, never a reason to pay for the editor's call again.
check("a story scored 6 or more that names fewer than three news values is named in the run's log", lines.filter((l) => /names 1 news value/.test(l)).length, 1);

// 3. The Mashriq desk's other half does not come in with the Arab weight.
const quiet = { desks: [{ name: "المشرق وإيران وتركيا", days: 4 }], areas: [], served: new Set() };
const grain = pick("أوكرانيا تزيد صادرات القمح إلى مصر", 6, { tie: "direct" });
const turkish = pick("تركيا ترفع ضريبة المبيعات على تجارة التجزئة", 5, { tie: "none", regions: ["المشرق وإيران وتركيا"], rotation: "المشرق وإيران وتركيا" });
const iraqi = pick("العراق يرفع صادرات النفط من البصرة", 5, { tie: "arab", regions: ["المشرق وإيران وتركيا"], rotation: "المشرق وإيران وتركيا" });
const swap = (extra) => rotationSwap({ chosen: [grain], stories: [grain, extra], quiet, runLimit: 1, minImportance: 6 });
check("a Turkish story of the quiet desk weighs its own tie and displaces nothing; an Iraqi one comes in as an Arab story",
  [swap(turkish), swap(iraqi)?.pick.headlineHint, swap(iraqi)?.drop.headlineHint], [null, iraqi.headlineHint, grain.headlineHint]);

// 4. A central bank or an index names its part of the world.
check("«بنك إنجلترا» and «نيكاي» name their parts of the world, and no word that only holds their letters does",
  [[...worldAreasNamed("بنك إنجلترا يرفع الفائدة إلى 4%")], [...worldAreasNamed("نيكاي يهبط دون 60 ألف نقطة")], [...worldAreasNamed("اقتصاد منطقة اليورو ينمو 0.4%")], [...worldAreasNamed("أرباح البنك ترتفع 4%")]],
  [["أوروبا الغربية والشمالية"], ["شرق آسيا"], ["أوروبا الغربية والشمالية"], []]);
const now = Date.parse("2026-11-23T12:00:00Z");
const day = (n) => new Date(now - n * 86400000).toISOString();
const rested = quietPlaces([{ kind: "news", title: "بنك إنجلترا يرفع الفائدة إلى 4%", publishedAt: day(1), regions: [] }, { kind: "news", title: "نيكاي يهبط دون 60 ألف نقطة", publishedAt: day(2), regions: [] }], now).areas.map((a) => a.name);
check("…so such a story resets its part's quiet days", [rested.includes("أوروبا الغربية والشمالية"), rested.includes("شرق آسيا")], [false, false]);

// 5. The sport cap gives the Arab story's place to an Arab story.
const club = pick("صندوق سعودي يبيع حصته في ناد", 7, { sport: true, tie: "arab", regions: ["الخليج"] });
const foreign = pick("احتياطيات كوريا ترتفع", 7, { tie: "none" });
const egypt = pick("احتياطي مصر الأجنبي يرتفع", 7, { tie: "arab", regions: ["مصر"] });
const fed = pick("قرار للفيدرالي", 8, { tie: "global" });
check("with the day's sport allowance spent, the run's only Arab story is replaced by an Arab one; a run that keeps another is filled by rank",
  [names(sportCap({ chosen: [fed, club], stories: [fed, club, foreign, egypt], runLimit: 2, minImportance: 6, today: 2 }).chosen), names(sportCap({ chosen: [egypt, club], stories: [egypt, club, foreign, fed], runLimit: 2, minImportance: 6, today: 2 }).chosen)],
  [[fed.headlineHint, egypt.headlineHint], [egypt.headlineHint, foreign.headlineHint]]);

// 6. A run for chosen sections tells the editor so.
await selectStories({ candidates, recentTitles: [], sections, limit: 2, log: () => {}, only: ["energy"], chatWith: editor([]) });
const told = /THIS RUN IS FOR ONE SECTION ONLY: energy/.test(editor.prompt);
await selectStories({ candidates, recentTitles: [], sections, limit: 2, log: () => {}, chatWith: editor([]) });
check("the editor of a section-only run is told its section, and an ordinary run's brief is as it was", [told, /THIS RUN IS FOR/.test(editor.prompt), /only: SECTIONS \}\)/.test(run)], [true, false, true]);

// 9. One candidate can be a story.
check("the editor is asked with one candidate or two", [/if \(candidates\.length < 1\) \{/.test(run), /candidates\.length < 3\) \{\s*log\("too few candidates/.test(run)], [true, false]);

// 10, 11. The front's two rules.
const site = source("src/lib/articles.ts");
const placed = (title) => { const set = new Set(countriesNamed(title)); if (/منطقة اليورو|الاتحاد الأوروبي/.test(title)) set.add("euro-area"); return set; };
const apart = (x, y) => { const a = placed(x), b = placed(y); return Boolean(a.size && b.size && ![...a].some((p) => b.has(p))); };
check("Saudi Arabia's and the euro area's growth are two events to the front; two headlines on one country are not parted",
  [apart("انكماش الاقتصاد السعودي يتباطأ إلى 3.8% في الربع الثالث", "اقتصاد منطقة اليورو ينمو 0.4% في الربع الثالث رغم انكماش فرنسا"), apart("انكماش الاقتصاد السعودي يتباطأ إلى 3.8% في الربع الثالث", "الاقتصاد السعودي ينكمش 3.8% في الربع الثالث"), /if \(here\.size && there\.size && !\[\.\.\.here\]\.some\(\(p\) => there\.has\(p\)\)\) return false;/.test(site)],
  [true, false, true]);
check("the front's lead is of the last day when it has a developed story, in the site and in the control room's mirror",
  [/const today = news\.filter\(\(a\) => hoursOld\(a, now\) < 24\);\s*const scored = \(today\.length \? today : news\)\.map/.test(site), /const fresh = pool\.filter\(\(a\) => hours\(a\) < 24\);/.test(source("scripts/control-room.mjs"))], [true, true]);

// 12. An analysis weighs what its strongest story weighs.
const hours = (h) => new Date(Date.now() - h * 3600000).toISOString();
const week = [
  ...[9, 8, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6].map((importance, i) => ({ slug: `n${i}`, kind: "news", publishedAt: hours(10 + i), quality: { importance } })),
  ...[0, 1, 2, 3].map((i) => ({ slug: `a${i}`, kind: "analysis", publishedAt: hours(5 + i), sourceUrls: [`/articles/n${i}/`] })),
  { slug: "a-draft", kind: "analysis", draft: true, publishedAt: hours(3), sourceUrls: ["/articles/n0/"] },
];
const chosen = weekStories(week);
check("the week's review reads the analyses of its strongest stories, three at most, and never a draft",
  [chosen.length, chosen.slice(0, 3).map((a) => a.slug), chosen.filter((a) => a.kind === "analysis").map((a) => a.slug), WEEK_ANALYSES, TIE_RANK.direct > TIE_RANK.none],
  [14, ["a0", "n0", "a1"], ["a0", "a1", "a2"], 3, true]);

if (failed) {
  console.log(`\n${failed} case(s) failed.`);
  process.exit(1);
}
console.log("\nThe weighting and ranking of news: every case holds.");
