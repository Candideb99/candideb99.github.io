import { chat } from "./llm.mjs";
import { hoursSince, truncate } from "./util.mjs";
import { DESK_NAMES, WORLD_AREAS, canonicalRegions, groundedRegions, worldAreasNamed } from "./regions.mjs";
import { reportingOrigin } from "./outlets.mjs";

const EDITOR_SYSTEM = `You are the managing editor of خازندار (Khazendar), an Arabic-language economics and business publication read across the Gulf, Egypt, the Levant, North Africa and the diaspora.
You decide which stories the newsroom will write in the next hours. You are rigorous, allergic to fluff, and you think about what an educated Arab reader needs to understand the economy today.
You always answer with a single JSON object and nothing else.`;

/** Hub sections hold the paper's own analyses and explainers; news is never filed into them (mirrors src/lib/sections.ts). */
export const HUB_SECTIONS = new Set(["analysis", "explainers"]);

/** The sections news can be filed into. */
export const newsSectionsOf = (sections) => sections.filter((s) => !HUB_SECTIONS.has(s.id));

/**
 * The weights of the news file (the owner, 2026-11-21: "organize weights when it comes to news publishing so we can
 * cover everything, but yet the most important stuff (for the arabic reader)"). The editor's brief ranks a story by
 * where its event happens (THE WEIGHTS below); code holds the floor. A run's editor returned its best six stories and
 * the rest of the world competed on size alone, so in the 28 days to that day the Maghreb's desk had 4 of 291 news
 * stories (15 days at a stretch with none), sub-Saharan Africa and Central Asia one each, though Africa's fifteen feeds
 * answered fresh in every run. Now the editor is told which Arab desks have had nothing for ROTATION_DAYS.desk days and
 * which parts of the world (WORLD_AREAS) for ROTATION_DAYS.area, adds a worthy story from each beyond its limit
 * (`rotation`), and `rotationSwap()` lets one of them break a tie with the weakest story of the run that is on no Arab
 * desk and from a part of the world already served: never in place of an Arab story or a stronger tie (TIE_RANK).
 */
export const ARAB_DESKS = ["الخليج", "مصر", "المشرق وإيران وتركيا", "المغرب العربي"];
export const ROTATION_DAYS = { desk: 3, area: 7 };
/** News stories in seven days that make a part of the world served, so its weakest story may give way. */
export const SERVED_STORIES = 3;
const DAY_MS = 86_400_000;

/**
 * The Arab desks and the parts of the world that have had no news story lately, the longest quiet first:
 * { desks: [{ name, days }], areas: [{ name, days }], served: Set of the parts with SERVED_STORIES or more in seven days }.
 * `days` is Infinity for a place with none on record. A desk is read from a story's regions, a part of the world from
 * the countries its headline names.
 */
export function quietPlaces(published, now = Date.now()) {
  const news = (published ?? []).filter((a) => (a.kind ?? "news") === "news" && Number.isFinite(Date.parse(a.publishedAt)));
  const age = (a) => (now - Date.parse(a.publishedAt)) / DAY_MS;
  const since = (list) => list.reduce((min, a) => Math.min(min, age(a)), Infinity);
  const desks = ARAB_DESKS.map((name) => ({ name, days: since(news.filter((a) => canonicalRegions(a.regions, { cap: Infinity }).includes(name))) }))
    .filter((d) => d.days >= ROTATION_DAYS.desk);
  const named = news.map((a) => ({ a, areas: worldAreasNamed(a.title) }));
  const areas = WORLD_AREAS.filter((area) => area.rotates)
    .map((area) => ({ name: area.name, days: since(named.filter((n) => n.areas.has(area.name)).map((n) => n.a)) }))
    .filter((area) => area.days >= ROTATION_DAYS.area);
  const served = new Set(WORLD_AREAS.map((area) => area.name).filter((name) => named.filter((n) => n.areas.has(name) && age(n.a) < 7).length >= SERVED_STORIES));
  const longest = (x, y) => y.days - x.days;
  return { desks: desks.sort(longest), areas: areas.sort(longest), served };
}

/**
 * How near a story's event is to the Arab reader (the editor's `tie`, THE WEIGHTS): its event in an Arab country,
 * a direct effect on Arab economies the items report, a force that moves every market, or its size alone. The big Arab
 * economy desks run the far world on these terms: over 48 hours of 2026-11-21 Asharq Business, Asharq Al-Awsat, Al
 * Jazeera, Sky News Arabia, Independent Arabia, Al Eqtisadiah and Al Bayan ran 265 items, and the few from the far
 * world were Saudi oil stored in Japan, DP World in Colombia and Peru, Indian refiners chasing tankers, Ethiopia's dams
 * beside Egypt and Sudan, or a market rout (Tokyo, Taipei); none rotated by region. A missing tie counts as global
 * when a story might give way and as none when it might come in, so a story is never pushed out on a guess.
 */
export const TIE_RANK = { arab: 3, direct: 2, global: 1, none: 0 };
const tieRank = (s, fallback) => TIE_RANK[s?.tie] ?? fallback;

/**
 * One rotation a run at most, as a tie-breaker and never a quota (the owner, 2026-11-21, after the first version: "i am
 * afraid that this being quiet region rule would be not so ideal. for example morocco makes a lot of deals with the
 * european union, and ukraine has news regarding grain shipments etc which could be dropped"). Replayed over the 27
 * news runs of 8-21 November, that version could have pushed out a chosen story in 26, judged on importance alone: the
 * day's gold forecast, the Fed's financial-stability survey, Lufthansa's cuts; and it read a Saudi or Egyptian
 * company's story whose headline names no place («سبكيم», «معادن», «الشرقية للدخان») as no Arab story.
 * Now: the editor's story from the quiet place that has waited longest (Arab desks first), one point under the
 * threshold being enough, is added when the run has room; otherwise it takes the place of the weakest chosen story
 * that is on no Arab desk by the editor's regions or its tie, and, for a part of the world, names only parts already
 * served (or none), when the newcomer's tie to the Arab reader is stronger and it is at most a point weaker, or its tie
 * is the same and it is no weaker. A tie never loses to a weaker one: Ukraine's grain bound for Egypt (direct) stays
 * whatever a quiet Indonesian story (none) offers. The newcomer's place is checked in code: a desk by the regions its
 * headline grounds, a part of the world by the countries its headline names. Returns { pick, drop, place } or null.
 */
export function rotationSwap({ chosen, stories, quiet, runLimit, minImportance, keep = new Set() }) {
  if (!quiet || (!quiet.desks.length && !quiet.areas.length)) return null;
  const desksOf = (s) => groundedRegions(s.regions ?? [], { title: s.headlineHint ?? "" });
  // Protecting a story trusts the editor's desk and tie; adding one needs its place grounded.
  const arab = (s) => s.tie === "arab" || canonicalRegions(s.regions ?? [], { cap: Infinity }).some((r) => ARAB_DESKS.includes(r));
  const order = [...quiet.desks.map((d) => ({ ...d, kind: "desk" })), ...quiet.areas.map((a) => ({ ...a, kind: "area" }))];
  const placeOf = (s) => {
    const desks = desksOf(s);
    const areas = worldAreasNamed(s.headlineHint ?? "");
    return order.findIndex((p) => (p.kind === "desk" ? desks.includes(p.name) : areas.has(p.name)));
  };
  const options = stories
    .filter((s) => !chosen.includes(s) && s.importance >= minImportance - 1)
    .map((s) => ({ s, rank: placeOf(s) }))
    .filter((o) => o.rank >= 0)
    .sort((x, y) => x.rank - y.rank || y.s.importance - x.s.importance);
  if (!options.length) return null;
  if (chosen.length < runLimit) return { pick: options[0].s, drop: null, place: order[options[0].rank] };
  const served = (s) => [...worldAreasNamed(s.headlineHint ?? "")].every((name) => quiet.served.has(name));
  // Each quiet place's story in turn, the longest wait first, until one can break a tie: on the evening's pool the
  // first, Indonesia's wage rises (no tie, 5), could displace nothing, and XRG's Argentine LNG project (an Arab
  // company's, 6) behind it was never tried (the live check of 2026-11-21).
  for (const { s: pick, rank } of options) {
    const place = order[rank];
    const incoming = place.kind === "desk" ? TIE_RANK.arab : tieRank(pick, TIE_RANK.none);
    const yields = (s) => {
      const own = tieRank(s, TIE_RANK.global);
      return incoming > own ? s.importance <= pick.importance + 1 : incoming === own && s.importance <= pick.importance;
    };
    const drop = chosen
      // `keep`: a story the section balance brought in for a section with nothing in three days (run.mjs) stays.
      .filter((s) => !keep.has(s) && !arab(s) && (place.kind === "desk" || served(s)) && yields(s))
      .sort((x, y) => tieRank(x, TIE_RANK.global) - tieRank(y, TIE_RANK.global) || x.importance - y.importance)[0];
    if (drop) return { pick, drop, place };
  }
  return null;
}

/**
 * The business of sport (the owner, 2026-11-22, after a friend advised a sports section: no section, "cover the business
 * of sport inside the existing sections"). The editor marks such a story `sport`, and code holds how much of the file it
 * may take, since a run writes about three stories: one a run, SPORT_LIMITS.day in 24 hours. A story past the limit
 * gives its place to the editor's next story that is not about sport and clears the bar; it is not marked, so a later
 * run may take it. Returns { chosen, dropped }.
 */
export const SPORT_LIMITS = { run: 1, day: 2 };

/**
 * `sections`: the sections a run was asked for (`--sections=`); the story that takes a sport story's place comes from
 * them too. Without it a companies-only run replaced its sport story with an energy story (a review of 2026-11-22).
 */
export function sportCap({ chosen, stories, runLimit, minImportance, today = 0, sections = [] }) {
  const room = Math.max(0, Math.min(SPORT_LIMITS.run, SPORT_LIMITS.day - today));
  const dropped = chosen.filter((s) => s.sport).sort((a, b) => b.importance - a.importance).slice(room);
  if (!dropped.length) return { chosen, dropped };
  const kept = chosen.filter((s) => !dropped.includes(s));
  const next = stories.filter((s) => !s.sport && !s.rotation && !chosen.includes(s) && s.importance >= minImportance && (!sections.length || sections.includes(s.section)));
  return { chosen: [...kept, ...next.slice(0, Math.max(0, runLimit - kept.length))], dropped };
}

/**
 * The order a run writes its stories in (2026-11-22). A run stops taking stories after its budget of minutes, so the
 * last ones wait, and in the rounds of 15-21 November most that waited were never chosen again. By importance, the
 * editor's order among equals; but a story a balance brought in (`first`: a section with nothing in three days, the
 * Arab world's story of the run) was pushed onto the end and would be the first to go, undoing the balance: those are
 * written right after the lead. A rotation story is a tie-breaker and keeps its own rank.
 */
export function writeOrder(chosen, first = new Set()) {
  const [lead, ...rest] = [...chosen].sort((a, b) => b.importance - a.importance);
  return lead ? [lead, ...rest.filter((s) => first.has(s)), ...rest.filter((s) => !first.has(s))] : [];
}

/**
 * The editor's reading list within a size it can read (2026-11-22, the owner: "the news room could be overwhelmed").
 * The list grew with every batch of feeds: 600 candidates in October, 1,173 on 21 November, when it was 164,000 tokens
 * of one call. A candidate's line is its headline (140 characters) and its feed summary (220), so a day of long
 * summaries could run half as long again with nothing to stop it. Measured that day: 1,045 items made 288,000
 * characters (about two characters a token), a full list at the day's mean 323,000, at the longest lines 497,000. The
 * model itself would still read that: asked the same day with a list far too long, the Claude CLI answered «Prompt is
 * too long … (limit 1000000)», a million tokens, four times the longest list. So this bounds what a round's first call
 * costs and how long it takes, not whether it runs. Past CANDIDATE_CHARS, above an ordinary full list, the summaries
 * are shortened for every candidate alike, then left out; no candidate is dropped and no headline cut.
 */
export const CANDIDATE_CHARS = 360_000;

export function candidateLines(candidates, budget = CANDIDATE_CHARS) {
  for (const room of [220, 150, 90, 40]) {
    const lines = candidates.map((c) => formatCandidate(c, room));
    if (lines.reduce((n, l) => n + l.length + 1, 0) <= budget) return lines;
  }
  return candidates.map((c) => formatCandidate(c, 0));
}

/**
 * Whether the editor's working headline frames a roundup and not one event. Until 2026-11-22 «بين … و» and
 * «من … إلى …» counted wherever they stood, so a range, a period and two parties were roundups: of the 601 published
 * news headlines the «بين» arm matched 7, every one a single event («يبقي الفائدة بين 3.75% و4%», «بين يوليو
 * وسبتمبر», «بين 2027 و2031», «انفراجة … بين واشنطن وطهران»), and none a roundup. A roundup's «بين» stands right after
 * a market or a week as its subject («الأسواق بين قرار الفيدرالي وبيانات التضخم»), with no figure on either side.
 */
const ROUNDUP = [
  /أسبوع (?:حافل|حاسم|المصارف|البنوك|المركزيات|التقارير)|المركزيات|تترقب/,
  // Never «بين الأكثر تداولاً» (among the most…), and the «و» is the conjunction, not a word's own first letter
  // («وسط»، «وزير»، «واشنطن»): «أسهم أرامكو بين الأكثر تداولاً وسط ارتفاع النفط» is one event.
  /^(?:ال)?(?:أسواق|أسهم|بورصات|نفط|ذهب|دولار|مستثمرون|متعاملون|أسبوع|وول ستريت)(?: \S+)? بين (?!(?:ال)?(?:أكثر|أعلى|أكبر|أفضل|أسوأ|أقل|أبرز|أهم|أدنى)(?![\u0600-\u06ff]))[^\d]{3,40} و(?!\d|سط(?![\u0600-\u06ff])|فق(?![\u0600-\u06ff])|زير|زار|اشنطن|كال|ول ستريت|قود|ثيق|ظائف|ارد|اقع|تير)/,
  /^من [^\d]{3,30} إلى [^\d]{3,30}(?:،| و)/,
];
export const roundupFrame = (headline) => ROUNDUP.some((re) => re.test(String(headline ?? "").trim()));

const daysLabel = (days) => (Number.isFinite(days) ? `${Math.floor(days)} days` : "none on record");

function formatCandidate(c, summaryChars = 220) {
  const age = Number.isFinite(hoursSince(c.publishedAt)) ? `${Math.round(hoursSince(c.publishedAt))}h` : "?";
  const tier = c.reliability === 3 ? "A" : c.reliability === 2 ? "B" : "C";
  // An outlet running another's reporting is named with it, so a cluster of the two is seen as one outlet.
  const origin = reportingOrigin(c);
  const outlet = origin && origin !== c.sourceNameEn ? `${c.sourceNameEn}, ${origin}'s reporting` : c.sourceNameEn;
  return `[${c.id}] (${outlet}; tier ${tier}; ${c.kind}; ${c.lang}; ${age} ago) ${truncate(c.title, 140)}${c.summary && summaryChars ? ` — ${truncate(c.summary, summaryChars)}` : ""}`;
}

/**
 * Asks the editor model to cluster candidates into stories and pick the best ones.
 * `coverage24h` maps section id → stories published there in the last 24 hours (for the balance rule).
 * `recent` gives the published stories with their dates, so the list says how long ago each ran; `follows` is the
 * published headline a chosen story continues (the desk notes then say what happened since, lib/editorial.mjs).
 * `quiet` (quietPlaces()) names the Arab desks and parts of the world with no story lately; the editor may add a story
 * from each beyond the limit, marked `rotation`, and rotationSwap() decides in code which of them runs.
 * Returns an array of { ids, section, importance, angle, headlineHint, regions, follows, rotation, tie, sport }.
 */
export async function selectStories({ candidates, recentTitles, recent = null, sections, coverage24h = {}, quiet = null, limit, log, chatWith = chat }) {
  // The quiet places (quietPlaces()) the editor may add a story from, beyond its limit; a `rotation` naming any other is dropped.
  const quietNames = new Set([...(quiet?.desks ?? []), ...(quiet?.areas ?? [])].map((p) => p.name));
  const quietLine = quietNames.size
    ? `\nPLACES WITH NO STORY LATELY (for the ROTATION rule): ${[
        quiet.desks.length ? `Arab desks with no story in ${ROTATION_DAYS.desk} days: ${quiet.desks.map((d) => `${d.name} (${daysLabel(d.days)})`).join("، ")}` : "",
        quiet.areas.length ? `parts of the world with no story in ${ROTATION_DAYS.area} days: ${quiet.areas.map((a) => `${a.name} (${daysLabel(a.days)})`).join("، ")}` : "",
      ].filter(Boolean).join("; ")}\n`
    : "";
  // Each published story with its age: a follow-up is judged against a story of yesterday, not one of four days ago.
  const publishedLines = (recent ?? recentTitles.map((title) => ({ title }))).map((a) => {
    const h = Math.round(hoursSince(a.publishedAt));
    return `- ${Number.isFinite(h) ? `(${h < 48 ? `${h}h` : `${Math.round(h / 24)}d`} ago) ` : ""}${a.title}`;
  });
  const sameHeadline = (t) => String(t ?? "").replace(/[«»"'\s]+/g, " ").trim();
  const samePublished = (value) => recentTitles.find((t) => sameHeadline(t) && sameHeadline(t) === sameHeadline(value)) ?? "";
  const newsSections = newsSectionsOf(sections);
  const sectionIds = newsSections.map((s) => `${s.id} (${s.name})`).join(", ");
  // The filing guide per section: what belongs, and the cases that keep going wrong (2026-09-22: an
  // air-traffic-control outage that grounded flights was filed under energy). Lives in sections.json
  // beside the public description, so the guide and the paper's sections cannot drift apart.
  const sectionGuide = newsSections.map((s) => `- ${s.id} (${s.name}): ${s.description}${s.guide ? ` ${s.guide}` : ""}`).join("\n");
  const coverageLine = newsSections.map((s) => `${s.id} ${coverage24h[s.id] ?? 0}`).join(", ");
  const quietSections = newsSections.filter((s) => !(coverage24h[s.id] > 0)).map((s) => s.id);
  const idSet = new Set(candidates.map((c) => c.id));
  const user = `Today is ${new Date().toISOString().slice(0, 10)} (UTC).

CANDIDATE ITEMS from the last hours (one per line; tier A = official institution or top-tier outlet):
${candidateLines(candidates).join("\n")}

STORIES ALREADY PUBLISHED RECENTLY (do not select stories that merely repeat these; a genuinely new development is fine):
${publishedLines.length ? publishedLines.join("\n") : "- (none)"}

STORIES PUBLISHED PER SECTION IN THE LAST 24 HOURS: ${coverageLine}${quietSections.length ? ` (no story yet in: ${quietSections.join(", ")})` : ""}${quietLine ? `\n${quietLine.trim()}` : ""}
TASK
1. Group candidate items that report the same underlying story into one cluster (items from different outlets about the same event belong together). A story is ONE event: one decision, one data release, one deal, one market move. Never merge different events into a cluster because they happened the same day or touch the same theme; a US confidence survey and a British rate outlook are two stories, not one, and a roundup is not a story. If two events are related, pick the more important and mention the other only if the writer needs it as context. A story cites at most FIVE candidate items (the outlets reporting that one event); a list of more than five ids means events have been merged, and the desk cuts it to the first five. "A week of central bank decisions", "markets await…", "X and Y" framings are roundups, not events: the story is the decision, the release, the deal or the move itself.
2. Choose up to ${limit} stories: every event that clears the bar below, and fewer only when fewer clear it. A news site is edited, not filled, but a worthy story left unwritten is a gap in the file. Score each candidate on the news values an Arabic desk edits by (قيم الخبر): التأثير (does it change money, prices, jobs or policy for our readers?), الأهمية (a central bank, a government, a market, a major company), الآنية (it happened or was decided now; a figure already reported is news again only if the change is material), القرب (the Gulf, Egypt, the Levant, the Maghreb, or the global forces that move them: oil, the dollar, the Fed, the ECB, China, the other large economies, trade, technology), الضخامة (the size of the number), الصراع والنتائج (winners, losers, what follows). A story must carry at least three of these to be selected; importance below 6 is not published. State the values it carries in "news_value".
   Development over repetition: when a candidate advances a story Khazendar already ran (a running file), prefer the development to an unrelated marginal item; when it only repeats, skip it. A development is something that HAPPENED after that story was published: a new decision, figure, deal or incident, a price that moved, a named party's response that changes something for an economy. The same event in another outlet's words or with another count, more detail of it, or a position that already stood restated (a closure, a ban, a demand, a threat) is a repeat, however fresh the item. For a story that continues a published one, copy that published headline exactly into "follows", say in the angle what happened since, and lead the headline_hint with that alone: the working headline never tells the published event again, and never joins it to the day's other news with «و» or «مع».
   Defence economics is part of our beat: defence budgets, procurement and contract awards (an official award with a stated value is news, not fluff), arms exports and imports, the defence industry and its suppliers, and what each of these means for Arab economies (Gulf procurement, offsets, local industry, public budgets). File a contractor's award, an arms deal or the defence industry under companies, and a defence budget or a war's cost to a state under economy (the defence section was folded into them on 2026-10-19).
   POLITICS AND CONFLICT WHEN THEY MOVE MONEY (the owner, 2026-10-22: Khazendar stays an economics paper, but covers politics and conflict when they move money, told from the economic angle; the Houthi attacks on Saudi airports and Aramco, and Libya's ratification of its maritime deal with Turkey, had gone untold). An attack, a war, a sanction, a treaty, a ratification, a boundary or a government's political decision is selected when the items report that it changes something an economy runs on: oil and gas output, exports or facilities, shipping lanes and ports, airports and flights, drilling and exploration rights (a maritime boundary decides who may drill), sanctions and trade, investment and events that bring it, a state's budget or debt, a market's price. The angle and the headline_hint lead with that consequence, and the story is filed where the consequence lives: energy for oil, gas, facilities and drilling rights; economy for a state's budget, trade, sanctions, airports and security pacts; companies for one company's assets, staff or contracts; markets for a price. Not selected: battlefield news, diplomacy, elections, protests, statements and condemnations that the items tie to no economic consequence.
   THE BUSINESS OF SPORT, AS BUSINESS (the owner, 2026-11-22: Khazendar has no sports section and covers the business of sport inside its own sections). Sport is selected when the event is money, by the same bar as any other story: a club, a team or a league bought, sold, listed, financed or valued; a broadcasting, sponsorship or kit deal with a stated value; a club's or a league's revenue, losses, debt or financial rules; a state's or a sovereign fund's investment in sport, and what hosting a tournament costs or earns (stadiums, tourism, the budget); a sports company's own news. Its tie to the Arab reader is weighed as for any story (THE WEIGHTS): Gulf funds and owners, the Saudi, Qatari and Egyptian leagues, a tournament an Arab country hosts or bids for. The angle and the headline_hint lead with the money, and it is filed as business: companies for a club, a league, a broadcaster, a sponsor or a sportswear maker; economy for a host state's bill, tourism and public spending; markets for a listed club's shares. Not selected: results, fixtures, draws, awards, injuries, coaches and line-ups, one player's transfer or contract (a transfer is news here only as a record fee or as a league's or a window's total spending), and a quarrel of sporting bodies with no sum at stake. Score such a story on the news values like any other, and mark it "sport": true: code holds sport to one story a run, so the mark costs the other stories nothing.
   OUR READERS' OWN ECONOMIES FIRST, as on every Arab economics desk. A Saudi, Emirati, Qatari, Kuwaiti, Omani, Bahraini, Egyptian, Moroccan, Jordanian or Iraqi decision, data release, budget, central-bank move, company result, listing, deal or project of real weight is selected ahead of a comparable foreign story, and about three of a day's stories in five should be about the Arab world when the candidates allow (THE WEIGHTS below). The Gulf and Egyptian outlets in the list (الخليج، جريدة الرياض، اليوم السابع، مصراوي، هسبريس، AGBI، Gulf Times، Saudi Gazette، Daily News Egypt، Arabian Business, alongside الشرق الأوسط، الجزيرة، سكاي نيوز عربية، البورصة) report such events; two of them reporting one event make a cluster like any other. Give such a story its own desk as its region: الخليج، مصر، المغرب العربي, or المشرق وإيران وتركيا for Jordan and Iraq.
   THE WORLD'S LARGE ECONOMIES, NOT ONLY AMERICA AND CHINA (the owner, 2026-11-09: in four weeks Germany's own economy led one story, Japan two, India one, Latin America three and sub-Saharan Africa none, while American companies led seventeen). Our readers' economies trade with all of them: Japan, India and Korea buy the Gulf's oil and gas, Europe and Brazil sell it machines and food, India's workers send their pay home from it. So a large economy's central-bank decision (the Bank of Japan, the Reserve Bank of India, the Bank of England, the central banks of Brazil, Mexico, Korea or Indonesia) and its headline figures (growth, inflation, trade, jobs, the budget) for Germany, Japan, India, Britain, France, Italy, Korea, Brazil, Mexico, Indonesia, Nigeria or South Africa carry التأثير and القرب as surely as the Fed's do. Among the stories that are not about the Arab world, such a decision or figure ranks ahead of a second story within days on the same company, and when the stories published recently hold none from these economies, take a worthy one. An official institution's own release (tier A, kind official) may carry it alone, as for any central bank.
   THE WEIGHTS: THE WHOLE WORLD, OUR READERS' ECONOMIES FIRST (the owner, 2026-11-21: cover everything, and first what matters most to the Arab reader). Weigh a story by where its event happens, in this order: (1) the Arab world's own economies, every Arab country and not the Gulf alone (Egypt, Iraq and the Levant, Yemen, the Maghreb, Sudan, Somalia and Mauritania too), about three stories in five; (2) the forces that move them: oil and gas, the dollar and the Fed, China, Iran and Turkey, the euro area; (3) the world's large economies, as the rule above says; (4) the rest of the world, whose القرب is its tie to the Arab economies: Gulf or Egyptian money invested there, what Arab states buy from it or sell to it (grain, fertiliser, gas, oil, phosphate), the Nile and the Red Sea, Arab workers there and the money they send home, the shipping lanes, a market where it competes with Arab exports; failing such a tie, its size. A story lower in this order never displaces a comparable one higher up. This is how the big Arab economy desks run the far world: through its tie to their readers (an Arab state's oil stored in Japan, an Arab port operator in Latin America, Ethiopia's dams beside Egypt and Sudan, Ukraine's grain bound for Egypt, a European deal with Morocco) or when it moves every market, never by turns.
   Give every story its "tie": "arab" when the event happens in an Arab country or an Arab state, fund or company is its actor; "direct" when it happens elsewhere and the items report its effect on Arab economies (their trade, food, energy or fertiliser, money invested, workers and remittances, the Nile, the Red Sea and Suez, a market where Arab exports compete); "global" when it moves every market (a major central bank, oil, gas or gold, the dollar, China's economy, a world market rout); "none" when only its own size carries it. Never a tie the items do not report.
   ROTATION: when a list of PLACES WITH NO STORY LATELY is given above, then for each place on it whose items report an event that clears the bar (importance 5 or more is enough here; two outlets, or one official institution), add that place's best story to your answer BEYOND the limit, with "rotation" set to the place's name exactly as the list writes it. At most four such stories, each one event of that place. Every other story has an empty "rotation". Code runs at most one of them, and only as a tie-breaker: in place of a story whose tie is weaker, or the same and no stronger in news value.
3. Skip: opinion columns, listicles, personal finance tips, celebrity and lifestyle, sports news that is not business (THE BUSINESS OF SPORT above), product reviews, minor local items, press-release fluff, protocol news (a minister receives a delegation, a memorandum that commits nothing, a ribbon-cutting; a treaty or a ratification that grants rights or moves money is news without figures), the day's price tables (gold, currency or share prices), stock-picking, crypto hype, and anything already covered.
   A MARKET MOVE IS A STORY ONLY WHEN IT IS NEWS (the owner, 2026-10-19, after the Financial Times ran no story on a morning when we ran WTI down 0.82%): a record or a high or low of several months, a large move (about 2% or more for oil or a stock index, about 1% for gold or a major currency, about 10 basis points for a government bond yield), or a move whose cause is itself news (a decision, an attack, a data release, a supply disruption), told as that cause's story. An ordinary day's move is on the market board every page carries: skip it, and give the slot to an Arab economy's own news. One story per instrument within eight hours: a later move of the same instrument is news only when it sets a new record or reverses.
4. Prefer official statistics and central-bank decisions when they are new. Prefer clusters with at least one tier A source. Every story becomes a developed report of 350-650 words (the news, its driver, the figures in perspective, the reactions, the background, what comes next), written only from the items you cite: cite EVERY candidate that reports the same event, up to five, and skip an event that no outlet reports beyond a sentence or two, however important its headline. A story reported by ONE outlet only is not selected unless that outlet is an official institution (tier A, kind official): with a single non-official source the desk cannot cross-check a figure, and the article would be a translation of one report rather than the paper's own account.
5. Balance, applied mildly: when a worthy candidate exists in a section that has had no story in the last 24 hours, prefer it over a marginal extra story in an already-covered section. Never promote a weak item just to fill a section.
6. Assign each story to exactly one section from: ${sectionIds}. File it where a reader would look for it, by the SUBJECT of the story, not by a word in it; a story that touches two sections goes to the one whose readers it changes most. The filing guide, with the cases that are often confused:
${sectionGuide}
7. The angle and headline_hint must state only what the candidate items themselves report; a neutral factual working title, no dramatisation, no ".." ellipses, no inferred events.

Return JSON:
{"stories":[{"ids":["<candidate id>", "..."],"section":"<section id>","importance":<1-10>,"news_value":"<the values it carries, e.g. تأثير، آنية، قرب>","angle":"<one Arabic sentence stating the story and the angle for Arab readers>","headline_hint":"<short Arabic working headline>","follows":"<the published headline this story continues, copied exactly from the list above, or an empty string>","regions":["<1-3 region names, only from: ${DESK_NAMES.join("، ")}>"],"tie":"<arab|direct|global|none>","sport":<true for a story about the business of sport, else false>${quietNames.size ? `,"rotation":"<a place's name from PLACES WITH NO STORY LATELY, or an empty string>"` : ""}}]}
Order stories by importance, highest first. Use only candidate ids that exist. Return at most ${limit + 2} stories${quietNames.size ? ", plus up to four rotation stories" : ""}.`;

  const { data, model } = await chatWith({
    role: "editor",
    system: EDITOR_SYSTEM,
    user,
    temperature: 0.2,
    maxTokens: 8000,
    // Three hundred candidates are a long read: the first call on 2026-09-24 ran past the default four minutes
    // and was thrown away, and the retry took a hundred seconds.
    timeoutMs: 420000,
    log,
    validate: (d) => {
      if (!d || !Array.isArray(d.stories)) throw new Error("stories[] missing");
      for (const s of d.stories) {
        if (!Array.isArray(s.ids) || !s.ids.length) throw new Error("story without ids");
        if (!s.section) throw new Error("story without section");
      }
    },
  });

  const normalizeId = (value) => {
    const text = String(value).trim().replace(/[[\]\s]/g, "");
    if (idSet.has(text)) return text;
    const digits = text.match(/\d+/)?.[0];
    return digits && idSet.has(`c${digits}`) ? `c${digits}` : null;
  };
  // Only news sections are recognised: an answer filed into a hub section (analysis, explainers) is dropped.
  const normalizeSection = (value) => {
    const text = String(value ?? "").trim().toLowerCase();
    const hit = newsSections.find((s) => text === s.id || text.startsWith(`${s.id} `) || text.startsWith(`${s.id}(`) || text.includes(s.name));
    return hit?.id ?? null;
  };
  if (data.stories.length) log(`editor raw: ${data.stories.length} stories; first ids=${JSON.stringify(data.stories[0].ids).slice(0, 80)} section=${data.stories[0].section}`);
  const stories = data.stories
    .map((s) => ({
      ids: [...new Set(s.ids.map(normalizeId).filter(Boolean))],
      section: normalizeSection(s.section),
      // 1 to 10, as the brief asks: a score outside it is no score (a «100» had led the run, 2026-11-22).
      importance: Number(s.importance) >= 0 && Number(s.importance) <= 10 ? Number(s.importance) : 0,
      angle: String(s.angle ?? "").trim(),
      headlineHint: String(s.headline_hint ?? "").trim(),
      newsValue: String(s.news_value ?? "").trim(),
      // Only a headline the paper published: anything else written there is dropped.
      follows: samePublished(s.follows),
      regions: Array.isArray(s.regions) ? s.regions.map(String).slice(0, 4) : [],
      // Only a place the list named: rotationSwap() checks the story's own place in code before any of it runs.
      rotation: quietNames.has(String(s.rotation ?? "").trim()) ? String(s.rotation).trim() : "",
      // The story's tie to the Arab reader (TIE_RANK); anything else is no tie at all, which rotationSwap() reads cautiously.
      tie: Object.hasOwn(TIE_RANK, String(s.tie ?? "").trim().toLowerCase()) ? String(s.tie).trim().toLowerCase() : "",
      // The business of sport, which sportCap() holds to one a run.
      sport: s.sport === true || String(s.sport).trim().toLowerCase() === "true",
    }))
    .filter((s) => s.ids.length && s.section)
    // Two full stops are punctuation, not a roundup: the working headline loses them and the story stays.
    .map((s) => ({ ...s, headlineHint: s.headlineHint.replace(/\s*\.{2,}\s*/g, "، ").replace(/^، |، $/g, "") }))
    .filter((s) => {
      const roundup = roundupFrame(s.headlineHint);
      if (roundup) log?.(`editor framed a roundup, dropped: "${s.headlineHint}"`);
      return !roundup;
    })
    .map((s) => {
      // One story is one event: the editor was seen citing eighteen items for a "story" that was
      // a roundup, which the writer then wrote as one. Five sources at most; the first are the strongest.
      if (s.ids.length > 5) {
        log?.(`editor stitched ${s.ids.length} items into "${s.headlineHint}"; cut to the first five`);
        return { ...s, ids: s.ids.slice(0, 5) };
      }
      return s;
    })
    .sort((a, b) => b.importance - a.importance);

  // Never let two selected stories share a candidate item.
  const used = new Set();
  const unique = [];
  for (const story of stories) {
    if (story.ids.some((id) => used.has(id))) continue;
    story.ids.forEach((id) => used.add(id));
    unique.push(story);
  }
  return { stories: unique, model };
}

const EXPLAINER_SYSTEM = `You are the explainers editor of خازندار, an Arabic economics publication. You answer with one JSON object only.`;

/**
 * Picks the one question readers of this week's news are left asking, and the stories that raised it. Returns
 * { topic: { question_ar, answer_ar, concept_ar, concept_en, peg_titles }, related: [articles], model }.
 * Until 2026-10-23 it picked an "evergreen concept" and the writer was forbidden to name any news, so 23 of 24
 * explainers came out as textbook entries priced in «وحدات نقدية» under jargon headlines (the owner, on four of them:
 * "looks like ai badly written topics with bad headlines that is even more confusing").
 */
export async function selectExplainerTopic({ recentArticles, existingExplainers, log, subject = null }) {
  const user = `Recent خازندار news (exact title — lede):
${recentArticles.map((a) => `- ${a.title} — ${truncate(a.lede ?? "", 220)}`).join("\n") || "- (none)"}

Explainers already published (do not ask their questions again):
${existingExplainers.map((t) => `- ${t}`).join("\n") || "- (none)"}

${subject ? `This explainer replaces Khazendar's earlier one on the same subject, which asked «${subject}» as a textbook would. Keep that subject: choose the question on it that readers of one of these stories are left asking, in their words, never the textbook's.
` : ""}Choose ONE question that readers of one of these stories are left asking: the mechanism, the term or the consequence behind the news that the story itself does not explain. It must be a question many readers share, answerable from standard economics plus the facts in the stories, and not one the explainers above have answered. The answer is taught as a lesson a layperson can follow and a student of economics finds deep enough (the owner, 2026-11-08: "like economics textbooks with graphs, mathematics and everything", "bachelor and master degree students level", "it should be for layperson too"), so of two such questions choose the one a first economics course would teach with a figure or a sum on the stories' own numbers: a price moved by supply and demand, money flowing into and out of something, one change leading to the next.
Best is a puzzle the news itself sets, two facts that seem not to add up or a figure that does not mean what it seems to, since the piece is told as the story of its answer and its headline stays this question. Write the question as that reader would say it, in everyday Arabic. A reader cannot ask about a term he has not learned yet, so a term the answer has to teach stays out of the question unless the news headline itself used it. The form, not the subject: «لماذا لا يرتفع سعر الخبز في اليوم الذي يهبط فيه الجنيه؟»; the subject comes from the list above.
Return JSON: {"question_ar":"<the question, ending in «؟», at most 14 words>","answer_ar":"<the short answer, one Arabic sentence>","concept_ar":"<the concept the answer turns on, in Arabic>","concept_en":"<the same in English>","peg_titles":["<1-3 exact titles from the list above whose facts raise the question; the first is the story the explainer opens on>"]}`;
  const { data, model } = await chat({
    role: "editor",
    system: EXPLAINER_SYSTEM,
    user,
    temperature: 0.4,
    maxTokens: 2000,
    log,
    validate: (d) => {
      if (!d?.question_ar || !d?.concept_ar) throw new Error("question missing");
      if (!matchTitles(d.peg_titles, recentArticles, 3).length) throw new Error("peg_titles names no story of the list");
    },
  });
  return { topic: data, related: matchTitles(data.peg_titles, recentArticles, 3), model };
}

const IDEA_SYSTEM = `You are the editor of «الفكر الاقتصادي», the weekly page of خازندار, an Arabic economics publication, that explains one economist's idea through a story of the week. You answer with one JSON object only.`;

/**
 * Picks this week's idea (lib/ideas.mjs, the owner, 2026-11-20): one of the candidates, the ideas of the fields the
 * section has covered least, that a story of the last week shows at work, and the reader's question that story raises
 * and the idea answers. Returns { topic: { id, question_ar, answer_ar, link_ar, peg_titles }, idea, related, model }.
 */
export async function selectIdea({ candidates, recentArticles, fieldNames = {}, counts = {}, log, chatWith = chat }) {
  const user = `This week's خازندار news (exact title — lede):
${recentArticles.map((a) => `- ${a.title} — ${truncate(a.lede ?? "", 200)}`).join("\n")}

THE CANDIDATE IDEAS (from the fields the page has covered least; pieces so far per field: ${Object.entries(counts).map(([f, n]) => `${fieldNames[f] ?? f} ${n}`).join("، ")}):
${candidates.map((i) => `[${i.id}] ${fieldNames[i.field] ?? i.field} — ${i.economists.map((e) => e.en).join(", ")} (${i.year}), ${i.work}: ${i.idea} News it can explain: ${i.pegs}.`).join("\n")}

Choose ONE candidate and ONE or TWO stories of the list that show it AT WORK: the idea explains why something in the story happens or what it means, as a specialist would see at once; a shared word or a loose theme is not enough. Of two candidates with a good story, take the one from the field with fewer pieces, then the one a reader of that story would find most illuminating.
Then write THE QUESTION, the headline: what the idea answers, in a reader's everyday Arabic, ending «؟», naming the economist as Arab readers know him or her (the family name, or the known name: «كينز»، «ابن خلدون»); never a term the piece has to teach, never a colon hinge. The form, never the subject: «لماذا طردت النقود الرديئة النقود الجيدة من الأسواق كما لاحظ غريشام؟»، «لماذا يقلّ نصيب الطعام من إنفاق الأسرة كلما زاد دخلها كما وجد إنغل؟».
Return JSON: {"id": "<the candidate's id exactly>", "question_ar": "<at most 16 words, ending «؟»>", "answer_ar": "<the idea's answer in one plain Arabic sentence>", "link_ar": "<one Arabic sentence: what in the story the idea explains, in the story's own facts>", "peg_titles": ["<1-2 exact titles from the list; the first is the story the piece opens on>"]}`;
  const { data, model } = await chatWith({
    role: "editor",
    system: IDEA_SYSTEM,
    user,
    temperature: 0.4,
    maxTokens: 2000,
    log,
    validate: (d) => {
      if (!candidates.some((i) => i.id === d?.id)) throw new Error("id names no candidate");
      if (!d?.question_ar || !/؟\s*$/.test(String(d.question_ar).trim())) throw new Error("question_ar must be a question ending «؟»");
      if (!matchTitles(d.peg_titles, recentArticles, 2).length) throw new Error("peg_titles names no story of the list");
    },
  });
  return { topic: data, idea: candidates.find((i) => i.id === data.id), related: matchTitles(data.peg_titles, recentArticles, 2), model };
}

const ANALYSIS_SYSTEM = `You are the analysis editor of خازندار, an Arabic economics publication. Once a day you commission one house analysis: a piece that connects several of Khazendar's own recent stories and answers the reader's question "what does this mean for us?". You answer with one JSON object only.`;

/** Titles compared loosely: models drop punctuation, quotes and diacritics when they copy a title back. */
const looseTitle = (t) =>
  String(t ?? "")
    .replace(/[ً-ْ]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function matchTitles(titles, articles, max = 5) {
  const byLoose = new Map(articles.map((a) => [looseTitle(a.title), a]));
  const matched = [];
  for (const raw of Array.isArray(titles) ? titles : []) {
    const key = looseTitle(raw);
    if (!key) continue;
    const hit = byLoose.get(key) ?? articles.find((a) => looseTitle(a.title).startsWith(key.slice(0, 40)) || key.startsWith(looseTitle(a.title).slice(0, 40)));
    if (hit && !matched.includes(hit)) matched.push(hit);
  }
  return matched.slice(0, max);
}

/**
 * Picks one theme for a house analysis: a question where at least two recent stories connect.
 * Returns { topic: { theme_ar, theme_en, question_ar, related_titles, hook, angle }, related: [articles], model }.
 */
/** The stories an analysis is written from: the one its question comes from and at most three that carry its evidence. */
export const ANALYSIS_STORIES = 4;

export async function selectAnalysisTopic({ recentArticles, existingAnalyses, log }) {
  const lines = recentArticles.map((a, i) => {
    const facts = (a.keyFacts ?? []).map((f) => [f.label, f.value].filter(Boolean).join(": ")).join("؛ ");
    return `${i + 1}. [${a.section}] "${a.title}" — ${truncate(a.lede ?? "", 260)}${facts ? ` — key facts: ${truncate(facts, 220)}` : ""}`;
  });
  const user = `Today is ${new Date().toISOString().slice(0, 10)} (UTC).

خازندار'S NEWS COVERAGE OF THE LAST 72 HOURS (section, exact title, lede, key facts):
${lines.join("\n") || "- (none)"}

ANALYSES ALREADY PUBLISHED (do not choose a theme that repeats one of these):
${existingAnalyses.map((t) => `- ${t}`).join("\n") || "- (none)"}

TASK
Pick ONE question that one of the stories above leaves an educated Arab reader asking ("what does this mean for us?") and that the facts of at least one other story help answer. It is one argument, never a tour of the week: the related titles are the story the question comes from, first, then only the stories whose facts the answer needs, four in all at most; a story that merely shares the country, the sector or the week stays out (2026-11-11: the analyses given four or five stories went through them one by one). The register: what oil above 100 dollars means for Gulf budgets; what a Fed cut means for dollar-pegged currencies; what a defence deal means for a local industry. Prefer themes with concrete figures in the stories, direct relevance to Arab economies, and a real tension or consequence to unpack. Do not pick a theme that merely summarises one story. The theme, question and angle must be answerable from the facts in the stories listed: do not introduce framings or concepts the stories do not contain, because the writer may use no other material. Keep the theme sober and specific, in Khazendar's calm register: no metaphors or dramatic framings (no "vicious cycle", "hidden price", "crisis" unless a story reports one); the theme names the question, not a conclusion.

Return JSON:
{"theme_ar":"<the theme in Arabic, one line>","theme_en":"<the theme in English, one line>","question_ar":"<the single question the analysis answers, in Arabic>","related_titles":["<2 to 4 titles copied EXACTLY from the list above: the story the question comes from, then only those whose facts the answer needs>"],"hook":"<one Arabic sentence tying the theme to this week's news>","angle":"<one Arabic sentence stating the argument the analysis should make and for whom it matters>"}`;
  let related = [];
  const { data, model } = await chat({
    role: "editor",
    system: ANALYSIS_SYSTEM,
    user,
    temperature: 0.3,
    // Reasoning models spend their first tokens thinking; leave room so the JSON is not cut off.
    maxTokens: 4000,
    log,
    validate: (d) => {
      if (!d?.theme_ar || !d?.question_ar) throw new Error("theme or question missing");
      // Four at most (2026-11-11): the analyses handed four or five stories told them one after another.
      related = matchTitles(d.related_titles, recentArticles, ANALYSIS_STORIES);
      if (related.length < 2) throw new Error(`fewer than two related_titles match the coverage list (${related.length})`);
    },
  });
  const topic = {
    theme_ar: String(data.theme_ar).trim(),
    theme_en: String(data.theme_en ?? "").trim(),
    question_ar: String(data.question_ar).trim(),
    related_titles: related.map((a) => a.title),
    hook: String(data.hook ?? "").trim(),
    angle: String(data.angle ?? "").trim(),
  };
  return { topic, related, model };
}

const FEATURE_EDITOR_SYSTEM = `You are the features editor of خازندار, an Arabic economics publication. Once a week you commission «في العمق», its in-depth piece: the whole story of ONE running file told from Khazendar's own reporting of the past weeks, the way الشرق الأوسط's in-depth pages tell one subject. You answer with one JSON object only.`;

/**
 * Picks the file for «في العمق» (2026-09-24): among the running files (tags with several stories in the last
 * weeks), the one whose story has moved the most and matters most to Arab readers, with the question the piece
 * answers. `files` is [{ tag, stories: [{title, publishedAt, section, lede}] }], busiest first.
 * Returns { topic: { file, theme_ar, question_ar, angle }, stories: [articles], model }.
 */
export async function selectFeatureTopic({ files, existingFeatures, log }) {
  const lines = files.map((f, i) => `${i + 1}. FILE «${f.tag}» — ${f.stories.length} stories:\n${f.stories.map((a) => `   - ${String(a.publishedAt ?? "").slice(0, 10)} [${a.section}] "${a.title}" — ${truncate(a.lede ?? "", 160)}`).join("\n")}`);
  const user = `Today is ${new Date().toISOString().slice(0, 10)} (UTC).

خازندار'S RUNNING FILES OF THE PAST WEEKS (tag, then its stories: date, section, exact title, lede)
${lines.join("\n\n")}

«في العمق» PIECES ALREADY PUBLISHED (do not choose a file one of these already told)
${existingFeatures.map((t) => `- ${t}`).join("\n") || "- (none)"}

TASK
Choose ONE file for this week's «في العمق». Prefer the file whose story has MOVED over the weeks (several dated steps, figures that changed, a turn or a reversal), that matters most to Arab readers (the Gulf, Egypt and the region's economies, energy, trade, their currencies and budgets), and whose stories carry enough facts for 1,200 words without padding. The theme and the question must be answerable from the listed stories alone: no framing the stories do not support, no dramatic metaphor, a question the stories can answer.
Return JSON:
{"file": "<the tag exactly as listed>", "theme_ar": "<the subject in Arabic, one line>", "question_ar": "<the single question the piece answers, in Arabic>", "angle": "<one Arabic sentence: the story the file tells and for whom it matters>", "stories": ["<5 to 12 titles copied EXACTLY from that file's list, the ones the piece needs>"]}`;
  let chosen = null;
  let picked = [];
  const { data, model } = await chat({
    role: "editor",
    system: FEATURE_EDITOR_SYSTEM,
    user,
    timeoutMs: 300000,
    log,
    validate: (d) => {
      chosen = files.find((f) => looseTitle(f.tag) === looseTitle(d?.file));
      if (!chosen) throw new Error(`file "${d?.file}" is not one of the listed tags`);
      if (!d?.theme_ar || !d?.question_ar) throw new Error("theme_ar or question_ar missing");
      picked = matchTitles(d.stories, chosen.stories, 12);
    },
  });
  // The editor's own choice of stories when it names at least five of them; otherwise the file's stories.
  const stories = picked.length >= 5 ? picked : chosen.stories.slice(0, 12);
  const topic = { file: chosen.tag, theme_ar: String(data.theme_ar).trim(), question_ar: String(data.question_ar).trim(), angle: String(data.angle ?? "").trim() };
  return { topic, stories, model };
}

const PAPER_SYSTEM = `You are the research editor of خازندار, an Arabic economics publication. Twice a week you choose ONE recently published, freely available economics research paper for the paper's plain-Arabic reading (قراءة في ورقة بحثية): the papers that matter to an educated Arab reader, explained without jargon. You answer with one JSON object only.`;

function formatPaper(c) {
  const age = Number.isFinite(hoursSince(c.publishedAt)) ? `${Math.round(hoursSince(c.publishedAt) / 24)}d ago` : "date not given";
  const access = c.abstractOnly ? "abstract only" : "abstract + free page text";
  return `[${c.id}] (${c.sourceNameEn}; ${age}; ${access}; ${c.summary.length} chars of abstract) ${truncate(c.title, 160)} — ${truncate(c.summary, 600)} — ${c.url}`;
}

/**
 * Picks one open-access research paper worth a reading. Returns { choice, model } with
 * `choice` = { id, title_en, why_it_matters_ar, reading_angle_ar, open_access: { ok, url } }.
 * The caller asks again, without the passed-over paper, when the chosen paper's free text is too thin.
 */
export async function selectPaper({ candidates, existingPapers, log }) {
  const idSet = new Set(candidates.map((c) => c.id));
  const user = `Today is ${new Date().toISOString().slice(0, 10)} (UTC).

RECENT RESEARCH PAPERS (one per line: id, series, age, what free text exists, title, abstract, link):
${candidates.map(formatPaper).join("\n")}

PAPERS ALREADY READ BY خازندار (do not choose these or a paper on the same finding):
${existingPapers.length ? existingPapers.map((t) => `- ${t}`).join("\n") : "- (none)"}

TASK
Choose ONE paper that is
(a) open access: a free full text, or at least a free full abstract, at the link shown (all the series listed are free to read; note the ones marked "abstract only");
(b) impactful for Arab readers: oil and energy markets, fiscal policy and public debt, labour markets and migration, inflation and monetary policy, trade and tariffs, development, banking and finance, the energy transition, remittances, sovereign wealth and reserves, AI and productivity; prefer findings a reader in the Gulf, Egypt, the Levant or the Maghreb can use, and findings with concrete numbers;
(c) not already covered in the list above;
(d) recent: prefer the last 60 days.
Skip papers that are purely methodological, about a single rich-country programme with no wider lesson, or too technical to explain in plain words. Prefer a finding measured in real data (what happened to prices, jobs, flows, yields, output) over one produced by a calibrated theoretical model: the wires report a paper when its finding can be told in one plain sentence a reader can picture («تراجع الهجرة يبطئ نمو الوظائف»), and a model's mechanism rarely can (2026-10-23). The writer needs at least 3,000 characters of the paper's own text to explain it without inventing: strongly prefer series whose pages carry the full text or a long summary (the Federal Reserve series and notes, the Bank of England working papers, arXiv papers with an HTML version, World Bank abstracts of several paragraphs); choose an "abstract only" paper only when no full-text candidate fits.

Return JSON:
{"id":"<candidate id>","title_en":"<the paper's title in English, exactly as listed>","why_it_matters_ar":"<one Arabic sentence: why this paper matters to Arab readers>","reading_angle_ar":"<one Arabic sentence: the angle the reading should take>","open_access":{"ok":true,"url":"<the link shown for the paper>"}}`;

  const normalizeId = (value) => {
    const text = String(value ?? "").trim().replace(/[[\]\s]/g, "");
    if (idSet.has(text)) return text;
    const digits = text.match(/\d+/)?.[0];
    return digits && idSet.has(`p${digits}`) ? `p${digits}` : null;
  };
  const { data, model } = await chat({
    role: "editor",
    system: PAPER_SYSTEM,
    user,
    temperature: 0.3,
    maxTokens: 4000,
    log,
    validate: (d) => {
      if (!d || typeof d !== "object") throw new Error("answer is not an object");
      if (!normalizeId(d.id)) throw new Error(`unknown candidate id "${d.id}"`);
      if (!d.why_it_matters_ar || !d.reading_angle_ar) throw new Error("why_it_matters_ar or reading_angle_ar missing");
    },
  });
  const id = normalizeId(data.id);
  const chosen = candidates.find((c) => c.id === id);
  const openAccess = data.open_access && typeof data.open_access === "object" ? data.open_access : { ok: true, url: chosen.url };
  const choice = {
    id,
    title_en: String(data.title_en ?? chosen.title).trim() || chosen.title,
    why_it_matters_ar: String(data.why_it_matters_ar).trim(),
    reading_angle_ar: String(data.reading_angle_ar).trim(),
    open_access: { ok: openAccess.ok !== false, url: String(openAccess.url ?? "").trim() || chosen.url },
  };
  return { choice, model };
}
