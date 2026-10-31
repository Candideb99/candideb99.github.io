/**
 * The reports desk (the owner, 2026-10-18: "should the website follow reports like [the UBS Global Wealth Report]?",
 * then "yes build it, however although arab world is in focus (not only gulf states), but important developed
 * economies are also important like germany, france etc"). Flagship recurring reports (pipeline/reports.json) are
 * read from their publishers' own pages, as primary sources, when a new edition appears: the Arab desks report them
 * from the wires' one or two headline numbers, and the report itself carries the figures for every Arab economy.
 *
 * Detection reads LINKS on a report's page (an edition is named in a link's text or title, so an announcement of a
 * future edition is not taken for one) or, for a publisher whose addresses follow a pattern, asks for this month's
 * address; an edition dated after the current month is ignored. Reading takes the edition's page and its PDF (unpdf):
 * the opening summary, and the passages that name the Arab economies first and the major economies after them.
 * A page behind a bot wall is never got round: such a report is `disabled` in the registry with the reason.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseHTML } from "linkedom";
import { allowedByRobots, extractArticle } from "./extract.mjs";
import { USER_AGENT, fetchWithTimeout, stripHtml } from "./util.mjs";

export const REGISTRY_PATH = path.join(process.cwd(), "pipeline", "reports.json");

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  januar: 1, februar: 2, märz: 3, mai: 5, juni: 6, juli: 7, oktober: 10, dezember: 12,
  janvier: 1, février: 2, mars: 3, avril: 4, juin: 6, juillet: 7, août: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12,
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, سبتمبر: 9, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
  spring: 4, frühjahr: 4, printemps: 4, summer: 7, sommer: 7, été: 7, autumn: 9, fall: 9, herbst: 9, automne: 9, winter: 12, hiver: 12,
};
const SEASONS = { spring: "ربيع", frühjahr: "ربيع", printemps: "ربيع", summer: "صيف", sommer: "صيف", été: "صيف", autumn: "خريف", fall: "خريف", herbst: "خريف", automne: "خريف", winter: "شتاء", hiver: "شتاء" };
const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AR_MONTHS = ["", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** The edition a matched label names, as a sortable key (year * 100 + month). The year's first match counts («2025/26» is 2025). */
export function editionKey(label, defaultMonth = 6) {
  const year = Number(String(label).match(/(?<!\d)(20\d\d)(?!\d)/)?.[1] ?? 0);
  if (!year) return null;
  const words = String(label).toLowerCase().split(/[^\p{L}]+/u);
  const word = words.find((w) => MONTHS[w]);
  // An address dates an edition by number («2025 06 19» from …/2025/06/19/…) when no month is named.
  const numeric = Number(String(label).match(new RegExp(`(?<!\\d)${year}\\s+(0[1-9]|1[0-2])(?!\\d)`))?.[1] ?? 0);
  // A quarter («GDP and National Accounts Q2/2026», «Q4,2023») is dated by its last month (2026-10-19, the statistics
  // releases): Q2 is June.
  const quarter = word ? 0 : Number(String(label).match(/(?<![A-Za-z])Q([1-4])(?!\d)/i)?.[1] ?? 0);
  const month = word ? MONTHS[word] : numeric || (quarter ? quarter * 3 : defaultMonth);
  return { key: year * 100 + month, year, month, season: word && SEASONS[word] ? SEASONS[word] : null, named: Boolean(word), quarter: quarter || null };
}

/** The current month as a key, in UTC. */
export const monthKey = (when = new Date()) => when.getUTCFullYear() * 100 + when.getUTCMonth() + 1;

export async function loadRegistry() {
  const data = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
  return (data.reports ?? []).filter((r) => r && r.id && !r.disabled);
}

async function fetchHtml(url) {
  if (!(await allowedByRobots(url))) return { ok: false, reason: "robots" };
  const response = await fetchWithTimeout(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" } }, 25000);
  const html = response.ok ? await response.text() : "";
  // A bot wall (Cloudflare's "Just a moment...") is a refusal, never a page to read.
  if (/<title>\s*(?:Just a moment|Attention Required|Client Challenge)/i.test(html)) return { ok: false, reason: "bot wall" };
  return { ok: response.ok, status: response.status, url: response.url || url, html, reason: response.ok ? "" : `http-${response.status}` };
}

/**
 * The newest edition a report's page offers: { key, label, url } or null. `report.template` (an address with {month}
 * and {year}, lower case) is asked for the current and the previous month; otherwise the page's links are read, each
 * link whose text or title matches `report.edition`; with `report.self`, the page itself is the edition and its text
 * names it.
 */
export async function latestEdition(report, { now = new Date(), log = () => {} } = {}) {
  const current = monthKey(now);
  if (report.template) {
    for (const back of [0, 1]) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const month = d.getUTCMonth() + 1;
      const year = d.getUTCFullYear();
      const url = report.template.replace("{month}", MONTH_NAMES[month].toLowerCase()).replace("{year}", String(year));
      const page = await fetchHtml(url).catch(() => ({ ok: false }));
      const title = page.html?.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "";
      // A refusal is said, not swallowed: from GitHub's runners the IEA answered nothing on 2026-10-18 while it answered
      // this laptop (a 404 is only an edition not out yet).
      if (!page.ok && page.reason !== "http-404") log(`report ${report.id}: ${url.replace(/^https?:\/\//, "").slice(0, 70)} not read (${page.reason || "no answer"})`);
      if (page.ok && new RegExp(report.edition, "i").test(title)) {
        const monthly = report.template.includes("{month}");
        const key = monthly ? year * 100 + month : editionKey(title, report.month ?? 6)?.key ?? year * 100 + (report.month ?? 6);
        return { key, named: monthly, season: null, label: stripHtml(title).replace(/\s*[-|–]\s*(?:IEA|Henley & Partners)\s*$/i, "").trim(), url: page.url };
      }
    }
    return null;
  }
  const page = await fetchHtml(report.page);
  if (!page.ok) {
    log(`report ${report.id}: page not read (${page.reason})`);
    return null;
  }
  const re = new RegExp(report.edition, "i");
  const found = [];
  if (report.text) {
    // The page is the edition and names it somewhere in its text: the newest name it carries.
    for (const m of stripHtml(page.html).matchAll(new RegExp(report.edition, "gi"))) {
      const e = editionKey(m[0], report.month ?? 6);
      if (e) found.push({ ...e, label: m[0].replace(/\s+/g, " ").trim(), url: page.url });
    }
  } else {
    const { document } = parseHTML(page.html);
    for (const a of document.querySelectorAll("a[href]")) {
      let url = "";
      try {
        url = new URL(a.getAttribute("href"), page.url).href;
      } catch {
        continue;
      }
      // The link's address is read too: the IMF titles its April 2026 GFSR link by its theme alone, and the edition is
      // only in the address (…/global-financial-stability-report-april-2026); the World Bank's Gulf update names its
      // editions "Issue 14" and dates them in the address (…/2025/06/19/…).
      const address = decodeURIComponent(url.replace(/^https?:\/\/[^/]+/, "")).replace(/[-_/.]+/g, " ");
      const label = `${a.textContent ?? ""} ${a.getAttribute("title") ?? ""} ${a.getAttribute("aria-label") ?? ""}`.replace(/\s+/g, " ").trim();
      const combined = `${label} | ${address}`;
      const m = combined.match(re);
      if (!m || !/^https?:/.test(url)) continue;
      const e = editionKey(m[0], report.month ?? 6) ?? editionKey(combined, report.month ?? 6);
      if (e) found.push({ ...e, label: (label.match(re)?.[0] ?? m[0]).replace(/\s+/g, " ").trim(), url });
    }
  }
  const usable = found.filter((e) => e.key <= current).sort((a, b) => b.key - a.key);
  return usable[0] ?? null;
}

/** The edition's label in Arabic for the working headline: «أكتوبر 2026» or «2026». */
const AR_QUARTERS = ["", "الربع الأول", "الربع الثاني", "الربع الثالث", "الربع الرابع"];
export function arabicEdition(edition) {
  const y = Math.floor((edition?.key ?? 0) / 100);
  if (edition?.season) return `${edition.season} ${y}`;
  if (edition?.quarter) return `${AR_QUARTERS[edition.quarter]} من ${y}`;
  return edition?.named ? `${AR_MONTHS[edition.key % 100]} ${y}` : String(y);
}

/**
 * Text of a report's document, one string per page; null when it cannot be read. A PDF is read with unpdf; a text or
 * Markdown version (the IMF offers «Full Report (Markdown version)», 2026-10-18) is read as it is, in page-sized parts.
 * A publisher that asks us to slow down (HTTP 429: the IMF did after a few requests) is asked once more after a pause.
 */
export async function pdfPages(url, log) {
  try {
    if (!(await allowedByRobots(url))) return null;
    const get = () => fetchWithTimeout(url, { headers: { "user-agent": USER_AGENT, accept: "application/pdf,text/markdown,text/plain;q=0.9,*/*;q=0.5" } }, 60000);
    let response = await get();
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 8000));
      response = await get();
    }
    const type = response.headers.get("content-type") ?? "";
    if (response.ok && (/text\/(?:markdown|plain)/i.test(type) || /\.md(?:$|[?#])/i.test(url))) {
      const text = (await response.text()).replace(/\r\n/g, "\n");
      const parts = [];
      let part = "";
      for (const para of text.split(/\n{2,}/)) {
        if (part.length + para.length > 3500 && part) {
          parts.push(part.trim());
          part = "";
        }
        part += `${para}\n`;
      }
      if (part.trim()) parts.push(part.trim());
      return parts.slice(0, 250);
    }
    if (!response.ok || !/pdf|octet-stream/i.test(type)) {
      if (!response.ok) log(`report document ${response.status}: ${url.slice(0, 90)}`);
      return null;
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > 45_000_000) return null;
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text : [text]).slice(0, 250).map((t) => String(t ?? "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim());
  } catch (error) {
    log(`report pdf not read (${String(error.message).slice(0, 100)}): ${url.slice(0, 90)}`);
    return null;
  }
}

/** The Arab economies by name, English and Arabic, and the major economies: what the country passages are chosen by. */
const ARAB = /Saudi|Emirat|UAE|Qatar|Kuwait|Bahrain|Oman|Egypt|Morocc|Algeri|Tunisi|Liby|Jordan|Leban|Syri|Iraq|Yemen|Sudan|Mauritani|Palestin|Somali|Djibouti|Comoros|GCC|Gulf Cooperation|Arab|MENA|Middle East|North Africa|السعودية|الإمارات|قطر|الكويت|البحرين|عمان|مصر|المغرب|الجزائر|تونس|ليبيا|الأردن|لبنان|سوريا|العراق|اليمن|السودان|موريتانيا|فلسطين|الخليج|العربية|الشرق الأوسط|شمال أفريقيا/;
const MAJOR = /United States|\bU\.?S\.?\b|China|Germany|France|United Kingdom|\bU\.?K\.?\b|Japan|Italy|India|euro area|Euro Area|Europe/;

/**
 * Passages of a report for the desk: the opening summary (the pages that call themselves an executive summary, key
 * findings, overview or highlights, else the first pages after the cover), and the paragraphs that name the Arab
 * economies (weighted three to one over the major economies), in the report's own order, each with its page.
 */
export function reportExcerpts(pages, { summaryChars = 7000, countryChars = 9000 } = {}) {
  const clean = pages.map((p) => p.replace(/\n(?=[a-z,;])/g, " "));
  const summaryAt = clean.findIndex((p, i) => i > 0 && /executive summary|key findings|main findings|overview|highlights|résumé|zusammenfassung|ملخص/i.test(p.slice(0, 600)));
  const start = summaryAt >= 0 ? summaryAt : Math.min(2, clean.length - 1);
  let summary = "";
  for (let i = start; i < clean.length && summary.length < summaryChars; i += 1) {
    if (/\.{5,}|^\s*contents\b/im.test(clean[i])) continue;
    summary += `[p.${i + 1}] ${clean[i]}\n\n`;
  }
  const paragraphs = [];
  clean.forEach((page, i) => {
    for (const para of page.split(/\n{1,}/).map((s) => s.trim()).filter((s) => s.length > 120)) {
      const arab = (para.match(new RegExp(ARAB.source, "g")) ?? []).length;
      const major = (para.match(new RegExp(MAJOR.source, "g")) ?? []).length;
      const score = arab * 3 + major;
      if (score > 0 && /\d/.test(para)) paragraphs.push({ i, para, score });
    }
  });
  const chosen = [];
  let used = 0;
  for (const p of [...paragraphs].sort((a, b) => b.score - a.score)) {
    if (used + p.para.length > countryChars) continue;
    chosen.push(p);
    used += p.para.length;
  }
  const countries = chosen.sort((a, b) => a.i - b.i).map((p) => `[p.${p.i + 1}] ${p.para}`).join("\n\n");
  return { summary: summary.slice(0, summaryChars), countries };
}

/**
 * The report's own document on an edition's page: a "Full Report" link (the World Bank's points at a download address
 * with no .pdf, 2026-10-18) or a PDF named like the report. Never an annex, a country note (the same page links 23
 * Macro Poverty Outlook PDFs), a methodology note (all the IEA's public page offers: its full report is for
 * subscribers), a chapter, a data file, slides or another language's version. None when nothing scores as the report:
 * the page's own text is then the source.
 */
export function bestPdf(html, base, report, edition = null) {
  const { document } = parseHTML(html);
  const name = String(report.nameEn).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
  const year = String(Math.floor((edition?.key ?? 0) / 100));
  const links = [];
  for (const a of document.querySelectorAll("a[href]")) {
    let url;
    try {
      url = new URL(a.getAttribute("href"), base).href;
    } catch {
      continue;
    }
    const text = String(a.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const label = `${text} ${decodeURIComponent(url).toLowerCase()}`;
    const document_ = /\.pdf(?:\.md)?(?:$|[?#])/i.test(url) || /\/download(?:$|[?#/])|bitstreams?\//i.test(url);
    if (!document_ && !/full report|download (?:the )?(?:full )?report/.test(text)) continue;
    if (/annex|appendix|methodolog|chapter|statistic|data|table|press|presentation|slides|ppt|infographic|brochure|summary in|arabic|عرب|français|french|deutsch|german|español|spanish|chinese|russian|\/related\/mpo|mpo-/.test(label)) continue;
    const score =
      // A link that says it is the full report outweighs name matches: the IMF's «Key Messages» PDF repeats the report's
      // name in its label and had won over «Full Report (PDF)» (2026-10-18).
      (/full report|complete report/.test(text) ? 12 : 0) +
      (/download (?:the )?(?:full )?report|read the (?:full )?report|report available/.test(text) ? 4 : 0) +
      2 * name.filter((w) => label.includes(w)).length +
      (year !== "0" && label.includes(year) ? 2 : 0) +
      (document_ ? 1 : 0) +
      // The same report as text reads cleaner than its PDF.
      (/\.md(?:$|[?#])/i.test(url) ? 1 : 0);
    links.push({ url, score });
  }
  const best = links.sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 4 ? best.url : null;
}

/**
 * An official release's own document for one edition (2026-10-19): a statistics page lists every month's PDF side by
 * side («CPI Sep 2026-EN.pdf», «CPI Aug 2026-EN.pdf», «ITR Jul2026 EN.pdf»), so the edition picks its file by the
 * registry's `document` pattern, filled with the edition's month ({mon} «Sep», {month} «September»), quarter ({q}) and
 * year ({yyyy}), read against the link's decoded address. Null when the edition has no such file yet.
 */
export function releaseDocument(html, base, report, edition) {
  if (!report.document || !edition?.key) return null;
  const year = Math.floor(edition.key / 100);
  const month = edition.key % 100;
  const full = MONTH_NAMES[month] ?? "";
  const pattern = report.document
    .replaceAll("{mon}", full.slice(0, 3))
    .replaceAll("{month}", full)
    .replaceAll("{q}", String(edition.quarter ?? Math.ceil(month / 3)))
    .replaceAll("{yyyy}", String(year));
  const re = new RegExp(pattern, "i");
  const { document } = parseHTML(html);
  for (const a of document.querySelectorAll("a[href]")) {
    let url;
    try {
      url = new URL(a.getAttribute("href"), base).href;
    } catch {
      continue;
    }
    let address = url;
    try {
      address = decodeURIComponent(url.replace(/\+/g, " "));
    } catch {}
    if (/\.pdf/i.test(address) && re.test(address)) return url;
  }
  return null;
}

/** The publisher's own press release for an edition, linked from its page and on its own site, or null. */
export function pressRelease(html, base, edition = null) {
  const { document } = parseHTML(html);
  const host = (u) => new URL(u).hostname.replace(/^www\./, "");
  const year = String(Math.floor((edition?.key ?? 0) / 100));
  for (const a of document.querySelectorAll("a[href]")) {
    let url;
    try {
      url = new URL(a.getAttribute("href"), base).href;
    } catch {
      continue;
    }
    const text = String(a.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!/press[- ]release|news release|communiqué de presse|بيان صحفي/i.test(`${text} ${url}`)) continue;
    if (host(url) !== host(base) || /\.pdf(?:$|[?#])/i.test(url) || /\/(?:press[- ]releases?|news)\/?$/i.test(url)) continue;
    if (year !== "0" && !url.includes(year) && !text.includes(year)) continue;
    return url;
  }
  return null;
}

/**
 * The sources a report story is written from: the edition's page and its PDF's summary, and its passages on the Arab
 * and the major economies. kind "report": the publisher's own flagship, authoritative for what it says, its estimates
 * and forecasts attributed to it. Returns [] when nothing readable was found.
 */
export async function readEdition(report, edition, { log = () => {} } = {}) {
  if (report.kind === "release") return readRelease(report, edition, { log });
  const sources = [];
  const name = report.publisher;
  const nameEn = report.publisherEn;
  const isPdf = /\.pdf(?:$|[?#])/i.test(edition.url);
  let pageText = "";
  let pdfUrl = isPdf ? edition.url : null;
  let release = null;
  if (!isPdf) {
    const page = await extractArticle(edition.url, { maxChars: 7000, log });
    pageText = page.ok ? page.text : "";
    const html = await fetchHtml(edition.url).catch(() => ({ ok: false }));
    if (html.ok) {
      pdfUrl = bestPdf(html.html, html.url, report, edition);
      // The publisher's press release for the edition carries its headline numbers (the World Bank's for the October
      // 2026 MENAAP update: the region shrinking 2.1% and the Gulf 4.3%, which the report's passages alone missed).
      const releaseUrl = pressRelease(html.html, html.url, edition);
      if (releaseUrl && releaseUrl !== edition.url) {
        const read = await extractArticle(releaseUrl, { maxChars: 6000, log });
        if (read.ok) release = { url: releaseUrl, text: read.text };
      }
    }
  }
  const pages = pdfUrl ? await pdfPages(pdfUrl, log) : null;
  const excerpts = pages?.length ? reportExcerpts(pages) : { summary: "", countries: "" };
  // With the report's own summary in hand the page's text gets a smaller share: UBS's page opens on a fraud-alert banner.
  const summary = [pageText.slice(0, excerpts.summary ? 3000 : 9000), excerpts.summary].filter(Boolean).join("\n\n").slice(0, 9000);
  const common = { sourceName: name, sourceNameEn: nameEn, lang: "en", kind: "report", reliability: 3, publishedAt: null, summary: "" };
  if (summary.length >= 400) sources.push({ ...common, title: `${report.nameEn} — ${edition.label}`, url: edition.url, text: summary });
  if (excerpts.countries.length >= 400) sources.push({ ...common, title: `${report.nameEn} — ${edition.label}: country findings`, url: pdfUrl, text: excerpts.countries.slice(0, 9000) });
  if (release && release.text.length >= 400) sources.push({ ...common, title: `${report.nameEn} — ${edition.label}: press release`, url: release.url, text: release.text });
  log(`report ${report.id}: ${edition.label} read (${summary.length} chars of summary${pdfUrl ? `, PDF ${pages ? `${pages.length} pages` : "unread"}` : ", no PDF"}, ${excerpts.countries.length} chars on the economies)`);
  return { sources, pdfUrl };
}

/**
 * An official statistics release (`kind: "release"` in the registry; the owner's go of 2026-10-19 for reporting from
 * official data): the edition's own PDF, whole up to a story's worth, as one primary institutional source. The listing
 * page is never a source (it is the list of every month's titles); without the edition's document there is nothing to
 * write from, and the edition is tried again the next day.
 */
async function readRelease(report, edition, { log = () => {} } = {}) {
  const html = await fetchHtml(edition.url).catch(() => ({ ok: false }));
  const pdfUrl = html.ok ? releaseDocument(html.html, html.url, report, edition) : null;
  const pages = pdfUrl ? await pdfPages(pdfUrl, log) : null;
  const text = (pages ?? []).map((p, i) => `[p.${i + 1}] ${p}`).join("\n").slice(0, 12000);
  log(`release ${report.id}: ${edition.label} ${pdfUrl ? `read (${pages ? `${pages.length} pages, ${text.length} chars` : "PDF unread"})` : "has no document yet"}`);
  // Listed before its document is posted: the edition waits, which is not a failed read (run.mjs spends no try on it).
  if (!pdfUrl && html.ok) return { sources: [], pdfUrl, pending: true };
  if (text.length < 400) return { sources: [], pdfUrl };
  const common = { sourceName: report.publisher, sourceNameEn: report.publisherEn, lang: "en", kind: "official", reliability: 3, publishedAt: null, summary: "" };
  const sources = [{ ...common, title: `${report.nameEn} — ${edition.label}`, url: pdfUrl, text }];
  // The previous period's release, from the same page, for the comparison a reader asks first: did inflation rise or
  // fall? The first test of September's Saudi prices (2026-10-19) gave 1.9% with no word on August, and filled the
  // floor with every minor category and the method.
  const previous = previousEdition(edition);
  const prevUrl = previous && html.ok ? releaseDocument(html.html, html.url, report, previous) : null;
  const prevPages = prevUrl ? await pdfPages(prevUrl, log) : null;
  const prevText = (prevPages ?? []).map((p, i) => `[p.${i + 1}] ${p}`).join("\n").slice(0, 4000);
  if (prevText.length >= 400) sources.push({ ...common, title: `${report.nameEn} — the previous release (${previous.label})`, url: prevUrl, text: prevText });
  log(`release ${report.id}: previous release ${previous?.label ?? "?"} ${prevText.length >= 400 ? "read" : "not found"}`);
  return { sources, pdfUrl };
}

/** The period before an edition: the month before, or the quarter before when the edition is a quarter. */
export function previousEdition(edition) {
  if (!edition?.key) return null;
  const year = Math.floor(edition.key / 100);
  if (edition.quarter) {
    const q = edition.quarter === 1 ? 4 : edition.quarter - 1;
    const y = edition.quarter === 1 ? year - 1 : year;
    return { key: y * 100 + q * 3, quarter: q, label: `Q${q} ${y}` };
  }
  const month = edition.key % 100;
  const m = month === 1 ? 12 : month - 1;
  const y = month === 1 ? year - 1 : year;
  return { key: y * 100 + m, quarter: null, label: `${MONTH_NAMES[m]} ${y}` };
}

/** The editor's brief for an official release: its headline figure and the change, then what drove it, nothing padded. */
export function releaseStory(report, edition) {
  return {
    ids: [],
    report: report.id,
    section: report.section,
    importance: report.importance ?? 7,
    regions: report.regions ?? [],
    headlineHint: `${report.headline} (${arabicEdition(edition)})`,
    // A data release is told as the wires tell it, in a short story (the owner, 2026-10-19, of a long compiled piece:
    // "extremely boring to read and i lost concentration").
    format: "short",
    angle: `AN OFFICIAL DATA RELEASE: ${report.publisherEn}'s ${report.nameEn} for ${edition.label}, read from the release itself, a primary source. ${report.lead ?? "Lead with the release's headline figure and its change from the previous period, as the release states them."} The previous period's figure comes from the previous release supplied beside it: say plainly whether the figure rose, fell or held. Then the two or three components that drove it most, with their own figures. Leave out the minor components, the full list of categories and the methodology: a reader wants the figure, its direction and its cause. Every figure as the release states it, with its period and unit, attributed to the authority («بحسب الهيئة العامة للإحصاء»).`,
  };
}

/** The editor's brief for a report story: the Arab world first, all of it, then the major economies the report covers. */
export function reportStory(report, edition) {
  const label = arabicEdition(edition);
  return {
    ids: [],
    report: report.id,
    section: report.section,
    importance: report.importance ?? 7,
    regions: [],
    headlineHint: `${report.publisher}: أبرز ما في «${report.name}» (${label})`,
    angle: `A REPORT STORY: the new edition (${edition.label}) of ${report.nameEn} by ${report.publisherEn}, read from the report itself. Lead with the finding that matters most to Arab readers: a notable figure, forecast, rank or change for an Arab economy (any of them, not only the Gulf) when the report gives one, otherwise the report's global headline finding. Then the other Arab economies the report gives figures for, and the major economies it covers (the United States, China, Germany, France, the United Kingdom, Japan). Every figure as the report states it, with its period and unit, attributed to the report; a forecast stays the report's forecast. One report, one story: not a roundup of other news.`,
  };
}
