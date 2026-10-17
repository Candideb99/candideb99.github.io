import { extractArticle } from "./extract.mjs";
import { canonicalUrl, fingerprint, hoursSince, isoNow } from "./util.mjs";

// Only cited public documents on these exact institutional hosts are followed.
// This is an evidence supplement, not a crawler or a replacement for the feed registry.
const PUBLISHERS = new Map([
  ["whitehouse.gov", ["البيت الأبيض", "White House"]],
  ["home.treasury.gov", ["وزارة الخزانة الأميركية", "US Treasury"]],
  ["federalregister.gov", ["السجل الفيدرالي الأميركي", "Federal Register"]],
  ["federalreserve.gov", ["الاحتياطي الفيدرالي", "Federal Reserve"]],
  ["ecb.europa.eu", ["البنك المركزي الأوروبي", "European Central Bank"]],
  ["bankofengland.co.uk", ["بنك إنجلترا", "Bank of England"]],
  ["eia.gov", ["إدارة معلومات الطاقة الأميركية", "US Energy Information Administration"]],
  ["ec.europa.eu", ["المفوضية الأوروبية", "European Commission"]],
  ["sec.gov", ["هيئة الأوراق المالية الأميركية", "US Securities and Exchange Commission"]],
  ["imf.org", ["صندوق النقد الدولي", "International Monetary Fund"]],
  ["cbe.org.eg", ["البنك المركزي المصري", "Central Bank of Egypt"]],
  ["sama.gov.sa", ["البنك المركزي السعودي", "Saudi Central Bank"]],
  ["stats.gov.sa", ["الهيئة العامة للإحصاء", "Saudi General Authority for Statistics"]],
]);
const hostOf = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

export function officialDocument(raw) {
  try {
    const u = new URL(raw);
    const publisher = PUBLISHERS.get(hostOf(raw));
    const parts = u.pathname.split("/").filter(Boolean);
    if (!publisher || u.protocol !== "https:" || u.port || u.username || u.password || parts.length < 2) return null;
    if (/\.(pdf|xml|json|jpg|png|zip)$/i.test(u.pathname) || /\/(search|rss|feeds?|tags?|topics?|contact|login|about)(\/|$)/i.test(u.pathname)) return null;
    if (/^(index|default)(\.[a-z]+)?$/i.test(parts.at(-1))) return null;
    if (/^(news|newsroom|press-releases|briefings|presidential-actions|publications|speeches)$/i.test(parts.at(-1))) return null;
    return { url: canonicalUrl(raw), name: publisher[0], nameEn: publisher[1] };
  } catch { return null; }
}

const COMMON = new Set("the and for with from that this said says new news press release statement report reports official today president ministry government after before into more about their will have has are was its not this been than over under public order executive في من على إلى الى عن أن ان مع هذا هذه التي الذي وقال قال بيان جديد الجديدة الرئيس الحكومة بشأن خلال بعد قبل لدى وذلك كما وقد وفق بحسب أو او اليوم أخبار اخبار".split(" "));
function terms(text) {
  return new Set((String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !COMMON.has(w)));
}
function shared(a, b) {
  const right = terms(b);
  return [...terms(a)].filter((w) => right.has(w)).length;
}

/** Four selected items, at most three report bodies and one cited primary document.
 * Failed enrichment leaves the original evidence intact. No model call is added.
 */
export async function collectNewsEvidence(story, candidates, { extract = extractArticle, log = () => {}, now = isoNow } = {}) {
  const items = story.ids.map((id) => candidates.find((c) => c.id === id)).filter(Boolean);
  items.sort((a, b) => b.reliability - a.reliability || hoursSince(a.publishedAt) - hoursSince(b.publishedAt));
  const sources = [];
  const links = [];
  for (const item of items.slice(0, 4)) {
    let fetched = null;
    if (!item.paywalled && sources.filter((s) => s.text).length < 3) {
      fetched = await extract(item.url, { log });
      if (!fetched.ok) log(`evidence ${item.sourceId}: ${fetched.reason}`);
    }
    const text = fetched?.ok ? fetched.text : "";
    sources.push({ ...item, text, fetchedAt: text ? now() : null, ogImage: fetched?.ogImage ?? "" });
    if (text && item.kind !== "official") {
      for (const link of fetched.links ?? []) {
        const official = officialDocument(link.url);
        if (official) links.push({ ...link, ...official, discoveredFrom: item.url,
          score: shared(item.title, `${link.label} ${link.context} ${link.url}`) });
      }
    }
  }
  const present = new Set(sources.map((s) => canonicalUrl(s.url)));
  const selected = links.filter((link) => !present.has(link.url)).sort((a, b) => b.score - a.score)[0];
  if (selected) {
    try {
      // Redirects must stay on approved public document URLs too.
      const fetched = await extract(selected.url, { log, allowUrl: (url) => Boolean(officialDocument(url)) });
      const context = `${items.map((s) => s.title).join(" ")} ${selected.context}`;
      // A homepage or unrelated linked release must never become a source just because it is official.
      if (fetched.ok && shared(context, fetched.title) >= 2) {
        sources.push({ id: `primary-${fingerprint(selected.url)}`, sourceId: hostOf(selected.url),
          sourceName: selected.name, sourceNameEn: selected.nameEn, kind: "official", reliability: 3,
          title: fetched.title, url: selected.url, lang: fetched.lang || "unknown", publishedAt: fetched.publishedAt ?? null,
          summary: "", text: fetched.text, fetchedAt: now(), ogImage: fetched.ogImage ?? "", discoveredFrom: selected.discoveredFrom });
        log(`evidence primary document: ${selected.nameEn} (linked by ${selected.discoveredFrom})`);
      } else log(`evidence primary document skipped: ${fetched.ok ? "title does not establish relevance" : fetched.reason}`);
    } catch (error) { log(`evidence primary document unavailable: ${error.message}`); }
  }
  return { items, sources, evidenceChars: sources.reduce((n, s) => n + (s.text || s.summary || "").length, 0) };
}
