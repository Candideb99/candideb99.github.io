import { chat } from "./llm.mjs";
import { hoursSince, truncate } from "./util.mjs";

const EDITOR_SYSTEM = `You are the managing editor of خازندار (Khazendar), an Arabic-language economics and business publication read across the Gulf, Egypt, the Levant, North Africa and the diaspora.
You decide which stories the newsroom will write in the next hours. You are rigorous, allergic to fluff, and you think about what an educated Arab reader needs to understand the economy today.
You always answer with a single JSON object and nothing else.`;

function formatCandidate(c) {
  const age = Number.isFinite(hoursSince(c.publishedAt)) ? `${Math.round(hoursSince(c.publishedAt))}h` : "?";
  const tier = c.reliability === 3 ? "A" : c.reliability === 2 ? "B" : "C";
  return `[${c.id}] (${c.sourceNameEn}; tier ${tier}; ${c.kind}; ${c.lang}; ${age} ago) ${truncate(c.title, 140)}${c.summary ? ` — ${truncate(c.summary, 220)}` : ""}`;
}

/**
 * Asks the editor model to cluster candidates into stories and pick the best ones.
 * Returns an array of { ids, section, importance, angle, headlineHint, regions }.
 */
export async function selectStories({ candidates, recentTitles, sections, limit, log }) {
  const sectionIds = sections.filter((s) => s.id !== "explainers").map((s) => `${s.id} (${s.name})`).join(", ");
  const idSet = new Set(candidates.map((c) => c.id));
  const user = `Today is ${new Date().toISOString().slice(0, 10)} (UTC).

CANDIDATE ITEMS from the last hours (one per line; tier A = official institution or top-tier outlet):
${candidates.map(formatCandidate).join("\n")}

STORIES ALREADY PUBLISHED RECENTLY (do not select stories that merely repeat these; a genuinely new development is fine):
${recentTitles.length ? recentTitles.map((t) => `- ${t}`).join("\n") : "- (none)"}

TASK
1. Group candidate items that report the same underlying story into one cluster (items from different outlets about the same event belong together).
2. Choose the ${limit} most important stories for our readers. Judge by: material economic significance; relevance to Arab economies (Gulf, Egypt, Levant, Maghreb) or to the global forces that shape them (oil, the dollar, the Fed, the ECB, China, trade, technology); primary or official sourcing; freshness; and novelty versus the recently published list.
3. Skip: opinion columns, listicles, personal finance tips, celebrity and lifestyle, sports business, product reviews, minor local items, press-release fluff, stock-picking, crypto hype, and anything already covered.
4. Prefer official statistics and central-bank decisions when they are new. Prefer clusters with at least one tier A source.
5. Assign each story to exactly one section from: ${sectionIds}.
6. The angle and headline_hint must state only what the candidate items themselves report; a neutral factual working title, no dramatisation, no ".." ellipses, no inferred events.

Return JSON:
{"stories":[{"ids":["<candidate id>", "..."],"section":"<section id>","importance":<1-10>,"angle":"<one Arabic sentence stating the story and the angle for Arab readers>","headline_hint":"<short Arabic working headline>","regions":["<Arabic region tags such as الخليج, مصر, أوروبا, الولايات المتحدة, الصين, عالمي>"]}]}
Order stories by importance, highest first. Use only candidate ids that exist. Return at most ${limit + 2} stories.`;

  const { data, model } = await chat({
    role: "editor",
    system: EDITOR_SYSTEM,
    user,
    temperature: 0.2,
    maxTokens: 3000,
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
  const normalizeSection = (value) => {
    const text = String(value ?? "").trim().toLowerCase();
    const hit = sections.find((s) => text === s.id || text.startsWith(`${s.id} `) || text.startsWith(`${s.id}(`) || text.includes(s.name));
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
      regions: Array.isArray(s.regions) ? s.regions.map(String).slice(0, 4) : [],
    }))
    .filter((s) => s.ids.length && s.section && s.section !== "explainers")
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
    maxTokens: 800,
    log,
    validate: (d) => {
      if (!d?.concept_ar) throw new Error("concept missing");
    },
  });
  return { topic: data, model };
}
