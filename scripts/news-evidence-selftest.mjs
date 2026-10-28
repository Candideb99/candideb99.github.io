#!/usr/bin/env node
import assert from "node:assert/strict";
import { readArticleHtml, extractArticle } from "../pipeline/lib/extract.mjs";
import { collectNewsEvidence, eventSourcesOf, independentOutletCount, needsRatingsReference, officialDocument } from "../pipeline/lib/news-evidence.mjs";
import { checkSourcesOf } from "../pipeline/lib/precheck.mjs";
import { reportingOrigin } from "../pipeline/lib/outlets.mjs";

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
const distinctReportText = (url) => `${paragraph} Report-specific evidence marker ${url}.`;
const syndicatedBody = Array.from({ length: 14 }, (_, n) =>
  `In section ${n + 1}, officials described how the sanctions measure changes the treatment of Russian oil purchases while leaving existing restrictions intact. The report explains the distinction between the current waiver and older rules, then identifies which agencies must publish implementation guidance before the next review date.`,
).join(" ");
const independentBody = [
  "The parliamentary committee opened a public hearing after regional refiners asked for clarification on the measure's licensing procedure.",
  "Several shipping firms said they were reviewing contract language and insurance terms, while declining to estimate any change in cargo volumes.",
  "The central bank's latest bulletin separately tracks energy imports and makes no forecast about this policy's effect on prices.",
  "A trade association told members that compliance teams should continue checking existing restrictions until regulators issue detailed guidance.",
  "The committee plans to publish written submissions before a second hearing, which is scheduled for the following month.",
  "Analysts said the public documents did not specify how many firms would qualify or how applications would be assessed.",
  "The ministry said its next update would explain reporting duties and the evidence companies must provide with an application.",
  "The debate has focused on administrative timing, with lawmakers asking whether the review process can be completed before contracts renew.",
].join(" ");
assert.equal(independentOutletCount([
  item(1, { text: syndicatedBody }),
  item(2, { sourceNameEn: "Another Publisher", text: syndicatedBody }),
]), 1, "identical stories under different mastheads are one reporting origin");
assert.equal(independentOutletCount([
  item(1, { text: syndicatedBody }),
  item(2, { sourceNameEn: "Another Publisher", text: `A different headline and short introduction. ${syndicatedBody} An outlet-specific closing note.` }),
]), 1, "a long near-copy does not count as independent corroboration");
assert.equal(independentOutletCount([
  item(1, { text: syndicatedBody }),
  item(2, { sourceNameEn: "Another Publisher", text: independentBody }),
]), 2, "materially different reporting on the same event remains independent");
assert.equal(independentOutletCount([
  item(1, { sourceNameEn: "Same Publisher", text: syndicatedBody }),
  item(2, { sourceNameEn: "Same Publisher", text: independentBody }),
]), 1, "separate feeds from one publisher do not become separate outlets");
assert.equal(independentOutletCount([
  item(1, { text: "The ministry announced a new export licensing rule today." }),
  item(2, { sourceNameEn: "Another Publisher", text: "A committee will question officials about the export licensing rule next month." }),
]), 2, "short, distinct reporting is not collapsed by the near-copy check");
assert.equal(independentOutletCount([
  item(1, { text: syndicatedBody }),
  item(2, { sourceNameEn: "Another Publisher", kind: "official", reliability: 3, text: syndicatedBody }),
]), 1, "official sources do not count as non-official reporting origins");
// An outlet running another's reporting under licence is that outlet (sources.json `origin`, 2026-10-29).
assert.equal(independentOutletCount([
  item(1, { sourceName: "بلومبرغ", sourceNameEn: "Bloomberg", text: "", summary: "Saudi crude exports near wartime high" }),
  item(2, { sourceName: "الشرق بلومبرغ", sourceNameEn: "Asharq Business", text: independentBody }),
]), 1, "Asharq Business is Bloomberg's reporting, never a second outlet beside it");
assert.equal(independentOutletCount([
  item(1, { sourceName: "بلومبرغ إتش تي", sourceNameEn: "Bloomberg HT", text: syndicatedBody }),
  item(2, { sourceName: "الشرق بلومبرغ", sourceNameEn: "Asharq Business", text: independentBody }),
]), 1, "two licensees of one outlet are one reporting origin");
assert.equal(independentOutletCount([
  item(1, { sourceName: "الشرق بلومبرغ", sourceNameEn: "Asharq Business", text: syndicatedBody }),
  item(2, { sourceName: "الشرق الأوسط", sourceNameEn: "Asharq Al-Awsat", text: independentBody }),
]), 2, "Asharq Business beside an independent outlet still counts");
assert.equal(reportingOrigin({ name: "الشرق بلومبرغ", nameEn: "Asharq Business" }), "Bloomberg", "a story's stored source resolves by name");
assert.equal(reportingOrigin({ sourceNameEn: "Asharq Al-Awsat" }), "Asharq Al-Awsat", "an outlet without `origin` is itself");
const calls = [];
const fake = async (url, options) => {
  calls.push(url);
  if (url === primary) {
    if (options.allowUrl) assert.equal(options.allowUrl("https://evil.test/a/b"), false);
    return { ok: true, title: "Implementing Russia sanctions waiver", text: paragraph.repeat(4), lang: "en", publishedAt: "2026-10-16T18:00:00Z" };
  }
  return { ...extracted, text: distinctReportText(url) };
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

const sameReport = await collectNewsEvidence({ ids: [6, 7] }, [item(6), item(7, { sourceNameEn: "Another Publisher" })], {
  extract: async () => ({ ok: true, title: "Russia sanctions waiver", text: syndicatedBody, links: [] }),
});
assert.equal(sameReport.sources.length, 1, "the writer receives one copy of a repeated report");
assert.equal(sameReport.items.length, 2, "deduplication retains the selected-item provenance");
const nearCopyReport = await collectNewsEvidence({ ids: [6, 7] }, [item(6), item(7, { sourceNameEn: "Another Publisher" })], {
  extract: async (url) => ({ ok: true, title: "Russia sanctions waiver", text: url.endsWith("report6") ? syndicatedBody : `A distinct headline and introduction. ${syndicatedBody} A short outlet note.`, links: [] }),
});
assert.equal(nearCopyReport.sources.length, 1, "a syndicated near-copy is not sent to the writer twice");
const summaryCopy = await collectNewsEvidence({ ids: [6, 7] }, [item(6), item(7, { paywalled: true, summary: syndicatedBody })], {
  extract: async () => ({ ok: true, title: "Russia sanctions waiver", text: syndicatedBody, links: [] }),
});
assert.equal(summaryCopy.sources.length, 1, "an unfetched source with a repeated feed summary is also removed");
const officialCopy = await collectNewsEvidence({ ids: [6, 7] }, [item(6), item(7, { kind: "official", reliability: 3 })], {
  extract: async () => ({ ok: true, title: "Russia sanctions waiver", text: syndicatedBody, links: [] }),
});
assert.equal(officialCopy.sources.length, 2, "a primary document remains available even when its body matches reporting");

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
assert.equal(withReference.sources.length, 2);
assert.equal(withReference.sources.at(-1).kind, "reference");
assert.equal(eventSourcesOf(withReference.sources).length, 1, "definitions do not corroborate today's event");
assert.equal(eventSourcesOf([{ kind: "reference", text: "full definition body" }]).length, 0, "a reference alone cannot supply an event body");
const referenceDown = await collectNewsEvidence({ ids: [1, 2] }, ratings, { extract: async (url) => url === referenceUrl ? { ok: false, reason: "offline" } : { ...extracted, text: distinctReportText(url), links: [] } });
assert.equal(referenceDown.sources.length, 2, "an unavailable glossary keeps the distinct original reports");
console.log("News evidence: body links, exact hosts, bounded enrichment, provenance, dates, fail-soft fetching, redirects/robots and definition/event separation pass.");
