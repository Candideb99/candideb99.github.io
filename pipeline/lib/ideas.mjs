/**
 * «الفكر الاقتصادي» (kind "idea"), one economist's idea a week (the owner, 2026-11-20: "should we add in introduction to
 * economics every week a famous economist and explanation of his famous findings/works and its effects? or this will
 * make the website less serious and more like a wiki? also does the intro to economics handle stuff like macroeconomics
 * and microeconomics, developmental economics, plural economics, institutional economics etc?", then "build it").
 *
 * Counted that day: the 48 published explainers answered the week's market questions (about 14 oil, 11 bonds, stocks and
 * gold, 9 offerings and company finance, 11 inflation, rates and growth figures, 2 or 3 trade, 1 or 2 public finance) and
 * none taught development, institutional, behavioural, labour or heterodox economics; nothing in the explainer editor
 * knows the fields exist. So the idea piece has a field map: its editor sees only the ideas of the fields the section
 * has covered least, and picks the one a story of the week shows at work. What would make it a wiki is the biography;
 * the piece is the idea (the question it answers, how it works, what it changed and what has been disputed since) and
 * what it says about this week's news, written from reference sources the newsroom reads itself (pipeline/ideas.json),
 * never from a model's memory of a life, which no check could hold.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extractArticle } from "./extract.mjs";

/** What one source may give the writer and the checks: a long text (an encyclopedia entry, a book) is cut around its anchor. */
export const IDEA_SOURCE_CHARS = 12000;
/** Below this, all sources together, the idea is passed over for the week: too little to write it from. */
export const IDEA_MIN_CHARS = 3000;
/** The fields the editor is shown at once: the least covered, then the next, until this many ideas are on the list. */
export const IDEA_CANDIDATES = 10;

/** The reference hosts, named on the page as the desks name them. A host that refuses Anthropic by name is not here. */
export const IDEA_HOSTS = {
  "www.nobelprize.org": { ar: "جائزة نوبل", en: "The Nobel Prize" },
  "www.econlib.org": { ar: "موسوعة الاقتصاد المختصرة (Econlib)", en: "Econlib" },
  "plato.stanford.edu": { ar: "موسوعة ستانفورد للفلسفة", en: "Stanford Encyclopedia of Philosophy" },
  "en.wikipedia.org": { ar: "ويكيبيديا", en: "Wikipedia" },
  "ar.wikipedia.org": { ar: "ويكيبيديا العربية", en: "Arabic Wikipedia" },
  "ar.wikisource.org": { ar: "ويكي مصدر", en: "Arabic Wikisource" },
};

const CATALOGUE = fileURLToPath(new URL("../ideas.json", import.meta.url));

/** The catalogue: { fields: {id: Arabic name}, ideas: [...] }. */
export async function loadIdeas(file = CATALOGUE) {
  const data = JSON.parse(await readFile(file, "utf8"));
  return { fields: data.fields ?? {}, ideas: Array.isArray(data.ideas) ? data.ideas : [] };
}

/** Published idea pieces per field (drafts count: a piece waiting for review is the week's). */
export function fieldCounts(catalogue, existing) {
  const counts = Object.fromEntries(Object.keys(catalogue.fields).map((f) => [f, 0]));
  const fieldOf = new Map(catalogue.ideas.map((i) => [i.id, i.field]));
  for (const a of existing) {
    if (a.kind !== "idea") continue;
    const field = a.ideaField ?? fieldOf.get(a.ideaId);
    if (field in counts) counts[field] += 1;
  }
  return counts;
}

/**
 * The ideas the editor may choose from this week: never one already run, from the least covered field upward until at
 * least IDEA_CANDIDATES are listed (a whole field at a time, so a field is never half shown). In catalogue order inside
 * a field, which the editor is free to set aside for a better peg.
 */
export function ideaCandidates(catalogue, existing, { min = IDEA_CANDIDATES } = {}) {
  const done = new Set(existing.filter((a) => a.kind === "idea").map((a) => a.ideaId).filter(Boolean));
  const counts = fieldCounts(catalogue, existing);
  const open = catalogue.ideas.filter((i) => !done.has(i.id) && i.field in counts);
  const levels = [...new Set(open.map((i) => counts[i.field]))].sort((a, b) => a - b);
  const out = [];
  for (const level of levels) {
    if (out.length >= min) break;
    out.push(...open.filter((i) => counts[i.field] === level));
  }
  return out;
}

/** The part of a long text a source names by its anchor, or its opening: at most `cap` characters, cut at a sentence. */
export function excerpt(text, anchor, cap = IDEA_SOURCE_CHARS) {
  const s = String(text ?? "");
  if (s.length <= cap) return s;
  const at = anchor ? s.indexOf(anchor) : -1;
  const start = at > 0 ? Math.max(0, s.lastIndexOf(".", Math.max(0, at - 800)) + 1, at - 1500) : 0;
  const cut = s.slice(start, start + cap);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("۔"), cut.lastIndexOf(" ."));
  return (end > cap * 0.6 ? cut.slice(0, end + 1) : cut).trim();
}

/** A source's name on the page: its host's, or the address's own host when the catalogue holds one not listed above. */
export function hostName(url) {
  const host = new URL(url).host;
  return IDEA_HOSTS[host] ?? { ar: host, en: host };
}

/**
 * Reads an idea's sources with the newsroom's reader (robots honoured, private addresses refused): each one a source as
 * the checks and the evidence keep them. A page that does not answer is left out and said in the log.
 */
export async function readIdeaSources(idea, { log = () => {}, read = extractArticle } = {}) {
  const out = [];
  for (const s of idea.sources ?? []) {
    // A long text (a whole book on Wikisource) is read whole so the anchor can be found in it; the excerpt is what stays.
    const page = await read(s.url, { maxChars: s.anchor ? 3_000_000 : IDEA_SOURCE_CHARS * 2, log });
    if (!page.ok) {
      log(`idea source ${s.url}: ${page.reason}`);
      continue;
    }
    const text = excerpt(page.text, s.anchor, IDEA_SOURCE_CHARS);
    const name = hostName(s.url);
    out.push({
      sourceId: `idea:${new URL(s.url).host}`,
      sourceName: s.name_ar ?? name.ar,
      sourceNameEn: s.name_en ?? name.en,
      title: page.title || idea.work,
      url: s.url,
      lang: /^ar\./.test(new URL(s.url).host) ? "ar" : "en",
      kind: "reference",
      text,
      summary: text.slice(0, 400),
    });
  }
  return out;
}

/** The kind the lesson machinery reads an idea piece as (the desk, the reviser, the checks, the glossary): an explainer's. */
export const lessonKind = (kind) => (kind === "idea" ? "explainer" : kind);

/** The idea's record printed with the piece (frontmatter `idea`): from the catalogue, never from a model. */
export function ideaRecord(idea, fields) {
  return {
    id: idea.id,
    field: idea.field,
    fieldName: fields?.[idea.field] ?? "",
    // `f`: a woman, so the page says «صاحبة الفكرة».
    economists: (idea.economists ?? []).map((e) => ({ ar: e.ar, en: e.en, ...(e.f ? { f: true } : {}) })),
    year: idea.year,
    work: idea.work,
  };
}
