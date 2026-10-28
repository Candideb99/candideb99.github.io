/**
 * Who speaks through an outlet (the owner, 2026-10-25, adding the Turkish, Iranian and Indian press "with ownership
 * labels"). A state agency, a ministry's agency, a government's paper or its opponents' channel is named as such the
 * first time a story names it, so the reader knows whose account it is. The labels live in sources.json: on the entry of
 * a source the newsroom reads (`owner`, `firstMention`, `mustSay`), and in `outletLabels` for outlets its sources quote,
 * Iran's agencies above all. The writer is shown the label of each source and of each quoted outlet a source's text
 * names; the checks (verify.mjs) send back a story whose first mention of a labelled outlet carries none of its
 * `mustSay` words. A private paper's label only gives its country («صحيفة «إيكونوميك تايمز» الهندية») and is not checked.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sources.json");

let labels = null;

/** Every labelled outlet once, by its Arabic name: the sources the newsroom reads first, then the outlets they quote. */
export function outletLabels() {
  if (labels) return labels;
  const config = JSON.parse(readFileSync(SOURCES_FILE, "utf8"));
  const named = new Set();
  labels = [...(config.sources ?? []), ...(config.outletLabels ?? [])]
    .filter((o) => o.firstMention && !named.has(o.name) && named.add(o.name))
    .map((o) => ({ name: o.name, nameEn: o.nameEn, owner: o.owner ?? "", firstMention: o.firstMention, mustSay: o.mustSay ?? [], seen: o.seen ?? [o.nameEn] }));
  return labels;
}

let origins = null;

/**
 * The reporting origin a source speaks for (2026-10-29, when Asharq Business joined the feeds). An outlet that runs
 * another's reporting under licence carries `origin` on its sources.json entry and counts as that outlet: Asharq
 * Business publishes Bloomberg's stories in Arabic, Bloomberg HT in Turkish, so a Bloomberg headline beside its Arabic
 * version is one report, never two outlets. Read by name, so a story's stored sources resolve as its feed items do.
 */
export function reportingOrigin(source) {
  if (!origins) {
    const config = JSON.parse(readFileSync(SOURCES_FILE, "utf8"));
    origins = new Map();
    for (const s of config.sources ?? []) if (s.origin) for (const name of [s.name, s.nameEn]) if (name) origins.set(name, s.origin);
  }
  const names = [source.sourceNameEn ?? source.nameEn, source.sourceName ?? source.name].filter(Boolean);
  return names.map((name) => origins.get(name)).find(Boolean) ?? names[0] ?? "";
}

/** The label of the outlet a source comes from, or null. */
export function labelOf(source) {
  const names = [source.sourceName ?? source.name, source.sourceNameEn ?? source.nameEn];
  return outletLabels().find((o) => names.includes(o.name) || names.includes(o.nameEn)) ?? null;
}

/** The writer's line under a source's heading. */
export function labelLine(source) {
  const label = labelOf(source);
  return label ? `[OUTLET: ${label.owner}. When the story names it, its first mention reads: ${label.firstMention}]\n` : "";
}

/** For the writer, after the sources: the labelled outlets their texts name, other than the story's own sources. */
export function quotedOutletsBlock(sources) {
  const own = new Set(sources.map((s) => labelOf(s)?.name).filter(Boolean));
  const text = sources.map((s) => `${s.title ?? ""}\n${s.text || s.summary || ""}`).join("\n");
  const quoted = outletLabels().filter((o) => !own.has(o.name) && o.seen.some((n) => text.includes(n)));
  if (!quoted.length) return "";
  return `OUTLETS THE SOURCES QUOTE: when the story names one of these, its first mention reads as given.\n${quoted.map((o) => `- ${o.nameEn} (${o.owner}): ${o.firstMention}`).join("\n")}\n\n`;
}

/**
 * A story names an outlet where its name stands as a word after an outlet noun or a verb of reporting («وكالة «مهر»»،
 * «بحسب الأناضول»), never where the word is something else: «شرق الأناضول» is a region, «شهر مهر» a Persian month.
 */
const CUE = /(?:وكالة|وكالات|صحيفة|صحف|قناة|موقع|شبكة|هيئة|بحسب|وفق|وفقاً|ذكرت|ذكر|أفادت|أفاد|نقلت|نقل|قالت|أوردت|أورد|نشرت|كتبت|أضافت)[\s«"(]*$/u;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function names(sentence, name) {
  const word = new RegExp(`(?<![\\p{L}\\p{M}])${escapeRegex(name)}(?![\\p{L}\\p{M}])`, "gu");
  for (const m of sentence.matchAll(word)) if (CUE.test(sentence.slice(Math.max(0, m.index - 14), m.index))) return true;
  return false;
}

/** The labelled outlets a draft first names, in its lede, body or «لماذا يهمّ», without any of their `mustSay` words. */
export function unlabelledOutlets(draft) {
  const sentences = [draft.lede, draft.body, draft.whyItMatters].filter(Boolean).join("\n").split(/(?<=[.؟!])\s+|\n+/);
  return outletLabels().filter((o) => {
    if (!o.mustSay.length) return false;
    const first = sentences.find((s) => names(s, o.name));
    return Boolean(first) && !o.mustSay.some((w) => first.includes(w));
  });
}
