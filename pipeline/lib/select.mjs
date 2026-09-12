import { chat } from "./llm.mjs";
import { hoursSince, truncate } from "./util.mjs";

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
1. Group candidate items that report the same underlying story into one cluster (items from different outlets about the same event belong together).
2. Choose at most ${limit} stories, and fewer when the day is thin: a paper is edited, not filled. Score each candidate on the news values an Arabic desk edits by (قيم الخبر): التأثير (does it change money, prices, jobs or policy for our readers?), الأهمية (a central bank, a government, a market, a major company), الآنية (it happened or was decided now; a figure already reported is news again only if the change is material), القرب (the Gulf, Egypt, the Levant, the Maghreb, or the global forces that move them: oil, the dollar, the Fed, the ECB, China, trade, technology), الضخامة (the size of the number), الصراع والنتائج (winners, losers, what follows). A story must carry at least three of these to be selected; importance below 6 is not published. State the values it carries in "news_value".
   Development over repetition: when a candidate advances a story the paper already ran (a running file), prefer the development to an unrelated marginal item, and say what is new in the angle; when it only repeats, skip it.
   Defence economics is part of our beat: defence budgets, procurement and contract awards (an official award with a stated value is news, not fluff), arms exports and imports, the defence industry and its suppliers, and what each of these means for Arab economies (Gulf procurement, offsets, local industry, public budgets). File such stories in the defense section.
3. Skip: opinion columns, listicles, personal finance tips, celebrity and lifestyle, sports business, product reviews, minor local items, press-release fluff, stock-picking, crypto hype, and anything already covered.
4. Prefer official statistics and central-bank decisions when they are new. Prefer clusters with at least one tier A source.
5. Balance, applied mildly: when a worthy candidate exists in a section that has had no story in the last 24 hours, prefer it over a marginal extra story in an already-covered section. Never promote a weak item just to fill a section.
6. Assign each story to exactly one section from: ${sectionIds}.
7. The angle and headline_hint must state only what the candidate items themselves report; a neutral factual working title, no dramatisation, no ".." ellipses, no inferred events.

Return JSON:
{"stories":[{"ids":["<candidate id>", "..."],"section":"<section id>","importance":<1-10>,"news_value":"<the values it carries, e.g. تأثير، آنية، قرب>","angle":"<one Arabic sentence stating the story and the angle for Arab readers>","headline_hint":"<short Arabic working headline>","regions":["<Arabic region tags such as الخليج, مصر, أوروبا, الولايات المتحدة, الصين, عالمي>"]}]}
Order stories by importance, highest first. Use only candidate ids that exist. Return at most ${limit + 2} stories.`;

  const { data, model } = await chat({
    role: "editor",
    system: EDITOR_SYSTEM,
    user,
    temperature: 0.2,
    maxTokens: 8000,
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

/** Picks one concept worth an evergreen explainer, tied to current coverage. */
export async function selectExplainerTopic({ recentArticles, existingExplainers, log }) {
  const user = `Recent خازندار coverage (title — tags):
${recentArticles.map((a) => `- ${a.title} — ${(a.tags ?? []).join("، ")}`).join("\n") || "- (none)"}

Explainers already published (do not repeat these concepts):
${existingExplainers.map((t) => `- ${t}`).join("\n") || "- (none)"}

Choose ONE economic or financial concept that recurs in the recent coverage (or underpins it) and that a curious Arab reader would want explained calmly: what it is, how it works, why it matters now, with one or two concrete worked examples using realistic illustrative numbers clearly labelled as examples.
Return JSON: {"concept_ar":"<concept in Arabic>","concept_en":"<concept in English>","hook":"<one Arabic sentence linking it to current news>","related_titles":["<titles from the recent coverage list that relate>"]}`;
  const { data, model } = await chat({
    role: "editor",
    system: EXPLAINER_SYSTEM,
    user,
    temperature: 0.4,
    maxTokens: 2000,
    log,
    validate: (d) => {
      if (!d?.concept_ar) throw new Error("concept missing");
    },
  });
  return { topic: data, model };
}

const ANALYSIS_SYSTEM = `You are the analysis editor of خازندار, an Arabic economics publication. Once a day you commission one house analysis: a piece that connects several of the paper's own recent stories and answers the reader's question "what does this mean for us?". You answer with one JSON object only.`;

/** Titles compared loosely: models drop punctuation, quotes and diacritics when they copy a title back. */
const looseTitle = (t) =>
  String(t ?? "")
    .replace(/[ً-ْ]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function matchTitles(titles, articles) {
  const byLoose = new Map(articles.map((a) => [looseTitle(a.title), a]));
  const matched = [];
  for (const raw of Array.isArray(titles) ? titles : []) {
    const key = looseTitle(raw);
    if (!key) continue;
    const hit = byLoose.get(key) ?? articles.find((a) => looseTitle(a.title).startsWith(key.slice(0, 40)) || key.startsWith(looseTitle(a.title).slice(0, 40)));
    if (hit && !matched.includes(hit)) matched.push(hit);
  }
  return matched.slice(0, 5);
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
Pick ONE theme where at least two of the stories above connect and an educated Arab reader would ask "what does this mean for us?". The register: what oil above 100 dollars means for Gulf budgets; what a Fed cut means for dollar-pegged currencies; what a defence deal means for a local industry. Prefer themes with concrete figures in the stories, direct relevance to Arab economies, and a real tension or consequence to unpack. Do not pick a theme that merely summarises one story. The theme, question and angle must be answerable from the facts in the stories listed: do not introduce framings or concepts the stories do not contain, because the writer may use no other material. Keep the theme sober and specific, in the paper's calm register: no metaphors or dramatic framings (no "vicious cycle", "hidden price", "crisis" unless a story reports one); the theme names the question, not a conclusion.

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
