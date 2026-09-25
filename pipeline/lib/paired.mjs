/**
 * Drafts for the evidence on the lessons, and the canary that watches the judge (2026-09-25, the owner: "how can we make
 * sure that this self-improving loop really gets better?"). A story is written again from the same sources and brief
 * with other lessons (the kept version, or none), and every draft goes to the blind fact-check (lib/factcheck.mjs),
 * which never sees which is which or that lessons exist. run.mjs pairs its published first draft with these as it
 * writes (`evidencePair()`); pipeline/lessons-test.mjs decides from the pairs every Monday (lib/evidence.mjs) after
 * testing the fact-check with planted errors. Only the writer's stage is compared (desk notes + writer), before the copy
 * desk and the critic, so the drafts differ by the lessons alone.
 */
import { deskNotes, newsFloor, writeArticle } from "./write.mjs";
import { verifyStory } from "./factcheck.mjs";
import { extractArticle } from "./extract.mjs";
import { programmaticChecks } from "./verify.mjs";

/** A published story's sources, fetched once for both drafts and the fact-check: the writer's form and the checker's. */
export async function sourcesOf(article, { log = () => {} } = {}) {
  const writer = [];
  const check = [];
  for (const s of article.sources ?? []) {
    if (!s.url || String(s.url).startsWith("/")) continue;
    const got = await extractArticle(s.url, { maxChars: 9000, log });
    if (!got.ok) continue;
    const lang = s.lang || (/[؀-ۿ]/.test(got.text.slice(0, 400)) ? "ar" : "en");
    writer.push({ sourceNameEn: s.nameEn || s.name, sourceName: s.name, lang, title: s.title, publishedAt: s.publishedAt ?? null, text: got.text, summary: "", url: s.url });
    check.push({ n: check.length + 1, name: s.nameEn || s.name, title: s.title, url: s.url, publishedAt: s.publishedAt ?? null, text: got.text, reason: "" });
  }
  return { writer, check };
}

/** One draft: the desk notes and the writer, with the given lessons ("" for none). */
export async function draftWith({ story, sources, lessons = "", log = () => {} }) {
  const notesResult = await deskNotes({ story, sources, log, lessons });
  const notes = notesResult?.notes ?? null;
  const { draft } = await writeArticle({ story, sources, notes, log, lessons });
  return { draft, notes };
}

/** What the blind fact-check proves in a draft, and how much the draft says (fewer errors must not mean saying less). */
export async function judge({ draft, notes = null, writerSources, checkSources, log = () => {} }) {
  const v = await verifyStory({ story: draft, sources: checkSources, log });
  const confirmed = v.checks.filter((c) => c.status === "confirmed");
  return {
    errors: confirmed.length,
    // Severity, the secondary measure (the statistics review, 2026-09-25): a wrong figure, period, scope or actor 3,
    // hedge, attribution, cause, term or superlative 2, anything else 1; in the headline or the lede, double.
    severity: confirmed.reduce((n, c) => n + (["figure", "period", "scope", "actor"].includes(c.class) ? 3 : ["hedge", "attribution", "cause", "term", "superlative"].includes(c.class) ? 2 : 1) * (["title", "lede"].includes(c.field) ? 2 : 1), 0),
    // What the fact-check cannot prove wrong: a claim no source makes. If the lessons made the writer add those, the
    // error count would not show it, so the share is watched beside it.
    notFound: v.counts.notFound + v.counts.noEvidence,
    classes: confirmed.map((c) => c.class),
    confirmed: confirmed.map((c) => ({ class: c.class, field: c.field, sentence: c.sentence, quote: c.quote, correction: c.correction })),
    words: `${draft.lede ?? ""} ${draft.body ?? ""}`.split(/\s+/).filter(Boolean).length,
    keyFacts: draft.keyFacts?.length ?? 0,
    checked: v.counts.checked,
    supported: v.counts.supported,
    programmatic: writerSources ? programmaticChecks(draft, writerSources, { minWords: newsFloor(notes) }).issues.length : null,
  };
}

/**
 * The checker's canary (a review of the loop's statistics, 2026-09-25: a judge that drifts makes every comparison
 * worthless, and nothing else would notice). Plants up to three wrong figures in a copy of a draft whose sources are at
 * hand, by code, so the right answer is known: each changed figure stands in a sentence the sources contradict. The
 * fact-check then reads the copy; what share of the planted errors it calls contradicted is its recall this week.
 */
export function plantErrors(draft, max = 3) {
  const sentences = String(draft.body ?? "").split(/(?<=[.؟!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const planted = [];
  let body = String(draft.body ?? "");
  for (const sentence of sentences) {
    if (planted.length >= max) break;
    // A figure a reader would check: a decimal, or a whole number of 100 or more that is not a year.
    const m = sentence.match(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+\.\d+|\d{3,})(?![\d.])/);
    if (!m) continue;
    const raw = m[1];
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value) || (Number.isInteger(value) && value >= 1900 && value <= 2100)) continue;
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    const wrong = (value * 1.37 + 1).toFixed(decimals);
    const changed = sentence.replace(raw, wrong);
    if (changed === sentence || !body.includes(sentence)) continue;
    body = body.replace(sentence, changed);
    planted.push({ sentence: changed, was: raw, now: wrong });
  }
  return { draft: { ...draft, body }, planted };
}

/** How many planted errors the fact-check called contradicted (confirmed, drift or unverified alike: it noticed). */
export async function canary({ draft, checkSources, log = () => {} }) {
  const { draft: seeded, planted } = plantErrors(draft);
  if (!planted.length) return null;
  const v = await verifyStory({ story: seeded, sources: checkSources, log });
  const flagged = new Set(v.checks.filter((c) => c.verdict === "contradicted").map((c) => c.sentence));
  const found = planted.filter((p) => [...flagged].some((s) => s.includes(p.now))).length;
  return { seeded: planted.length, found };
}
