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
 * Searches Commons for every query (with simpler fallbacks) and ranks the unique results.
 * `people`: "by-query" keeps a photo of a named person only when the query itself asked for that
 * surname (the writer's specific subject); "none" drops every photo of a named person — a generic
 * illustration is a place or a thing, never somebody else's summit.
 */
async function collect(queries, log, { perQuery = 6, max = 8, exclude = new Set(), people = "by-query" } = {}) {
  const seen = new Set(exclude);
  const candidates = [];
  for (const query of queries) {
    let results = await searchCommons(query, { limit: perQuery, log });
    for (const alternative of simplerQueries(query)) {
      if (results.length) break;
      results = await searchCommons(alternative, { limit: perQuery, log });
    }
    const asked = new Set(query.toLowerCase().split(/[^\p{L}\p{N}'’-]+/u));
    for (const image of results) {
      if (seen.has(image.url) || seen.has(`title:${image.title}`)) continue;
      seen.add(image.url);
      const named = namedPeople(image);
      const unwanted = people === "none" ? named : named.filter((words) => !words.some((w) => asked.has(w)));
      if (unwanted.length) {
        log(`image: dropped "${String(image.title).slice(0, 70)}" — shows ${unwanted.map((w) => w[0]).join(", ")}, not the story's people`);
        continue;
      }
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
    ? `This is the fallback pass: a generic but appropriate newspaper illustration is acceptable, such as the skyline or a landmark of the city or country in the story, the headquarters of the institution, or a typical scene of the sector (port, refinery, trading floor, factory, bank branch, oil field). Reject: any photograph of identifiable people — officials, politicians, executives, a named meeting, summit, ceremony or visit (a generic illustration shows places and things, never someone else's event); visible text overlays or watermarks; logos, maps, charts, diagrams, infographics, screenshots, documents, banknotes or coins as the subject; a product or appliance close-up unrelated to the story; military vessels, aircraft or weapons for a story that is not about the military; an archival, black-and-white or pre-2005 look; a close-up of a private individual; a different country or city than the story's; anything misleading or embarrassing next to the headline.`
    : `Requirements: clearly relevant to the story's subject (institution, place, industry, product); looks like a contemporary editorial news photo; landscape composition; no visible text overlays, watermarks, logos as the main subject, charts, maps, diagrams, infographics, screenshots, product close-ups, or historical/archival look; no close-up of a private individual; nothing embarrassing or misleading if paired with the headline.
PEOPLE — the gravest error: a photograph showing an identifiable person (a politician, official, executive, anyone a caption would name) who is NOT one of the people this story is about is WRONG, however well the room, flag or setting matches. Read each candidate's file name and description for names of people and compare them with the headline: a story about Treasury Secretary Bessent must never run a photo of Secretary Kerry; a story about He Lifeng must never run one of Liu Yandong. When no candidate shows the story's own people, choose 0 and let the fallback find a building, skyline or sector scene instead.`;
  const user = `We are illustrating an Arabic economics article.
Headline: ${draft.title}
Summary: ${draft.subtitle ?? ""}
Editor's angle: ${story?.angle ?? ""}
Regions: ${(draft.regions ?? []).join(", ") || "unknown"}

Candidate photographs (numbered in the same order as the attached images):
${list.map((c, i) => `${i + 1}. "${c.title}" — ${c.description || "no description"} — dated ${c.date || "unknown"} — search: ${c.query}`).join("\n")}

Choose the single best photograph for this article, or none. ${rules}
Return JSON: {"choice": <1-${list.length} or 0 for none>, "alt": "<Arabic alt text of 8-16 words describing what the chosen photo shows; for a generic illustration describe only what is seen and name no place, company or person the story does not mention>", "reason": "<short English reason>"}`;

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
/**
 * The second lock. The chooser's answer is one model's opinion on four thumbnails; before a photo is
 * attached, a different model re-reads the story against the file's own name, description and
 * categories and must say RIGHT or GENERIC_OK. Wrong person, wrong country, wrong company, wrong
 * event → the photo is refused and the story runs as text. This is the audit rubric of 2026-09-22
 * (37 flagged of 125) made a gate, so it cannot be skipped.
 */
async function verifyImage({ image, draft, story, log }) {
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

Judge as a strict picture editor of a paper read across the Arab world. The test is what is IN THE FRAME and what the CAPTION says; readers never see the file name:
- WRONG_PERSON: an identifiable person (official, politician, executive) who is not one of the story's own people, whatever the setting.
- WRONG_SUBJECT: a different country or city than the story's; a different company or institution; a different sector; a military vessel or weapon for a non-military story; a scene that merely lies NEAR the subject (a beach, a park, a street, a metro station, a hillside or a coastline beside a refinery, port or pipeline; a satellite view of a whole country); a landmark, flag, sign or building in the frame that identifies a country the story does not mention; a caption that names a place, company or person the story does not mention (a tanker depot captioned "at Eilat" is WRONG_SUBJECT on a Gulf oil story, however good a tanker depot it is). If your reason would contain "loosely", "broadly", "tangentially", "not specifically", "though it shows" or "reasonably", the verdict is WRONG_SUBJECT.
- STALE_EVENT: a specific past event (a summit, a ceremony, a visit) that the story is not about.
- GENERIC_OK: a neutral illustration whose frame shows the story's OWN country, city, institution or sector itself: the named capital's skyline, the named company's building, the sector's own object (a refinery, a tanker, a pipeline, a pumpjack, a trading floor, a port crane, a factory line, a branch of the named bank). For a story about the WORLD market (oil prices, global trade, shipping, a world body such as the WTO or the IMF) an anonymous scene of the sector taken anywhere is acceptable — a refinery, a tanker at sea, a container port, a trading floor — when nothing in the frame identifies the country and the caption names no place.
- RIGHT: the story's own people, place or event.
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

/** Chooser plus second lock; a refused photo is excluded and the story goes on without it. */
async function chooseVerified({ list, inlined, draft, story, log, relaxed, exclude }) {
  const image = await judge({ list, inlined, draft, story, log, relaxed });
  if (!image) return null;
  const chosen = list.find((c) => c.url === image.url) ?? {};
  let verified = false;
  try {
    verified = await verifyImage({ image: { ...chosen, title: chosen.title ?? image.title, query: chosen.query, alt: image.alt }, draft, story, log });
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
  return image;
}

const excluded = (exclude, c) => exclude.has(c.url) || exclude.has(`title:${c.title}`);

export async function pickImage({ draft, story, log, fallback = true, exclude = new Set() }) {
  const specific = (draft.imageQueries?.length ? draft.imageQueries : []).slice(0, 3);
  if (specific.length) {
    const candidates = await collect(specific, log, { exclude });
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
  try {
    queries = await genericQueries({ draft, story, log });
  } catch (error) {
    log(`image: generic queries failed (${error.message.split("\n")[0]})`);
  }
  if (!queries.length) return null;
  log(`image: fallback queries: ${queries.join(" | ")}`);
  const candidates = await collect(queries, log, { perQuery: 8, max: 12, exclude, people: "none" });
  if (!candidates.length) {
    log("image: no candidates for the fallback queries");
    return null;
  }
  const s = await shortlist(candidates, log);
  if (!s.list.length) return null;
  const image = await chooseVerified({ ...s, draft, story, log, relaxed: true, exclude });
  if (image) return image;
  // One more try with the refused photo excluded.
  const rest = candidates.filter((c) => !excluded(exclude, c));
  if (rest.length) {
    const again = await shortlist(rest, log);
    if (again.list.length) {
      const second = await chooseVerified({ ...again, draft, story, log, relaxed: true, exclude });
      if (second) return second;
    }
  }
  return lastResort({ draft, story, log, exclude });
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

Name, in English, the capital or main financial city of the ONE country this story is about (for example "Riyadh", "Cairo", "Frankfurt"); null if the story is about the world, a region or several countries at once. Separately name the institution at the centre of the story if it is a world body, central bank, ministry or company with a known headquarters (for example "World Trade Organization", "European Central Bank", "Saudi Aramco"); null otherwise.
Return JSON: {"city": "<name or null>", "institution": "<name or null>"}`,
      temperature: 0,
      maxTokens: 1000,
      timeoutMs: 60000,
      log,
    });
    const clean = (v) => (typeof v === "string" && v.trim().length > 1 && v.trim().toLowerCase() !== "null" ? v.trim() : null);
    const city = clean(data?.city);
    const institution = clean(data?.institution);
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
  const candidates = await collect(queries, log, { perQuery: 8, max: 12, exclude, people: "none" });
  // Two chances, the refused photo excluded in between: the vision model tends to repeat a choice.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rest = candidates.filter((c) => !excluded(exclude, c));
    if (!rest.length) return null;
    const s = await shortlist(rest, log);
    if (!s.list.length) return null;
    const image = await chooseVerified({ ...s, draft, story, log, relaxed: true, exclude });
    if (image) return image;
  }
  return null;
}
