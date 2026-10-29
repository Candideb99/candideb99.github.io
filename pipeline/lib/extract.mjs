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
const BLOCK_NOTICE = /automated scraping|programmatic access|complete the captcha|verify (?:that )?you are (?:a )?human|unusual traffic from your|are you a robot|checking your browser before|enable javascript and cookies to continue|request unsuccessful\. incapsula/i;

function paragraphsFallback(html) {
  return [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter((t) => t.length > 60 && !BOILERPLATE.test(t))
    .join("\n\n");
}

/**
 * The publisher's own word that a page is for subscribers: schema.org `isAccessibleForFree` set to false in its
 * structured data or its microdata. Such a page counts as paywalled, its feed's headline and summary and never its text
 * (the owner, 2026-10-25, with the Turkish, Iranian and Indian press: Expansión, NZZ and The Hindu serve a marked
 * article's whole text to a reader that does not log in, and a 716-character SPIEGEL+ teaser passed the 400-character
 * floor below).
 */
export function subscribersOnly(html) {
  return /"isAccessibleForFree"\s*:\s*"?false"?/i.test(html)
    || /<[^>]*\bitemprop=["']isAccessibleForFree["'][^>]*\bcontent=["']false["']/i.test(html)
    || /<[^>]*\bcontent=["']false["'][^>]*\bitemprop=["']isAccessibleForFree["']/i.test(html);
}

function metaContent(html, name) {
  const m =
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, "i"));
  return m ? stripHtml(m[1]) : "";
}

/**
 * Fetches a public article page and extracts its readable text.
 * Links come only from the readable article, never the page's navigation.
 */
export async function extractArticle(url, { maxChars = 9000, log = () => {}, allowUrl = null } = {}) {
  const result = { ok: false, text: "", title: "", ogImage: "", lang: "", links: [], publishedAt: null, status: 0, reason: "" };
  try {
    if (allowUrl && !allowUrl(url)) return { ...result, reason: "url-not-allowed" };
    if (!(await allowedByRobots(url))) {
      result.reason = "robots-disallow";
      return result;
    }
    let response;
    let current = url;
    for (let redirects = 0; redirects <= 4; redirects++) {
      response = await fetchWithTimeout(
      current,
      {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en,ar;q=0.9,de;q=0.7",
        },
        redirect: allowUrl ? "manual" : "follow",
      },
      25000,
      );
      if (!allowUrl || ![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) break;
      const next = new URL(location, current).href;
      if (response.body) await response.body.cancel();
      if (redirects === 4 || !allowUrl(next) || !(await allowedByRobots(next))) {
        return { ...result, reason: "redirect-not-allowed" };
      }
      current = next;
    }
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
    Object.assign(result, readArticleHtml(html, response.url || current, { maxChars, log }));
    return result;
  } catch (error) {
    result.reason = error.name === "AbortError" ? "timeout" : error.message;
    return result;
  }
}

/**
 * A page's photographs with what the page itself says about them: its lead image (og:image and its alt), the images
 * its structured data describes (caption, credit, copyright holder, author) and its <figure> photographs and captioned
 * images. The picture desk takes a handout only when the page credits an official body or the story's company
 * (lib/images.mjs, handoutTier(); the owner, 2026-10-18: "yes, use handouts credited to official sources"); the
 * outlet's own photographs and the agencies' are never taken. Logos, icons and drawings are left out here.
 */
export function photosOf(html, url, document = null) {
  const found = new Map();
  const absolute = (u) => {
    try {
      return new URL(String(u ?? "").trim(), url).href;
    } catch {
      return "";
    }
  };
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const add = (u, info = {}) => {
    const href = absolute(u);
    if (!/^https?:\/\//.test(href) || /\.(?:svg|gif)(?:[?#]|$)/i.test(href) || /logo|icon|sprite|avatar|placeholder|blank|banner|\/ads?\//i.test(href)) return;
    const key = href.split(/[?#]/)[0];
    const photo = found.get(key) ?? { url: href, caption: "", credit: "", width: null, height: null };
    for (const k of ["caption", "credit"]) {
      const v = clean(info[k]);
      if (v && !photo[k].includes(v)) photo[k] = [photo[k], v].filter(Boolean).join(" | ").slice(0, 400);
    }
    photo.width ??= Number(info.width) || null;
    photo.height ??= Number(info.height) || null;
    found.set(key, photo);
  };
  const og = metaContent(html, "og:image");
  if (og) add(og, { caption: metaContent(html, "og:image:alt"), width: metaContent(html, "og:image:width"), height: metaContent(html, "og:image:height") });
  const name = (x) => (typeof x === "string" ? x : Array.isArray(x) ? x.map(name).join(", ") : x?.name ?? "");
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const visit = (node, depth = 0) => {
      if (!node || typeof node !== "object" || depth > 6) return;
      if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
      if ([].concat(node["@type"] ?? []).includes("ImageObject")) {
        add(node.contentUrl ?? node.url, { caption: node.caption ?? node.description, credit: [node.creditText, name(node.copyrightHolder), name(node.author)].filter(Boolean).join(" | "), width: node.width, height: node.height });
      }
      for (const v of Object.values(node)) if (v && typeof v === "object") visit(v, depth + 1);
    };
    visit(data);
  }
  try {
    const doc = document ?? parseHTML(html).document;
    const src = (img) => img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original") || img.getAttribute("src") || "";
    for (const figure of [...doc.querySelectorAll("figure")].slice(0, 12)) {
      const img = figure.querySelector("img");
      if (img) add(src(img), { caption: [figure.querySelector("figcaption")?.textContent, img.getAttribute("alt"), img.getAttribute("title")].filter(Boolean).join(" | "), width: img.getAttribute("width"), height: img.getAttribute("height") });
    }
    // Sites without <figure>: an image beside an element whose class names a caption or a credit.
    for (const el of [...doc.querySelectorAll("[class*='caption'], [class*='Caption'], [class*='credit'], [class*='Credit']")].slice(0, 12)) {
      const img = el.parentElement?.querySelector("img");
      if (img) add(src(img), { caption: el.textContent.slice(0, 300) });
    }
  } catch {
    /* the structured data and the og:image stand on their own */
  }
  // Pages built from embedded data (CNBC عربية keeps «الصورة من وزارة البترول المصرية» in a JSON blob beside the image's
  // address, 2026-10-18): a credit phrase anywhere in the raw page goes to the nearest image address around it.
  // English credit words are matched as a caption writes them (capitalised, a space after the colon), never the
  // attribute names of the page's own markup (og:image:width).
  const hints = [...html.matchAll(/(?:الصورة\s*من|صورة\s*من|مصدر\s*الصورة|الصورة\s*:|(?:Photo|PHOTO|Image|IMAGE)(?: [Cc]redit)?:\s+|[Cc]ourtesy of\s|\/\s*(?:Handout|HANDOUT)|(?:Handout|HANDOUT)(?: photo| image)?\s*(?:from|by|:))/g)].slice(0, 8);
  for (const hint of hints) {
    const start = Math.max(0, hint.index - 900);
    const window = html.slice(start, hint.index + 900);
    let best = null;
    for (const m of window.matchAll(/https?:\/\/[^"'\s<>()\\]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s<>\\]*)?/gi)) {
      const distance = Math.abs(start + m.index - hint.index);
      if (!best || distance < best.distance) best = { url: m[0], distance };
    }
    if (!best) continue;
    const phrase = stripHtml(html.slice(hint.index, hint.index + 160)).split(/["{}<>\n|]|\\u0022/)[0];
    add(best.url, { credit: phrase.slice(0, 120) });
  }
  return [...found.values()].slice(0, 8);
}

/**
 * A page that carries the next articles below its own (infinite scroll). Asharq Al-Awsat marks its own body
 * `entry-content first-article-node` and appends three more stories in plain `entry-content` blocks, each in its own
 * `printable-area`; Readability took the longest, another story, under the page's own title (2026-10-29: its pages on
 * the Fed's hold, the ECB's hold and US growth all read as one IMF story on Iraq and Egypt, and the GDP story printed
 * the IMF's comment on Warsh as Asharq Al-Awsat's report of that day; of 53 of its pages kept as evidence since
 * September, 12 shared almost no word with their own headline). Where the page marks its first article, every block
 * that repeats one of the marked article's containers without holding it is another story, and goes.
 */
export function ownArticleOnly(document) {
  const own = document.querySelector("[class*='first-article']");
  if (!own) return 0;
  let removed = 0;
  for (let level = own; level && level.tagName !== "BODY"; level = level.parentElement) {
    const cls = level.getAttribute("class");
    if (!cls || /["\\]/.test(cls)) continue;
    const twins = [...document.querySelectorAll(`[class="${cls}"]`)].filter((el) => el !== level && !el.contains(own) && !own.contains(el));
    for (const twin of twins) twin.remove();
    removed += twins.length;
  }
  // The block marked first may share no class with its followers (`entry-content first-article-node` against
  // `entry-content`): its plain sister class is matched too.
  for (const cls of [...own.classList].filter((c) => !/first-article/.test(c))) {
    for (const twin of [...document.getElementsByClassName(cls)].filter((el) => el !== own && !el.contains(own) && !own.contains(el))) {
      twin.remove();
      removed++;
    }
  }
  return removed;
}

/** Pure extraction, shared with offline evidence tests. No inferred publication date. */
export function readArticleHtml(html, url, { maxChars = 9000, log = () => {} } = {}) {
    // Parsed once and stripped of any appended stories before the text, the photographs or the fallback read it.
    let document = null;
    let pageHtml = html;
    try {
      ({ document } = parseHTML(html));
      if (ownArticleOnly(document)) pageHtml = document.toString();
    } catch {
      document = null;
    }
    const result = { ok: false, text: "", title: "", ogImage: metaContent(html, "og:image"),
      photos: photosOf(html, url, document),
      lang: (html.match(/<html[^>]+lang=["']([a-zA-Z-]+)["']/i)?.[1] ?? "").toLowerCase(),
      links: [], publishedAt: null, reason: "" };
    let text = "";
    let title = "";
    try {
      const article = new Readability(document ?? parseHTML(html).document, { charThreshold: 300 }).parse();
      const published = article?.publishedTime || metaContent(html, "article:published_time") || metaContent(html, "datePublished");
      if (published && Number.isFinite(Date.parse(published))) result.publishedAt = new Date(published).toISOString();
      if (article?.textContent) {
        text = article.textContent.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        title = article.title ?? "";
        const body = parseHTML(`<html><body>${article.content}</body></html>`).document;
        for (const node of body.querySelectorAll("nav, aside, footer, header, script, style, [class*='related'], [class*='share']")) node.remove();
        const seen = new Set();
        for (const anchor of body.querySelectorAll("p a[href]")) {
          try {
            const href = new URL(anchor.getAttribute("href"), url).href;
            const label = anchor.textContent.trim();
            const context = anchor.closest("p").textContent.trim().slice(0, 600);
            if (seen.has(href) || /^(read more|related|اقرأ أيضا|اقرأ أيضاً)/i.test(context)) continue;
            if (!/^https?:/.test(href)) continue;
            seen.add(href);
            result.links.push({ url: href, label: label.slice(0, 180), context });
            if (result.links.length >= 40) break;
          } catch { /* An invalid link is not evidence. */ }
        }
      }
    } catch (error) {
      log(`readability failed for ${url}: ${error.message}`);
    }
    if (text.length < 400) {
      const fallback = paragraphsFallback(pageHtml);
      if (fallback.length > text.length) text = fallback;
    }
    if (!title) title = metaContent(html, "og:title") || stripHtml(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    result.title = title;
    if (subscribersOnly(html)) {
      result.reason = "subscribers-only";
      return result;
    }
    // A page that says it refuses robots is not an article, however long its notice (2026-10-29: the Federal Register
    // answers «Due to aggressive automated scraping of FederalRegister.gov and eCFR.gov, programmatic access…» in 825
    // characters, and it was read as a source). Only a short page is judged so: a report about captchas is not a wall.
    if (text.length < 2000 && BLOCK_NOTICE.test(text)) {
      result.reason = "blocked";
      return result;
    }
    result.text = text.slice(0, maxChars);
    result.ok = result.text.length >= 400;
    if (!result.ok) result.reason = "thin";
    return result;
}
