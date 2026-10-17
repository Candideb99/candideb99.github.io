#!/usr/bin/env node
import assert from "node:assert/strict";
import { readArticleHtml, extractArticle } from "../pipeline/lib/extract.mjs";
import { collectNewsEvidence, eventSourcesOf, needsRatingsReference, officialDocument } from "../pipeline/lib/news-evidence.mjs";
import { checkSourcesOf } from "../pipeline/lib/precheck.mjs";

const primary = "https://www.whitehouse.gov/presidential-actions/2026/10/implementing-russia-sanctions/";
const unrelated = "https://www.whitehouse.gov/briefings/2026/10/housing-programme/";
const paragraph = "The sanctions waiver changes the treatment of Russian oil purchases while leaving existing restrictions intact. The report explains the distinction between existing measures and the new legislation, and attributes the policy's stated purpose to its authors.";
const html = `<html lang="en"><head><title>Russia sanctions waiver</title>
  <meta property="article:published_time" content="2026-10-16T18:00:00Z">
  <meta property="article:modified_time" content="2026-10-17T12:00:00Z"></head>
  <body><nav><a href="${unrelated}">Other government news</a></nav><article><h1>Russia sanctions waiver</h1>
  <p>${paragraph} The <a href="${primary}">Russia sanctions order</a> sets out the provisions.</p>
  <p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p>
  <aside><p>Related: <a href="${unrelated}">housing programme</a></p></aside></article></body></html>`;
const extracted = readArticleHtml(html, "https://example.com/report");
assert.equal(extracted.ok, true);
assert.equal(extracted.publishedAt, "2026-10-16T18:00:00.000Z");
assert.deepEqual(extracted.links.map((link) => link.url), [primary]);
assert.equal(readArticleHtml(html.replace(/<meta property="article:published_time"[^>]+>/, ""), "https://example.com/report").publishedAt, null, "modified time cannot become publication time");
for (const url of ["https://whitehouse.gov.evil.test/actions/waiver", "http://whitehouse.gov/actions/waiver", "https://user:pass@whitehouse.gov/actions/waiver", "https://whitehouse.gov:444/actions/waiver", "https://127.0.0.1/actions/waiver", "https://whitehouse.gov/", "https://whitehouse.gov/actions/index.html", "https://whitehouse.gov/search/waiver", "https://whitehouse.gov/actions/order.pdf"]) assert.equal(officialDocument(url), null, url);
assert.equal(officialDocument(primary).nameEn, "White House");

const item = (id, extra = {}) => ({ id, sourceId: `feed${id}`, sourceName: `مصدر ${id}`, sourceNameEn: `Source ${id}`, title: "Russia sanctions waiver", url: `https://example.com/report${id}`, lang: "en", reliability: 2, kind: "news", summary: "Feed summary", publishedAt: "2026-10-17T12:00:00Z", ...extra });
const candidates = [1, 2, 3, 4, 5].map((n) => item(n));
const calls = [];
const fake = async (url, options) => {
  calls.push(url);
  if (url === primary) {
    if (options.allowUrl) assert.equal(options.allowUrl("https://evil.test/a/b"), false);
    return { ok: true, title: "Implementing Russia sanctions waiver", text: paragraph.repeat(4), lang: "en", publishedAt: "2026-10-16T18:00:00Z" };
  }
  return extracted;
};
const result = await collectNewsEvidence({ ids: [1, 2, 3, 4, 5] }, candidates, { extract: fake, now: () => "2026-10-17T20:00:00Z" });
assert.equal(result.sources.length, 5);
assert.equal(calls.length, 4, "three report bodies and one linked original, with no duplicate fetch");
assert.equal(result.sources[3].text, "");
assert.equal(result.sources[4].kind, "official");
assert.equal(result.sources[4].reliability, 3);
assert.equal(result.sources[4].discoveredFrom, candidates[0].url);
assert.equal(result.sources[4].publishedAt, "2026-10-16T18:00:00Z");
assert.equal(checkSourcesOf(result.sources).at(-1).discoveredFrom, candidates[0].url);

const official = await collectNewsEvidence({ ids: [1] }, [item(1, { kind: "official", reliability: 3, url: primary })], { extract: fake });
assert.equal(official.sources.length, 1);
assert.equal(official.sources[0].kind, "official", "retain the official-source exception's metadata");
assert.equal(official.sources[0].reliability, 3);
const noDuplicate = await collectNewsEvidence({ ids: [1, 2] }, [item(1), item(2, { url: primary, kind: "official", reliability: 3 })], { extract: fake });
assert.equal(noDuplicate.sources.length, 2);

for (const failure of ["network", "thin", "robots-disallow", "unrelated"]) {
  const failed = await collectNewsEvidence({ ids: [1] }, candidates, { extract: async (url) => {
    if (url !== primary) return extracted;
    if (failure === "network") throw new Error("offline");
    return failure === "unrelated" ? { ok: true, title: "Housing programme expands", text: paragraph.repeat(4) } : { ok: false, reason: failure };
  } });
  assert.equal(failed.sources.length, 1, failure);
  assert.equal(failed.sources[0].text, extracted.text, "enrichment failure preserves original evidence");
}
const unknownDate = await collectNewsEvidence({ ids: [1] }, candidates, { extract: async (url) => url === primary ? { ok: true, title: "Russia sanctions waiver", text: paragraph.repeat(4) } : extracted });
assert.equal(unknownDate.sources.at(-1).publishedAt, null);
const paid = await collectNewsEvidence({ ids: [1] }, [item(1, { paywalled: true })], { extract: async () => { throw new Error("paywall fetched"); } });
assert.equal(paid.sources[0].text, "");

// Real fetch plumbing with scripted HTTP responses: robots and every redirect remain checked.
const originalFetch = globalThis.fetch;
const fetchedUrls = [];
try {
  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url));
    if (String(url).endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n");
    return new Response(null, { status: 302, headers: { location: "https://evil.test/private/document" } });
  };
  const redirect = await extractArticle(primary, { allowUrl: (url) => Boolean(officialDocument(url)) });
  assert.equal(redirect.reason, "redirect-not-allowed");
  assert.equal(fetchedUrls.some((url) => url.includes("evil.test")), false);
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /news/\n");
    throw new Error("robots-disallowed page was fetched");
  };
  const robots = await extractArticle("https://www.bankofengland.co.uk/news/2026/decision", { allowUrl: (url) => Boolean(officialDocument(url)) });
  assert.equal(robots.reason, "robots-disallow");
} finally { globalThis.fetch = originalFetch; }
const ratings = [item(1, { title: "Moody's raises Egypt credit rating" }), item(2, { title: "Egypt debt financing after Moody's rating action" })];
assert.equal(needsRatingsReference({}, ratings), true);
assert.equal(needsRatingsReference({ headlineHint: "موديز ترفع تصنيف مصر" }, []), true);
assert.equal(needsRatingsReference({ headlineHint: "Oil prices rise" }, []), false);
const referenceUrl = "https://www.fidelity.com/learning-center/investment-products/fixed-income-bonds/bond-ratings";
const withReference = await collectNewsEvidence({ ids: [1, 2] }, ratings, { extract: async (url, options) => {
  if (url !== referenceUrl) return { ...extracted, links: [] };
  assert.equal(options.allowUrl("https://www.fidelity.com/login"), false);
  return { ok: true, title: "Bond Ratings", text: "Baa3 and above are investment-grade. B3 is in the non-investment-grade scale." };
} });
assert.equal(withReference.sources.length, 3);
assert.equal(withReference.sources.at(-1).kind, "reference");
assert.equal(eventSourcesOf(withReference.sources).length, 2, "definitions do not corroborate today's event");
assert.equal(eventSourcesOf([{ kind: "reference", text: "full definition body" }]).length, 0, "a reference alone cannot supply an event body");
const referenceDown = await collectNewsEvidence({ ids: [1, 2] }, ratings, { extract: async (url) => url === referenceUrl ? { ok: false, reason: "offline" } : { ...extracted, links: [] } });
assert.equal(referenceDown.sources.length, 2, "an unavailable glossary keeps the original reports");
console.log("News evidence: body links, exact hosts, bounded enrichment, provenance, dates, fail-soft fetching, redirects/robots and definition/event separation pass.");
