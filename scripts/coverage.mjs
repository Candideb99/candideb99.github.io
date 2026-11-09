#!/usr/bin/env node
/**
 * Where in the world the news stories come from, before a change and after it. Written for THE WORLD'S LARGE
 * ECONOMIES (pipeline/lib/select.mjs) and the six sources added with it on 2026-11-09, when the owner asked whether the
 * site gets "economics and business and trade news from europe, asia, south america etc or very poor in this regard":
 * in the four weeks before, Germany's own economy led one story, Japan two, India one, Latin America three and
 * sub-Saharan Africa none, while American companies led seventeen.
 *
 * For the news stories of each window: how many a day; the share on an Arab desk, which the rule must not crowd out;
 * among the others, the share whose headline names one of the twelve economies the rule lists, and each of them, then
 * the euro area, the United States, China and the rest of the world; the regions the writers gave; the stories citing
 * each of the six sources, with the feed's last answer; and, after the change, every headline naming one of the twelve.
 * A headline's countries are read as the pipeline reads them (countriesNamed() in lib/regions.mjs), with the places its
 * list has no entry for (South Africa, the euro area, most of Latin America and Africa, the markets, currencies and
 * central banks it does not reach) read as whole words the same way. p is Fisher's exact test of the two windows'
 * shares: the chance of a gap at least this large if nothing had changed.
 *
 * `--ref=pages/main` reads the stories and the feed record from that commit (run `git fetch pages` first) and leaves
 * the working tree alone; without it, this checkout's own files. `--change=` (an ISO time) splits the windows, by
 * default the push of the rule and the sources, 2026-11-09 18:25:38 UTC (no news round ran across it: the one before
 * ended at 16:07, the next began at 19:53); `--days=28` is the length of the window before; the window after runs to
 * now, or to `--to=`. `--list` also prints the window before's headlines naming one of the twelve. Run it from the
 * repository's root.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { DESK_NAMES, canonicalRegions, countriesNamed, countryText, placeRe } from "../pipeline/lib/regions.mjs";

const DAY = 86_400_000;

// The site's three Arab desks (src/data/regions.json); the other desks fold into العالم on the site.
const ARAB = ["الخليج", "مصر والمغرب العربي", "المشرق وإيران وتركيا"];
for (const desk of ARAB) if (!DESK_NAMES.includes(desk)) throw new Error(`coverage: «${desk}» is no longer a desk in regions.json`);

/**
 * A group of places, read in a headline by the countries countriesNamed() finds there (`named`: words it reads as each
 * of them), by places its list has no entry for (`places`, each a whole word through its clitics and endings), and by
 * `patterns` for what placeRe() cannot hold to one form (both read the headline as countryText() gives it).
 */
function group(label, { named = [], places = [], patterns = [] }) {
  const keys = new Set();
  for (const word of named) {
    const found = countriesNamed(word);
    if (!found.size) throw new Error(`coverage: countriesNamed() no longer reads «${word}»`);
    for (const key of found) keys.add(key);
  }
  return { label, keys, res: [...places.map((p) => placeRe(p, { country: true })), ...patterns] };
}

// The twelve the rule names, in its order: "Germany, Japan, India, Britain, France, Italy, Korea, Brazil, Mexico,
// Indonesia, Nigeria or South Africa", each with its markets, its currency and its central bank where the pipeline's
// list does not reach them (the Bank of England is «بنك إنجلترا», which names no British place).
const RULE = [
  group("Germany", { named: ["ألمانيا"], places: ["داكس", "بوندسبنك", "ميونخ", "هامبورغ"] }),
  group("Japan", { named: ["اليابان"], places: ["نيكاي", "توبكس", "الين"] }),
  group("India", { named: ["الهند"], places: ["سنسكس", "نيفتي"] }),
  group("Britain", { named: ["بريطانيا"], places: ["إنجلترا", "إنكلترا", "إسترليني", "فوتسي"] }),
  group("France", { named: ["فرنسا"], places: ["كاك 40"] }),
  group("Italy", { named: ["إيطاليا"] }),
  group("Korea", { named: ["كوريا"], places: ["كوسبي"] }),
  group("Brazil", { named: ["البرازيل"], places: ["ساو باولو"] }),
  group("Mexico", { named: ["المكسيك"] }),
  group("Indonesia", { named: ["إندونيسيا"], places: ["جاكرتا"] }),
  group("Nigeria", { named: ["نيجيريا"], places: ["لاغوس", "أبوجا", "نايرا"] }),
  group("South Africa", { places: ["جنوب أفريقي", "جنوب إفريقي", "جوهانسبرغ", "بريتوريا", "كيب تاون", "الراند"] }),
];
const AR = "\\u0621-\\u064A";
// Not «بيروت» (placeRe() reads «بيرو» as a whole word), nor «المجرى» for Hungary, which is left out; the Fed is
// «الفيدرالي», never the feminine of «الحكومة الفيدرالية» (Nigeria's has one).
const OTHERS = [
  group("the euro area or the EU", { places: ["منطقة اليورو", "الاتحاد الأوروبي", "المركزي الأوروبي", "المفوضية الأوروبية", "أوروبا", "أوروبي", "بروكسل", "لاغارد"] }),
  group("the United States", {
    named: ["الولايات المتحدة"],
    places: ["الاحتياطي الاتحادي", "ناسداك", "داو جونز", "إس آند بي 500"],
    patterns: [new RegExp(`(?<![${AR}])[وفبك]?(?:ال|لل)?فيدرالي(?![${AR}])`)],
  }),
  group("China", { named: ["الصين"], places: ["اليوان"] }),
  group("the rest of Europe", {
    named: ["روسيا", "أوكرانيا", "إسبانيا", "هولندا", "سويسرا", "السويد", "النرويج", "الدنمارك", "فنلندا", "بلجيكا", "النمسا"],
    places: ["بولندا", "بولندي", "اليونان", "يوناني", "البرتغال", "برتغالي", "التشيك", "تشيكي", "رومانيا", "أيرلندا", "أيرلندي", "إيرلندا"],
  }),
  group("the rest of Asia and the Pacific", {
    named: ["تايوان", "ماليزيا", "باكستان", "أستراليا"],
    // «سنغافورة» with its tā' marbūṭa is not among countriesNamed()'s forms of «سنغافور».
    places: ["سنغافورة", "سنغافوري", "فيتنام", "تايلاند", "الفلبين", "فلبيني", "بنغلاديش", "سريلانكا", "نيوزيلندا", "كازاخستان"],
  }),
  group("the rest of Latin America", {
    named: ["فنزويلا"],
    places: ["الأرجنتين", "أرجنتيني", "تشيلي", "كولومبيا", "كولومبي", "بيرو", "بيروفي", "الإكوادور", "أوروغواي", "باراغواي", "بوليفيا", "بوليفي", "غيانا", "كوبا", "بنما", "ميركوسور", "أمريكا اللاتينية", "أميركا اللاتينية", "أمريكا الجنوبية"],
  }),
  group("Canada", { named: ["كندا"] }),
  group("the rest of sub-Saharan Africa", {
    places: ["كينيا", "كيني", "غانا", "غاني", "إثيوبيا", "إثيوبي", "أنغولا", "أنغولي", "السنغال", "سنغالي", "تنزانيا", "تنزاني", "زامبيا", "زامبي", "موزمبيق", "الكونغو", "ساحل العاج", "كوت ديفوار", "أوغندا", "رواندا", "جنوب الصحراء"],
  }),
];
// Read past by countriesNamed(): «أمريكا اللاتينية» is not America, which it would read in its «أمريكا», and North
// Korea is not the Korea the rule means. The groups' own places still read the whole headline.
const NOT_THEM = /أمريكا اللاتينية|أميركا اللاتينية|أمريكا الجنوبية|أمريكا الوسطى|كوريا الشمالية|الكورية الشمالية|الكوري الشمالي|بيونغ ?يانغ/g;

/** The groups a headline names. */
function namedIn(title, groups) {
  const countries = countriesNamed(title.replace(NOT_THEM, " "));
  const hay = countryText(title);
  return groups.filter((g) => [...g.keys].some((k) => countries.has(k)) || g.res.some((re) => re.test(hay))).map((g) => g.label);
}

/** What a headline names: of the rule's twelve, and of the rest of the world. */
export const placesIn = (title) => ({ twelve: namedIn(title, RULE), others: namedIn(title, OTHERS) });

/** The stories' front matter and the feed record, from the working tree or from `ref` (one `git cat-file --batch`). */
function readFiles(ref) {
  if (!ref) {
    const dir = path.join("content", "articles");
    const texts = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => readFileSync(path.join(dir, f), "utf8"));
    let feeds = {};
    try {
      feeds = JSON.parse(readFileSync(path.join("pipeline", "state", "feeds.json"), "utf8")).feeds ?? {};
    } catch {
      /* no record yet */
    }
    return { texts, feeds, at: "this checkout" };
  }
  const git = (args, input) => execFileSync("git", args, { input, maxBuffer: 1 << 30 });
  let commit;
  try {
    commit = git(["rev-parse", "--short", ref]).toString().trim();
  } catch {
    console.error(`coverage: no commit called ${ref} here (run \`git fetch pages\` first)`);
    process.exit(1);
  }
  const names = git(["ls-tree", "--name-only", ref, "content/articles/"]).toString().split("\n").filter((n) => n.endsWith(".md"));
  const out = git(["cat-file", "--batch"], [...names, "pipeline/state/feeds.json"].map((n) => `${ref}:${n}`).join("\n") + "\n");
  // Each answer is "<id> blob <size>\n<bytes>\n", or "<name> missing\n".
  const blobs = [];
  for (let i = 0; i < out.length; ) {
    const nl = out.indexOf(10, i);
    const size = Number(out.subarray(i, nl).toString().split(" ")[2]);
    if (!Number.isInteger(size)) {
      blobs.push(null);
      i = nl + 1;
      continue;
    }
    blobs.push(out.subarray(nl + 1, nl + 1 + size).toString("utf8"));
    i = nl + 1 + size + 1;
  }
  let feeds = {};
  try {
    feeds = JSON.parse(blobs.pop() ?? "{}").feeds ?? {};
  } catch {
    /* no record at that commit */
  }
  return { texts: blobs.filter(Boolean), feeds, at: `${ref} at ${commit}` };
}

/** A published news story as this count reads it, or null. */
function storyOf(text) {
  const head = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
  if (!head) return null;
  let data;
  try {
    data = YAML.parse(head[1]);
  } catch {
    return null;
  }
  if ((data.kind ?? "news") !== "news" || data.draft === true) return null;
  const at = Date.parse(data.publishedAt);
  if (!Number.isFinite(at)) return null;
  const title = String(data.title ?? "");
  const regions = canonicalRegions(data.regions ?? []);
  return {
    at,
    title,
    regions,
    arab: regions.some((r) => ARAB.includes(r)),
    ...placesIn(title),
    sources: (data.sources ?? []).filter((s) => s?.url).map((s) => ({ url: String(s.url), name: String(s.nameEn ?? s.name ?? "") })),
  };
}

const LOG = [0];
const logFact = (n) => {
  for (let i = LOG.length; i <= n; i++) LOG[i] = LOG[i - 1] + Math.log(i);
  return LOG[n];
};
const logChoose = (n, k) => logFact(n) - logFact(k) - logFact(n - k);
/** Fisher's exact test, two-sided: k1 of n1 against k2 of n2. */
export function fisher(k1, n1, k2, n2) {
  if (!n1 || !n2) return NaN;
  const n = n1 + n2;
  const k = k1 + k2;
  const prob = (x) => Math.exp(logChoose(k, x) + logChoose(n - k, n1 - x) - logChoose(n, n1));
  const p0 = prob(k1);
  let p = 0;
  for (let x = Math.max(0, n1 - (n - k)); x <= Math.min(k, n1); x++) {
    const px = prob(x);
    if (px <= p0 * (1 + 1e-7)) p += px;
  }
  return Math.min(1, p);
}

// The six sources added with the rule (pipeline/sources.json), by the addresses their stories cite.
const NEW_SOURCES = [["boj", "boj.or.jp"], ["rbi", "rbi.org.in"], ["bcb", "bcb.gov.br"], ["mercopress", "mercopress.com"], ["businessday-ng", "businessday.ng"], ["nairametrics", "nairametrics.com"]];
const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const cites = (s, domain) => s.sources.some((x) => hostOf(x.url) === domain || hostOf(x.url).endsWith(`.${domain}`));

function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const ref = arg("ref") ?? null;
  const change = Date.parse(arg("change") ?? "2026-11-09T18:25:38Z");
  const days = Number(arg("days") ?? 28);
  const end = arg("to") ? Date.parse(arg("to")) : Date.now();
  const start = change - days * DAY;
  if (![change, start, end].every(Number.isFinite) || !(days > 0) || end <= change) {
    console.error("coverage: --change and --to must be times with --to after --change, and --days a positive number");
    process.exit(1);
  }

  const { texts, feeds, at } = readFiles(ref);
  const stories = texts.map(storyOf).filter((s) => s && s.at >= start && s.at < end);
  const before = stories.filter((s) => s.at < change);
  const after = stories.filter((s) => s.at >= change);
  const daysBefore = (change - start) / DAY;
  const daysAfter = (end - change) / DAY;

  const when = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
  const W = 46;
  const cell = (k, n) => `${String(k).padStart(4)} ${n ? `${((100 * k) / n).toFixed(1)}%`.padStart(6) : "     -"}`;
  const row = (label, test, { p = false } = {}) => {
    const kb = before.filter(test).length;
    const ka = after.filter(test).length;
    const pv = p ? fisher(kb, before.length, ka, after.length) : NaN;
    console.log(`${label.padEnd(W)}${cell(kb, before.length)}    ${cell(ka, after.length)}${p ? `    p=${Number.isFinite(pv) ? pv.toPrecision(2) : "-"}` : ""}`);
    return [kb, ka];
  };

  console.log(`Where the news stories come from, read from ${at}.`);
  console.log(`Before: ${when(start)} to ${when(change)} UTC (${daysBefore.toFixed(1)} days). After: ${when(change)} to ${when(end)} UTC (${daysAfter.toFixed(1)} days).`);
  console.log("A story counts in every group its headline names. p: Fisher's exact test of the two shares.\n");
  console.log(`${"".padEnd(W)}${"before".padStart(11)}    ${"after".padStart(11)}`);
  console.log(`${"news stories (a day)".padEnd(W)}${`${before.length} (${(before.length / daysBefore).toFixed(1)})`.padStart(11)}    ${`${after.length} (${(after.length / daysAfter).toFixed(1)})`.padStart(11)}`);
  row("on an Arab desk", (s) => s.arab, { p: true });
  row("  and naming one of the twelve as well", (s) => s.arab && s.twelve.length > 0);
  // The rule is about the stories that are not about the Arab world: the rows below count those alone, as shares of
  // all the window's news.
  console.log("Not on an Arab desk, the headline names:");
  const [twelveBefore, twelveAfter] = row("  one of the rule's twelve", (s) => !s.arab && s.twelve.length > 0, { p: true });
  console.log(`${"    (a week)".padEnd(W)}${((twelveBefore * 7) / daysBefore).toFixed(1).padStart(11)}    ${((twelveAfter * 7) / daysAfter).toFixed(1).padStart(11)}`);
  for (const g of RULE) row(`    ${g.label}`, (s) => !s.arab && s.twelve.includes(g.label));
  for (const g of OTHERS) row(`  ${g.label}`, (s) => !s.arab && s.others.includes(g.label));
  row("  no place", (s) => !s.arab && !s.twelve.length && !s.others.length);

  console.log("\nThe regions the writers gave (a story may carry several):");
  for (const [label, desk] of [["Europe", "أوروبا"], ["Asia", "آسيا"], ["the Americas", "الأمريكتان"], ["Africa", "أفريقيا"], ["the world", "عالمي"]]) {
    row(`  ${label}`, (s) => s.regions.includes(desk));
  }

  console.log("\nThe six sources of 2026-11-09: news stories citing each, and the feed when it was last read.");
  for (const [id, domain] of NEW_SOURCES) {
    const f = feeds[id];
    const feed = f ? `newest item ${f.newestAt ? when(Date.parse(f.newestAt)) : "undated"}, read ${when(Date.parse(f.readAt))} UTC` : "never read";
    console.log(`  ${id.padEnd(16)}${String(before.filter((s) => cites(s, domain)).length).padStart(3)} before  ${String(after.filter((s) => cites(s, domain)).length).padStart(3)} after   (${feed})`);
  }

  const outlets = (s) => [...new Set(s.sources.map((x) => x.name).filter(Boolean))].join(", ");
  const list = (label, set, test) => {
    const hits = set.filter(test).sort((a, b) => a.at - b.at);
    console.log(`\n${label}: ${hits.length}`);
    for (const s of hits) console.log(`  ${when(s.at).slice(5, 16)} [${[...s.twelve, ...s.others].join(", ")}${s.arab ? "; Arab desk" : ""}] ${s.title}  <- ${outlets(s)}`);
  };
  list("After the change, headlines naming one of the twelve", after, (s) => s.twelve.length > 0);
  list("After the change, stories citing one of the six", after, (s) => NEW_SOURCES.some(([, d]) => cites(s, d)));
  if (process.argv.includes("--list")) list("Before it, headlines naming one of the twelve", before, (s) => s.twelve.length > 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
