import { attributionLine, searchCommons } from "./commons.mjs";
import { chat } from "./llm.mjs";
import { USER_AGENT, fetchWithTimeout } from "./util.mjs";

function smallThumb(url) {
  return String(url).replace(/\/1280px-/, "/640px-");
}

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
 * Finds a licensed editorial photo for the article, verified by a vision model.
 * Returns null when nothing suitable exists (the site then renders generated cover art).
 */
export async function pickImage({ draft, story, log }) {
  const queries = draft.imageQueries?.length ? draft.imageQueries : [];
  if (!queries.length) return null;
  const seen = new Set();
  const candidates = [];
  for (const query of queries.slice(0, 3)) {
    let results = await searchCommons(query, { limit: 6, log });
    for (const alternative of simplerQueries(query)) {
      if (results.length) break;
      results = await searchCommons(alternative, { limit: 6, log });
    }
    for (const image of results) {
      if (seen.has(image.url)) continue;
      seen.add(image.url);
      candidates.push({ ...image, query, score: recencyScore(image) + (image.width >= 1600 ? 1 : 0) });
    }
    if (candidates.length >= 8) break;
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const shortlist = [];
  const inlined = [];
  for (const candidate of candidates) {
    if (shortlist.length >= 4) break;
    const dataUrl = await inlineImage(candidate.url, log);
    if (!dataUrl) continue;
    shortlist.push(candidate);
    inlined.push(dataUrl);
  }
  if (!shortlist.length) return null;

  const user = `We are illustrating an Arabic economics article.
Headline: ${draft.title}
Summary: ${draft.subtitle}
Editor's angle: ${story?.angle ?? ""}

Candidate photographs (numbered in the same order as the attached images):
${shortlist.map((c, i) => `${i + 1}. "${c.title}" — ${c.description || "no description"} — dated ${c.date || "unknown"} — search: ${c.query}`).join("\n")}

Choose the single best photograph for this article, or none. Requirements: clearly relevant to the story's subject (institution, place, industry, product); looks like a contemporary editorial news photo; landscape composition; no visible text overlays, watermarks, logos as the main subject, charts, maps, or historical/archival look; no close-up of a private individual; nothing embarrassing or misleading if paired with the headline.
Return JSON: {"choice": <1-${shortlist.length} or 0 for none>, "alt": "<Arabic alt text of 8-16 words describing what the chosen photo shows>", "reason": "<short English reason>"}`;

  try {
    const { data, model } = await chat({
      role: "vision",
      system: "You are a photo editor at an Arabic economics publication. Reply with one JSON object only.",
      user,
      images: inlined,
      temperature: 0.1,
      maxTokens: 500,
      timeoutMs: 120000,
      log,
      validate: (d) => {
        if (!d || typeof d.choice !== "number") throw new Error("choice missing");
      },
    });
    const index = Math.round(data.choice) - 1;
    if (index < 0 || index >= shortlist.length) {
      log(`image: vision rejected all candidates (${data.reason ?? ""})`);
      return null;
    }
    const chosen = shortlist[index];
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
    log(`image: vision failed (${error.message.split("\n")[0]}); skipping photo`);
    return null;
  }
}
