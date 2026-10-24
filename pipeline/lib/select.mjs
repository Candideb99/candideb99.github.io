import { chat } from "./llm.mjs";
import { hoursSince, truncate } from "./util.mjs";
import { DESK_NAMES } from "./regions.mjs";

const EDITOR_SYSTEM = `You are the managing editor of خازندار (Khazendar), an Arabic-language economics and business publication read across the Gulf, Egypt, the Levant, North Africa and the diaspora.
You decide which stories the newsroom will write in the next hours. You are rigorous, allergic to fluff, and you think about what an educated Arab reader needs to understand the economy today.
You always answer with a single JSON object and nothing else.`;

/** Hub sections hold the paper's own analyses and explainers; news is never filed into them (mirrors src/lib/sections.ts). */
export const HUB_SECTIONS = new Set(["analysis", "explainers"]);

/** The sections news can be filed into. */
export const newsSectionsOf = (sections) => sections.filter((s) => !HUB_SECTIONS.has(s.id));

function formatCandidate(c) {
  const age = Number.isFinite(hoursSince(c.publishedAt)) ? `${Math.round(hoursSince(c.publishedAt))}h` : "?";
  const tier = c.reliability === 3 ? "A" : c.reliability === 2 ? "B" : "C";
  return `[${c.id}] (${c.sourceNameEn}; tier ${tier}; ${c.kind}; ${c.lang}; ${age} ago) ${truncate(c.title, 140)}${c.summary ? ` — ${truncate(c.summary, 220)}` : ""}`;
}

/**
 * Asks the editor model to cluster candidates into stories and pick the best ones.
 * `coverage24h` maps section id → stories published there in the last 24 hours (for the balance rule).
 * Returns an array of { ids, section, importance, angle, headlineHint, regions }.
 */
export async function selectStories({ candidates, recentTitles, sections, coverage24h = {}, limit, log }) {
  const newsSections = newsSectionsOf(sections);
  const sectionIds = newsSections.map((s) => `${s.id} (${s.name})`).join(", ");
  // The filing guide per section: what belongs, and the cases that keep going wrong (2026-09-22: an
  // air-traffic-control outage that grounded flights was filed under energy). Lives in sections.json
  // beside the public description, so the guide and the paper's sections cannot drift apart.
  const sectionGuide = newsSections.map((s) => `- ${s.id} (${s.name}): ${s.description}${s.guide ? ` ${s.guide}` : ""}`).join("\n");
  const coverageLine = newsSections.map((s) => `${s.id} ${coverage24h[s.id] ?? 0}`).join(", ");
  const quiet = newsSections.filter((s) => !(coverage24h[s.id] > 0)).map((s) => s.id);
  const idSet = new Set(candidates.map((c) => c.id));
  const user = `Today is ${new Date().toISOString().slice(0, 10)} (UTC).

CANDIDATE ITEMS from the last hours (one per line; tier A = official institution or top-tier outlet):
${candidates.map(formatCandidate).join("\n")}

STORIES ALREADY PUBLISHED RECENTLY (do not select stories that merely repeat these; a genuinely new development is fine):
${recentTitles.length ? recentTitles.map((t) => `- ${t}`).join("\n") : "- (none)"}

STORIES PUBLISHED PER SECTION IN THE LAST 24 HOURS: ${coverageLine}${quiet.length ? ` (no story yet in: ${quiet.join(", ")})` : ""}

TASK
1. Group candidate items that report the same underlying story into one cluster (items from different outlets about the same event belong together). A story is ONE event: one decision, one data release, one deal, one market move. Never merge different events into a cluster because they happened the same day or touch the same theme; a US confidence survey and a British rate outlook are two stories, not one, and a roundup is not a story. If two events are related, pick the more important and mention the other only if the writer needs it as context. A story cites at most FIVE candidate items (the outlets reporting that one event); a list of more than five ids means events have been merged, and the desk cuts it to the first five. "A week of central bank decisions", "markets await…", "X and Y" framings are roundups, not events: the story is the decision, the release, the deal or the move itself.
2. Choose up to ${limit} stories: every event that clears the bar below, and fewer only when fewer clear it. A news site is edited, not filled, but a worthy story left unwritten is a gap in the file. Score each candidate on the news values an Arabic desk edits by (قيم الخبر): التأثير (does it change money, prices, jobs or policy for our readers?), الأهمية (a central bank, a government, a market, a major company), الآنية (it happened or was decided now; a figure already reported is news again only if the change is material), القرب (the Gulf, Egypt, the Levant, the Maghreb, or the global forces that move them: oil, the dollar, the Fed, the ECB, China, trade, technology), الضخامة (the size of the number), الصراع والنتائج (winners, losers, what follows). A story must carry at least three of these to be selected; importance below 6 is not published. State the values it carries in "news_value".
   Development over repetition: when a candidate advances a story Khazendar already ran (a running file), prefer the development to an unrelated marginal item, and say what is new in the angle; when it only repeats, skip it.
   Defence economics is part of our beat: defence budgets, procurement and contract awards (an official award with a stated value is news, not fluff), arms exports and imports, the defence industry and its suppliers, and what each of these means for Arab economies (Gulf procurement, offsets, local industry, public budgets). File a contractor's award, an arms deal or the defence industry under companies, and a defence budget or a war's cost to a state under economy (the defence section was folded into them on 2026-10-19).
   POLITICS AND CONFLICT WHEN THEY MOVE MONEY (the owner, 2026-10-22: Khazendar stays an economics paper, but covers politics and conflict when they move money, told from the economic angle; the Houthi attacks on Saudi airports and Aramco, and Libya's ratification of its maritime deal with Turkey, had gone untold). An attack, a war, a sanction, a treaty, a ratification, a boundary or a government's political decision is selected when the items report that it changes something an economy runs on: oil and gas output, exports or facilities, shipping lanes and ports, airports and flights, drilling and exploration rights (a maritime boundary decides who may drill), sanctions and trade, investment and events that bring it, a state's budget or debt, a market's price. The angle and the headline_hint lead with that consequence, and the story is filed where the consequence lives: energy for oil, gas, facilities and drilling rights; economy for a state's budget, trade, sanctions, airports and security pacts; companies for one company's assets, staff or contracts; markets for a price. Not selected: battlefield news, diplomacy, elections, protests, statements and condemnations that the items tie to no economic consequence.
   OUR READERS' OWN ECONOMIES FIRST, as on every Arab economics desk. A Saudi, Emirati, Qatari, Kuwaiti, Omani, Bahraini, Egyptian, Moroccan, Jordanian or Iraqi decision, data release, budget, central-bank move, company result, listing, deal or project of real weight is selected ahead of a comparable foreign story, and about half of a day's stories should be about the Arab world when the candidates allow. The Gulf and Egyptian outlets in the list (الخليج، جريدة الرياض، اليوم السابع، مصراوي، هسبريس، AGBI، Gulf Times، Saudi Gazette، Daily News Egypt، Arabian Business, alongside الشرق الأوسط، الجزيرة، سكاي نيوز عربية، البورصة) report such events; two of them reporting one event make a cluster like any other. Give such a story the region الخليج or مصر والمغرب العربي.
3. Skip: opinion columns, listicles, personal finance tips, celebrity and lifestyle, sports business, product reviews, minor local items, press-release fluff, protocol news (a minister receives a delegation, a memorandum that commits nothing, a ribbon-cutting; a treaty or a ratification that grants rights or moves money is news without figures), the day's price tables (gold, currency or share prices), stock-picking, crypto hype, and anything already covered.
   A MARKET MOVE IS A STORY ONLY WHEN IT IS NEWS (the owner, 2026-10-19, after the Financial Times ran no story on a morning when we ran WTI down 0.82%): a record or a high or low of several months, a large move (about 2% or more for oil or a stock index, about 1% for gold or a major currency, about 10 basis points for a government bond yield), or a move whose cause is itself news (a decision, an attack, a data release, a supply disruption), told as that cause's story. An ordinary day's move is on the market board every page carries: skip it, and give the slot to an Arab economy's own news. One story per instrument within eight hours: a later move of the same instrument is news only when it sets a new record or reverses.
4. Prefer official statistics and central-bank decisions when they are new. Prefer clusters with at least one tier A source. Every story becomes a developed report of 350-650 words (the news, its driver, the figures in perspective, the reactions, the background, what comes next), written only from the items you cite: cite EVERY candidate that reports the same event, up to five, and skip an event that no outlet reports beyond a sentence or two, however important its headline. A story reported by ONE outlet only is not selected unless that outlet is an official institution (tier A, kind official): with a single non-official source the desk cannot cross-check a figure, and the article would be a translation of one report rather than the paper's own account.
5. Balance, applied mildly: when a worthy candidate exists in a section that has had no story in the last 24 hours, prefer it over a marginal extra story in an already-covered section. Never promote a weak item just to fill a section.
6. Assign each story to exactly one section from: ${sectionIds}. File it where a reader would look for it, by the SUBJECT of the story, not by a word in it; a story that touches two sections goes to the one whose readers it changes most. The filing guide, with the cases that are often confused:
${sectionGuide}
7. The angle and headline_hint must state only what the candidate items themselves report; a neutral factual working title, no dramatisation, no ".." ellipses, no inferred events.

Return JSON:
{"stories":[{"ids":["<candidate id>", "..."],"section":"<section id>","importance":<1-10>,"news_value":"<the values it carries, e.g. تأثير، آنية، قرب>","angle":"<one Arabic sentence stating the story and the angle for Arab readers>","headline_hint":"<short Arabic working headline>","regions":["<1-3 region names, only from: ${DESK_NAMES.join("، ")}>"]}]}
Order stories by importance, highest first. Use only candidate ids that exist. Return at most ${limit + 2} stories.`;

  const { data, model } = await chat({
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
      importance: Number(s.importance) || 0,
      angle: String(s.angle ?? "").trim(),
      headlineHint: String(s.headline_hint ?? "").trim(),
      newsValue: String(s.news_value ?? "").trim(),
      regions: Array.isArray(s.regions) ? s.regions.map(String).slice(0, 4) : [],
    }))
    .filter((s) => s.ids.length && s.section)
    .filter((s) => {
      const roundup = /أسبوع (?:حافل|حاسم|المصارف|البنوك|المركزيات|التقارير)|المركزيات|تترقب|بين .{3,40} و|من .{3,30} إلى .{3,30}(?:،| و)|\.\.\.|\.\./.test(s.headlineHint);
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
` : ""}Choose ONE question that readers of one of these stories are left asking: the mechanism, the term or the consequence behind the news that the story itself does not explain. It must be a question many readers share, answerable from standard economics plus the facts in the stories, and not one the explainers above have answered.
Write the question as that reader would say it, in everyday Arabic. A reader cannot ask about a term he has not learned yet, so a term the answer has to teach stays out of the question unless the news headline itself used it. The form, not the subject: «لماذا لا يرتفع سعر الخبز في اليوم الذي يهبط فيه الجنيه؟»; the subject comes from the list above.
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
Pick ONE theme where at least two of the stories above connect and an educated Arab reader would ask "what does this mean for us?". The register: what oil above 100 dollars means for Gulf budgets; what a Fed cut means for dollar-pegged currencies; what a defence deal means for a local industry. Prefer themes with concrete figures in the stories, direct relevance to Arab economies, and a real tension or consequence to unpack. Do not pick a theme that merely summarises one story. The theme, question and angle must be answerable from the facts in the stories listed: do not introduce framings or concepts the stories do not contain, because the writer may use no other material. Keep the theme sober and specific, in Khazendar's calm register: no metaphors or dramatic framings (no "vicious cycle", "hidden price", "crisis" unless a story reports one); the theme names the question, not a conclusion.

Return JSON:
{"theme_ar":"<the theme in Arabic, one line>","theme_en":"<the theme in English, one line>","question_ar":"<the single question the analysis answers, in Arabic>","related_titles":["<2 to 5 titles copied EXACTLY from the list above>"],"hook":"<one Arabic sentence tying the theme to this week's news>","angle":"<one Arabic sentence stating the argument the analysis should make and for whom it matters>"}`;
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
      related = matchTitles(d.related_titles, recentArticles);
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
