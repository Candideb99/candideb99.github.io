import { readFileSync } from "node:fs";
import path from "node:path";
import { attributionLine, searchCommons } from "./commons.mjs";
import { chat } from "./llm.mjs";
// The house spellings the copy desk keeps («أمريكي»، «ترامب») hold under photographs too.
import { fixNames } from "./copydesk.mjs";
import { USER_AGENT, fetchWithTimeout } from "./util.mjs";

/** Vision providers cannot fetch Wikimedia URLs themselves; inline the thumbnails as data URLs. */
async function inlineImage(url, log) {
  try {
    const response = await fetchWithTimeout(url, { headers: { "user-agent": USER_AGENT } }, 25000);
    if (!response.ok) {
      log(`image: thumbnail HTTP ${response.status} for ${url.slice(0, 90)}`);
      return null;
    }
    const type = response.headers.get("content-type") ?? "image/jpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 4_000_000) {
      log(`image: thumbnail too large (${bytes.length} bytes)`);
      return null;
    }
    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch (error) {
    log(`image: could not inline ${url.slice(0, 90)}: ${error.message}`);
    return null;
  }
}

/** Long, adjective-heavy queries find nothing on Commons; retry with the core nouns. */
function simplerQueries(query) {
  const words = query.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["aerial", "view", "exterior", "close-up", "closeup", "interior", "skyline", "signage", "building", "facility", "stack", "photo", "image", "at", "of", "the", "in", "on", "with", "and", "a", "an"]);
  const core = words.filter((w) => !stop.has(w.toLowerCase()));
  const out = [];
  if (core.length && core.join(" ") !== query) out.push(core.join(" "));
  if (core.length > 2) out.push(core.slice(0, 2).join(" "));
  if (core.length > 1) out.push(core[core.length - 1]);
  return [...new Set(out)].filter((q) => q.length >= 3);
}

/**
 * The year a photograph was taken: its record's date, else a date in its file name («…-20260515.jpg»,
 * «2018 G20»), else (`upload`) the year it was uploaded. Null when nothing says.
 */
function photoYear(image, { upload = true } = {}) {
  const fromDate = String(image.date ?? "").match(/(?<!\d)((?:19|20)\d\d)(?!\d)/)?.[1];
  const fromTitle = String(image.title ?? "").match(/(?<!\d)((?:19|20)\d\d)(?:[01]\d[0-3]\d)?(?!\d)/)?.[1];
  const fromUpload = upload ? String(image.uploaded ?? "").match(/^((?:19|20)\d\d)/)?.[1] : undefined;
  const year = Number(fromDate ?? fromTitle ?? fromUpload);
  return Number.isFinite(year) && year > 1900 ? year : null;
}

/**
 * Newer is better, by the year the photograph was taken: this year's first, then last year's, and so on
 * down to ten years back (the owner, 2026-09-23: "check if we can still get up to date images that are
 * relevant"). The flat bonus it replaced, the same for every year from 2015, put a 2017 handshake level
 * with May 2026's.
 */
function recencyScore(image) {
  const year = photoYear(image);
  if (!year) return 0;
  const age = new Date().getUTCFullYear() - year;
  return age <= 0 ? 6 : age === 1 ? 4 : age === 2 ? 3 : age <= 5 ? 2 : age <= 10 ? 1 : -2;
}

/**
 * The name a Commons file gives to the person it shows, when it gives one: "Secretary Kerry", "Vice
 * Premier Liu", "President Macron", "Minister Schallenberg", "CEO Altman". Returns the surnames found.
 * 2026-09-22: a story about Bessent and He Lifeng ran "Secretary Kerry, Chinese Vice Premier Liu…"
 * because the room matched; no model should have had to be trusted with that call.
 */
const RANK = /\b(?:Secretary|President|Vice[- ]President|Prime Minister|Premier|Vice[- ]Premier|Chancellor|Minister|Governor|Senator|Congressman|Ambassador|King|Queen|Prince|Princess|Sheikh|Emir|Crown Prince|Chairman|Chairwoman|CEO|Director|Commissioner|Mayor|General|Admiral|Pope|Sultan)\s+(?:of\s+[A-Z][\w-]+\s+)?([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?)/g;
/** Words that make a rank-plus-name a place or an institution, not a person: "King Abdulaziz International Airport", "General Motors", "Prince Sultan Air Base". */
const NOT_A_PERSON = new Set(["international", "airport", "university", "hospital", "stadium", "bridge", "street", "road", "avenue", "boulevard", "highway", "causeway", "center", "centre", "city", "port", "base", "district", "foundation", "medical", "park", "square", "tower", "towers", "mosque", "library", "museum", "school", "college", "institute", "financial", "economic", "cup", "trophy", "league", "motors", "electric", "mills", "hotel", "terminal", "station", "line", "dam", "canal", "complex", "hall", "building", "plaza", "mall", "gardens", "memorial", "academy", "company", "corporation", "bank", "fund", "award", "prize", "air", "naval", "military", "sports", "convention", "exhibition", "expo", "industrial", "village", "island", "islands", "bay", "beach", "harbour", "harbor", "refinery", "oil", "gas", "petroleum", "energy", "campus", "palace", "monument", "statue"]);

/**
 * The people a file names by rank ("Secretary Kerry Poses…", "Vice Premier He Lifeng"): one entry per
 * person, the capitalised words after the rank in lower case. Commons titles are in Title Case, so the
 * word after a surname is often a verb ("Kerry Poses", "Bessent Meets"); a person counts as wanted when
 * ANY of the words is in the search, so a wanted person is not lost to the verb beside the name.
 */
function namedPeople(image) {
  const text = `${image.title ?? ""} ${image.description ?? ""}`;
  const people = [];
  for (const m of text.matchAll(RANK)) {
    const words = m[1].split(/\s+/).map((w) => w.toLowerCase());
    const next = text.slice(m.index + m[0].length).match(/^\s+([A-Za-z][\w-]*)/)?.[1]?.toLowerCase();
    if (words.some((w) => NOT_A_PERSON.has(w)) || (next && NOT_A_PERSON.has(next))) continue;
    people.push(words);
  }
  return people;
}

/**
 * Where a photograph was taken is part of what it says. The owner, 2026-09-23, on a US diesel story
 * that ran a Finnish filling station («ITSEPALVELU» on the pump; its Commons categories say "Finland
 * photographs taken on 2016-08-19"): "pictures should also match geographical locations if possible".
 * The checks had judged only the frame and passed it as an anonymous sector scene. Every step that
 * chooses or checks a picture now reads this rule; the audit imports it too.
 */
export const PLACE_RULE = `WHERE IT WAS TAKEN. The photograph must match the story's geography. When the story is about ONE country (a US fuel ban, a Saudi pipeline, Egypt's budget, a Qatari gas field), the photograph must come from that country whenever anything says where it was taken: the file name, the description, the categories (for example "Finland photographs taken on 2016-08-19" or "Gas stations in Germany"), or writing in the frame (shop signs, pump labels, road signs, number plates) in a language or script not used in the story's country, such as the Finnish «ITSEPALVELU» on a pump on a US story. A photograph placed in another country is WRONG_SUBJECT for such a story, however typical its scene. A scene with no clue to its place is acceptable only when nothing from the story's own country is on offer. For a story about the world market, a region or several countries, a sector scene may come from anywhere unless the frame itself identifies a country the story does not mention.`;

/**
 * "If possible" (the owner's words). When nothing from the story's own country passes, a story is not left
 * bare: a neutral frame of its sector runs, captioned «صورة تعبيرية» (illustrative photo), as the Arabic
 * desks caption stock pictures. Neutral means nothing a reader can see says where it was taken; the file's
 * own record may name a place, since readers never see it. This is the pass that would have refused the
 * Finnish pump: its lettering, «ITSEPALVELU», is in the frame.
 */
export const ILLUSTRATIVE = "صورة تعبيرية";
const NEUTRAL_RULE = `LAST PASS: no photograph from the story's own country was found, so a neutral stock illustration may run, captioned as illustrative. The file names above may say where each photo was taken; in this pass that does not count against it, because readers never see the file name. Judge only what a reader would see: choose a frame of the story's own sector that shows nothing pointing to a place — no shop, road or station signs, no pump or shop lettering, no number plates, no writing in a local language or script, no flag, no landmark, no skyline, no street, no identifiable person. A ship's own name on its hull and a maker's name on a machine are fine; they point to no country. A server hall, a production line, pipes, a tank farm, a refinery or a tanker at sea can qualify; a filling station, a shop front or a street cannot. Nor can a frame whose land, weather or vegetation contradicts the story's own place: a green forest, snow or rain for a story set in the Gulf's deserts (a Saudi pipeline is shown in dry, open land or not at all). When in doubt, choose 0.`;
const NEUTRAL_CHECK = `This is a LAST-PASS neutral illustration: no photograph from the story's own country was found, and the paper will caption this one «${ILLUSTRATIVE}» (illustrative photo). Where the file says it was taken does not matter, because readers never see the file; what matters is what they see. The file's record may name the terminal, jetty, refinery, port, company or country where the photograph was taken: that does NOT count against it (a crude tanker at a jetty the record calls "BP Oil Refinery Jetty, Kwinana" is a neutral tanker to a reader). Refuse it (WRONG_SUBJECT) for what a reader can see: readable signs or lettering in the frame (a logo, a company's name on a tank or a building), a flag, a famous landmark or skyline, a street; or if the caption names a place, or if its land, weather or vegetation contradicts the story's own place (a green forest, snow or rain under a story set in the Gulf's deserts: a Siberian pipeline ran under a Saudi pipeline story on 2026-09-24); accept it (GENERIC_OK) when it is a neutral frame of the story's own sector.`;

/**
 * The same rule without a model. The free judges read "Finland photographs taken on 2016-08-19" and
 * still passed the Finnish pump as "no location clues" (audit of 2026-09-23), so a photo's country is
 * also read in code: Commons files carry it in their categories ("Finland photographs taken on …",
 * "Gas stations in Finland") and often in the title or description. The story's countries come from
 * its Arabic tags. A photo placed in a country none of the story's tags name is refused; a story that
 * names no country (the world market, a region) and a photo that names none are left to the judges.
 */
const STORY_COUNTRIES = {
  "الولايات المتحدة": "United States", "أمريكا": "United States", "أميركا": "United States", "واشنطن": "United States",
  "السعودية": "Saudi Arabia", "المملكة العربية السعودية": "Saudi Arabia", "أرامكو": "Saudi Arabia",
  "الإمارات": "United Arab Emirates", "الإمارات العربية المتحدة": "United Arab Emirates", "دبي": "United Arab Emirates", "أبوظبي": "United Arab Emirates",
  "مصر": "Egypt", "القاهرة": "Egypt", "قطر": "Qatar", "الكويت": "Kuwait", "سلطنة عمان": "Oman", "عمان": "Oman", "عُمان": "Oman", "البحرين": "Bahrain",
  "العراق": "Iraq", "إيران": "Iran", "الأردن": "Jordan", "لبنان": "Lebanon", "سوريا": "Syria", "اليمن": "Yemen",
  "إسرائيل": "Israel", "تركيا": "Turkey", "المغرب": "Morocco", "الجزائر": "Algeria", "تونس": "Tunisia", "ليبيا": "Libya", "السودان": "Sudan",
  "الصين": "China", "اليابان": "Japan", "الهند": "India", "كوريا الجنوبية": "South Korea", "باكستان": "Pakistan",
  "إندونيسيا": "Indonesia", "ماليزيا": "Malaysia", "سنغافورة": "Singapore", "روسيا": "Russia", "أوكرانيا": "Ukraine",
  "ألمانيا": "Germany", "فرنسا": "France", "بريطانيا": "United Kingdom", "المملكة المتحدة": "United Kingdom",
  "إيطاليا": "Italy", "إسبانيا": "Spain", "هولندا": "Netherlands", "بلجيكا": "Belgium", "النمسا": "Austria", "سويسرا": "Switzerland",
  "النرويج": "Norway", "السويد": "Sweden", "فنلندا": "Finland", "الدنمارك": "Denmark", "بولندا": "Poland",
  "جرينلاند": "Greenland", "غرينلاند": "Greenland", "كندا": "Canada", "المكسيك": "Mexico", "البرازيل": "Brazil",
  "أستراليا": "Australia", "نيجيريا": "Nigeria", "جنوب أفريقيا": "South Africa",
};
/** Tags that name a country by its adjective or its institutions («العقوبات الأمريكية», «الاحتياطي الفيدرالي»). */
const STORY_STEMS = [
  ["أمريك", "United States"], ["أميرك", "United States"], ["ترامب", "United States"], ["ترمب", "United States"], ["الاحتياطي الفيدرالي", "United States"], ["وول ستريت", "United States"],
  ["سعودي", "Saudi Arabia"], ["إماراتي", "United Arab Emirates"], ["مصري", "Egypt"], ["قطري", "Qatar"], ["كويتي", "Kuwait"], ["عماني", "Oman"], ["عراقي", "Iraq"], ["إيراني", "Iran"],
  ["الصيني", "China"], ["الياباني", "Japan"], ["الهندي", "India"], ["الروسي", "Russia"], ["أوكراني", "Ukraine"], ["ألماني", "Germany"], ["فرنسي", "France"], ["بريطاني", "United Kingdom"], ["كندي", "Canada"], ["التركي", "Turkey"],
];
// A United States Navy photograph is often taken in the Gulf, so "U.S."/"USA" alone never places a photo:
// only a state, a city, or a category that says the photo was taken in the country.
const PHOTO_PLACES = {
  "United States": ["United States photographs", "in the United States", "Alabama", "Alaska", "Arizona", "California", "Colorado", "Florida", "Illinois", "Louisiana", "Michigan", "Nevada", "New Jersey", "New York", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Texas", "Utah", "Wyoming", "Washington, D.C.", "Manhattan", "San Francisco", "Chicago", "Houston", "Los Angeles", "Seattle"],
  "Saudi Arabia": ["Saudi Arabia", "Riyadh", "Jeddah", "Dammam", "Yanbu", "Ras Tanura", "Dhahran", "Jazan"],
  "United Arab Emirates": ["United Arab Emirates", "Dubai", "Abu Dhabi", "Fujairah", "Sharjah"],
  Egypt: ["Egypt", "Cairo", "Alexandria", "Suez", "Port Said"], Qatar: ["Qatar", "Doha", "Ras Laffan"], Kuwait: ["Kuwait"], Oman: ["Oman", "Muscat"], Bahrain: ["Bahrain", "Manama"],
  Iraq: ["Iraq", "Baghdad", "Basra"], Iran: ["Iran", "Tehran"], Jordan: ["Jordan", "Amman"], Lebanon: ["Lebanon", "Beirut"], Syria: ["Syria", "Damascus"], Yemen: ["Yemen", "Aden"],
  Israel: ["Israel", "Eilat", "Haifa", "Tel Aviv"], Turkey: ["Turkey", "Istanbul", "Ankara"], Morocco: ["Morocco", "Casablanca", "Rabat"], Algeria: ["Algeria", "Algiers"], Tunisia: ["Tunisia"], Libya: ["Libya", "Tripoli"], Sudan: ["Sudan", "Khartoum"],
  China: ["China", "Shanghai", "Beijing", "Shenzhen", "Guangzhou"], Japan: ["Japan", "Tokyo", "Yokohama", "Osaka"], India: ["India", "Mumbai", "New Delhi"], "South Korea": ["South Korea", "Seoul", "Busan"], Pakistan: ["Pakistan", "Karachi"],
  Indonesia: ["Indonesia", "Jakarta"], Malaysia: ["Malaysia", "Kuala Lumpur"], Singapore: ["Singapore"], Russia: ["Russia", "Moscow", "Saint Petersburg"], Ukraine: ["Ukraine", "Kyiv", "Kiev"],
  Germany: ["Germany", "Berlin", "Hamburg", "Frankfurt", "Munich"], France: ["France", "Paris", "Marseille"], "United Kingdom": ["United Kingdom", "England", "Scotland", "Wales", "London", "Solent", "Southampton"],
  Italy: ["Italy", "Rome", "Milan"], Spain: ["Spain", "Madrid", "Barcelona"], Netherlands: ["Netherlands", "Rotterdam", "Amsterdam"], Belgium: ["Belgium", "Brussels", "Antwerp"], Austria: ["Austria", "Vienna", "Schwechat"], Switzerland: ["Switzerland", "Geneva", "Zurich", "Vevey"],
  Norway: ["Norway", "Oslo"], Sweden: ["Sweden", "Stockholm", "Gothenburg"], Finland: ["Finland", "Helsinki"], Denmark: ["Denmark", "Copenhagen"], Poland: ["Poland", "Warsaw"],
  Greenland: ["Greenland", "Ilulissat"], Canada: ["Canada", "Ontario", "Alberta", "Quebec", "Toronto", "Vancouver"], Mexico: ["Mexico"], Brazil: ["Brazil", "Rio de Janeiro", "São Paulo"],
  Australia: ["Australia", "Western Australia", "Queensland", "New South Wales", "Sydney", "Melbourne", "Kwinana"], Nigeria: ["Nigeria", "Lagos"], "South Africa": ["South Africa", "Johannesburg", "Cape Town"],
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PHOTO_PLACE_RE = Object.entries(PHOTO_PLACES).map(([country, names]) => [country, new RegExp(`(?<![A-Za-z])(?:${names.map(escapeRe).join("|")})(?![A-Za-z])`)]);

/** Waters and regions a story names by themselves: «مضيق هرمز» is Iran's, Oman's and the Emirates' shore,
 *  «الأسهم الأوروبية» any European market's. */
const GULF = ["Saudi Arabia", "United Arab Emirates", "Qatar", "Kuwait", "Bahrain", "Oman", "Iraq", "Iran"];
const EUROPE = ["United Kingdom", "France", "Germany", "Italy", "Spain", "Netherlands", "Belgium", "Austria", "Switzerland", "Norway", "Sweden", "Finland", "Denmark", "Poland"];
const EURO_AREA = ["Germany", "France", "Italy", "Spain", "Netherlands", "Belgium", "Austria", "Finland"];
const EU = [...EURO_AREA, "Sweden", "Denmark", "Poland"];
const ASIA = ["China", "Japan", "India", "South Korea", "Pakistan", "Indonesia", "Malaysia", "Singapore"];
const AFRICA = ["Egypt", "Morocco", "Algeria", "Tunisia", "Libya", "Sudan", "Nigeria", "South Africa"];
const MIDDLE_EAST = [...GULF, "Egypt", "Jordan", "Lebanon", "Syria", "Yemen", "Israel", "Turkey"];
const PLACE_STEMS = [
  ["الخليج", GULF], ["خليجي", GULF], ["هرمز", ["Iran", "Oman", "United Arab Emirates"]], ["الحوثي", ["Yemen"]], ["باب المندب", ["Yemen"]],
  ["البحر الأحمر", ["Egypt", "Saudi Arabia", "Yemen", "Sudan", "Jordan", "Israel"]], ["السويس", ["Egypt"]],
  ["شرق-غرب", ["Saudi Arabia"]], ["الشرق-الغرب", ["Saudi Arabia"]], ["شرق غرب", ["Saudi Arabia"]],
  ["أوروب", EUROPE], ["الاتحاد الأوروبي", EU], ["اليورو", EURO_AREA], ["آسيا", ASIA], ["آسيوي", ASIA],
  ["أفريقي", AFRICA], ["إفريقي", AFRICA], ["الشرق الأوسط", MIDDLE_EAST], ["المغرب العربي", ["Morocco", "Algeria", "Tunisia", "Libya"]],
];
/** A world body's or a company's own building is at home on its stories: OPEC in Vienna and its members'
 *  oil fields, the ECB in Frankfurt, Nestlé at Vevey. A curated list, like the desks; a company missing from
 *  it is judged by the story's countries alone. Matched as whole words, so «أبل» is not read in «أبلغت». */
const INSTITUTION_HOMES = [
  ["البنك المركزي الأوروبي", ["Germany"]], ["أوبك", ["Austria", "Saudi Arabia", "Iraq", "United Arab Emirates", "Kuwait", "Iran", "Algeria", "Libya", "Nigeria", "Russia", "Oman"]],
  ["صندوق النقد", ["United States"]], ["البنك الدولي", ["United States"]], ["منظمة التجارة العالمية", ["Switzerland"]], ["بنك التسويات الدولية", ["Switzerland"]],
  ["بنك إنجلترا", ["United Kingdom"]], ["بنك اليابان", ["Japan"]], ["بنك الشعب الصيني", ["China"]], ["وكالة الطاقة الدولية", ["France"]],
  ["منظمة التعاون الاقتصادي", ["France"]], ["المفوضية الأوروبية", ["Belgium"]], ["الأمم المتحدة", ["United States", "Switzerland"]],
  ["أدنوك", ["United Arab Emirates"]], ["قطر للطاقة", ["Qatar"]], ["قطر غاز", ["Qatar"]], ["سابك", ["Saudi Arabia"]],
  ["سينوبك", ["China"]], ["بتروتشاينا", ["China"]], ["هواوي", ["China"]], ["روسنفت", ["Russia"]], ["غازبروم", ["Russia"]], ["لوك أويل", ["Russia"]],
  ["نستله", ["Switzerland"]], ["أوشان", ["France"]], ["توتال", ["France"]], ["توتال إنرجيز", ["France"]], ["إيني", ["Italy"]], ["إكوينور", ["Norway"]],
  ["إكسون", ["United States"]], ["إكسون موبيل", ["United States"]], ["شيفرون", ["United States"]], ["أبل", ["United States"]], ["إنفيديا", ["United States"]], ["إنتل", ["United States"]],
  ["مايكروسوفت", ["United States"]], ["غوغل", ["United States"]], ["جوجل", ["United States"]], ["ألفابت", ["United States"]], ["أمازون", ["United States"]], ["ميتا", ["United States"]],
  ["تسلا", ["United States"]], ["بوينغ", ["United States"]], ["بيركشاير", ["United States"]], ["أوبن إيه آي", ["United States"]], ["أنثروبيك", ["United States"]],
  ["سامسونغ", ["South Korea"]], ["تويوتا", ["Japan"]], ["سوفت بنك", ["Japan"]], ["بي واي دي", ["China"]], ["فولكس فاغن", ["Germany"]], ["فولكسفاغن", ["Germany"]],
  ["سيمنس", ["Germany"]], ["إيرباص", ["France", "Germany"]],
];
/** The countries of each regional desk (src/data/regions.json), in English. A Gulf story may show the Gulf's
 *  Iraqi and Iranian shores, and a Middle East story the Gulf. */
const DESK_COUNTRIES = (() => {
  const desks = new Map();
  try {
    for (const d of JSON.parse(readFileSync(path.join(process.cwd(), "src", "data", "regions.json"), "utf8"))) {
      desks.set(d.name, new Set(d.match.map((m) => STORY_COUNTRIES[m]).filter(Boolean)));
    }
  } catch {
    /* without the desk list, tags alone decide */
  }
  const gulf = desks.get("الخليج");
  const mena = desks.get("الشرق الأوسط");
  if (gulf) ["Iraq", "Iran"].forEach((c) => gulf.add(c));
  if (gulf && mena) gulf.forEach((c) => mena.add(c));
  return desks;
})();

/** A name as a whole word, through the letters Arabic joins to it («بالسعودية», «للصين», «ومصر», «لأبل»). */
function wordRe(name) {
  const forms = [escapeRe(name)];
  if (name.startsWith("ال")) forms.push(`لل${escapeRe(name.slice(2))}`);
  return new RegExp(`(?<![\\p{L}\\p{M}])[وف]?[بكل]?(?:${forms.join("|")})(?![\\p{L}\\p{M}])`, "u");
}
/** Countries by name, in a headline or a tag. «عمان» alone is left out: it is Oman and Amman. */
const COUNTRY_WORDS = Object.entries(STORY_COUNTRIES).filter(([name]) => name !== "عمان").map(([name, country]) => [wordRe(name), [country]]);
const INSTITUTION_WORDS = INSTITUTION_HOMES.map(([name, countries]) => [wordRe(name), countries]);
const STEMS = [...STORY_STEMS.map(([stem, country]) => [stem, [country]]), ...PLACE_STEMS];

/**
 * The countries a story is about, in English: what its headline and tags name (countries, their adjectives,
 * their waters, the seats of the world bodies and companies in it). Only a story that names none takes its
 * desks' countries. A desk is a broad shelf: the Asia desk runs from Beijing to Perth, and counting it as
 * home let a China–Russia oil story keep a tanker at an Australian jetty, captioned «في كوينانا بأستراليا»
 * (2026-09-23).
 */
export function storyCountries(story) {
  const out = new Set();
  const add = (countries) => countries.forEach((c) => out.add(c));
  const texts = [...(story?.tags ?? []).map((t) => String(t).trim()), String(story?.title ?? "")];
  for (const text of texts) {
    if (STORY_COUNTRIES[text]) out.add(STORY_COUNTRIES[text]);
    for (const [re, countries] of [...COUNTRY_WORDS, ...INSTITUTION_WORDS]) if (re.test(text)) add(countries);
    for (const [stem, countries] of STEMS) if (text.includes(stem)) add(countries);
  }
  if (!out.size) for (const desk of story?.regions ?? []) add([...(DESK_COUNTRIES.get(desk) ?? [])]);
  return out;
}

/** The country a photo was taken in when its own metadata says so and it is none of the story's; else null.
 *  A story filed on the world desk alone (عالمي) is left to the judges: a passing country tag does not make
 *  a world-market story one country's. */
export function placedAbroad(image, story) {
  const desks = story?.regions ?? [];
  if (desks.length && desks.every((d) => d === "عالمي")) return null;
  const home = storyCountries(story);
  if (!home.size) return null;
  // "Ships built in South Korea", "Builder: Daewoo …, South Korea", "under the flag of Singapore" say where a
  // ship was made or registered, not where the photograph was taken.
  const said = `${image?.title ?? ""} | ${image?.description ?? ""} | ${image?.categories ?? ""}`
    .replace(/_/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\b(?:built|made|manufactured|registered|designed|founded)\s+(?:in|by)\s+[^|;,]+/gi, " ")
    .replace(/\b(?:Builder|Flag|Owner|Operator|Manager|Home port):\s*[^|;]*?(?=\s+[A-Z][A-Za-z ]{1,20}:|[|;]|$)/g, " ")
    .replace(/\bflag of\s+[^|;,.]+/gi, " ");
  const found = PHOTO_PLACE_RE.filter(([, re]) => re.test(said)).map(([country]) => country);
  if (!found.length || found.some((c) => home.has(c))) return null;
  return found[0];
}

/**
 * Searches Commons for every query (with simpler fallbacks) and ranks the unique results.
 * `people`: "by-query" keeps a photo of a named person only when the query itself asked for that
 * surname (the writer's specific subject); "none" drops every photo of a named person — a generic
 * illustration is a place or a thing, never somebody else's summit.
 * `place`: words that name the story's one country (its name, demonym, main cities); a photo whose
 * title, description or categories carry one is ranked first, so the shortlist starts at home.
 * `together`: the story's people (English full names); a photo whose record names two of them is ranked
 * first, one that names one of them next, so a summit story starts with the two leaders side by side.
 */
/**
 * What a search phrase is about: its lower-case words («oil tanker Persian Gulf» → oil, tanker). Capitalised
 * words name a place, a company or a person, and a file that matches only them is about something else: for
 * that phrase Commons put four 2014 shots of a Gulf beach first, and the ranking below, which read recency and
 * life but not relevance, sent them to the judge with a map and a fighter jet (2026-09-24, the Brent story,
 * after the owner called its offshore-risers picture "weird").
 */
const EVENT = /\b(?:forum|conference|summit|ceremony|awards?|seminar|symposium|panel|congress|convention|meeting|visits?|reception|gala|rally|delegation)\b/i;
const SUBJECT_STOP = new Set(["and", "the", "for", "with", "from", "near", "into", "over", "under"]);
function subjectWords(query) {
  return [...new Set(String(query).split(/[^\p{L}\p{N}'’-]+/u).filter((w) => w.length >= 3 && /\p{L}/u.test(w) && w === w.toLowerCase() && !SUBJECT_STOP.has(w)))];
}
/** The share of a phrase's subject words a file's title, description and categories carry (a word matches its plural and kin: tanker, tankers). */
function relevance(image, words) {
  if (!words.length) return 1;
  const said = `${image.title ?? ""} ${image.description ?? ""} ${image.categories ?? ""}`.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  const hit = words.filter((w) => {
    const stem = w.length > 5 ? w.slice(0, w.length - 2) : w.slice(0, 4);
    // A long stem also counts inside a compound («Gigafactory» is a factory); a short one only as a word's start
    // («oil» is not in «soil»).
    return said.some((t) => (stem.length >= 5 ? t.includes(stem) : t.startsWith(stem)));
  }).length;
  return hit / words.length;
}

export async function collect(queries, log, { perQuery = 6, max = 8, exclude = new Set(), people = "by-query", place = [], together = [], fresh: freshFirst = false } = {}) {
  const surnames = together.map((name) => String(name).trim().split(/\s+/).pop().toLowerCase()).filter((s) => s.length >= 2);
  const seen = new Set(exclude);
  const candidates = [];
  const year = String(new Date().getUTCFullYear());
  for (const query of queries) {
    // `fresh`: this year's photographs of the subject first (the owner, 2026-09-24, Task 3: "fresher, livelier
    // news photos"; of the newest 24 stories, 12 ran photographs taken 2007-2018, and one ran Albanese's 2022
    // portrait while Commons held nine 2026 photographs of him). The year in the search finds files dated in
    // their names, descriptions or "taken on" categories. Only for the writer's own subjects: on generic sector
    // scenes the year fetched fresh but unrelated files ("oil pipeline 2026" → fishing boats) that crowded the
    // four-photo shortlist, and a pipeline from 2015 looks like one from 2026.
    const fresh = !freshFirst || query.includes(year) ? [] : await searchCommons(`${query} ${year}`, { limit: perQuery, log });
    let results = await searchCommons(query, { limit: perQuery, log });
    for (const alternative of simplerQueries(query)) {
      if (results.length || fresh.length) break;
      results = await searchCommons(alternative, { limit: perQuery, log });
    }
    results = [...fresh, ...results];
    const asked = new Set(query.toLowerCase().split(/[^\p{L}\p{N}'’-]+/u));
    const subject = subjectWords(query);
    for (const image of results) {
      if (seen.has(image.url) || seen.has(`title:${image.title}`)) continue;
      seen.add(image.url);
      // A file that names less than half of what the phrase is about never reaches the judges («bond market
      // screens» found a church in the town of Market Rasen).
      const relevant = relevance(image, subject);
      if (relevant < 0.5) {
        log(`image: dropped "${String(image.title).slice(0, 70)}" — names too little of ${subject.join(", ")}`);
        continue;
      }
      // An archival picture is refused in code: the judges were told "no pre-2005 look" and still
      // put a 1963 Library of Congress trading floor on a 2026 tokenized-stocks story (2026-09-23).
      // When it was taken, from its record or its file name, never from its upload: a 1963 photo uploaded in
      // 2020 is still a 1963 photo.
      const year = photoYear(image, { upload: false });
      if (year && year < 2005) {
        log(`image: dropped "${String(image.title).slice(0, 70)}" — dated ${year}, an archival picture`);
        continue;
      }
      const named = namedPeople(image);
      const unwanted = people === "none" ? named : named.filter((words) => !words.some((w) => asked.has(w)));
      if (unwanted.length) {
        log(`image: dropped "${String(image.title).slice(0, 70)}" — shows ${unwanted.map((w) => w[0]).join(", ")}, not the story's people`);
        continue;
      }
      // A generic illustration shows places and things; an event's photograph is people and banners (the bond
      // explainer's search brought four of an investment forum in Cameroon, 2026-09-24).
      if (people === "none" && EVENT.test(`${image.title ?? ""} ${image.description ?? ""}`)) {
        log(`image: dropped "${String(image.title).slice(0, 70)}" — an event's photograph, people and banners`);
        continue;
      }
      const said = `${image.title ?? ""} ${image.description ?? ""} ${image.categories ?? ""}`.toLowerCase();
      const home = place.some((word) => word && said.includes(String(word).toLowerCase()));
      const ofTheirs = surnames.filter((s) => new RegExp(`(?<![a-z])${escapeRe(s)}(?![a-z])`).test(said)).length;
      // A search for the story's people keeps only files that name one of them: «Amin H. Nasser» brought tombs in
      // South Kalimantan and Indonesia's vice-president, Ma'ruf Amin (2026-09-24).
      if (surnames.length && !ofTheirs) {
        log(`image: dropped "${String(image.title).slice(0, 70)}" — names none of the story's people`);
        continue;
      }
      // A story about one person: a file that pairs them with someone else («… and Mike Johnson», «Nicki Minaj with
      // Donald Trump») comes after one of them alone, since the judges refuse the other face anyway.
      const company = surnames.length === 1 && ofTheirs === 1 && /\b(?:and|with|meets?|&)\b/i.test(String(image.title ?? "")) ? -3 : 0;
      const withPeople = (ofTheirs >= 2 ? 6 : ofTheirs === 1 ? 2 : 0) + company;
      // Relevance weighs as much as the newest year: a fitting 2019 tanker comes before a 2026 beach.
      candidates.push({ ...image, query, score: 6 * relevant + recencyScore(image) + (image.width >= 1600 ? 1 : 0) + (home ? 4 : 0) + withPeople + liveliness(image) });
    }
    if (candidates.length >= max) break;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Life in a photograph, read from its record: the agencies' pictures show people at work and a sector in
 * action, and of the newest 24 stories on 2026-09-24 most ran a headquarters front, a skyline, a satellite view
 * or a studio portrait. A mild weight, so relevance still leads: it moves a livelier fitting frame onto the
 * four-photo shortlist ahead of an empty facade; the judge makes the choice.
 */
/** What the photo editor is told about life in a picture, beside the ranking below. */
const LIVELY_RULE = `LIFE AND FRESHNESS. Among photographs that fit the story, choose the one with life in it, the way the news agencies' pictures look: the story's own people at work (speaking, meeting, signing, visiting) or its sector in action (ships loading at a port, cranes working, traders at their screens, workers on a line, shoppers in a market, tankers under way). An empty building front, a skyline, an aerial or satellite view, a logo or a studio portrait is the last choice, taken only when nothing livelier fits. Life never makes a photograph of another subject fit: an oil tanker does not illustrate a growth forecast because the forecast mentions energy. Of two fitting and equally lively photographs, the more recent one (the dates are given).`;
/**
 * The owner, 2026-09-24, on the risers of an offshore platform seen from above under a Brent story ("weird
 * unattracting image for the topic") and on the Treasury's front under an explainer of bond yields: a photo
 * must say its subject at a glance, and a concept is pictured at work, not by a ministry's facade.
 */
const GLANCE_RULE = `AT A GLANCE. The reader sees the photograph beside the headline for a moment, often as a small thumbnail: it must show its subject whole and plainly, the picture a news agency would run for it (an oil tanker at sea, pumpjacks in a field, a refinery, traders at their screens, a port's cranes and containers, a factory line, shoppers in a market, the story's people). Refuse a frame that puzzles even when it belongs to the sector: a close-up of a part (pipes, risers, valves, cables, gauges, a hull's plates), a view straight down or from an odd angle, a texture or a pattern, an interior or a piece of equipment only a specialist would recognise, a picture that needs its caption to be understood.`;
const CONCEPT_KINDS = new Set(["explainer", "paper", "analysis", "weekly", "feature"]);
/** The same two faults as the second check and the audit read them (one text, not two copies). */
export function glanceFaults(kind) {
  return `a frame that does not read at a glance (a close-up of a part such as pipes, risers, valves, cables or gauges; a view straight down or from an odd angle; a texture; equipment only a specialist would recognise)${CONCEPT_KINDS.has(kind) ? "; a government's or an institution's building front for this piece, which explains or analyses a concept, unless it is about that institution's own decision" : ""}`;
}
const CONCEPT_RULE = `THIS PIECE EXPLAINS OR ANALYSES (it is not a news report): picture its subject at work in the economy, the way the agencies picture it: traders at their screens or a trading floor for bonds, rates and markets; shoppers and price tags in a market for prices and inflation; a container port for trade; a factory line for industry; a tanker, pumpjacks or a refinery for oil. A government's or an institution's building front does not picture a concept: refuse it unless the piece is about that institution's own decision.`;
const LIVELY = /\b(?:meets?|meeting|speaks?|speaking|speech|press conference|remarks|interview|visit(?:s|ing)?|talks|summit|signing|signs|ceremony|inaugurat\w*|opens?|workers?|employees|traders?|trading floor|dealers?|shoppers?|customers|market(?:place)?|bazaar|souq|souk|port|harbou?r|loading|unloading|ship|vessel|tanker|carrier|crane|cranes|train|trucks?|traffic|construction|assembly line|production line|factory floor|harvest|drilling|rig|queue|crowd)\b/i;
const STATIC = /\b(?:headquarters|head office|building|exterior|facade|façade|skyline|aerial view|satellite|from space|ISS\d*|portrait|official photo|headshot|logo|plaque|nameplate|entrance sign)\b/i;
function liveliness(image) {
  const said = `${image.title ?? ""} ${image.description ?? ""}`;
  return (LIVELY.test(said) ? 2 : 0) - (STATIC.test(said) ? 2 : 0);
}

/**
 * The caption is printed under the photograph, and it is written the way the desks write one, not the way
 * a model describes a picture. The owner, 2026-09-23, on «مصفاة نفط تحت سماء ملبدة بالغيوم»: "a human
 * writer would not describe the sky". A caption names what is shown and, when the file says so, where;
 * it never paints weather, light, colour, mood or composition. Every step that writes a caption carries
 * this rule, and `captionFlaws()` checks the result in code.
 */
export const CAPTION_RULE = `THE CAPTION is shown under the photograph on an Arabic economics news website, so write it the way the desks of Asharq Al-Awsat or Al Jazeera write one: a short noun phrase of 3 to 10 words that says WHAT the photograph shows and, only when the file itself names it, WHERE. Examples of the register: «مصفاة نفط في هيوستن بولاية تكساس الأمريكية», «مقر بورصة نيويورك في وول ستريت», «ناقلة غاز مسال قرب ميناء رأس لفان في قطر», «خوادم في أحد مراكز البيانات», «خط إنتاج بطاريات في مصنع». A caption names; it does not paint: never the weather, the sky, clouds, light, the time of day, colours, the mood, the size impression, the camera or the composition (no «تحت سماء…», «منظر», «مشهد», «لقطة», «في الخلفية», «صورة تظهر», «ضخمة», «حمراء»). Never name a place, company or person the file does not name. A photograph of named people taken at an earlier occasion says so: the occasion and its year as the file gives them («ترامب وشي خلال لقائهما في أوساكا عام 2019»), or «(أرشيفية)» at the end when the file names no occasion. Modern Standard Arabic, no full stop at the end.`;

// Names that contain a colour or a sky word and are not description: struck out before the check.
const CAPTION_NAMES = ["البحر الأحمر", "البحر الأبيض المتوسط", "البحر الأسود", "البيت الأبيض", "النيل الأزرق", "النيل الأبيض", "الهلال الأحمر", "الصليب الأحمر", "الخط الأخضر", "الذهب الأسود", "المنطقة الخضراء", "الجبل الأخضر"];
const CAPTION_FLAWS = /(?<!\p{L})(?:[وفبك]?ال|لل|[وفبك])?(?:سماء|غيوم|غيم|ملبدة|ملبد|غائمة|غائم|صافية|صاف|مشمسة|مشمس|ضباب|غروب|شروق|إضاءة|أضواء|منظر|مشهد|لقطة|الخلفية|المقدمة|تظهر|يظهر|خلابة|خلاب|جميلة|جميل|رائعة|مهيبة|هادئة|هادئ|ضخمة|ضخم|عملاقة|مفتوحة|حمراء|أحمر|زرقاء|أزرق|خضراء|أخضر|صفراء|أصفر|برتقالية|برتقالي|بيضاء|أبيض|سوداء|أسود|رمادية|رمادي)(?!\p{L})/gu;

// Each name with the clitics Arabic attaches to it: البيت الأبيض، للبيت الأبيض، بالبحر الأحمر، والبحر الأسود.
const CAPTION_NAME_RE = new RegExp(CAPTION_NAMES.map((n) => `(?:[وفبك]?ال|لل)${n.slice(2)}`).join("|"), "gu");

/** The painted words a caption carries (sky, weather, light, colour, mood, composition), for the code check. */
export function captionFlaws(caption) {
  const text = String(caption ?? "").replace(CAPTION_NAME_RE, " ");
  return [...new Set(text.match(CAPTION_FLAWS) ?? [])];
}

/**
 * Makes sure a caption is Arabic and written as a caption. A model returned English once (the INEOS
 * refinery, 2026-09-23) and a missing caption used to fall back to the English file title; a painted
 * caption («… تحت سماء ملبدة بالغيوم») is rewritten. If no clean caption comes back, the photo runs with
 * none rather than a foreign or painted one.
 */
async function arabicCaption(alt, log, { file = {}, story = "" } = {}) {
  const text = String(alt ?? "").trim();
  if (text && /[؀-ۿ]/.test(text) && !captionFlaws(text).length) return fixNames(text);
  const written = await writeCaption({ file, story, current: text, log });
  if (!written) log(`image: no clean caption for "${String(file.title ?? text).slice(0, 60)}"; the photo runs without one`);
  return fixNames(written);
}

/**
 * Writes a caption by CAPTION_RULE from what the file says about itself (name, description, categories)
 * and the story, checked in code: Arabic, at most twelve words, nothing painted. Two tries, then "".
 * `illustrative`: the photo runs as «صورة تعبيرية», so its caption names no place (the label is added
 * by the caller).
 */
export async function writeCaption({ file = {}, story = "", current = "", illustrative = false, log = () => {} }) {
  let attempt = String(current ?? "").trim();
  let flaws = captionFlaws(attempt);
  let tooLong = 0;
  for (let round = 0; round < 2; round++) {
    try {
      const { data } = await chat({
        role: "writer",
        system: "You write photo captions for an Arabic economics news website. Reply with one JSON object only.",
        user: `${CAPTION_RULE}${illustrative ? "\nThis photograph runs as an illustration («صورة تعبيرية»), so its caption names no place at all and invents no setting in its stead (no «في مياه مفتوحة», no «في أحد الموانئ»): only the thing it shows, as «ناقلة نفط خام» or «مصفاة نفط»." : ""}
Story: ${story || "(unknown)"}
File name: ${file.title ?? ""}
File description: ${file.description ?? "(none)"}
File categories: ${file.categories ?? "(none)"}
Current caption: ${attempt || "(none)"}${flaws.length ? `\nThe current caption paints (${flaws.join("، ")}); a caption only names.` : ""}${tooLong ? `\nThe current caption runs ${tooLong} words; keep it to ten at most (drop the ship's or the plant's name before the place).` : ""}
Return JSON: {"alt": "<the Arabic caption>"}`,
        temperature: 0,
        maxTokens: 400,
        timeoutMs: 60000,
        log,
      });
      const arabic = String(data?.alt ?? "").trim().replace(/[.。]+$/, "");
      flaws = captionFlaws(arabic);
      const words = arabic.split(/\s+/).filter(Boolean).length;
      if (/[؀-ۿ]/.test(arabic) && !flaws.length && words <= 12) return fixNames(arabic);
      log(`image: caption refused "${arabic}" (${flaws.length ? `paints: ${flaws.join("، ")}` : words > 12 ? `${words} words` : "not Arabic"})`);
      tooLong = words > 12 ? words : 0;
      attempt = arabic || attempt;
    } catch (error) {
      log(`image: caption rewrite failed (${error.message.split("\n")[0]})`);
      break;
    }
  }
  return "";
}

/** Inlines the best candidates for the vision model (at most four). */
async function shortlist(candidates, log) {
  const list = [];
  const inlined = [];
  for (const candidate of candidates) {
    if (list.length >= 4) break;
    const dataUrl = await inlineImage(candidate.url, log);
    if (!dataUrl) continue;
    list.push(candidate);
    inlined.push(dataUrl);
  }
  return { list, inlined };
}

/** Asks the vision model to choose one photograph, or none. `relaxed` accepts a generic illustration. */
async function judge({ list, inlined, draft, story, log, relaxed, neutral = false, people = [] }) {
  // A story about named people is illustrated with those people, as the desks do: the owner, 2026-09-23,
  // on the White House's facade under a Trump–Xi summit story: "i would search for uncopyrighted pictures
  // from older summits maybe for trump and xi together … makes the news look less appealing and boring".
  const theirs = people.length
    ? `\nTHE STORY'S PEOPLE: ${people.join(", ")}. A photograph of them (together, when the story is about their meeting or talks) is the first choice, even from an earlier occasion such as a previous summit, visit or press conference: that is how the news desks illustrate a story about people, and it is livelier than any building. Of the photographs that show them, choose the MOST RECENT (the dates are given): the event itself when its photograph exists, otherwise their latest occasion; an older one only when nothing newer shows them well. It must be a contemporary news photograph (sharp, their faces visible), never a painting, poster, screen, cartoon or a crowd in which they are hard to find, and nothing unflattering or embarrassing. Its caption names them and, for an earlier occasion, that occasion and its year as the file gives them («ترامب وشي خلال لقائهما في أوساكا عام 2019»).`
    : "\nA photograph of the story's own people taken at an earlier occasion (a previous summit, visit or press conference) is how the desks illustrate a story about them; its caption then names that occasion and its year.";
  const placed = relaxed
    ? `This is the fallback pass: a generic but appropriate newspaper illustration is acceptable: a typical scene of the story's OWN sector at work (port, refinery, trading floor, factory line, data-centre hall, LNG tanker, bank branch, oil field), or, when nothing livelier fits, the headquarters of the institution named. The skyline or a landmark of the capital is acceptable only for a story about a country's economy as a whole (inflation, growth, budget, currency, rates, rating); a story about one company, plant, project, product, deal, commodity or technology needs its sector's own object, never a cityscape. Reject: any photograph of identifiable people — officials, politicians, executives, a named meeting, summit, ceremony or visit (a generic illustration shows places and things, never someone else's event); visible text overlays or watermarks; logos, maps, charts, diagrams, infographics, screenshots, documents, banknotes or coins as the subject; a product or appliance close-up unrelated to the story; military vessels, aircraft or weapons for a story that is not about the military; an archival, black-and-white or pre-2005 look; a close-up of a private individual; a recognisable place (a skyline, a landmark, a sign, a flag) in a different country or city than the story's; anything misleading or embarrassing next to the headline. Of two fitting scenes, choose the one taken in the story's own country, and then the more recent one.
${PLACE_RULE}`
    : `Requirements: clearly relevant to the story's subject (institution, place, industry, product); looks like a contemporary editorial news photo, and of two fitting photographs the more recent one (the dates are given); landscape composition; no visible text overlays, watermarks, logos as the main subject, charts, maps, diagrams, infographics, screenshots, product close-ups, or historical/archival look; no close-up of a private individual; nothing embarrassing or misleading if paired with the headline.
PEOPLE — the gravest error: a photograph showing an identifiable person (a politician, official, executive, anyone a caption would name) who is NOT one of the people this story is about is WRONG, however well the room, flag or setting matches. Read each candidate's file name and description for names of people and compare them with the headline: a story about Treasury Secretary Bessent must never run a photo of Secretary Kerry; a story about He Lifeng must never run one of Liu Yandong. When no candidate shows the story's own people, choose 0 and let the fallback find a building, skyline or sector scene instead.${theirs}
${people.length ? "" : PLACE_RULE}`;
  // The last pass swaps the geography rule for the neutral-frame rule; everything else stands. Every pass but
  // the neutral one prefers life (Task 3, 2026-09-24): the agencies show people and sectors at work.
  // Every pass, the neutral one too, wants a frame that reads at a glance; a piece that explains is pictured at work.
  const concept = CONCEPT_KINDS.has(draft.kind) ? `\n${CONCEPT_RULE}` : "";
  const rules = `${neutral ? placed.replace(PLACE_RULE, NEUTRAL_RULE) : `${placed}\n${LIVELY_RULE}`}\n${GLANCE_RULE}${concept}`;
  const user = `We are illustrating an Arabic economics article.
Headline: ${draft.title}
Summary: ${draft.subtitle ?? ""}
Editor's angle: ${story?.angle ?? ""}
Regions: ${(draft.regions ?? []).join(", ") || "unknown"}

Candidate photographs (numbered in the same order as the attached images):
${list.map((c, i) => `${i + 1}. "${c.title}" — ${c.description || "no description"} — categories: ${c.categories || "none"} — dated ${c.date || "unknown"} — search: ${c.query}`).join("\n")}

Choose the single best photograph for this article, or none. ${rules}
${CAPTION_RULE}${neutral ? " This is an illustrative photograph: its caption names no place at all and invents no setting in its stead." : ""}
Return JSON: {"choice": <1-${list.length} or 0 for none>, "alt": "<the Arabic caption of the chosen photograph, written by the rule above>", "reason": "<short English reason>"}`;

  try {
    const { data, model } = await chat({
      role: "vision",
      system: "You are a photo editor at an Arabic economics publication. Reply with one JSON object only.",
      user,
      images: inlined,
      temperature: 0.1,
      // Nex N2.5 Pro reasons before it answers and the reasoning counts against the cap: at 1500 it answered with nothing.
      maxTokens: 4000,
      timeoutMs: 120000,
      log,
      validate: (d) => {
        if (!d || !Number.isFinite(Number(d.choice))) throw new Error("choice missing");
      },
    });
    const index = Math.round(Number(data.choice)) - 1;
    if (index < 0 || index >= list.length) {
      log(`image: vision rejected all candidates${relaxed ? " (fallback pass)" : ""} (${data.reason ?? ""})`);
      return null;
    }
    const chosen = list[index];
    return {
      url: chosen.url,
      width: chosen.width,
      height: chosen.height,
      alt: await arabicCaption(data.alt ?? chosen.title, log, { file: chosen, story: draft.title }),
      credit: attributionLine(chosen),
      author: chosen.artist,
      license: chosen.license,
      licenseUrl: chosen.licenseUrl,
      pageUrl: chosen.pageUrl,
      title: chosen.title,
      model,
    };
  } catch (error) {
    log(`image: vision failed (${error.message.split("\n")[0]}); judging by metadata instead`);
    try {
      return await judgeByText({ list, draft, story, log, rules });
    } catch (fallbackError) {
      log(`image: metadata judge failed (${fallbackError.message.split("\n")[0]}); skipping photo`);
      return null;
    }
  }
}

/** Without a working vision model, a text model judges by title, description, categories and date. */
async function judgeByText({ list, draft, story, log, rules }) {
  const user = `We are illustrating an Arabic economics article. The images cannot be viewed; judge each candidate by its Wikimedia Commons metadata.
Headline: ${draft.title}
Summary: ${draft.subtitle ?? ""}
Editor's angle: ${story?.angle ?? ""}
Regions: ${(draft.regions ?? []).join(", ") || "unknown"}

Candidates:
${list.map((c, i) => `${i + 1}. "${c.title}" — ${c.description || "no description"} — categories: ${c.categories || "none"} — dated ${c.date || "unknown"} — ${c.width}×${c.height} px — found by searching: ${c.query}`).join("\n")}

Choose the single best photograph for this article, or none. ${rules} Prefer recent, plainly descriptive photographs of the place, institution or sector; reject anything whose title, description or categories suggest a map, diagram, chart, logo, document, screenshot, artwork, historical scene, or an unrelated subject.
${CAPTION_RULE}
Return JSON: {"choice": <1-${list.length} or 0 for none>, "alt": "<the Arabic caption of the chosen photograph, written by the rule above>", "reason": "<short English reason>"}`;
  const { data, model } = await chat({
    role: "critic",
    system: "You are a photo editor at an Arabic economics publication choosing from wire captions. Reply with one JSON object only.",
    user,
    temperature: 0.1,
    maxTokens: 1500,
    timeoutMs: 90000,
    log,
    validate: (d) => {
      if (!d || !Number.isFinite(Number(d.choice))) throw new Error("choice missing");
    },
  });
  const index = Math.round(Number(data.choice)) - 1;
  if (index < 0 || index >= list.length) {
    log(`image: metadata judge rejected all candidates (${data.reason ?? ""})`);
    return null;
  }
  const chosen = list[index];
  return {
    url: chosen.url,
    width: chosen.width,
    height: chosen.height,
    alt: await arabicCaption(data.alt ?? chosen.title, log, { file: chosen, story: draft.title }),
    credit: attributionLine(chosen),
    author: chosen.artist,
    license: chosen.license,
    licenseUrl: chosen.licenseUrl,
    pageUrl: chosen.pageUrl,
    title: chosen.title,
    model: `${model} (metadata)`,
  };
}

/** Asks a text model for the stock subjects a newspaper would use to illustrate this story, and for the
 *  words that name the story's one country (`place`), so photographs taken there are searched first. */
async function genericQueries({ draft, story, log }) {
  const { data } = await chat({
    role: "writer",
    system: "You are a photo editor at an Arabic economics news website choosing stock photographs from Wikimedia Commons. Reply with one JSON object only.",
    user: `Story headline: ${draft.title}
Summary: ${draft.subtitle ?? ""}
Lede: ${String(draft.lede ?? "").slice(0, 400)}
Angle: ${story?.angle ?? ""}
Regions: ${(draft.regions ?? []).join(", ") || "unknown"}
Tags: ${(draft.tags ?? []).join(", ")}

Give 4 English search phrases (2-4 words each, concrete nouns only) for generic photographs that this newspaper could run with the story, each a subject a reader recognises at a glance (never a part, a detail or a close-up of equipment). ${CONCEPT_KINDS.has(draft.kind) ? "This piece explains or analyses a concept rather than reporting one event: all four phrases picture the concept at work (traders on a trading floor for bonds, rates and markets; shoppers in a supermarket for prices and inflation; a container port for trade; a factory floor for industry), and none is a building or a skyline. " : ""}First the story's OWN sector at work, the way the news agencies picture it (a lithium battery production line, an LNG carrier ship, container ship loading, traders on a trading floor, a data-centre server hall, an oil pipeline in the desert, a wheat harvest, shoppers in a market)${CONCEPT_KINDS.has(draft.kind) ? "." : ", then the headquarters building of the institution named, as the last phrase only."} A story about the economy as a whole (growth, a forecast, inflation, a budget, trade figures) is pictured by economic life in its own place (a container port, a factory floor, shoppers in a market, a busy commercial street), never by one commodity it mentions in passing. The skyline or a landmark of the capital ONLY when the story is about a country's economy as a whole (inflation, growth, budget, currency, rates, rating); a story about one company, plant, project, product, deal, commodity or technology gets its sector's object, never a cityscape. Prefer subjects that certainly exist as photos on Wikimedia Commons (e.g. "lithium battery factory", "LNG carrier ship", "data center server racks", "Ras Tanura refinery", "container terminal cranes", "Central Bank of Egypt", "Riyadh skyline").
The photograph should be from the story's own place. When the story is about ONE country, the first two phrases name it with the object ("diesel pump United States", "gas station Texas", "LNG carrier Qatar", "wheat harvest Egypt"); the last two may leave it out. Also give "place": 2-6 English words a Wikimedia Commons title, description or category of a photo taken in that country would contain (the country's name and demonym, its main cities or states, e.g. ["United States", "USA", "American", "Texas", "California"]); [] when the story is about the world, a region or several countries.
Also give "people": the English full names, as Wikipedia writes them, of at most three people the story is about when it is about what named people did, said or agreed (heads of state or government, ministers, central bank governors, chief executives), for example ["Donald Trump", "Xi Jinping"] for a story about their summit. When the story reports what ONE institution decided, forecast or announced (a central bank, a ministry, the IMF, the OECD, OPEC, one company), give the person who leads it and speaks for it, for example ["Mathias Cormann"] for an OECD forecast or ["Amin H. Nasser"] for a Saudi Aramco result: the agencies illustrate such a story with that person at work, captioned as a file photo. [] when the story is about markets, prices, data or a sector as a whole.
Return JSON: {"queries": ["...", "...", "...", "..."], "place": ["..."], "people": ["..."]}`,
    // Models that think before answering spend their first tokens on reasoning; leave room for it.
    temperature: 0.2,
    maxTokens: 1500,
    timeoutMs: 60000,
    log,
    validate: (d) => {
      if (!Array.isArray(d?.queries) || !d.queries.length) throw new Error("queries missing");
    },
  });
  return {
    queries: data.queries.map((q) => String(q).trim()).filter((q) => q.length >= 3).slice(0, 4),
    place: (Array.isArray(data.place) ? data.place : []).map((w) => String(w).trim()).filter((w) => w.length >= 2).slice(0, 8),
    people: (Array.isArray(data.people) ? data.people : []).map((w) => String(w).trim()).filter((w) => /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(w)).slice(0, 3),
  };
}

/**
 * Finds a licensed editorial photo for the article, verified by a vision model: first the
 * writer's specific subjects, then, as a newspaper would, a generic illustration of the place,
 * institution or sector. Returns null when nothing suitable exists (the story runs as text).
 */
/**
 * The second lock. The chooser's answer is one model's opinion on four thumbnails; before a photo is
 * attached, a different model re-reads the story against the file's own name, description and
 * categories and must say RIGHT or GENERIC_OK. Wrong person, wrong country, wrong company, wrong
 * event → the photo is refused and the story runs as text. This is the audit rubric of 2026-09-22
 * (37 flagged of 125) made a gate, so it cannot be skipped.
 */
async function verifyImage({ image, draft, story, log, neutral = false, people = [] }) {
  // Where the file itself says it was taken is read in code first; a model is not trusted with it. The
  // last pass (`neutral`) looks for no place at all, so there the file's own record does not refuse it,
  // and neither does a photograph of the story's own people, taken wherever they last met.
  const abroad = neutral || people.length ? null : placedAbroad(image, draft);
  if (abroad) {
    log(`image: second check refused "${String(image.title ?? "").slice(0, 60)}": taken in ${abroad}, which the story does not name`);
    return false;
  }
  const user = `STORY (Arabic economics newspaper):
Headline: ${draft.title}
Standfirst: ${draft.subtitle ?? ""}
Lede: ${draft.lede ?? ""}
Editor's angle: ${story?.angle ?? ""}
Regions: ${(draft.regions ?? []).join(", ") || "unknown"}
Search that found the photo: ${image.query ?? ""}

PHOTOGRAPH proposed for it:
File name: ${image.title ?? ""}
Description: ${image.description || "(none)"}
Categories: ${image.categories || "(none)"}
Date: ${image.date || "(unknown)"}
Caption the paper would print: ${image.alt || "(none yet)"}

Judge as a strict picture editor of a paper read across the Arab world. ${neutral ? "The test is what readers will see: the frame and the caption" : "The test is what is in the frame, what the caption says, and where the photograph was taken; the file name, description and categories say where, even when readers never see them"}:
- WRONG_PERSON: an identifiable person (official, politician, executive) who is not one of the story's own people, whatever the setting.
- WRONG_SUBJECT: ${neutral ? "a caption that names a place; a frame the file describes with readable signs, lettering, a landmark, a flag, a skyline, a street or a famous building a reader would recognise" : "a different country or city than the story's when the frame, the caption, the writing in the frame, the file name, the description or the categories identify it"}; a different company or institution${neutral ? " whose name or logo a reader can see in the frame (one named only in the file's record does not count in this pass)" : ""}; a different sector, including a neighbouring one (electricity pylons on a gas story, a highway on a port story, a bank branch on a factory story); a military vessel or weapon for a non-military story; ${glanceFaults(draft.kind)}; a scene that merely lies NEAR the subject (a beach, a park, a street, a metro station, a hillside or a coastline beside a refinery, port or pipeline; a satellite view of a whole country); a landmark, flag, sign or building in the frame that identifies a country the story does not mention; a caption that names a place, company or person the story does not mention (a tanker depot captioned "at Eilat" is WRONG_SUBJECT on a Gulf oil story, however good a tanker depot it is); a city skyline, panorama or street scene on a story about ONE company, plant, project, product, deal, commodity or technology (a Cairo panorama on a battery-plant story, a San Francisco skyline on an AI-company story) — such a story needs its sector's own object. If your reason would contain "loosely", "broadly", "tangentially", "not specifically", "though it shows" or "reasonably", the verdict is WRONG_SUBJECT.
- STALE_EVENT: a specific past event (a summit, a ceremony, a visit) that the story is not about, unless the frame shows the story's own people${people.length ? ` (${people.join(", ")})` : ""}: a photograph of them at an earlier occasion, captioned with that occasion and its year or «(أرشيفية)», is how the desks illustrate a story about them, and it is RIGHT.
- GENERIC_OK: a neutral illustration whose frame shows the story's OWN institution or sector itself: the named company's or ministry's building, the sector's own object (a battery production line, a data-centre hall, an LNG tanker, a refinery, a pipeline, a pumpjack, a trading floor, a port crane, a factory line, a branch of the named bank). The named capital's skyline or central bank is acceptable ONLY for a story about the country's economy as a whole (inflation, growth, budget, currency, rates, sovereign rating, trade balance, jobs). An anonymous scene of the story's sector — a battery production line, a refinery, a tanker at sea, a container port, a trading floor, a server hall — is acceptable as a stock photograph is, under the rule below${neutral ? "." : ": for a story about one country, only when nothing (frame, writing, caption, file name, description, categories) places it in another country."}
- RIGHT: the story's own people (also at an earlier occasion, captioned as one), place or event.
${neutral ? NEUTRAL_CHECK : people.length ? "" : PLACE_RULE}
Return JSON: {"verdict":"RIGHT|GENERIC_OK|STALE_EVENT|WRONG_SUBJECT|WRONG_PERSON","reason":"<one short English sentence>"}`;
  const { data, model } = await chat({
    role: "critic",
    system: "You are a strict newspaper picture editor. Answer with one JSON object only.",
    user,
    temperature: 0,
    maxTokens: 300,
    timeoutMs: 90000,
    log,
    validate: (d) => {
      if (!d || typeof d.verdict !== "string") throw new Error("verdict missing");
    },
  });
  const verdict = String(data.verdict).toUpperCase();
  const ok = verdict === "RIGHT" || verdict === "GENERIC_OK";
  log(`image: second check (${model}) ${verdict}${ok ? "" : " — refused"} "${String(image.title ?? "").slice(0, 60)}": ${String(data.reason ?? "").slice(0, 120)}`);
  return ok;
}

/**
 * A file photograph of people says it is one, as the desks mark it: the occasion's year in its caption, or
 * «(أرشيفية)». Code makes sure of it, so a reader never takes a 2019 handshake for this week's summit: a
 * photo of named officials (or chosen for the story's people) taken more than three days ago, or on an
 * unknown date, whose caption carries neither a year nor the word, gets «(أرشيفية)».
 */
function markFilePhoto(image, chosen, people = []) {
  const alt = String(image.alt ?? "").trim();
  if (!people.length && !namedPeople(chosen).length) return image;
  if (/(?<!\d)(?:19|20)\d\d(?!\d)/.test(alt) || alt.includes("أرشيفية")) return image;
  const taken = Date.parse(String(chosen.date ?? "").slice(0, 10));
  if (Number.isFinite(taken) && Date.now() - taken < 3 * 86_400_000) return image;
  return { ...image, alt: `${alt.replace(/[\s.،]+$/, "")} (أرشيفية)` };
}

/** Chooser plus second lock; a refused photo is excluded and the story goes on without it. */
async function chooseVerified({ list, inlined, draft, story, log, relaxed, neutral = false, exclude, people = [] }) {
  let image = await judge({ list, inlined, draft, story, log, relaxed, neutral, people });
  if (!image) return null;
  const chosen = list.find((c) => c.url === image.url) ?? {};
  // The last pass's caption names no place, and the judge does not always keep to that (the Hormuz feature's
  // tanker came captioned with the Norwegian port it was photographed in and was refused for it, 2026-09-24):
  // the illustration's own caption writer writes it before the second check reads it.
  if (neutral) {
    const caption = await writeCaption({ file: chosen, story: draft.title, current: image.alt, illustrative: true, log });
    if (caption) image = { ...image, alt: caption };
  }
  let verified = false;
  try {
    verified = await verifyImage({ image: { ...chosen, title: chosen.title ?? image.title, query: chosen.query, alt: image.alt }, draft, story, log, neutral, people });
  } catch (error) {
    // No second opinion available: fail closed. A story without a photo is allowed; a wrong photo is not.
    log(`image: second check failed (${error.message.split("\n")[0]}); photo refused`);
    verified = false;
  }
  if (!verified) {
    // Excluded by URL and by file title: Commons serves one file under several URLs and widths.
    exclude.add(image.url);
    if (chosen.title) exclude.add(`title:${chosen.title}`);
    return null;
  }
  // The story's people are the subject wherever they were photographed: their photo is marked as a file
  // photo when it is one, never relabelled as an illustration.
  if (people.length) return markFilePhoto(image, chosen, people);
  return markFilePhoto(await asIllustrationIfElsewhere(image, chosen, draft, log), chosen);
}

/**
 * A photo taken outside the countries its story names runs as an illustration even where the location
 * check lets it through (a world-desk story): its caption names no place and carries «صورة تعبيرية»,
 * so a reader never meets «كوينانا بأستراليا» under a story about China's imports of Russian oil
 * (2026-09-23).
 */
export async function asIllustrationIfElsewhere(image, file, story, log = () => {}) {
  if (String(image.alt ?? "").includes(ILLUSTRATIVE)) return image;
  // A world-desk story keeps an honest place in its caption («رافعات حاويات في ميناء أنتويرب»), as the desks
  // caption agency pictures; a story about named countries never shows a caption from somewhere else.
  const elsewhere = placedAbroad(file, { title: story?.title ?? "", tags: story?.tags ?? [], regions: story?.regions ?? [] });
  if (!elsewhere) return image;
  const caption = await writeCaption({ file, story: story?.title ?? "", current: image.alt, illustrative: true, log });
  return { ...image, alt: caption ? `${caption} (${ILLUSTRATIVE})` : `(${ILLUSTRATIVE})` };
}

const excluded = (exclude, c) => exclude.has(c.url) || exclude.has(`title:${c.title}`);

/**
 * Two looks at a pass's candidates, four photographs at a time. A photo the second check refused is excluded
 * and its three companions come back with the next one; a shortlist the judge turned down whole is passed over,
 * so the second look shows the next four. It used to show the same four again: the bond explainer's judge
 * refused one set of forum photos twice in a row (2026-09-24).
 */
async function twoLooks({ candidates, draft, story, log, exclude, neutral = false, relaxed = true, people = [] }) {
  const passed = new Set();
  for (let look = 0; look < 2; look += 1) {
    const rest = candidates.filter((c) => !excluded(exclude, c) && !passed.has(c.url));
    if (!rest.length) return null;
    const s = await shortlist(rest, log);
    if (!s.list.length) return null;
    const refused = exclude.size;
    const image = await chooseVerified({ ...s, draft, story, log, relaxed, neutral, exclude, people });
    if (image) return image;
    if (exclude.size === refused) for (const c of s.list) passed.add(c.url);
  }
  return null;
}

/** Candidates whose own metadata places them in a country the story does not name never reach the judges. */
function atHome(candidates, draft, log) {
  return candidates.filter((c) => {
    const abroad = placedAbroad(c, draft);
    if (abroad) log(`image: dropped "${String(c.title).slice(0, 70)}" — taken in ${abroad}, which the story does not name`);
    return !abroad;
  });
}

export async function pickImage({ draft, story, log, fallback = true, exclude = new Set() }) {
  // The photographs other stories already run, before this story's passes add their refusals.
  const used = new Set(exclude);
  const specific = (draft.imageQueries?.length ? draft.imageQueries : []).slice(0, 3);
  if (specific.length) {
    const candidates = atHome(await collect(specific, log, { exclude, fresh: true }), draft, log);
    if (candidates.length) {
      const s = await shortlist(candidates, log);
      if (s.list.length) {
        const image = await chooseVerified({ ...s, draft, story, log, relaxed: false, exclude });
        if (image) return image;
      }
    } else {
      log("image: no candidates for the specific queries");
    }
  }
  if (!fallback) return null;

  let queries = [];
  let place = [];
  let people = [];
  try {
    ({ queries, place, people } = await genericQueries({ draft, story, log }));
  } catch (error) {
    log(`image: generic queries failed (${error.message.split("\n")[0]})`);
  }
  // The story's people before any building or scene (the owner, 2026-09-23: a Trump–Xi summit story ran
  // the White House's facade, "boring"; the desks run the two leaders from an earlier summit).
  if (people.length) {
    const image = await peoplePhoto({ people, draft, story, log, exclude });
    if (image) return image;
  }
  if (!queries.length) return null;
  log(`image: fallback queries: ${queries.join(" | ")}${place.length ? ` (home: ${place.join(", ")})` : ""}`);
  const candidates = atHome(await collect(queries, log, { perQuery: 12, max: 12, exclude, people: "none", place }), draft, log);
  if (!candidates.length) log("image: no candidates for the fallback queries");
  const image = await twoLooks({ candidates, draft, story, log, exclude });
  if (image) return image;
  const last = await lastResort({ draft, story, log, exclude });
  if (last) return last;
  // The last pass may take a photo the passes before it refused for where it was taken or for a caption naming
  // that place: that is what it is for (the bond explainer lost the Frankfurt exchange floor to its caption,
  // 2026-09-24). Its own checks judge every photo afresh; the photos other stories run stay out.
  const again = new Set(used);
  const scene = await neutralScene({ draft, story, log, exclude: again, queries, place });
  for (const x of again) exclude.add(x);
  return scene;
}

/**
 * A photograph of the story's people: together when there are two (the search names both, and a file that
 * names both ranks first), one person's when there is one. An earlier occasion is fine and is captioned as
 * one («… في أوساكا عام 2019» or «(أرشيفية)»); where it was taken does not matter, since the people are
 * the subject. Wrong people stay the gravest error, for both checks.
 */
async function peoplePhoto({ people, draft, story, log, exclude }) {
  // This year's photographs first: the year in the search finds files dated in their names or descriptions
  // («…-20260515.jpg»), and the ranking puts the newest of the fitting ones on the shortlist.
  const year = new Date().getUTCFullYear();
  const names = people.length >= 2 ? `${people[0]} ${people[1]}` : people[0];
  // Two people: together first, then each of them alone this year. A story quoting Albanese about an OpenAI
  // agent searched only "Albanese Altman", found no file naming both, and fell back to his 2022 portrait.
  const queries = people.length >= 2 ? [`${names} ${year}`, names, `${people[0]} and ${people[1]}`, ...people.slice(0, 2).map((p) => `${p} ${year}`)] : [`${names} ${year}`, names];
  log(`image: the story's people first: ${queries.join(" | ")}`);
  // A face from more than eight years ago is no longer the face the reader knows (Commons' newest photograph of
  // the New York Fed's John C. Williams was taken in 2008): such a file is dropped and the story falls back to a
  // scene of its sector.
  const oldest = year - 8;
  const candidates = (await collect(queries, log, { perQuery: 10, max: 20, exclude, people: "by-query", together: people })).filter((c) => {
    if (excluded(exclude, c)) return false;
    const taken = photoYear(c);
    if (taken && taken < oldest) {
      log(`image: dropped "${String(c.title).slice(0, 60)}" — a ${taken} photograph of a person, older than ${oldest}`);
      return false;
    }
    return true;
  });
  if (!candidates.length) {
    log("image: no photograph of the story's people");
    return null;
  }
  log(`image: people shortlist: ${candidates.slice(0, 4).map((c) => `${photoYear(c) ?? "?"} ${String(c.title).slice(0, 50)}`).join(" | ")}`);
  // Two looks: the first four 2026 photographs of Trump all showed him with someone else (Nicki Minaj, Mike
  // Johnson), the judge rightly refused them, and the story fell back to a data centre (2026-09-24).
  return twoLooks({ candidates, draft, story, log, exclude, relaxed: false, people });
}

/**
 * The last pass ("if possible", the owner, 2026-09-23): nothing from the story's own country passed, so
 * rather than leave the story bare, a neutral frame of its sector, wherever its file says it was taken,
 * captioned «صورة تعبيرية». Neutral is judged on what a reader can see (no writing, flag, landmark,
 * skyline or street), which is what would have kept the Finnish pump out: its lettering is in the frame.
 */
async function neutralScene({ draft, story, log, exclude, queries, place }) {
  // The subject alone, never its place or its company («oil tanker Persian Gulf» → «oil tanker»), and only a
  // subject of two words or more: stripping the place from «Yanbu port Saudi Arabia» left «port», which
  // fetched ferries at Piraeus and a marina in Mallorca (2026-09-24).
  const words = (place ?? []).map((w) => new RegExp(`(?<![A-Za-z])${escapeRe(w)}(?![A-Za-z])`, "gi"));
  const neutral = [...new Set(queries.map((q) => subjectWords(words.reduce((s, re) => s.replace(re, " "), q)).join(" ")).filter((q) => q.split(" ").length >= 2))];
  if (!neutral.length) return null;
  log(`image: last pass, a neutral illustration: ${neutral.join(" | ")}`);
  const candidates = await collect(neutral, log, { perQuery: 12, max: 12, exclude, people: "none" });
  const image = await twoLooks({ candidates, draft, story, log, exclude, neutral: true });
  if (!image) return null;
  const alt = String(image.alt ?? "").replace(/[\s.،]+$/, "");
  return { ...image, alt: alt.includes(ILLUSTRATIVE) ? alt : `${alt} (${ILLUSTRATIVE})` };
}

/**
 * Last resort: the skyline of the story's own capital, which the second check accepts by rule. A story
 * about the world market, a region or several countries has no one capital and runs as text.
 */
async function lastResort({ draft, story, log, exclude }) {
  let queries = [];
  try {
    const { data } = await chat({
      role: "writer",
      system: "You name places for a newspaper photo desk. Reply with one JSON object only.",
      user: `Story headline: ${draft.title}
Summary: ${draft.subtitle ?? ""}
Regions: ${(draft.regions ?? []).join(", ") || "unknown"}
Tags: ${(draft.tags ?? []).join(", ")}

Give four things in English. "scene": the concrete object of this story's own sector as a 2-4 word photo search (for example "lithium battery factory", "LNG carrier ship", "data center server racks", "oil pipeline desert", "container terminal cranes"); null only if the story has no sector. "country": the ONE country the story is about (for example "United States", "Saudi Arabia", "Egypt"); null for the world, a region or several countries. "institution": the world body, central bank, ministry or company at the centre of the story if it has a known headquarters (for example "World Trade Organization", "European Central Bank", "Saudi Aramco"); null otherwise. "city": the capital or main financial city of the ONE country the story is about (for example "Riyadh", "Cairo", "Frankfurt") ONLY if the story is about that country's economy as a whole (inflation, growth, budget, currency, rates, rating); null for a story about one company, plant, project, product, deal, commodity or technology, and null for the world or several countries.
Return JSON: {"scene": "<search or null>", "country": "<name or null>", "institution": "<name or null>", "city": "<name or null>"}`,
      temperature: 0,
      maxTokens: 1000,
      timeoutMs: 60000,
      log,
    });
    const clean = (v) => (typeof v === "string" && v.trim().length > 1 && v.trim().toLowerCase() !== "null" ? v.trim() : null);
    const scene = clean(data?.scene);
    const country = clean(data?.country);
    const institution = clean(data?.institution);
    const city = clean(data?.city);
    // The story's own country first: a scene from there before the same scene from anywhere.
    if (scene && country) queries.push(`${scene} ${country}`);
    if (scene) queries.push(scene, `${scene} industrial`);
    if (institution) queries.push(`${institution} headquarters`, `${institution} building`);
    if (city) queries.push(`${city} skyline`, `${city} city panorama`);
  } catch (error) {
    log(`image: last resort failed (${error.message.split("\n")[0]})`);
    return null;
  }
  if (!queries.length) {
    log("image: no single country or institution to fall back on; the story runs as text");
    return null;
  }
  log(`image: last resort: ${queries.join(" | ")}`);
  const candidates = atHome(await collect(queries, log, { perQuery: 12, max: 12, exclude, people: "none" }), draft, log);
  return twoLooks({ candidates, draft, story, log, exclude });
}
