import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { USER_AGENT, fetchWithTimeout, stripHtml } from "./util.mjs";

const robotsCache = new Map();

/** Minimal robots.txt check for our user agent (and *). Fails open on network errors. */
export async function allowedByRobots(url) {
  let origin;
  let pathname;
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    pathname = parsed.pathname + parsed.search;
  } catch {
    return false;
  }
  if (!robotsCache.has(origin)) {
    robotsCache.set(
      origin,
      (async () => {
        try {
          const response = await fetchWithTimeout(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT } }, 10000);
          if (!response.ok) return [];
          const text = await response.text();
          const groups = [];
          let current = null;
          for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.replace(/#.*/, "").trim();
            if (!line) continue;
            const [key, ...rest] = line.split(":");
            const value = rest.join(":").trim();
            const field = key.trim().toLowerCase();
            if (field === "user-agent") {
              if (!current || current.rules.length) current = { agents: [], rules: [] };
              current.agents.push(value.toLowerCase());
              if (!groups.includes(current)) groups.push(current);
            } else if ((field === "disallow" || field === "allow") && current) {
              current.rules.push({ allow: field === "allow", path: value });
            }
          }
          return groups;
        } catch {
          return [];
        }
      })(),
    );
  }
  const groups = await robotsCache.get(origin);
  const ours = groups.find((g) => g.agents.some((a) => a.includes("khazendar")));
  const star = groups.find((g) => g.agents.includes("*"));
  const group = ours ?? star;
  if (!group) return true;
  let verdict = true;
  let longest = -1;
  for (const rule of group.rules) {
    if (!rule.path) continue;
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp(`^${pattern}`);
    if (regex.test(pathname) && rule.path.length > longest) {
      longest = rule.path.length;
      verdict = rule.allow;
    }
  }
  return verdict;
}

const BOILERPLATE = /(cookie|subscribe|newsletter|sign up|advertisement|read more:|related:|follow us|share this|©|all rights reserved)/i;

function paragraphsFallback(html) {
  return [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter((t) => t.length > 60 && !BOILERPLATE.test(t))
    .join("\n\n");
}

function metaContent(html, name) {
  const m =
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, "i"));
  return m ? stripHtml(m[1]) : "";
}

/**
 * Fetches a public article page and extracts its readable text.
 * Returns { ok, text, title, ogImage, lang, status, reason }.
 */
export async function extractArticle(url, { maxChars = 9000, log = () => {} } = {}) {
  const result = { ok: false, text: "", title: "", ogImage: "", lang: "", status: 0, reason: "" };
  try {
    if (!(await allowedByRobots(url))) {
      result.reason = "robots-disallow";
      return result;
    }
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en,ar;q=0.9,de;q=0.7",
        },
        redirect: "follow",
      },
      25000,
    );
    result.status = response.status;
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      result.reason = `http-${response.status}`;
      return result;
    }
    if (!/html|xml/i.test(type)) {
      result.reason = `content-type ${type}`;
      return result;
    }
    const html = (await response.text()).slice(0, 3_000_000);
    result.ogImage = metaContent(html, "og:image");
    result.lang = (html.match(/<html[^>]+lang=["']([a-zA-Z-]+)["']/i)?.[1] ?? "").toLowerCase();
    let text = "";
    let title = "";
    try {
      const { document } = parseHTML(html);
      const article = new Readability(document, { charThreshold: 300 }).parse();
      if (article?.textContent) {
        text = article.textContent.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        title = article.title ?? "";
      }
    } catch (error) {
      log(`readability failed for ${url}: ${error.message}`);
    }
    if (text.length < 400) {
      const fallback = paragraphsFallback(html);
      if (fallback.length > text.length) text = fallback;
    }
    if (!title) title = metaContent(html, "og:title") || stripHtml(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    result.title = title;
    result.text = text.slice(0, maxChars);
    result.ok = result.text.length >= 400;
    if (!result.ok) result.reason = "thin";
    return result;
  } catch (error) {
    result.reason = error.name === "AbortError" ? "timeout" : error.message;
    return result;
  }
}
