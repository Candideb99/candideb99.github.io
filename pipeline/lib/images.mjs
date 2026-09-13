import { attributionLine, searchCommons } from "./commons.mjs";
import { chat } from "./llm.mjs";
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

function recencyScore(image) {
  const year = Number(String(image.date ?? "").slice(0, 4));
  if (!Number.isFinite(year) || year < 1900) return 0;
  if (year >= 2015) return 3;
  if (year >= 2005) return 2;
  if (year >= 1995) return 1;
  return -2;
}

/** Searches Commons for every query (with simpler fallbacks) and ranks the unique results. */
async function collect(queries, log, { perQuery = 6, max = 8, exclude = new Set() } = {}) {
  const seen = new Set(exclude);
  const candidates = [];
  for (const query of queries) {
    let results = await searchCommons(query, { limit: perQuery, log });
    for (const alternative of simplerQueries(query)) {
      if (results.length) break;
      results = await searchCommons(alternative, { limit: perQuery, log });
    }
    for (const image of results) {
      if (seen.has(image.url)) continue;
      seen.add(image.url);
      candidates.push({ ...image, query, score: recencyScore(image) + (image.width >= 1600 ? 1 : 0) });
    }
    if (candidates.length >= max) break;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
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
async function judge({ list, inlined, draft, story, log, relaxed }) {
  const rules = relaxed
    ? `This is the fallback pass: a generic but appropriate newspaper illustration is acceptable, such as the skyline or a landmark of the city or country in the story, the headquarters of the institution, or a typical scene of the sector (port, refinery, trading floor, factory, bank branch, oil field). Reject only: visible text overlays or watermarks; logos, maps, charts, diagrams, infographics, screenshots, documents, banknotes or coins as the subject; a product or appliance close-up unrelated to the story; an archival, black-and-white or pre-2005 look; a close-up of a private individual; a different country or city than the story's; anything misleading or embarrassing next to the headline.`
    : `Requirements: clearly relevant to the story's subject (institution, place, industry, product); looks like a contemporary editorial news photo; landscape composition; no visible text overlays, watermarks, logos as the main subject, charts, maps, diagrams, infographics, screenshots, product close-ups, or historical/archival look; no close-up of a private individual; nothing embarrassing or misleading if paired with the headline.`;
  const user = `We are illustrating an Arabic economics article.
Headline: ${draft.title}
Summary: ${draft.subtitle ?? ""}
Editor's angle: ${story?.angle ?? ""}
Regions: ${(draft.regions ?? []).join(", ") || "unknown"}

Candidate photographs (numbered in the same order as the attached images):
${list.map((c, i) => `${i + 1}. "${c.title}" — ${c.description || "no description"} — dated ${c.date || "unknown"} — search: ${c.query}`).join("\n")}

Choose the single best photograph for this article, or none. ${rules}
Return JSON: {"choice": <1-${list.length} or 0 for none>, "alt": "<Arabic alt text of 8-16 words describing what the chosen photo shows>", "reason": "<short English reason>"}`;

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
      alt: String(data.alt ?? chosen.title).trim(),
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
Return JSON: {"choice": <1-${list.length} or 0 for none>, "alt": "<Arabic alt text of 8-16 words describing what the chosen photo most likely shows>", "reason": "<short English reason>"}`;
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
    alt: String(data.alt ?? chosen.title).trim(),
    credit: attributionLine(chosen),
    author: chosen.artist,
    license: chosen.license,
    licenseUrl: chosen.licenseUrl,
    pageUrl: chosen.pageUrl,
    title: chosen.title,
    model: `${model} (metadata)`,
  };
}

/** Asks a text model for the stock subjects a newspaper would use to illustrate this story. */
async function genericQueries({ draft, story, log }) {
  const { data } = await chat({
    role: "writer",
    system: "You are a photo editor at an Arabic economics newspaper choosing stock photographs from Wikimedia Commons. Reply with one JSON object only.",
    user: `Story headline: ${draft.title}
Summary: ${draft.subtitle ?? ""}
Lede: ${String(draft.lede ?? "").slice(0, 400)}
Angle: ${story?.angle ?? ""}
Regions: ${(draft.regions ?? []).join(", ") || "unknown"}
Tags: ${(draft.tags ?? []).join(", ")}

Give 4 English search phrases (2-4 words each, concrete nouns only) for generic photographs that this newspaper could run with the story: the skyline or central business district of the city or country involved, the headquarters building of the institution named, a typical scene of the sector (port, refinery, stock exchange, factory, oil tanker, bank), or a well-known landmark of the place. Prefer subjects that certainly exist as photos on Wikimedia Commons (e.g. "Riyadh skyline", "Cairo Nile skyline", "Central Bank of Egypt", "Ras Tanura refinery", "Dubai Marina", "Shanghai Pudong skyline", "oil tanker sea").
Return JSON: {"queries": ["...", "...", "...", "..."]}`,
    // Models that think before answering spend their first tokens on reasoning; leave room for it.
    temperature: 0.2,
    maxTokens: 1500,
    timeoutMs: 60000,
    log,
    validate: (d) => {
      if (!Array.isArray(d?.queries) || !d.queries.length) throw new Error("queries missing");
    },
  });
  return data.queries.map((q) => String(q).trim()).filter((q) => q.length >= 3).slice(0, 4);
}

/**
 * Finds a licensed editorial photo for the article, verified by a vision model: first the
 * writer's specific subjects, then, as a newspaper would, a generic illustration of the place,
 * institution or sector. Returns null when nothing suitable exists (the story runs as text).
 */
export async function pickImage({ draft, story, log, fallback = true, exclude = new Set() }) {
  const specific = (draft.imageQueries?.length ? draft.imageQueries : []).slice(0, 3);
  if (specific.length) {
    const candidates = await collect(specific, log, { exclude });
    if (candidates.length) {
      const s = await shortlist(candidates, log);
      if (s.list.length) {
        const image = await judge({ ...s, draft, story, log, relaxed: false });
        if (image) return image;
      }
    } else {
      log("image: no candidates for the specific queries");
    }
  }
  if (!fallback) return null;

  let queries = [];
  try {
    queries = await genericQueries({ draft, story, log });
  } catch (error) {
    log(`image: generic queries failed (${error.message.split("\n")[0]})`);
  }
  if (!queries.length) return null;
  log(`image: fallback queries: ${queries.join(" | ")}`);
  const candidates = await collect(queries, log, { perQuery: 8, max: 12, exclude });
  if (!candidates.length) {
    log("image: no candidates for the fallback queries");
    return null;
  }
  const s = await shortlist(candidates, log);
  if (!s.list.length) return null;
  return judge({ ...s, draft, story, log, relaxed: true });
}
