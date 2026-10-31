#!/usr/bin/env node
/**
 * The newsroom's safeguards, tested on cases whose right answer is known, with scripted stand-ins for the model: no
 * Claude call. Written 2026-09-26 with the check before publication (the owner's go to "check, repair, hold"), so that
 * a change to it, to the duplicate rule, to the lessons' lint or to the state files cannot pass the site's gate while
 * behaving wrongly. The gate runs it (scripts/gate.mjs).
 *
 *   node scripts/pipeline-selftest.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_REPAIRS, checkSourcesOf, precheck } from "../pipeline/lib/precheck.mjs";
import { repeatsRecent } from "../pipeline/lib/events.mjs";
import { fetchFeed } from "../pipeline/lib/feeds.mjs";
import { lessonRuleOk, loadLessons } from "../pipeline/lib/lessons.mjs";
import { refersBack, restoredFigures, sentenceUnits, sourceNumbers, ungroundedNumbers, writeJsonAtomic } from "../pipeline/lib/util.mjs";
import { loadSnapshot, saveSnapshot } from "../pipeline/lib/snapshots.mjs";
import { loadSources, quoteFound, settleChanged, settleDrift, verifyStory } from "../pipeline/lib/factcheck.mjs";
import { readArticleHtml } from "../pipeline/lib/extract.mjs";
import { labelLine, outletLabels, quotedOutletsBlock, unlabelledOutlets } from "../pipeline/lib/outlets.mjs";
import { instrumentsOf, macroMarketOf, marketData, repeatsInstrument } from "../pipeline/lib/context.mjs";
import { independentOutletCount } from "../pipeline/lib/news-evidence.mjs";
import { boxFacts, figureOnly } from "../pipeline/lib/keyfacts.mjs";
import { deskNotes, explainingFacts, newsDepthBrief, newsFloor, normalizeChart, normalizeDraft, paperNotes, prioritizeContext, substantiveFacts, validateDraft, validateWhyBasis, writePaperReading } from "../pipeline/lib/write.mjs";
import { NEWS_DEPTH, NEWS_FLOOR, NEWS_MIN_EXPLAINING, NEWS_MIN_FACTS, SHORT_WORDS } from "../pipeline/lib/editorial.mjs";
import { arabicEdition, bestPdf, coveredBy, documentUrl, editionKey, previousEdition, releaseDocument, releaseStory, reportExcerpts } from "../pipeline/lib/reports.mjs";
import { mergeNewsRefresh, serializeArticle } from "../pipeline/lib/article.mjs";
import { cleanTags } from "../pipeline/lib/tags.mjs";
import { countriesNamed, groundedRegions, unplacedActors } from "../pipeline/lib/regions.mjs";
import { styleIssues } from "../pipeline/lib/style.mjs";
import { fixNames, judgeRewrite } from "../pipeline/lib/copydesk.mjs";
import { CUTTABLE, cutToSources, normalizeCritique, programmaticChecks } from "../pipeline/lib/verify.mjs";
import { noveltyFault } from "../pipeline/lib/images.mjs";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
}

// A scripted fact-check: each call returns the next list of proved errors ([] is clean), or throws.
const verifier = (script) => {
  let i = 0;
  const fn = async () => {
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    fn.calls = i;
    if (step === "throw") throw new Error("Claude failed for role checker");
    return { counts: { checked: 10 }, checks: step.map((id) => ({ id, field: "body", class: "figure", status: "confirmed", verdict: "contradicted", sentence: `sentence ${id}`, quote: `source ${id}`, correction: "fix" })) };
  };
  fn.calls = 0;
  return fn;
};
// A scripted repair: accepted (a changed draft) or refused by the guards.
const repairer = (accept) => {
  const fn = async ({ draft }) => {
    fn.calls += 1;
    return accept ? { draft: { ...draft, body: `${draft.body} (repaired)` }, problems: [], changed: 1 } : { draft: null, problems: ["figures that stand in no source: 9.9"], changed: 0 };
  };
  fn.calls = 0;
  return fn;
};
const draft = { title: "عنوان", lede: "مقدمة", body: "متن", keyFacts: [] };
const sources = [{ sourceName: "رويترز", title: "t", url: "https://example.com/a", text: "source text" }];

{
  const quota = Object.assign(new Error("workspace out of credits"), { meta: { quota: true } });
  let stopped = false;
  try { await deskNotes({ story: {}, sources, chatWith: async () => { throw quota; } }); } catch (error) { stopped = error === quota; }
  check("notes quota exhaustion stops before another writer call", stopped, true);
  const fallback = await deskNotes({ story: {}, sources, chatWith: async () => { throw new Error("temporary notes failure"); } });
  check("ordinary notes failure retains the existing source-only fallback", fallback, null);
  // Untagged notes would read as nothing explaining the event and send it short: they are asked again (2026-10-30).
  const facts = (job) => Array.from({ length: 6 }, (_, i) => ({ fact: `حقيقة رقم ${["أولى", "ثانية", "ثالثة", "رابعة", "خامسة", "سادسة"][i]} من المصدر`, source: 1, ...(job ? { job } : {}) }));
  const refusals = [];
  const tagged = await deskNotes({ story: {}, sources, chatWith: async ({ validate }) => {
    for (const data of [{ event: "e", reader_context: null, facts: facts() }, { event: "e", reader_context: null, facts: facts(" Driver ") }]) {
      try { validate(data); return { data, model: "stand-in" }; } catch (error) { refusals.push(error.message); }
    }
  } });
  check("notes whose facts carry no job are asked again", refusals.length === 1 && /carry no job/.test(refusals[0]), true);
  check("…and a job is read whatever its case or spacing", tagged?.notes && explainingFacts(tagged.notes), 6);
  // Asked once: notes still untagged on the second answer are kept (they explain nothing, so the event runs short) rather
  // than lost to a third refusal, which would leave the writer with the raw sources and no depth gate.
  const stubborn = [];
  const kept = await deskNotes({ story: {}, sources, chatWith: async ({ validate }) => {
    for (let i = 0; i < 3; i += 1) {
      const data = { event: "e", reader_context: null, facts: facts() };
      try { validate(data); return { data, model: "stand-in" }; } catch (error) { stubborn.push(error.message); }
    }
    throw new Error(stubborn.at(-1));
  } });
  check("…once only: untagged notes on the second answer are kept, and explain nothing", [stubborn.length, kept?.notes?.facts.length, kept && explainingFacts(kept.notes)], [1, 6, 0]);
  // An ungrounded context fact or identification leaves the notes, never takes them all (30 October: six whole answers
  // refused for one such line); and the job is never asked for on the last try.
  const loose = [];
  const looseKept = await deskNotes({ story: {}, sources, chatWith: async ({ validate }) => {
    const data = { event: "e", reader_context: { fact: "سياق لم يرد في أي مصدر 999", source: 1 }, identifications: [{ fact: "خبير مجهول 777", source: 1 }], facts: facts("driver") };
    try { validate(data); return { data, model: "stand-in" }; } catch (error) { loose.push(error.message); throw error; }
  } });
  check("an ungrounded context fact or identification is left out, the notes kept", [loose.length, looseKept?.notes?.facts.length], [0, 6]);
  const late = [];
  const lateKept = await deskNotes({ story: {}, sources, chatWith: async ({ validate }) => {
    const answers = [{ event: "e", reader_context: null, facts: facts().slice(0, 3) }, { event: "e", reader_context: null, facts: facts().slice(0, 3) }, { event: "e", reader_context: null, facts: facts() }];
    for (const data of answers) {
      try { validate(data); return { data, model: "stand-in" }; } catch (error) { late.push(error.message); }
    }
    throw new Error(late.at(-1));
  } });
  check("…and untagged notes on the third and last try are kept", [late.length, lateKept?.notes?.facts.length], [2, 6]);
  // The last try is chat()'s to say, not the answers' count (a review of 2026-10-31): a timeout and an unreadable answer
  // first, then untagged notes on the third and last try, were asked again and the writer got no notes at all.
  const timedOut = await deskNotes({ story: {}, sources, chatWith: async ({ validate }) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt < 3) continue; // a timeout, then an answer that did not parse: validate() never runs
      const data = { event: "e", reader_context: null, facts: facts() };
      validate(data, { attempt, last: true });
      return { data, model: "stand-in" };
    }
  } });
  check("…and after two failed tries, untagged notes on the last are kept", timedOut?.notes?.facts.length, 6);
}

// Exercise the real checker response boundary; a nonempty array is not necessarily a completed check.
const checkerReply = (checks) => async ({ validate }) => {
  const data = { checks };
  validate(data);
  return { data, model: "offline-checker" };
};
for (const [name, checks] of [
  ["unknown sentence", [{ id: 999, verdict: "supported" }]],
  ["fractional sentence", [{ id: 1.5, verdict: "supported" }]],
  ["missing sentence", [{ verdict: "supported" }]],
  ["boolean sentence", [{ id: true, verdict: "supported" }]],
  ["unknown verdict", [{ id: 1, verdict: "looks fine" }]],
  ["self-cited support", [{ id: 1, verdict: "supported", source: 0, quote: "عنوان" }]],
  ["duplicate sentence", [{ id: 1, verdict: "supported" }, { id: 1, verdict: "contradicted" }]],
]) {
  const result = await precheck({ draft, sources, verify: (options) => verifyStory({ ...options, chatWith: checkerReply(checks) }) });
  check(`malformed checker response (${name}) cannot count as clean`, [result.ok, /could not run/.test(result.held ?? "")], [false, true]);
}
{
  const result = await precheck({
    draft: { title: "The bank raised its rate.", body: "The policy rate rose to 5%." },
    sources: [{ sourceNameEn: "Central bank", title: "Rate decision", text: "The bank raised its policy rate to 5%." }],
    verify: (options) => verifyStory({ ...options, chatWith: checkerReply([{ id: 1, verdict: "supported", source: 1, quote: "The bank raised its policy rate to 5%." }]) }),
  });
  check("a partial fact-check cannot silently skip a required factual sentence", [result.ok, /could not run.*unchecked factual sentence ids: 2/.test(result.held ?? "")], [false, true]);
}
{
  const result = await verifyStory({ story: draft, sources: checkSourcesOf(sources), chatWith: checkerReply([{ id: 1, verdict: "not_found", source: null, quote: "" }]) });
  check("a valid not-found verdict remains an observation, not a proved error", [result.checks.length, result.checks[0].status], [1, "not_found"]);
}
{
  const quote = "The bank raised its policy rate to 3%.";
  const evidence = [{ n: 1, name: "Central bank", title: "Rate decision", text: quote }];
  for (const [title, verdict, status] of [[quote, "supported", "supported"], ["The bank cut its policy rate to 3%.", "contradicted", "confirmed"]]) {
    const result = await verifyStory({ story: { title }, sources: evidence, chatWith: checkerReply([{ id: "1", verdict, source: 1, quote, class: "figure" }]) });
    check(`valid ${verdict} evidence survives response validation`, [result.checks[0].status, result.counts.checked], [status, 1]);
  }
  const internal = await verifyStory({ story: { title: "The bank cut its policy rate to 3%.", body: quote }, sources: evidence, chatWith: checkerReply([{ id: 1, verdict: "contradicted", source: 0, quote, class: "internal" }, { id: 2, verdict: "supported", source: 1, quote }]) });
  check("the story remains evidence for its own internal contradiction", internal.checks[0].status, "confirmed");
}
{
  const versionFor = (provider, model) => spawnSync(process.execPath, ["--input-type=module", "-e", "import { CHECKER_VERSION } from './pipeline/lib/factcheck.mjs'; console.log(CHECKER_VERSION)"], {
    encoding: "utf8", env: { ...process.env, KHAZENDAR_PROVIDER: provider, KHAZENDAR_CODEX_MODEL: model, KHAZENDAR_CLAUDE_MODEL: model },
  });
  const versions = [versionFor("codex", "offline-model-a"), versionFor("codex", "offline-model-b"), versionFor("claude", "offline-model-a")];
  check("checker evidence versions separate active providers and models", [versions.every((r) => r.status === 0), new Set(versions.map((r) => r.stdout.trim())).size], [true, 3]);
}

// 1. The check before publication.
{
  const v = verifier([[]]);
  const r = await precheck({ draft, sources, verify: v, repairWith: repairer(true) });
  check("a clean story is published after one check", [r.ok, r.repairs, v.calls], [true, 0, 1]);
}
{
  const v = verifier([[1, 2], []]);
  const r = await precheck({ draft, sources, verify: v, repairWith: repairer(true) });
  check("an error is repaired, checked again and published", [r.ok, r.repairs, v.calls, r.draft.body.endsWith("(repaired)")], [true, 1, 2, true]);
}
{
  const v = verifier([[1]]);
  const r = await precheck({ draft, sources, verify: v, repairWith: repairer(true) });
  check(`an error that survives ${MAX_REPAIRS} repairs is held`, [r.ok, r.repairs, v.calls, Boolean(r.held)], [false, MAX_REPAIRS, MAX_REPAIRS + 1, true]);
}
{
  const rep = repairer(false);
  const r = await precheck({ draft, sources, verify: verifier([[1]]), repairWith: rep });
  check("repairs the guards refuse: held, never published unrepaired", [r.ok, rep.calls], [false, MAX_REPAIRS]);
}
{
  const r = await precheck({ draft, sources, verify: verifier([[1], []]), repairWith: repairer(true), validate: () => ({ ok: false, issues: ["too short"] }) });
  check("a repair that fails the newsroom's own checks is refused: held", [r.ok, r.repairs], [false, MAX_REPAIRS]);
}
{
  const r = await precheck({ draft, sources, verify: verifier(["throw"]), repairWith: repairer(true) });
  check("a check that cannot run holds the story (never a pass)", [r.ok, /could not run/.test(r.held)], [false, true]);
}
{
  const r = await precheck({ draft, sources: [{ title: "t", url: "u" }], verify: verifier([[]]), repairWith: repairer(true) });
  check("a story with no source text is held", [r.ok, /no source text/.test(r.held)], [false, true]);
}
{
  const v = verifier([[1], [2], []]);
  const r = await precheck({ draft, sources, verify: v, repairWith: repairer(true) });
  check("a repair that brings a new error is checked and repaired again", [r.ok, r.repairs, v.calls], [true, 2, 3]);
}

// 1b. The sentences of a clean news story that no source bears on (2026-10-28): cut, but for a definition, a quote code
// finds and the wires' one clause on a withheld term; «لماذا يهمّ» never read, the lede never emptied, nothing held.
{
  const nf = (id, field, sentence) => ({ id, field, verdict: "not_found", status: "not_found", sentence, quote: "" });
  const judge = (answers) => {
    const fn = async ({ sentences }) => {
      fn.asked = sentences.map((c) => c.id);
      return { answers };
    };
    return fn;
  };
  const story = {
    title: "عنوان",
    subtitle: "وصف.",
    lede: "رفع البنك الفائدة إلى 5%.",
    whyItMatters: "قد يبطئ ذلك الإقراض.",
    keyFacts: [],
    body: "وقال المحافظ إن القرار يكبح التضخم. والخطوة التالية خفض الدعم.\n\nوتوصف السوق بالهابطة حين يتراجع المؤشر 20%.\n\nولم يكشف البنك موعد القرار المقبل. ولم يكشف البنك حجم السيولة.",
  };
  const src = [{ sourceName: "رويترز", title: "Rate decision", url: "https://example.com/a", text: "The bank raised its policy rate to 5%. The governor said the decision curbs inflation." }];
  const checks = [
    { id: 1, field: "lede", verdict: "supported", status: "supported", sentence: story.lede, quote: "The bank raised its policy rate to 5%.", source: 1 },
    nf(2, "whyItMatters", "قد يبطئ ذلك الإقراض."),
    nf(3, "body", "والخطوة التالية خفض الدعم."),
    nf(4, "body", "وتوصف السوق بالهابطة حين يتراجع المؤشر 20%."),
    nf(5, "body", "ولم يكشف البنك موعد القرار المقبل."),
    nf(6, "body", "ولم يكشف البنك حجم السيولة."),
    nf(7, "body", "وقال المحافظ إن القرار يكبح التضخم."),
  ];
  const verify = async () => ({ counts: { checked: checks.length }, checks });
  const verdicts = [
    { id: 3, verdict: "unsourced" },
    { id: 4, verdict: "definition" },
    { id: 5, verdict: "withheld" },
    { id: 6, verdict: "withheld" },
    { id: 7, verdict: "sourced", source: 1, quote: "The governor said the decision curbs inflation." },
  ];
  const j = judge(verdicts);
  const r = await precheck({ draft: story, sources: src, verify, judgeWith: j, unsourced: true });
  check("sentences no source bears on: «لماذا يهمّ» is never read", j.asked, [3, 4, 5, 6, 7]);
  check(
    "an unsourced claim and a second withheld term are cut; a definition, a found quote and one withheld term stay",
    [r.ok, r.trimmed, r.draft.body],
    [true, 2, "وقال المحافظ إن القرار يكبح التضخم.\n\nوتوصف السوق بالهابطة حين يتراجع المؤشر 20%.\n\nولم يكشف البنك موعد القرار المقبل."],
  );
  check("a cut sentence leaves the evidence map with it", r.checks.map((c) => c.id), [1, 2, 4, 5, 7]);
  const unfound = await precheck({ draft: story, sources: src, verify, judgeWith: judge([...verdicts.slice(0, 4), { id: 7, verdict: "sourced", source: 1, quote: "The governor said the decision will cut prices next year." }]), unsourced: true });
  check("support counts only on a quote code finds", unfound.draft.body.includes("وقال المحافظ"), false);
  const off = judge(verdicts);
  const hub = await precheck({ draft: story, sources: src, verify, judgeWith: off });
  check("an analysis is not read for it (unsourced off)", [hub.trimmed, hub.draft === story, off.asked ?? null], [0, true, null]);
  const floor = await precheck({ draft: story, sources: src, verify, judgeWith: judge(verdicts), unsourced: true, validate: () => ({ ok: false, issues: ["under the floor"] }) });
  check("a cut the newsroom's own checks refuse leaves the story as written", [floor.ok, floor.trimmed, floor.draft === story, /under the floor/.test(floor.rounds[0].unsourced.refused)], [true, 0, true, true]);
  const told = await precheck({ draft: story, sources: src, verify, judgeWith: judge(verdicts), unsourced: true, validate: (d, { cut = false } = {}) => ({ ok: cut, issues: cut ? [] : ["under the floor"] }) });
  check("the checks are told the draft is a cut (the floor gives it a tenth)", told.trimmed, 2);
  const failing = await precheck({ draft: story, sources: src, verify, judgeWith: async () => { throw new Error("Claude failed for role checker"); }, unsourced: true });
  check("a reading that cannot run cuts nothing and holds nothing", [failing.ok, failing.trimmed, failing.draft === story], [true, 0, true]);
  const quota = Object.assign(new Error("out of credits"), { meta: { quota: true } });
  let stopped = false;
  try {
    await precheck({ draft: story, sources: src, verify, judgeWith: async () => { throw quota; }, unsourced: true });
  } catch (error) {
    stopped = error === quota;
  }
  check("quota exhaustion in that reading stops the round", stopped, true);
  let calls = 0;
  const afterRepair = async () => (calls++ === 0 ? { counts: {}, checks: [{ id: 3, field: "body", class: "figure", status: "confirmed", verdict: "contradicted", sentence: "x", quote: "y", correction: "fix" }] } : { counts: {}, checks: [nf(3, "body", "والخطوة التالية خفض الدعم.")] });
  const repaired = await precheck({ draft: story, sources: src, verify: afterRepair, repairWith: repairer(true), judgeWith: judge([{ id: 3, verdict: "unsourced" }]), unsourced: true });
  check("after a repair, the repaired text is the one cut", [repaired.repairs, repaired.trimmed, repaired.draft.body.includes("(repaired)"), repaired.draft.body.includes("والخطوة التالية")], [1, 1, true, false]);
}
{
  const judgeAll = (verdict) => async ({ sentences }) => ({ answers: sentences.map((c) => ({ id: c.id, verdict })) });
  const lede = { title: "عنوان", lede: "تقول المصادر إن البنك سيرفع الفائدة.", body: "نص أول. نص ثان.", keyFacts: [] };
  const one = await precheck({ draft: lede, sources, verify: async () => ({ counts: {}, checks: [{ id: 2, field: "lede", verdict: "not_found", status: "not_found", sentence: lede.lede, quote: "" }] }), judgeWith: judgeAll("unsourced"), unsourced: true });
  check("the lede's only sentence is never cut", [one.trimmed, one.draft.lede, one.rounds[0].unsourced.kept[0]?.reason], [0, lede.lede, "the only sentence of the lede"]);
  const headed = { title: "عنوان", lede: "رفع البنك الفائدة.", body: "نص أول.\n\n## ما التالي\n\nوالخطوة التالية خفض الدعم.", keyFacts: [] };
  const orphan = await precheck({ draft: headed, sources, verify: async () => ({ counts: {}, checks: [{ id: 4, field: "body", verdict: "not_found", status: "not_found", sentence: "والخطوة التالية خفض الدعم.", quote: "" }] }), judgeWith: judgeAll("unsourced"), unsourced: true });
  check("a cut that would leave a subhead with nothing under it leaves the story as written", [orphan.trimmed, orphan.draft === headed], [0, true]);
  const v = verifier([[]]);
  const plain = Object.assign(async () => {
    plain.calls += 1;
    return { answers: [] };
  }, { calls: 0 });
  const clean = await precheck({ draft, sources, verify: v, judgeWith: plain, unsourced: true });
  check("a story every source bears on is not read again", [clean.ok, clean.trimmed, v.calls, plain.calls], [true, 0, 1, 0]);
  // 2026-10-28: «وكانت قيود الاستخدام هذه…» stood with nothing named before it; a cut must not make one.
  const pointed = { title: "عنوان", lede: "رفع البنك الفائدة.", body: "نص أول. وتفرض الشركة قيوداً على استخدام نماذجها.\n\nوكانت هذه القيود قد أوقعتها في خلاف. والخطوة التالية خفض الدعم.", keyFacts: [] };
  const nfb = (id, sentence) => ({ id, field: "body", verdict: "not_found", status: "not_found", sentence, quote: "" });
  const anchored = await precheck({ draft: pointed, sources, verify: async () => ({ counts: {}, checks: [nfb(5, "وتفرض الشركة قيوداً على استخدام نماذجها."), nfb(6, "والخطوة التالية خفض الدعم.")] }), judgeWith: judgeAll("unsourced"), unsourced: true });
  check(
    "a sentence the next one points back at stays; the rest of the cut goes on",
    [anchored.trimmed, anchored.draft.body.includes("وتفرض الشركة"), anchored.draft.body.includes("والخطوة التالية"), anchored.rounds[0].unsourced.kept[0]?.reason],
    [1, true, false, "the next sentence refers back to it"],
  );
}
{
  // The last cut takes a sentence that points back at a cut figure with it, within its paragraph.
  const draft = { title: "عنوان", subtitle: "وصف", lede: "رفع البنك الفائدة إلى 5%.", body: "وبلغ التضخم 9.7% في سبتمبر. وهذه أعلى نسبة منذ عامين. ويجتمع البنك مجدداً في ديسمبر.", whyItMatters: "", keyFacts: [] };
  const out = cutToSources(draft, [{ title: "Rate decision", text: "The bank raised its policy rate to 5%. It meets again in December." }]);
  check("the last cut takes the sentence pointing back at a cut figure", [out?.cut.length, out?.draft.body], [2, "ويجتمع البنك مجدداً في ديسمبر."]);
  check("a sentence that points back is told from one that does not", [refersBack("وكانت قيود الاستخدام هذه قد أوقعت الشركة"), refersBack("ومع ذلك ارتفع المؤشر"), refersBack("وارتفع المؤشر 2% في هذه الجلسة الطويلة جداً")], [true, true, false]);
  // The review of 2026-10-30: a demonstrative before a word of time names the time; a pronoun opening takes up the sentence before.
  check("«هذا العام» is a time, «وهو ما يعني» a reference", [refersBack("وتتوقع الشركة هذا العام نمواً بنسبة 7%."), refersBack("وفي هذه الأثناء ارتفع المؤشر"), refersBack("وهو ما يعني ارتفاع الكلفة"), refersBack("مما يرفع الكلفة")], [false, false, true, true]);
  const forecast = { title: "عنوان", subtitle: "وصف", lede: "ارتفعت مبيعات الشركة.", body: "وارتفعت المبيعات 13% في الربع. وتتوقع الشركة هذا العام نمواً بنسبة 7%.", whyItMatters: "", keyFacts: [] };
  check("the last cut keeps a sourced forecast after a cut figure", cutToSources(forecast, [{ title: "Results", text: "The company expects growth of 7% this year." }])?.draft.body, "وتتوقع الشركة هذا العام نمواً بنسبة 7%.");
  check("a quotation over two sentences is one unit", sentenceUnits("قال الوزير «سنرفع الإنتاج إلى 5 ملايين برميل. وسنخفض الأسعار قريباً جداً» في مؤتمر صحفي. ثم غادر."), ["قال الوزير «سنرفع الإنتاج إلى 5 ملايين برميل. وسنخفض الأسعار قريباً جداً» في مؤتمر صحفي.", "ثم غادر."]);
}
{
  // The review of 2026-10-30: a verbatim Arabic quote the copy desk has put in the house spelling is still found in its
  // source («الأميركية» → «الأمريكية»), and translated speech is still sent back.
  const aawsat = [{ sourceName: "الشرق الأوسط", title: "رسوم جديدة", text: "وقال المتحدث إن الإدارة الأميركية ستفرض رسوماً جديدة على واردات الصلب قريباً. وأضاف أن القرار نهائي." }];
  const quoting = (q) => ({ title: "الإدارة الأمريكية تفرض رسوماً جديدة", subtitle: "", lede: `وقال المتحدث إن «${q}».`, body: "نص.", whyItMatters: "", keyFacts: [] });
  const speech = (d) => programmaticChecks(d, aawsat, { minWords: 0 }).issues.some((i) => i.startsWith("كلام مترجم"));
  check("a quote in the house spelling is found in its source; translated speech still goes back", [speech(quoting("الإدارة الأمريكية ستفرض رسوماً جديدة")), speech(quoting("سنواجه هذه الرسوم بكل الوسائل المتاحة لدينا"))], [false, true]);
}
{
  // The review of 2026-10-30: half a quotation is never cut, and a body that points back reaches into the lede.
  const judgeAll = (verdict) => async ({ sentences }) => ({ answers: sentences.map((c) => ({ id: c.id, verdict })) });
  const quoted = { title: "عنوان", lede: "رفع البنك الفائدة.", body: "نص أول. قال الوزير «سنرفع الإنتاج إلى 5 ملايين برميل. وسنخفض الأسعار قريباً جداً» في مؤتمر صحفي.", keyFacts: [] };
  const half = await precheck({ draft: quoted, sources, verify: async () => ({ counts: {}, checks: [{ id: 3, field: "body", verdict: "not_found", status: "not_found", sentence: "وسنخفض الأسعار قريباً جداً» في مؤتمر صحفي.", quote: "" }] }), judgeWith: judgeAll("unsourced"), unsourced: true });
  check("half a quotation is never cut", half.draft.body, quoted.body);
  const across = { title: "عنوان", lede: "رفع البنك الفائدة. والخطوة التالية خفض الدعم.", body: "وهذه الخطوة تثير قلق الأسر.", keyFacts: [] };
  const crossing = await precheck({ draft: across, sources, verify: async () => ({ counts: {}, checks: [{ id: 2, field: "lede", verdict: "not_found", status: "not_found", sentence: "والخطوة التالية خفض الدعم.", quote: "" }] }), judgeWith: judgeAll("unsourced"), unsourced: true });
  check("the lede's last sentence stays when the body points back at it", crossing.draft.lede, across.lede);
}
{
  // The house spelling table (lib/copydesk.mjs), 2026-10-28.
  check("a decimal comma becomes the decimal point; a thousands group stays", [fixNames("2,22 مليون برميل"), fixNames("4,000 دولار"), fixNames("1,234,567")], ["2.22 مليون برميل", "4,000 دولار", "1,234,567"]);
  check("one outlet, one spelling", [fixNames("بحسب «إيه جي بي آي»"), fixNames("يرجّح موقع AGBI أن"), fixNames("«أرابيان غلف بزنس إنسايت» (AGBI)"), fixNames("فاينانشال تايمز")], ["بحسب «أرابيان غلف بزنس إنسايت»", "يرجّح موقع «أرابيان غلف بزنس إنسايت» أن", "«أرابيان غلف بزنس إنسايت» (AGBI)", "فايننشال تايمز"]);
  check("a name glossed with itself loses the gloss", fixNames("وقال موقع «إيه جي بي آي» (أرابيان غلف بيزنس إنسايت) إنه"), "وقال موقع «أرابيان غلف بزنس إنسايت» إنه");
  check("a box value keeps its figure, not a list after a colon", [figureOnly("3 أنظمة: التجاري والأوراق التجارية والدفاتر التجارية"), figureOnly("02:22"), figureOnly("نحو 70%")], ["3 أنظمة", "02:22", "نحو 70%"]);
  const box = normalizeDraft({ title: "t", key_facts: [{ label: "ديزل المرحلة الأولى", value: "2,22 مليون برميل" }, { label: "الأنظمة الملغاة", value: "3 أنظمة: التجاري والأوراق التجارية" }] }).keyFacts;
  check("the writer's box goes through the spelling table and keeps figures only", box.map((f) => f.value), ["2.22 مليون برميل", "3 أنظمة"]);
  const both = normalizeDraft({ title: "t", key_facts: [{ label: "الفائدة على الإيداع", value: "20%" }, { label: "التضخم", value: "12.5%" }], table: { title: "أرقام الأسبوع", columns: ["المؤشر", "القيمة"], rows: [["الفائدة على الإيداع", "20%"], ["سعر برنت", "113 دولاراً"], ["الذهب", "3890 دولاراً"]] } });
  check("the box never repeats a value its own table prints (the week's review, 2026-10-30)", both.keyFacts.map((f) => f.value), ["12.5%"]);
}

// 2. A story is not written twice: a retry of the same event, or the same event from another outlet.
check("the same headline again (a retried round) is caught", repeatsRecent("ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع", ["ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع"]) !== null, true);
check("the same event under another headline is caught", repeatsRecent("ترامب يعلن إنشاء «قوة للذكاء الاصطناعي» على غرار «قوة الفضاء»", ["ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع"]) !== null, true);
check("a different event is not", repeatsRecent("السعودية تعيد تشغيل خط «شرق - غرب» النفطي المتوقف منذ 13 سبتمبر", ["ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع"]), null);
check("one oil move under two names is still one event", repeatsRecent("برنت يقفز فوق 108 دولارات بعد إغلاق خط الأنابيب السعودي", ["النفط يقفز فوق 107 دولارات مع إغلاق خط الأنابيب السعودي"]) !== null, true);
check("two subjects sharing only a running war are two events", repeatsRecent("برنت عند أعلى مستوى في 5 أشهر فوق 111 دولاراً مع هجمات الحوثيين على السعودية", ["السعودية تؤجل مؤتمر مبادرة مستقبل الاستثمار إلى 2027 مع تصاعد هجمات الحوثيين"]), null);
check("two institutions' different forecasts are two events", repeatsRecent("صندوق النقد يتوقع انكماش اقتصادات الخليج 4.8% في 2026 قبل تعافيها 9.1% في 2027", ["البنك الدولي يتوقع انكماش اقتصادات الخليج 4.3% هذا العام"]), null);
// The earnings season of October 2026: Etisalat's results skipped twice and Bahri's once as repeats of Aldar's.
check("two companies' results are two events; one company's twice is one", [
  repeatsRecent("أرباح «اتصالات» ترتفع 46% إلى 17.2 مليار درهم في تسعة أشهر", ["أرباح الدار ترتفع 19% في 9 أشهر رغم تراجع مبيعاتها في الإمارات"]),
  repeatsRecent("أرباح البحري ترتفع 587% إلى 9.98 مليار ريال في 9 أشهر", ["أرباح الدار ترتفع 19% في 9 أشهر رغم تراجع مبيعاتها في الإمارات"]),
  Boolean(repeatsRecent("أرباح «الدار» العقارية ترتفع 19% في تسعة أشهر", ["أرباح الدار ترتفع 19% في 9 أشهر رغم تراجع مبيعاتها في الإمارات"])),
], [null, null, true]);
// 2026-10-29: Egypt's first rate rise since March 2024 was skipped as Pakistan's.
check("two countries' central banks are two events; one country's twice is one", [repeatsRecent("المركزي المصري يرفع الفائدة 1% في أول زيادة منذ مارس 2024", ["المركزي الباكستاني يرفع الفائدة إلى 12% في أول زيادة منذ أبريل"]), Boolean(repeatsRecent("المركزي المصري يرفع الفائدة 1% لأول مرة منذ مارس 2024 لكبح التضخم", ["المركزي المصري يرفع الفائدة 1% في أول زيادة منذ مارس 2024"]))], [null, true]);
// The review of 2026-10-30: countries are whole words, read in the main clause; a move before the subject is passed over.
check(
  "a country is a whole word: «مصرف» is no Egypt, «مشتركة» no Turkey, «للسعودية» Saudi, «المملكة المتحدة» Britain alone, «عمّان» Jordan",
  [[...countriesNamed("مصرف البحرين المركزي يبقي الفائدة")], [...countriesNamed("تأسيس شركة مشتركة للتركيز على يمنح العراقيل")], [...countriesNamed("توقعات النمو للسعودية")], [...countriesNamed("المملكة المتحدة ترفع الضرائب")], [...countriesNamed("عمّان ترفع أسعار الوقود")]],
  [["بحرين"], [], ["سعود"], ["بريطان"], ["اردن"]],
);
check(
  "an Egyptian and a Bahraini decision are two events; a cause clause's country does not split one",
  [repeatsRecent("المركزي المصري يبقي الفائدة دون تغيير", ["مصرف البحرين المركزي يبقي الفائدة دون تغيير"]), Boolean(repeatsRecent("أرامكو ترفع سعر البيع الرسمي لآسيا في ديسمبر مع تراجع صادرات العراق", ["أرامكو السعودية ترفع سعر البيع الرسمي لآسيا في ديسمبر"]))],
  [null, true],
);
check(
  "one company's results told two ways are one event; two banks' «ارتفاع أرباح» are two",
  [Boolean(repeatsRecent("ارتفاع أرباح سابك 30% إلى 1.2 مليار ريال", ["أرباح سابك ترتفع 30% إلى 1.2 مليار ريال"])), repeatsRecent("ارتفاع أرباح الراجحي 20% في الربع الثالث", ["ارتفاع أرباح الأهلي 18% في الربع الثالث"])],
  [true, null],
);
check(
  "a central bank called «مصرف» is not given Egypt's markets",
  [macroMarketOf("مصرف الإمارات المركزي يخفض الفائدة"), macroMarketOf("مصرف قطر المركزي يبقي الفائدة"), macroMarketOf("المركزي المصري يرفع الفائدة")],
  [[], [], ["egx30", "usdegp"]],
);
check(
  "rates fetch a market only as a central bank's decision: officials' remarks and a bank's card rates fetch none",
  [macroMarketOf("مسؤولان في الفيدرالي الأمريكي يريان حاجة إلى رفع الفائدة مجدداً"), macroMarketOf("بنك أمريكي يرفع الفائدة على بطاقات الائتمان"), macroMarketOf("الفيدرالي الأمريكي يبقي الفائدة بين 3.75% و4%")],
  [[], [], ["spx", "us10y", "dxy"]],
);
check(
  "a decision written with its vowel marks is a decision (a review of 2026-10-31)",
  [macroMarketOf("المركزي المصري يُثبّت الفائدة عند 27.25%"), macroMarketOf("المركزي المصري يُخفّض الفائدة 200 نقطة")],
  [["egx30", "usdegp"], ["egx30", "usdegp"]],
);
check(
  "an actor is placed by a whole word: «مشتركة» places no Turkish company, a Saudi city places a Saudi one",
  [unplacedActors({ title: "«أسيلسان» تؤسس شركة مشتركة لصناعة الرادارات", lede: "أعلنت «أسيلسان» التركية تأسيس شركة." }).length, unplacedActors({ title: "«معادن» توسّع مصهر الألمنيوم في ينبع", lede: "قالت «معادن» السعودية إنها توسّع." }).length],
  [1, 0],
);

// 2a. A Google News sitemap is read like a feed, and an Arabic address is filtered decoded (2026-10-22, Independent Arabia).
{
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  const entry = (section, slug, title) => `<url><loc>https://www.example.com/node/1/${encodeURIComponent(section)}/${encodeURIComponent(slug)}</loc><news:news><news:publication><news:name>x</news:name><news:language>ar</news:language></news:publication><news:title>${title}</news:title><news:publication_date>${fresh}</news:publication_date></news:news></url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${entry("اقتصاد", "تاسي-يهبط", "لماذا هبط &quot;تاسي&quot;؟")}${entry("رياضة", "مباراة", "موعد المباراة")}</urlset>`;
  const items = await fetchFeed({ id: "t", url: `data:text/xml;charset=utf-8,${encodeURIComponent(xml)}`, pathFilter: "/node/\\d+/(اقتصاد|الأخبار)/" });
  check("a news sitemap is read, and its Arabic sections filtered", items.map((i) => i.title), ['لماذا هبط "تاسي"؟']);
}

// 2a'. A feed that answers but has stopped moving (2026-10-31: Sky News Arabia's business feed stood still for two days
// after its desk moved to snabusiness.com) is told by its newest item of any age, never a future-dated one; a feed that
// fails tells nothing.
{
  const item = (title, date) => `<item><title>${title}</title><link>https://www.example.com/${encodeURIComponent(title)}</link><pubDate>${new Date(date).toUTCString()}</pubDate></item>`;
  const old = Date.now() - 4 * 86_400_000;
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${item("قديم", old - 86_400_000)}${item("الأحدث", old)}${item("موعد لاحق", Date.now() + 5 * 86_400_000)}</channel></rss>`;
  const heard = [];
  await fetchFeed({ id: "still", url: `data:text/xml;charset=utf-8,${encodeURIComponent(rss)}` }, { onRead: (info) => heard.push(info) });
  await fetchFeed({ id: "down", url: "http://127.0.0.1:9/feed.xml" }, { onRead: (info) => heard.push(info) });
  check("a feed tells its newest item of any age, never a future-dated one; a refused feed tells nothing", [heard.length, heard[0]?.newestAt?.slice(0, 10), heard[0]?.items], [1, new Date(old).toISOString().slice(0, 10), 3]);
}

// 2b. The last cut (2026-10-22): a sentence carrying a figure no source has, or a stitched second event, goes; the story stays.
{
  const sources = [{ title: "Houthi attack", text: "Drones struck the Dammam airport and an Aramco facility on Wednesday, killing 3 people and injuring 10. Brent rose to 111.2 dollars." }];
  const base = { title: "هجوم حوثي على مطار الدمام ومنشأة لأرامكو", subtitle: "برنت يرتفع إلى 111.2 دولار", lede: "استهدفت مسيّرات مطار الدمام ومنشأة لأرامكو الأربعاء، ما أسفر عن مقتل 3 أشخاص وإصابة 10.", body: "ارتفع خام برنت إلى 111.2 دولار للبرميل بعد الهجوم.\n\nوكانت هجمات سابقة قد أوقعت 36 جريحاً في الرياض. وتواصل الدفاعات اعتراض المسيّرات منذ أسابيع.\n\nوفي التاريخ نفسه، أعلنت شركة طيران خفض رحلاتها. وقالت إن الخفض مؤقت.\n\nوتراقب الأسواق إمدادات الخام السعودي من الخليج.", whyItMatters: "", keyFacts: [{ label: "الجرحى في هجمات سابقة", value: "36" }, { label: "سعر برنت", value: "111.2 دولار" }] };
  const before = programmaticChecks(base, sources, { minWords: 0 });
  check("the faults the cut is for are found first", [before.issues.some((i) => i.startsWith("أرقام لا تظهر في المصادر")), before.issues.some((i) => i.startsWith("خبر ثانٍ ملحق"))], [true, true]);
  const cut = cutToSources(base, sources);
  check("the figure's sentence and the stitched paragraph are cut, nothing else", [cut.draft.body.includes("36"), cut.draft.body.includes("التاريخ نفسه"), cut.draft.body.includes("الخفض مؤقت"), cut.draft.body.includes("وتواصل الدفاعات"), cut.draft.body.includes("111.2"), cut.draft.keyFacts.length], [false, false, false, true, true, 1]);
  const after = programmaticChecks(cut.draft, sources, { minWords: 0 });
  check("the cut draft passes the checks it failed", after.issues.filter((i) => CUTTABLE.test(i)).length, 0);
  check("a figure in the headline cannot be cut", cutToSources({ ...base, title: "هجوم حوثي يوقع 36 جريحاً" }, sources), null);
  check("a stitch in the lede cannot be cut", cutToSources({ ...base, lede: `${base.lede} وفي التاريخ نفسه، أعلنت شركة طيران خفض رحلاتها.` }, sources), null);
  check("a clean draft has nothing to cut", cutToSources({ ...base, body: "ارتفع خام برنت إلى 111.2 دولار للبرميل بعد الهجوم.", keyFacts: [] }, sources), null);
}

// 3. The lessons' lint: harmful rules refused, good ones kept.
check("a rule to drop figures is refused", lessonRuleOk("Skip secondary figures so the story stays focused on the main event and its lead number."), false);
check("a rule to state forecasts as outcomes is refused", lessonRuleOk("State forecasts, estimates and expectations as the outcome they point to, in the plain future tense."), false);
check("a rule to keep qualifiers is kept", lessonRuleOk("Never drop a figure's qualifier: 500 is not more than 500, and nearly 4,000 is not 4,000 in print."), true);
check("a rule to remove unsupported claims is kept", lessonRuleOk("Omit any claim the sources do not support, and keep every supported figure with its own qualifier."), true);

// 4. The state files: written whole, and a damaged one is never read as empty.
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "khazendar-selftest-"));
  const file = path.join(dir, "state.json");
  await writeJsonAtomic(file, { a: 1 });
  await writeJsonAtomic(file, { a: 2 });
  check("an atomic write leaves the new file whole and no temporary file", [JSON.parse(readFileSync(file, "utf8")).a, readdirSync(dir).length], [2, 1]);
  const broken = path.join(dir, "lessons.json");
  writeFileSync(broken, '{"lessons": [{"id": "L1"');
  const state = await loadLessons(broken);
  check("a damaged lessons file is read as damaged, not as empty", Boolean(state.damaged), true);
}

// 5. Two writers at once (the owner, 2026-09-26: "concurrent runs cannot silently lose fact-check, correction, or
// learning records"): a cloud run and a run by hand change the same state files from the same starting point, each
// adding its record where every writer adds one (at the end), and the hand run is replayed onto the cloud's as the
// workflows' `git pull --rebase -X theirs` does. Run twice: without the merge driver a record must be lost (the test is
// worthless on a layout git merges anyway), and with scripts/merge-state.mjs every record of both must survive.
function overlappingRuns(withDriver) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "khazendar-merge-"));
  const driver = path.resolve("scripts", "merge-state.mjs").replace(/\\/g, "/");
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  const put = (rel, data) => {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`);
  };
  const get = (rel) => JSON.parse(readFileSync(path.join(repo, rel), "utf8"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "selftest");
  git("config", "user.email", "selftest@example.com");
  git("config", "core.autocrlf", "false");
  if (withDriver) {
    git("config", "merge.state-json.driver", `"${process.execPath.replace(/\\/g, "/")}" "${driver}" %O %A %B`);
    put(".gitattributes", "pipeline/state/*.json merge=state-json\n");
  }
  const L1 = { id: "L1", rule: "r", seen: 3, evidence: ["a:1"], status: "active" };
  put("pipeline/state/factcheck.json", { version: 1, stories: { a: { at: "2026-09-25T10:00:00Z", outcome: "corrected" } } });
  put("pipeline/state/lessons.json", { version: 7, used: ["a:1"], lessons: [L1] });
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  // The cloud run: reads story b, learns from it (L1 reinforced), publishes story B.
  git("checkout", "-q", "-b", "cloud");
  put("pipeline/state/factcheck.json", { version: 1, stories: { a: { at: "2026-09-25T10:00:00Z", outcome: "corrected" }, b: { at: "2026-09-26T01:00:00Z", outcome: "clean" } } });
  put("pipeline/state/lessons.json", { version: 8, used: ["a:1", "b:1"], lessons: [{ ...L1, seen: 4, evidence: ["a:1", "b:1"] }] });
  put("content/articles/story-b.md", "---\ntitle: B\n---\n");
  git("add", "-A");
  git("commit", "-q", "-m", "cloud run");
  // The run by hand, from the same start: reads story c, learns a new lesson from it, publishes story C.
  git("checkout", "-q", "main");
  git("checkout", "-q", "-b", "local");
  put("pipeline/state/factcheck.json", { version: 1, stories: { a: { at: "2026-09-25T10:00:00Z", outcome: "corrected" }, c: { at: "2026-09-26T01:05:00Z", outcome: "corrected" } } });
  put("pipeline/state/lessons.json", { version: 8, used: ["a:1", "c:1"], lessons: [L1, { id: "L10", rule: "n", seen: 1, evidence: ["c:1"], status: "pending" }] });
  put("content/articles/story-c.md", "---\ntitle: C\n---\n");
  git("add", "-A");
  git("commit", "-q", "-m", "hand run");
  const rebase = git("rebase", "-q", "-X", "theirs", "cloud");
  let fc = null;
  let ls = null;
  try {
    fc = get("pipeline/state/factcheck.json");
    ls = get("pipeline/state/lessons.json");
  } catch {
    /* a merge that broke the JSON */
  }
  const l1 = ls?.lessons?.find((l) => l.id === "L1");
  return {
    status: rebase.status,
    stories: fc ? Object.keys(fc.stories).sort() : null,
    used: ls ? [...ls.used].sort() : null,
    l1: l1 ? [l1.seen, [...l1.evidence].sort()] : null,
    l10: Boolean(ls?.lessons?.some((l) => l.id === "L10")),
    articles: readdirSync(path.join(repo, "content", "articles")).sort(),
  };
}
if (spawnSync("git", ["--version"]).status === 0) {
  const without = overlappingRuns(false);
  const lost = JSON.stringify(without.stories) !== JSON.stringify(["a", "b", "c"]) || JSON.stringify(without.used) !== JSON.stringify(["a:1", "b:1", "c:1"]);
  check("overlapping runs without the merge driver lose a record (the case is real)", lost, true);
  const withDriver = overlappingRuns(true);
  check("overlapping runs: the replay applies without a conflict", withDriver.status, 0);
  check("overlapping runs: every fact-check record survives", withDriver.stories, ["a", "b", "c"]);
  check("overlapping runs: every learned mistake survives", withDriver.used, ["a:1", "b:1", "c:1"]);
  check("overlapping runs: both lessons' changes survive (L1 reinforced, L10 added)", [withDriver.l1, withDriver.l10], [[4, ["a:1", "b:1"]], true]);
  check("overlapping runs: both new stories are there, once each", withDriver.articles, ["story-b.md", "story-c.md"]);
} else console.log("skip overlapping runs: git is not installed here");

// 6. The saved evidence (the owner, 2026-09-26: "Verify that the evidence can still be retrieved when the original page
// changes or is unavailable"): a page that no longer answers is read from the copy saved at publication; a page that
// changed is read as it is now, its publication text alongside; a figure the saved copy carries is a changed page, one
// it never carried an error; and the first copy is never replaced.
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "khazendar-evidence-"));
  const url = "https://example.com/brent";
  const page = "Oil markets were busy on Friday. Brent fell 2.8% to 97.55 dollars a barrel, traders said. The dollar was steady. Analysts expect more volatility. Shipping costs rose sharply. Gold was flat.";
  await saveSnapshot({ slug: "s1", title: "t", sources: [{ url, sourceName: "رويترز", text: page, fetchedAt: "2026-09-26T00:00:00Z" }], checks: [{ field: "body", sentence: "توقع محللون مزيداً من التقلب", verdict: "supported", status: "supported", source: 1, quote: "Analysts expect more volatility." }], storyText: "تراجع برنت 2.8% إلى 97.55 دولار", dir });
  await saveSnapshot({ slug: "s1", title: "t", sources: [{ url, sourceName: "رويترز", text: "rewritten later" }], dir });
  const snap = loadSnapshot("s1", { dir });
  check("the copy saved at publication is never replaced", snap?.sources?.[0]?.passages?.includes("97.55"), true);
  // The passages, not the page (the repository is public): the quoted sentence with its neighbours, the figure's sentence.
  check("only the passages the story rests on are kept, never the whole page", [snap.sources[0].passages.includes("Analysts expect more volatility."), snap.sources[0].passages.includes("Gold was flat.")], [true, false]);
  // The path a real story takes: the check before publication's own record of its verdicts, then the save (a live round
  // on 2026-09-26 saved a story's claims but no passages, because the record named each quote's source by name while
  // the save matched by number; this case failed before that was fixed).
  const pre = await precheck({
    draft,
    sources: [{ sourceName: "رويترز", sourceNameEn: "Reuters", title: "t", url, text: page, fetchedAt: "2026-09-26T00:00:00Z" }],
    verify: async () => ({ counts: { checked: 1 }, checks: [{ id: 1, field: "body", verdict: "supported", status: "supported", sentence: "تراجع برنت 2.8%", quote: "Brent fell 2.8% to 97.55 dollars a barrel, traders said.", source: 1, sourceName: "Reuters" }] }),
    repairWith: repairer(true),
  });
  await saveSnapshot({ slug: "s2", title: "t", sources: checkSourcesOf([{ sourceName: "رويترز", sourceNameEn: "Reuters", title: "t", url, text: page, fetchedAt: "2026-09-26T00:00:00Z" }]), checks: pre.checks, storyText: "تراجع برنت 2.8%", dir });
  const s2 = loadSnapshot("s2", { dir });
  check("a real story's quoted passage reaches its saved evidence", [s2.sources[0].passages.includes("97.55"), s2.claims[0].source], [true, 1]);
  const story = { slug: "s1", sources: [{ url, name: "رويترز", nameEn: "Reuters" }] };
  const gone = await loadSources(story, { fetcher: async () => ({ ok: false, reason: "http-403" }), snapshot: snap });
  check("a page that no longer answers is read from its saved copy", [gone[0].text.includes("97.55"), Boolean(gone[0].snapshot)], [true, true]);
  const changed = await loadSources(story, { fetcher: async () => ({ ok: true, text: "Brent fell 3.1% to 96.80 dollars a barrel." }), snapshot: snap });
  check("a page that changed is read as it is now, with its publication text alongside", [changed[0].text.includes("96.80"), changed[0].saved.includes("97.55")], [true, true]);
  const settled = settleDrift([{ status: "drift", class: "figure", sentence: "تراجع برنت إلى 97.55 دولار" }, { status: "drift", class: "figure", sentence: "تراجع برنت إلى 91.25 دولار" }], [changed[0].saved]);
  check("a figure the saved copy carries is a changed page; one it never carried is an error", settled.map((c) => c.status), ["drift", "confirmed"]);
  // A sentence supported at publication, contradicted only by a page rewritten since (Binance's earlier 2.54 billion,
  // 2026-10-30): never corrected. With the contradicting quote in the saved copy too, or the story's own arithmetic, or a
  // sentence the check before publication never saw supported, it stays an error.
  const claims = [{ sentence: "قالت بينانس في وقت سابق إن الأصول المجمدة بلغت 2.54 مليار دولار", status: "supported" }, { sentence: "تراجع برنت 2.8%", status: "supported" }];
  const savedCopy = ["Before raising it to 3 billion, the company said the frozen assets were worth about 2.54 billion dollars.", "Brent fell 2.8% to 97.55 dollars a barrel, traders said. Brent fell 3.1% on the week, not 2.8%."];
  const confirmed = (sentence, quote, source = 1) => ({ status: "confirmed", class: "figure", sentence, quote, source });
  check(
    "a rewritten page never corrects what was supported at publication; an error the saved copy proves still does",
    settleChanged(
      [
        confirmed("قالت بينانس في وقت سابق إن الأصول المجمدة بلغت 2.54 مليار دولار", "Binance earlier announced it had frozen 3 billion dollars of assets."),
        confirmed("تراجع برنت 2.8%", "Brent fell 3.1% on the week, not 2.8%."),
        confirmed("قالت بينانس في وقت سابق إن الأصول المجمدة بلغت 2.54 مليار دولار", "the story's own sum", 0),
        confirmed("ارتفع الذهب 3%", "Gold rose 2% on Friday, dealers said in London."),
      ],
      claims,
      savedCopy,
    ).map((c) => c.status),
    ["drift", "confirmed", "confirmed", "confirmed"],
  );
  // Supported by one source at publication, contradicted later by another (the Saudi tariff support, 2026-10-31): the
  // sources disagree, a conflict listed, never corrected. Contradicted by the same source it stays as above.
  const tariff = "ويبدأ صرفه للعسكريين مع بدء تطبيق التعريفة الجديدة في 1 يناير 2027.";
  const named = [{ name: "الشرق الأوسط" }, { name: "الجزيرة نت" }, { name: "ذا ناشيونال" }];
  const backed = [{ sentence: tariff, status: "supported", source: 1, quote: "وتبدأ اعتباراً من العام المقبل وقت تطبيق التعريفة الجديدة." }];
  const against = (source, sourceName, quote) => ({ status: "confirmed", class: "period", sentence: tariff, quote, source, sourceName });
  check(
    "another source contradicting what one bore out at publication is a conflict; the same source, as before",
    [
      settleChanged([against(3, "ذا ناشيونال", "The support will take effect ahead of tariff changes.")], backed, ["The support will take effect ahead of tariff changes."], named)[0].status,
      settleChanged([against(1, "الشرق الأوسط", "وتبدأ قبل تطبيق التعريفة الجديدة.")], backed, ["وتبدأ قبل تطبيق التعريفة الجديدة."], named)[0].status,
    ],
    ["conflict", "confirmed"],
  );
  // As production names them (the review of 2026-10-31): the copy keeps the Arabic name and the English one, the check
  // names the source in English, and the page's list may number it differently. The same source is still the same.
  const copyNamed = [{ name: "الشرق الأوسط", nameEn: "Asharq Al-Awsat", url: "https://aawsat.com/economy/1" }, { name: "ذا ناشيونال", nameEn: "The National", url: "https://www.thenationalnews.com/business/2" }];
  const live = [{ n: 1, name: "The National", url: "https://www.thenationalnews.com/business/2" }, { n: 2, name: "Asharq Al-Awsat", url: "https://aawsat.com/economy/1" }];
  check(
    "the same source in another language or at another number is the same source; another source is a conflict",
    [
      settleChanged([against(2, "Asharq Al-Awsat", "وتبدأ قبل تطبيق التعريفة الجديدة.")], backed, ["وتبدأ قبل تطبيق التعريفة الجديدة."], copyNamed, live)[0].status,
      settleChanged([against(1, "The National", "The support will take effect ahead of tariff changes.")], backed, ["The support will take effect ahead of tariff changes."], copyNamed, live)[0].status,
      settleChanged([against(1, "Asharq Al-Awsat", "وتبدأ قبل تطبيق التعريفة الجديدة.")], backed, ["وتبدأ قبل تطبيق التعريفة الجديدة."], copyNamed)[0].status,
    ],
    ["confirmed", "conflict", "confirmed"],
  );
}

// The mend keeps the revision's fixes (2026-10-30): gold's October loss of 3.8%, cut for a later price, came back into the
// box, and Exxon's and Chevron's share moves went back from 1.6% and 1.5% to 2% and 1%. A figure the later findings ask for
// is not "undone"; a year and a small bare number are not counted.
{
  const before = { body: "فقد الذهب نحو 3.8% منذ مطلع أكتوبر. وارتفع سهم إكسون 2% وسهم شيفرون 1% في 2026.", keyFacts: [{ label: "خسائر أكتوبر", value: "نحو 3.8%" }] };
  const revised = { body: "تراجع الذهب إلى 3890 دولاراً. وارتفع سهم إكسون 1.6% وسهم شيفرون 1.5%.", keyFacts: [] };
  const mended = { body: "تراجع الذهب إلى 3890 دولاراً في 2026. وارتفع سهم إكسون 2% وسهم شيفرون 1%. وارتفعت 3 ناقلات.", keyFacts: [{ label: "خسائر أكتوبر", value: "نحو 3.8%" }] };
  check(
    "a figure the revision took out and the mend puts back is named; one the findings ask for, a year or a bare small number is not",
    [restoredFigures(before, revised, mended), restoredFigures(before, revised, mended, "ينقص التقرير: خسائر أكتوبر نحو 3.8% (المصدر 2)"), restoredFigures(before, revised, revised)],
    [["2%", "1%", "3.8%"], ["2%", "1%"], []],
  );
}

// 7. The «الأرقام» box holds figures (the owner, 2026-09-27, on «بغداد ومسقط», «النجف» and «الإقصاء من نظام الدولار»
// printed there): the story he found, the values the rule must keep though they carry no digit, the dates it must drop,
// and an explainer's glossary, which it must leave alone.
{
  const box = (values, kind) => boxFacts(values.map((value, i) => ({ label: `l${i}`, value })), kind).map((f) => f.value);
  check("the story he found keeps its one figure", box(["23 سبتمبر", "27", "بغداد ومسقط", "النجف", "الإقصاء من نظام الدولار"]), ["27"]);
  check("names, outlets, verdicts and «not announced» leave the box", box(["CATL، جيلي، BYD", "تروث سوشيال", "تثبيت الفائدة", "لم تُعلن", "البنزين والسولار", "لا تكلفة"]), []);
  check("weekdays, dates and years leave the box", box(["الخميس", "يوم الجمعة", "16 سبتمبر 2026", "من 14 إلى 16 سبتمبر 2026", "يناير 2005", "2018", "منذ عام 1972، واتفاقية شراكة استراتيجية منذ 2004"]), []);
  check("figures in letters, fractions, duals and ratings stay", box(["شهران", "ربع نقطة مئوية", "نحو الثلث", "الخُمس", "سبعة أيام", "BBB-", "رفعان", "٢٧ شركة"]), ["شهران", "ربع نقطة مئوية", "نحو الثلث", "الخُمس", "سبعة أيام", "BBB-", "رفعان", "٢٧ شركة"]);
  check("a figure with a date beside it stays", box(["9 أيام (13-22 سبتمبر)", "171 دولاراً للبرميل للأسبوع المنتهي في 4 سبتمبر"]), ["9 أيام (13-22 سبتمبر)", "171 دولاراً للبرميل للأسبوع المنتهي في 4 سبتمبر"]);
  check("an explainer's glossary is left alone", box(["سعر السهم × عدد الأسهم القائمة", "ينخفض السعر فيرتفع العائد"], "explainer").length, 2);
  // Every path to the file applies it: the writers' drafts, and the article as written (a repair or a revision included).
  const drafted = normalizeDraft({ title: "t", body: "b", key_facts: [{ label: "وجهات أُلغيت رحلاتها", value: "بغداد ومسقط" }, { label: "شركات النقل الجوي", value: "27" }] });
  check("a writer's draft keeps figures only", drafted.keyFacts.map((f) => f.value), ["27"]);
  const glossary = normalizeDraft({ title: "t", body: "b", key_facts: [{ label: "القيمة السوقية", value: "سعر السهم × عدد الأسهم" }] }, { kind: "explainer" });
  check("an explainer's draft keeps its terms", glossary.keyFacts.length, 1);
  const file = serializeArticle({ draft: { ...drafted, keyFacts: [{ label: "مطار بديل", value: "النجف" }, { label: "شركات", value: "27" }] }, slug: "s", section: "economy", sources: [], image: null, models: {}, quality: {} });
  check("the article as written keeps figures only", [file.includes("النجف"), file.includes('"27"')], [false, true]);
  // The second audit's sentences about figures (2026-09-27): a value opens with its quantity, in Arabic.
  check("a sentence about a figure leaves the box", box(["تجاوزت 100 دولار للبرميل هذا الأسبوع", "أدنى مستوى في 13 عاماً", "أعلنت 2023 لترخيص تقنية", "18-year high", "2022 و2024", "2026-09-17", "2030 على الأقل"]), []);
  check("a figure opening with its measure word stays", box(["أعلى من 126 دولاراً/برميل", "حتى 7%", "ارتفاع بأكثر من 40% منذ بداية الشهر", "قرابة يوم واحد", "A-3", "إيه+/إيه-1"]), ["أعلى من 126 دولاراً/برميل", "حتى 7%", "ارتفاع بأكثر من 40% منذ بداية الشهر", "قرابة يوم واحد", "A-3", "إيه+/إيه-1"]);
}

// 8. Labels that match their stories (the audits of 2026-09-27: "posting info that does not match category/title").
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "khazendar-tags-"));
  // A tag the story never mentions goes; one it words differently stays; spellings meet.
  const tags = cleanTags(["الذكاء الاصطناعي", "التجارة", "الأميركية", "الحوثيون", "لجنة الاتصالات الفيدرالية"], "قمة ترامب وشي تبحث التجارة والرسوم الجمركية، والسياسة الأمريكية تجاه الحوثي، وقرار هيئة الطيران الفيدرالية", { dir });
  check("tags: absent subjects and institutions go, worded ones stay, house spelling", tags, ["التجارة", "الأمريكية", "الحوثيون"]);
  // An Arab desk only where the headline, dek or lede names one of its places; a war named as a cause is not a place.
  check("desks: a US jobs report leaves the Gulf desk", groundedRegions(["الخليج", "الأمريكتان"], { title: "الاقتصاد الأمريكي يضيف 150 ألف وظيفة", lede: "أضاف الاقتصاد الأمريكي 150 ألف وظيفة في أغسطس" }), ["الأمريكتان"]);
  // One measure per chart (CHART_RULE, 2026-10-20): what code can see of it.
  const bars = (categories, values) => ({ type: "bar", title: "t", unit: "%", source: "s", categories, series: [{ name: "v", values }] });
  check("charts: a policy rate beside inflation is no chart", normalizeChart(bars(["سعر الفائدة الأساسي", "التضخم السنوي", "الحد الأعلى للنطاق"], [4.6, 3.5, 3])), null);
  check("charts: a bond yield beside a policy rate is no chart", normalizeChart(bars(["عوائد سندات بريطانيا", "عوائد سندات أمريكا", "معدل فائدة المركزي الأوروبي"], [5.37, 4.92, 2.5])), null);
  check("charts: Egypt's deposit rate is an interest rate, so three rates stay one measure", normalizeChart(bars(["سعر عائد الإيداع", "سعر عائد الإقراض", "سعر الائتمان والخصم"], [19, 20, 19.5]))?.categories.length, 3);
  check("charts: actual and expected as four bars become two series", normalizeChart(bars(["الصادرات (فعلي)", "الصادرات (متوقع)", "الواردات (فعلي)", "الواردات (متوقع)"], [25, 25.9, 28.2, 31]))?.series.map((x) => `${x.name}:${x.values.join(",")}`), ["فعلي:25,28.2", "متوقع:25.9,31"]);
  check("charts: a total beside its own parts loses the total, and two bars are no chart", normalizeChart(bars(["إجمالي التجارة الثنائية", "الصادرات", "الواردات"], [10, 7, 3])), null);
  check("charts: a rate that never moved is a sentence, not a chart", normalizeChart({ ...bars(["أبريل", "مايو", "يوليو"], [20, 20, 20]), type: "line" }), null);
  check("charts: a total that is not the sum of the others stays (a rate of the whole beside its groups)", normalizeChart(bars(["المعدل الإجمالي", "السعوديون", "السعوديات"], [3, 6.5, 9.6]))?.categories.length, 3);
  check("desks: the ECB's hike stays off the Middle East desk though the war is its cause", groundedRegions(["الشرق الأوسط", "أوروبا"], { title: "المركزي الأوروبي يرفع الفائدة إلى 2.5%", lede: "رفع البنك الفائدة لاحتواء التضخم الناجم عن أسعار النفط جراء الحرب في الشرق الأوسط" }), ["أوروبا"]);
  check("desks: a Saudi headline joins the Gulf desk", groundedRegions(["عالمي"], { title: "كيف يتجاوز خط الشرق-الغرب السعودي مضيق هرمز؟" }), ["عالمي", "الخليج"]);
  // ONE STORY: a second event brought in by a joint is refused.
  const stitched = styleIssues({ title: "مصر تنشئ مركز بيانات بمليار دولار", subtitle: "", lede: "أعلنت مصر خطة لمركز بيانات.", body: "وقالت الوزارة إن المرحلة الأولى تبدأ العام المقبل.\n\nوفي التاريخ نفسه، أعلنت «جوجل» استثماراً في فنلندا.", whyItMatters: "", keyFacts: [] }).issues;
  check("a second event stitched in is refused", stitched.some((i) => i.startsWith("خبر ثانٍ ملحق")), true);
  // A close is recorded, never reached; "the median stock" is said as what it shows (the owner, 2026-10-23).
  const closeFaults = (title, subtitle = "") => {
    const found = styleIssues({ title, subtitle, lede: "", body: "", whyItMatters: "", keyFacts: [] });
    return [found.issues.filter((i) => /الإغلاق يُسجَّل/.test(i)).length, [...found.issues, ...found.warnings].filter((i) => /مصطلح إحصائي/.test(i)).length];
  };
  check("«تهبط 2.3% إلى أدنى إغلاق» is sent back, «وسيط تراجع الأسهم» warned", closeFaults("الأسهم السعودية تهبط 2.3% إلى أدنى إغلاق منذ 2021", "ووسيط تراجع الأسهم يبلغ 3.32%"), [1, 1]);
  check("«لتسجل أدنى إغلاق», «إلى أدنى مستوى» and a broker («وسيط مالي») pass", closeFaults("السوق السعودية تهبط 2.3% لتسجل أدنى إغلاق منذ 2021", "المؤشر يهبط إلى أدنى مستوى منذ 2021 ووسيط مالي يتوقع ارتداداً"), [0, 0]);
  // WHO AND WHERE (the owner, 2026-10-29): a headline that drops the country its own story gives an actor.
  const acwa = { title: "«أكوا» و«إي آي جي» تؤسسان منصة كهرباء أمريكية برأسمال مستهدف 4 مليارات دولار", subtitle: "تملك «إي آي جي» 51% من منصة «بلينوم باور» و«أكوا» 49%", lede: "أعلنت «أكوا» السعودية و«إي آي جي» (EIG) الأمريكية إطلاق منصة مشتركة.", body: "", whyItMatters: "", keyFacts: [] };
  const unplacedOf = (draft) => styleIssues(draft).issues.filter((i) => i.startsWith("العنوان والوصف يسمّيان"));
  check("ACWA's headline is sent back for «أكوا» السعودية, EIG placed by «أمريكية»", unplacedOf(acwa).map((i) => [i.includes("«أكوا» السعودية"), i.includes("«إي آي جي» الأمريكية")]), [[true, false]]);
  check("«أكوا» السعودية in the headline passes", unplacedOf({ ...acwa, title: "«أكوا» السعودية و«إي آي جي» تؤسسان منصة كهرباء أمريكية بـ4 مليارات دولار" }).length, 0);
  check("the country in the dek passes", unplacedOf({ ...acwa, subtitle: "الشركة السعودية تملك 49% من المنصة" }).length, 0);
  check("a name the headline carries unquoted is read («إس كيه هاينكس» الكورية)", unplacedOf({ title: "إس كيه هاينكس تعلّق طرح وحدتها «سوليدايم» في أمريكا", subtitle: "", lede: "علّقت «إس كيه هاينكس» الكورية الجنوبية طرح وحدتها.", body: "", whyItMatters: "" }).length, 1);
  check("a household name the story gives no country passes", unplacedOf({ title: "«أبل» تطلق أول «ماك بوك برو» بشاشة لمس", subtitle: "", lede: "أطلقت «أبل» أول حاسوب «ماك بوك برو» بشاشة لمس.", body: "", whyItMatters: "" }).length, 0);

  // The first Sol story was factually clean but had an incomplete headline and three tiny dispatches.
  const dispatches = [
    "وقالت القيادة المركزية الأمريكية إن إيران أغرقت سفينة الحاويات «جي إف إس برايد» الأربعاء في مضيق هرمز.",
    "وأفادت الهيئة البحرية السنغافورية بإجلاء أفراد طاقم السفينة المسجلة في سنغافورة بسلام.",
    "وقالت المنظمة البحرية الدولية إن الاعتداءات أسفرت عن إصابة ثلاثة بحارة، وظل اثنان في عداد المفقودين.",
  ];
  const brief = { title: "يلامس برنت 110 دولارات مع مخاوف الإمدادات عبر هرمز", subtitle: "ارتفع برنت 4.9% خلال الأسبوع", lede: "لامس خام برنت 110 دولارات للبرميل الجمعة.", body: dispatches.join("\n\n"), whyItMatters: "تتعلق المخاوف بوصول النفط عبر المضيق." };
  check("the reported compressed supply-fears headline is sent back", styleIssues(brief).issues.some((i) => i.startsWith("العنوان يختزل المعنى")), true);
  const naturalTitle = "برنت يلامس 110 دولارات وسط مخاوف بشأن الإمدادات عبر هرمز";
  check("a complete fears phrase passes", styleIssues({ ...brief, title: naturalTitle }).issues.some((i) => i.startsWith("العنوان يختزل المعنى")), false);
  check("whose fears they are is a valid possessive", styleIssues({ ...brief, title: "مخاوف المستثمرين تدفع الذهب إلى الصعود" }).issues.some((i) => i.startsWith("العنوان يختزل المعنى")), false);
  check("three detached dispatches prompt a flow review", styleIssues(brief).warnings.some((i) => i.startsWith("ثلاث فقرات قصيرة")), true);
  // The Fed story of 2026-10-28 closed its box by taking the inference back; five more boxes argued «لا… وحده».
  const takesBack = (whyItMatters) => styleIssues({ ...brief, whyItMatters }).warnings.some((i) => i.startsWith("«لماذا يهمّ» تنفي"));
  check("a box that takes its inference back goes to the desk", takesBack("إذا ظل النفط يدفع الأسعار صعوداً، فسيقف الاحتياطي الفيدرالي بين خيارين. ومسار أسعار الطاقة سيحدد ثمن كل منهما، من دون أن يحسم وحده اتجاه القرار."), true);
  check("a box arguing what a thing does not do «وحده» goes to the desk", [takesBack("حجم الاستثمارات وحده لا يحدد سرعة زيادة الإنتاج."), takesBack("إعادة فتح المطار لا تعيد وحدها حركة السفر.")], [true, true]);
  check("so does a box correcting a claim nobody made, «، لا بـ…»", takesBack("فإن حجم ما ستضخه المنصة في الكهرباء الأمريكية يتحدد صفقة بصفقة، لا بإعلان التأسيس."), true);
  check("a box that ends on its inference passes, and «وحده» as an amount is no take-back", [takesBack("إذا ظل النفط يدفع الأسعار صعوداً، فسيقف الاحتياطي الفيدرالي بين رفع يكبح الطلب وتمهّل يترك التضخم يترسخ."), takesBack("ويمثل النفط وحده ثلث صادرات البلاد، فكل تراجع في سعره يضغط على الموازنة.")], [false, false]);
  check("a short brief is not automatically a flow defect", styleIssues({ ...brief, body: dispatches.slice(0, 2).join("\n\n") }).warnings.some((i) => i.startsWith("ثلاث فقرات قصيرة")), false);
  check("grouped related dispatches do not trigger the same warning", styleIssues({ ...brief, body: dispatches.join(" ") }).warnings.some((i) => i.startsWith("ثلاث فقرات قصيرة")), false);
  check("literal news bullet lists are sent for editing", styleIssues({ ...brief, body: dispatches.map((p) => `- ${p}`).join("\n") }).issues.some((i) => i.startsWith("متن الخبر قائمة")), true);
  check("an explainer's list is not treated as news prose", styleIssues({ ...brief, body: "- سعر الفائدة هو كلفة الاقتراض." }, { kind: "explainer" }).issues.some((i) => i.startsWith("متن الخبر قائمة")), false);
  const regrouped = judgeRewrite(brief, { title: naturalTitle, body: [dispatches[2], dispatches[0], dispatches[1]].join(" ") }, ["title", "body"]);
  check("the fact guard permits regrouping without losing facts", Object.keys(regrouped.accepted).sort(), ["body", "title"]);
  const changedFigure = judgeRewrite(brief, { title: naturalTitle.replace("110", "120") }, ["title"]);
  check("improving the headline cannot change its figure", changedFigure.rejected.some((r) => r.field === "title"), true);
  // 2026-10-29: the World Bank's 105-dollar scenario went out without its «إذا».
  const scenario = { title: "البنك الدولي يرفع توقعاته لأسعار السلع الأولية", subtitle: "", lede: "رفع البنك الدولي توقعاته لأسعار السلع.", body: "وحذّر البنك من أن يرتفع متوسط سعر برنت إلى 105 دولارات للبرميل في 2027 إذا تعطلت إمدادات إضافية بنحو 5 ملايين برميل يومياً." };
  const bare = "وحذّر البنك من أن يرتفع متوسط سعر برنت إلى 105 دولارات للبرميل في 2027، مع تعطل إمدادات إضافية بنحو 5 ملايين برميل يومياً.";
  const reworded = "وحذّر البنك من ارتفاع متوسط سعر برنت إلى 105 دولارات للبرميل في 2027 في حال تعطلت إمدادات إضافية بنحو 5 ملايين برميل يومياً.";
  check("a forecast's condition may be reworded, never dropped", [judgeRewrite(scenario, { body: bare }, ["body"]).rejected.some((r) => r.field === "body"), judgeRewrite(scenario, { body: reworded }, ["body"]).rejected.some((r) => r.field === "body")], [true, false]);
  // The review of 2026-10-30: «ما إذا» is "whether", and its fix «هل» drops no condition; «في حالة» keeps one.
  const whether = { ...scenario, body: "وقال البنك إن لجنته ستدرس ما إذا كان التضخم يتراجع بما يكفي قبل اجتماعها المقبل." };
  const inCase = scenario.body.replace(/إذا|في حال(?!ة)/, "في حالة");
  check(
    "«ما إذا» rewritten «هل» drops no condition; «في حالة» keeps one",
    [judgeRewrite(whether, { body: "وقال البنك إن لجنته ستدرس هل يتراجع التضخم بما يكفي قبل اجتماعها المقبل." }, ["body"]).rejected.some((r) => r.field === "body"), judgeRewrite(scenario, { body: inCase }, ["body"]).rejected.some((r) => r.field === "body")],
    [false, false],
  );
  // 2026-10-18: no explainer or analysis had been published since 1 October; the two of that day were thrown away by
  // rules that contradicted each other or a sound phrase.
  const hedgedExplainer = { title: "إعادة تمويل الدين العام قد تغيّر كلفته حتى مع ثبات أصله", subtitle: "تستبدل الحكومة ديناً يحل أجله بدين جديد", lede: "تلجأ الحكومات إلى إعادة تمويل ديونها حين يحل أجل السندات.", body: "تصدر الحكومة سندات جديدة تسدد بها القديمة." };
  check("an explainer's hedged headline may become the question it answers", Object.keys(judgeRewrite(hedgedExplainer, { title: "لماذا تتغير كلفة الدين العام عند إعادة تمويله حتى مع ثبات أصله؟" }, ["title"]).accepted), ["title"]);
  check("the same headline may not become an assertion", Object.keys(judgeRewrite(hedgedExplainer, { title: "إعادة تمويل الدين العام تغيّر كلفته حتى مع ثبات أصله" }, ["title"]).accepted), []);
  const passiveAgent = (body) => styleIssues({ ...brief, title: naturalTitle, body }).issues.some((i) => /«من قِ?بل»/.test(i));
  check("«من قبل» with its agent is the calque", passiveAgent("رُفع التصنيف من قبل الوكالة الأسبوع الماضي."), true);
  check("«من قِبل» before a quoted name is the calque", passiveAgent("رُفع التصنيف من قِبل «موديز» الأسبوع الماضي."), true);
  check("«من قبل» meaning before, at a clause's end, is good Arabic", passiveAgent("لم تبلغ البورصة هذا المستوى من قبل."), false);
  check("«من قبل أن» is good Arabic", passiveAgent("ارتفع السهم من قبل أن يبدأ الطرح."), false);
  const withBox = { ...brief, title: naturalTitle, subtitle: "برنت يحقق مكاسب أسبوعية بنسبة 4.9%", keyFacts: [{ label: "مكاسب برنت الأسبوعية", value: "4.9%" }] };
  const dekFault = (d) => programmaticChecks(d, [{ text: "Brent 110, weekly gain 4.9%." }], { minWords: 0 }).issues.some((i) => i.startsWith("الوصف الفرعي"));
  check("a dek may develop a figure in the story's numeric sidebar", dekFault(withBox), false);
  check("an unrelated dek still fails its topic check", dekFault({ ...withBox, subtitle: "شركة الطيران الكندية تطلب أسطولاً جديداً من الطائرات" }), true);
  const englishFault = (body) => programmaticChecks({ ...withBox, body }, [{ text: "Brent 110, weekly gain 4.9%." }], { minWords: 0 }).issues.some((i) => i.startsWith("كلمات إنجليزية تُركت"));
  check("a parenthesized Latin proper name is identification, not English prose", englishFault("وقال النائب دون باير (Don Beyer) إن القرار لا يخدم مصالح بلاده."), false);
  check("an English common word in Arabic prose still needs translation", englishFault("وقال النائب دون باير إن outlook الاقتصاد تحسن."), true);
  // The gas benchmark as the house style orders it written («عقود TTF الهولندية», style.mjs) is not untranslated
  // (2026-10-31: its warning and the critic's «غير معرّب» helped reject the European gas story).
  const ttf = programmaticChecks({ ...withBox, body: "وارتفعت عقود TTF الهولندية للغاز تسليم الشهر المقبل، كما صعد مؤشر JKM الآسيوي." }, [{ text: "Brent 110, weekly gain 4.9%. TTF and JKM rose." }], { minWords: 0 });
  check("the gas benchmarks TTF and JKM are not called untranslated Latin", [...ttf.issues, ...ttf.warnings].some((m) => /TTF|JKM/.test(m)), false);
  // GRAVITY: a curiosity the photograph names and the story does not is refused in code.
  check("photos: a horse-drawn fuel cart under a central-bank story is refused", noveltyFault({ title: "CairoHorseDrawnFuelTransport.jpg", alt: "عربة وقود يجرها حصان في محطة بنزين بالقاهرة" }, { title: "برنت فوق 105 دولارات يعقّد حسابات المركزي المصري" }), "Horse");
  check("photos: an oil field's «nodding donkey» is a pumpjack, not an animal", noveltyFault({ title: "Oil pumpjack in the Permian Basin.jpg", categories: "Nodding donkeys in Texas" }, { title: "النفط يتراجع مع آمال مفاوضات هرمز" }), null);
  check("photos: sheep on an Eid-prices story, a shopping trolley and a street named Jamal pass",[noveltyFault({ title: "Sheep market Riyadh.jpg", alt: "سوق الأغنام في الرياض" }, { title: "أسعار الأضاحي ترتفع في السعودية" }), noveltyFault({ title: "Shopping cart.jpg", alt: "عربة تسوق" }, { title: "التضخم في مصر" }), noveltyFault({ title: "Jamal Street.jpg", alt: "شارع جمال عبد الناصر" }, { title: "التضخم في مصر" })], [null, null, null]);
}

// 9. Reader findings survive an overgenerous overall score (the Russia-waiver report scored 10).
{
  const context = { fact: "القانون يستهدف زيادة الضغط الاقتصادي على روسيا بسبب الحرب", source: 2 };
  const notes = { reader_context: context, facts: Array.from({ length: 20 }, (_, i) => ({ fact: `تفصيل إجرائي ${i}`, source: 1 })) };
  prioritizeContext(notes);
  check("useful sourced context survives a full twenty-fact notes budget", notes.facts.slice(0, 20)[0], context);
  const repeated = { reader_context: context, facts: [context, { ...context }, { fact: "تفصيل آخر", source: 1 }] };
  prioritizeContext(repeated);
  check("the context fact is not counted twice", repeated.facts.length, 2);
  // The context is often the event's driver: listed among the facts as well, it keeps that job (2026-10-30, the review).
  const asDriver = { fact: "ارتفعت الصادرات بعد خفض الرسوم الجمركية", source: 1 };
  const tagged = { reader_context: asDriver, facts: [{ ...asDriver, job: "driver" }, { fact: "رحّب المصدّرون بالقرار", source: 1, job: "reaction" }] };
  prioritizeContext(tagged);
  check("a context fact the notes also list keeps its job, so it still explains the event", [explainingFacts(tagged), tagged.facts[0] === asDriver], [2, true]);
  const thin = { reader_context: null, facts: [{ fact: "خبر مقتضب", source: 1 }] };
  prioritizeContext(thin);
  check("thin sources do not force invented context", thin.facts.length, 1);
  const identity = { fact: "سليم نور مسؤول الدخل الثابت في شركة واحة للاستثمارات", source: 2 };
  const rich = { reader_context: context, identifications: [identity], facts: Array.from({ length: 20 }, (_, i) => ({ fact: `تفصيل ${i}`, source: 1 })) };
  prioritizeContext(rich);
  check("expert identification survives the same twenty-fact budget", rich.facts.slice(0, 20).includes(identity), true);
  const programme = { fact: "برنامج رعاية يوفر تأميناً صحياً حكومياً", source: 2 };
  const withProgramme = { reader_context: context, identifications: [programme], facts: Array.from({ length: 20 }, (_, i) => ({ fact: `تفصيل ${i}`, source: 1 })) };
  prioritizeContext(withProgramme);
  check("a sourced programme function survives the same notes budget", withProgramme.facts.slice(0, 20).includes(programme), true);
  const noContext = { reader_context: null, identifications: [identity], facts: [identity] };
  prioritizeContext(noContext);
  check("an expert can be identified without invented economic context or duplication", noContext.facts, [identity]);
  const invalidContext = (reader_context) => { try { prioritizeContext({ reader_context, facts: [] }); return false; } catch { return true; } };
  check("a boolean is not a contextual fact", invalidContext(false), true);
  check("a context label without a fact is refused", invalidContext({ source: 1 }), true);
  const clear = Object.fromEntries(["scope", "context", "flow", "precision"].map((area) => [area, { status: "clear", evidence: "الخبر واضح ضمن نطاق الأدلة المتاحة", repair: "" }]));
  const review = { score: 10, verdict: "publish", issues: [], summary: "مراجعة", reader_check: clear };
  for (const score of ["Infinity", 11, -1, null, true, [], ""]) {
    let refused = false;
    try { normalizeCritique({ ...review, score }, { news: true }); } catch { refused = true; }
    check(`invalid critic score ${JSON.stringify(score)} is a malformed response`, refused, true);
  }
  check("a numeric-string critic score remains compatible", normalizeCritique({ ...review, score: "6" }, { news: true }).score, 6);
  for (const area of ["scope", "context", "flow", "precision"]) {
    const result = normalizeCritique({ ...review, reader_check: { ...clear, [area]: { status: "revise", evidence: "العنوان لا يميز العقوبات الجديدة من السابقة", repair: "بيّن نطاق الإعفاء في المقدمة" } } }, { news: true });
    check(`reader ${area} defect requests revision despite a 10/10 verdict`, [result.verdict, result.score, result.issues.some((i) => i.includes("بيّن نطاق"))], ["revise", 10, true]);
  }
  check("a clear brief does not acquire a new rejection threshold", normalizeCritique(review, { news: true }).verdict, "publish");
  check("a reader finding cannot erase a factual rejection", normalizeCritique({ ...review, verdict: "reject", score: 3 }, { news: true }).verdict, "reject");
  check("other genres keep their existing review contract", normalizeCritique({ score: 8, verdict: "publish", issues: [] }).verdict, "publish");
  const refuses = (reader_check) => { try { normalizeCritique({ ...review, reader_check }, { news: true }); return false; } catch { return true; } };
  check("an unexplained numeric score is not a complete news review", refuses(undefined), true);
  check("a missing reader observation is refused", refuses({ ...clear, flow: undefined }), true);
  check("a number cannot substitute for a reader observation", refuses({ ...clear, flow: { status: "clear", evidence: 10 } }), true);
  check("a revision finding needs an actionable repair", refuses({ ...clear, context: { status: "revise", evidence: "سياق ضروري غائب", repair: "" } }), true);
  check("a thin source can make context not applicable without a false alarm", normalizeCritique({ ...review, reader_check: { ...clear, context: { status: "not_applicable", evidence: "المصدر خبر مقتضب ولا يقدم خلفية إضافية", repair: "" } } }, { news: true }).verdict, "publish");
}

{
  const old = '---\nslug: same-story\nsection: economy\nkind: news\npublishedAt: 2026-10-17T10:00:00Z\nfeatured: true\nimage: {url: old.jpg}\ncorrections: [{date: 2026-10-17T11:00:00Z, note: تصحيح سابق}]\n---\nقديم';
  const fresh = '---\nslug: same-story\nsection: economy\nkind: news\npublishedAt: 2026-10-18T10:00:00Z\nimage: null\ndraft: true\n---\nخبر موسع';
  const merged = mergeNewsRefresh(old, fresh, { note: "إضافة شرح وتعريف بالمحلل", at: "2026-10-18T12:00:00Z" });
  check("a refresh keeps the original publication date, picture, cover choice and correction history", [merged.includes("publishedAt: 2026-10-17T10:00:00Z"), merged.includes("old.jpg"), merged.includes("featured: true"), merged.includes("تصحيح سابق"), merged.includes("draft: true")], [true, true, true, true, false]);
  check("a style refresh records its date and body without a public editorial banner", [merged.includes("إضافة شرح وتعريف بالمحلل"), merged.includes("updatedAt: 2026-10-18T12:00:00Z"), merged.includes("خبر موسع"), merged.includes("updates:")], [false, true, true, false]);
  let refused = false;
  try { mergeNewsRefresh(old, fresh.replace("same-story", "different-story"), { note: "تحديث" }); } catch { refused = true; }
  check("a refresh cannot overwrite a different article", refused, true);
}

{
  const body = "وقال المحلل إن كلفة التمويل لم تتغير.\n\nواستندت الوكالة إلى تحسن الإيرادات.\n\nوقالت الوزارة إن احتياطياتها زادت.\n\nوأوضحت الوكالة أن الدين لا يزال مرتفعاً.";
  const warnings = (text) => styleIssues({ title: "قرار التصنيف الائتماني", lede: "رفعت الوكالة التصنيف الائتماني.", body: text, whyItMatters: "" }).warnings;
  check("monotonous waw/reporting openings include the previously exempt reporting verbs", warnings(body).some((w) => w.includes("كل فقرات المتن")), true);
  check("ordinary waw is not by itself a defect", warnings(body.replace("واستندت", "استندت")).some((w) => w.includes("كل فقرات المتن")), false);
  check("substantial sources get developed reporting guidance", newsDepthBrief([{ text: "a".repeat(4000) }, { text: "b".repeat(4000) }]).includes("450-650"), true);
  check("definitions alone do not turn a brief into rich event reporting", newsDepthBrief([{ text: "short event" }, { kind: "reference", text: "a".repeat(9000) }]).includes("450-650"), false);
}

{
  const defects = (body, whyItMatters = "") => styleIssues({ title: "قرار اقتصادي", lede: "أعلن المصرف قراره.", body, whyItMatters }).issues;
  check("vague reference attribution cannot pass as finished journalism", defects("التصنيف الائتماني، وفق تعريف المرجع، رأي في القدرة على السداد.").some((i) => i.includes("إسناد مبهم")), true);
  check("the benchmark sense of مرجع remains legitimate", defects("يظل خام برنت مرجعاً لتسعير النفط.").some((i) => i.includes("إسناد مبهم")), false);
  check("an analyst-led recap cannot replace the house synthesis", defects("يرى المحلل أن القرار مفيد.", "يرى محمود نجلة أن التصنيف الجديد يحسن شروط التمويل.").some((i) => i.includes("تبدأ بإسناد")), true);
  check("attributed reporting remains valid in the body", defects("يرى المحلل أن القرار مفيد.", "تبقى كلفة الدين قيداً على الموازنة رغم تحسن التصنيف.").some((i) => i.includes("تبدأ بإسناد")), false);
  const sources = [{ text: "بلغ الدين 81.9% من الناتج المحلي." }];
  const refuses = (basis) => { try { validateWhyBasis({ why_basis: basis }, sources); return false; } catch { return true; } };
  check("synthesis premises need real source numbers", refuses([{ fact: "الدين مرتفع", source: 2 }]), true);
  check("a premise cannot borrow a figure absent from its source", refuses([{ fact: "بلغ الدين 60% من الناتج المحلي", source: 1 }]), true);
  check("a sourced premise is accepted for semantic review", refuses([{ fact: "بلغ الدين 81.9% من الناتج المحلي", source: 1 }]), false);
  // 2026-10-29: eleven drafts in six runs were refused and written again over the count alone.
  const six = { why_basis: Array.from({ length: 6 }, () => ({ fact: "بلغ الدين 81.9% من الناتج المحلي", source: 1 })) };
  validateWhyBasis(six, sources);
  check("more than four premises keep the first four; none is still refused", [six.why_basis.length, refuses([])], [4, true]);
}

// News depth (the owner, 2026-10-18: "low quality articles (also too short)"): a news story is a developed report of at
// least NEWS_FLOOR words whatever the notes hold, the checks refuse a shorter one, and the copy desk may not cut a
// story under the floor.
{
  const sentence = "وارتفع خام برنت في جلسة الجمعة مع تصاعد المخاوف من تعطل الإمدادات عبر المضيق.";
  const bodyOf = (n) => Array.from({ length: n }, () => sentence).join("\n\n");
  const story = (n) => ({ title: "برنت يرتفع مع مخاوف تعطل الإمدادات", subtitle: "مكاسب أسبوعية للخام", lede: "ارتفع خام برنت الجمعة.", body: bodyOf(n), whyItMatters: "", keyFacts: [] });
  const short = (d) => programmaticChecks(d, [{ text: sentence }]).issues.some((i) => i.startsWith("المقال قصير جداً"));
  check("the news floor no longer bends to thin notes", [newsFloor(null), newsFloor({ facts: [1, 2, 3] }), newsFloor({ facts: Array(25).fill(1) })], [NEWS_FLOOR, NEWS_FLOOR, NEWS_FLOOR]);
  check("a 170-word news story is refused", short(story(12)), true);
  check("a developed news story passes the floor", short(story(24)), false);
  const long = story(24);
  const cut = judgeRewrite(long, { body: bodyOf(16) }, ["body"], { minWords: NEWS_FLOOR });
  check("the copy desk cannot cut a news story under the floor", [Boolean(cut.accepted.body), cut.rejected.some((r) => /^length: the story would fall/.test(r.reason))], [false, true]);
  const trimmed = judgeRewrite(long, { body: bodyOf(22) }, ["body"], { minWords: NEWS_FLOOR });
  check("a desk trim that keeps the story above the floor is accepted", Boolean(trimmed.accepted.body), true);
  check("the writer's brief carries the six elements on thin and rich material", [newsDepthBrief([{ text: "x" }]), newsDepthBrief([{ text: "a".repeat(4000) }, { text: "b".repeat(4000) }])].every((b) => b.includes("WHAT COMES NEXT") && b.includes("THE REACTION")), true);
  check("no brief tells a writer that a thin event may run as a brief", /remains a brief|brief of 120|honestly brief/.test(`${newsDepthBrief([{ text: "x" }])}${NEWS_DEPTH}`), false);
}

// The short story (editorial.mjs SHORT_STORY, 2026-10-18): 120-320 words with no boxes, marked `format: short` in its
// frontmatter; a developed report carries no such field; the copy desk may trim a short story down to its own floor.
{
  const sentence = "أعلنت شركة فيرتيغلوب الأحد خطة لإنشاء مجمع للأسمدة الفوسفاتية في مصر بطاقة كبيرة.";
  const bodyOf = (n) => Array.from({ length: n }, () => sentence).join("\n\n");
  const base = { title: "فيرتيغلوب تخطط لمجمع أسمدة فوسفاتية في مصر", subtitle: "المشروع ينتظر تقييم الإمدادات", slug: "fertiglobe-phosphate-complex-egypt", lede: "أعلنت فيرتيغلوب خطة لمجمع أسمدة.", body: bodyOf(13), tags: ["الأسمدة"] };
  const refused = (d, o) => { try { validateDraft(structuredClone(d), o); return false; } catch { return true; } };
  check("a short story needs no «لماذا يهمّ»", refused(base, { ...SHORT_WORDS, short: true }), false);
  check("a developed report still needs one", refused(base, { minWords: 100 }), true);
  check("a short story over its word ceiling is refused", refused({ ...base, body: bodyOf(30) }, { ...SHORT_WORDS, short: true }), true);
  check("a short story under its floor is refused", refused({ ...base, body: bodyOf(6) }, { ...SHORT_WORDS, short: true }), true);
  const draft = { ...base, keyFacts: [], whyItMatters: "", regions: [], chart: null, table: null };
  const md = (format) => serializeArticle({ draft, slug: base.slug, section: "companies", sources: [], image: null, models: {}, quality: {}, format });
  check("a short story is marked in its frontmatter, a developed report is not", [/\nformat: short\n/.test(md("short")), /\nformat:/.test(md("full"))], [true, false]);
  const trimmed = judgeRewrite(draft, { body: bodyOf(11) }, ["body"], { minWords: SHORT_WORDS.minWords });
  const cut = judgeRewrite(draft, { body: bodyOf(7) }, ["body"], { minWords: SHORT_WORDS.minWords });
  check("the desk may trim a short story to its own floor, never below it", [Boolean(trimmed.accepted.body), Boolean(cut.accepted.body)], [true, false]);
}

// The reports desk (lib/reports.mjs, 2026-10-18): an edition is dated by its label or its address, labelled in Arabic,
// read from the report's own document (never an annex, a country note or a methodology note), and its passages on the
// Arab economies come before those on the major economies.
{
  check(
    "editions are dated by a month, a season, a year or an address",
    [editionKey("World Economic Outlook, October 2026")?.key, editionKey("Herbst 2026")?.key, editionKey("Annual Report 2025/26", 11)?.key, editionKey("Issue 14: | en news press release 2025 06 19 gcc")?.key],
    [202610, 202609, 202511, 202506],
  );
  check("an edition is labelled in Arabic", [arabicEdition(editionKey("October 2026")), arabicEdition(editionKey("Spring 2026 Economic Forecast")), arabicEdition(editionKey("Global Wealth Report 2026", 6))], ["أكتوبر 2026", "ربيع 2026", "2026"]);
  const page = `<a href="/related/mpo-egy.pdf">Egypt</a><a href="/methodology.pdf">Refinery margin methodology</a><a href="https://openknowledge.worldbank.org/bitstreams/abc/download">Full Report</a><a href="/ar/download">التقرير باللغة العربية</a>`;
  check("the full report is chosen over a country note, a methodology note and another language", bestPdf(page, "https://www.worldbank.org/x", { nameEn: "MENAAP Economic Update" }, { key: 202610 }), "https://openknowledge.worldbank.org/bitstreams/abc/download");
  check("no document is taken when none is the report", bestPdf(`<a href="/methodology.pdf">Methodology</a>`, "https://www.iea.org/x", { nameEn: "IEA Oil Market Report" }, { key: 202610 }), null);
  const pages = ["Cover", "Executive summary\nGrowth in the region is projected at 2.1 percent in 2026 while Gulf output fell sharply in the second quarter of the year.", "In Germany, output is expected to grow by 0.4 percent in 2026, held back by weak industry and exports to China and the United States.\nIn Egypt, growth is projected at 4.6 percent in fiscal 2026, while Saudi Arabia's economy contracts by 3.0 percent as oil output falls."];
  const { summary, countries } = reportExcerpts(pages, { countryChars: 160 });
  check("the summary starts at the executive summary", summary.startsWith("[p.2] Executive summary"), true);
  // 2026-10-31, the World Bank's Commodity Markets Outlook of October: its repository's download link is a script page,
  // its summary heading comes out letter-spaced, and the news desk had told it already, naming the report in its body.
  const spaced = reportExcerpts(["Cover", "", "Commodity Markets Outlook OCTOBER 2026 A World Bank Group Report", "© 2026 International Bank for Reconstruction and Development / The World Bank. Some rights reserved; this work is a product of the staff.", "E X E C U T I V E S U M M A RY C O M M O D I T Y M A R K E T S O U T L O O K\nEnergy prices are expected to rise 32 percent in 2026."]);
  check("a letter-spaced summary heading is found, the copyright page left out", [spaced.summary.startsWith("[p.5] E X E C"), spaced.summary.includes("Some rights reserved")], [true, false]);
  check(
    "a repository's download link is read from its API; other addresses are left as they are",
    [documentUrl("https://openknowledge.worldbank.org/bitstreams/b89c473c-d071-4aa4-9f4d-174281aaf0be/download"), documentUrl("https://www.imf.org/-/media/Files/Publications/WEO/2026/October/text.pdf"), documentUrl("https://example.com/ar/download")],
    ["https://openknowledge.worldbank.org/server/api/core/bitstreams/b89c473c-d071-4aa4-9f4d-174281aaf0be/content", "https://www.imf.org/-/media/Files/Publications/WEO/2026/October/text.pdf", "https://example.com/ar/download"],
  );
  const cmo = { id: "wb-cmo", name: "آفاق أسواق السلع الأولية", nameEn: "Commodity Markets Outlook", publisher: "البنك الدولي" };
  const told = { slug: "world-bank-raises-commodity-price-forecasts", kind: "news", publishedAt: "2026-10-29T01:16:55Z", title: "البنك الدولي يتوقع ارتفاع أسعار الطاقة 32% في 2026", subtitle: "", lede: "رفع البنك الدولي توقعاته لأسعار السلع الأولية.", body: "فالبنك يتوقع في تقريره «آفاق أسواق السلع الأولية» لشهر أكتوبر أن ترتفع الأسعار.", sourceUrls: ["https://www.reuters.com/x"] };
  const at = Date.parse("2026-10-29T15:17:00Z");
  const edition = { url: "https://openknowledge.worldbank.org/bitstreams/b89c473c-d071-4aa4-9f4d-174281aaf0be/download" };
  check(
    "a report the news desk told is not told again; a passing mention, a release's common name and an old story are not the edition",
    [
      coveredBy(cmo, edition, [told], { now: at })?.slug,
      coveredBy(cmo, edition, [{ ...told, title: "أسعار النفط ترتفع مع تعطل الإمدادات", lede: "ارتفع خام برنت." }], { now: at }) ?? null,
      coveredBy({ ...cmo, kind: "release", name: "التضخم في السعودية", publisher: "الهيئة العامة للإحصاء" }, edition, [{ ...told, title: "الهيئة العامة للإحصاء تنشر بيانات التجارة", body: "وكان التضخم في السعودية قد ارتفع." }], { now: at }) ?? null,
      coveredBy(cmo, edition, [told], { now: at + 30 * 86_400_000 }) ?? null,
    ],
    ["world-bank-raises-commodity-price-forecasts", null, null, null],
  );
  // Official releases (2026-10-19): a quarter is dated by its last month, and each edition reads its own month's PDF
  // from a page that lists every month's side by side.
  const q2 = editionKey("GDP and National Accounts Q2/2026");
  check("a quarter is dated by its last month and named in Arabic", [q2?.key, arabicEdition(q2)], [202606, "الربع الثاني من 2026"]);
  const sep0 = editionKey("Consumer Price Index – September 2026");
  check("the period before a release: last month, or last quarter across the year", [previousEdition({ key: 202601 })?.key, previousEdition({ key: 202603, quarter: 1 })?.label], [202512, "Q4 2025"]);
  check("a data release is written as a short story", releaseStory({ headline: "التضخم في السعودية", nameEn: "Consumer Price Index", publisherEn: "GASTAT" }, sep0).format, "short");
  const listing = `<a href="/documents/1/CPI+Sep+2026-EN.pdf/a?t=1">CPI</a><a href="/documents/1/CPI+Tables-Sep+2026-AR-EN.xlsx/b">Tables</a><a href="/documents/1/CPI+Aug+2026-EN.pdf/c">CPI</a>`;
  const sep = editionKey("Consumer Price Index – September 2026");
  const aug = editionKey("Consumer Price Index – August 2026");
  const cpi = { document: "CPI\\W*{mon}\\W*{yyyy}\\W*EN" };
  check("each month reads its own release, never a neighbour's or a table", [releaseDocument(listing, "https://www.stats.gov.sa/en/x", cpi, sep), releaseDocument(listing, "https://www.stats.gov.sa/en/x", cpi, aug), releaseDocument(listing, "https://www.stats.gov.sa/en/x", cpi, editionKey("Consumer Price Index – October 2026"))], ["https://www.stats.gov.sa/documents/1/CPI+Sep+2026-EN.pdf/a?t=1", "https://www.stats.gov.sa/documents/1/CPI+Aug+2026-EN.pdf/c", null]);
  check("the Arab economies' passage comes before the major economies' when room is short", [countries.includes("Egypt"), countries.includes("Germany")], [true, false]);
}

// What reads as a machine (the owner, 2026-10-19: "is the arabic language used natural or robotic and scream ai?"):
// a story about what its sources do not say, a speech told call by call, bridges between paragraphs, abstract
// summing-up; and what must still pass: the wires' clause about a withheld term, a real contrast, a time phrase.
{
  const flagged = (draft) => styleIssues({ title: "صادرات مصر غير البترولية ترتفع إلى 48 مليار دولار", subtitle: "", lede: "", whyItMatters: "", ...draft }, { kind: "news" });
  const said = (r, re) => r.issues.some((i) => re.test(i));
  check("a sentence on what the figure does not reveal on its own is sent back", said(flagged({ body: "ولم تتضمن تصريحاته المنشورة مقارنة بالأعوام السابقة. لذلك يبيّن الرقم حجم الصادرات، لكنه لا يكشف وحده اتجاه نموها." }), /لم تقله مصادره/), true);
  check("the wires' clause about a withheld term passes", flagged({ body: "ولم تكشف الشركة قيمة الصفقة. وقالت إن الإغلاق متوقع في الربع الأول." }).issues.some((i) => /لم تقله مصادره/.test(i)), false);
  const speech = "ودعا الوزير إلى تطوير حلول تكنولوجية للشركات. وشدد على تعريف الشباب باتفاقيات التجارة. وأكد أهمية فهم قواعد المنشأ للتصدير. وأشاد بجهود البورصة في نشر الثقافة المالية.";
  check("four exhortations in a row are sent back", said(flagged({ body: speech }), /من الدعوات والتشديد/), true);
  const bridged = "ولتطوير هذه الحلول، أشار الوزير إلى مبادرات تكنولوجيا التجارة.\n\nإلى جانب الأدوات التقنية، شدد الوزير على اتفاقيات التجارة.";
  check("two paragraphs opening on a bridge are sent back", said(flagged({ body: bridged }), /بجسر يشير/), true);
  const natural = "ورغم هذا الصعود، تبقى الأسهم دون ذروتها.\n\nورفعت قطر شحناتها عبر المضيق هذا الشهر، بحسب بيانات تتبع السفن.\n\nلكن هذا التحسن لم يكفِ لتعويض خسائر الربع.";
  check("a real contrast and a time phrase are not bridges", said(flagged({ body: natural }), /بجسر يشير/), false);
  check("a piece that describes itself is sent back", said(flagged({ subtitle: "يتتبع هذا الشرح الطرح العام الأولي من نشرة الاكتتاب إلى أول جلسة تداول", body: "نص." }), /النص يصف نفسه/), true);
  check("a summing-up in abstract nouns is sent back", said(flagged({ body: "وتتباين الاحتمالات التي تواجهها السوق بين مكاسب شركات الطاقة وضغوط التمويل." }), /أسماء مجردة/), true);
  const relayed = "وقالت شينا يو في تصريحات أوردتها «سي إن بي سي» إن النمو تسارع. وأضاف محلل آخر في تصريحات أوردتها «رويترز» أن الصادرات قادت النمو. ورأت يو في تصريحات أوردتها «بلومبرغ» أن الاستهلاك ضعيف.";
  check("one attribution formula three times is sent back", said(flagged({ body: relayed }), /صيغة الإسناد نفسها/), true);
  check("remarks never count toward a developed report", substantiveFacts({ facts: [{ job: "news" }, { job: "remark" }, { job: "numbers" }, { job: "remark" }] }), 2);
  // The euro-area GDP story of 2026-10-30: 25 notes, 11 of them figures from Eurostat's table, one driver, no reaction.
  const euro = { facts: [...Array(3).fill({ job: "news" }), { job: "driver" }, ...Array(11).fill({ job: "numbers" }), ...Array(6).fill({ job: "background" }), ...Array(2).fill({ job: "next" }), { job: "remark" }] };
  check("a pile of figures counts as substantive", substantiveFacts(euro) >= NEWS_MIN_FACTS, true);
  check("…but one driver and no reaction do not explain it", explainingFacts(euro) < NEWS_MIN_EXPLAINING, true);
  check("causes and reactions are what explain an event", explainingFacts({ facts: [{ job: "driver" }, { job: "reaction" }, { job: "numbers" }, { job: "background" }, { job: "remark" }] }), 2);
  check("one spelling of Bloomberg", fixNames("قالت المحللة في «الشرق بلومبرج» لـ«بلومبيرغ»"), "قالت المحللة في «الشرق بلومبرغ» لـ«بلومبرغ»");
}

// The latest price (lib/context.mjs, 2026-10-19): read for the instruments a story is about, Brent with WTI and first,
// never for a story that only names a currency or a bond holding; filed as a source the outlet count ignores; and read by
// the second look only as it stood at publication, never fetched again (a later price would read as a contradiction).
{
  const ids = (headlineHint, section = "markets") => instrumentsOf({ headlineHint, section }).map((i) => i.id);
  check("an oil story reads Brent first, then WTI", ids("خام غرب تكساس يتراجع إلى 100.58 دولار بعد إعفاء روسيا من عقوبات", "energy"), ["brent", "wti"]);
  check("a bond holding is not a yield story", ids("الإمارات ترفع حيازتها من سندات الخزانة الأمريكية إلى 116.1 مليار دولار"), []);
  check("an investment counted in euros fetches no exchange rate", ids("الإمارات تستثمر 40 مليار يورو في ألمانيا", "economy"), []);
  check("a thirty-year yield story reads the thirty-year bond", ids("عائد السندات الأمريكية لأجل 30 عاماً يقفز إلى أعلى مستوى منذ 2002"), ["us30y"]);
  check("a rating agency is not the S&P 500", ids("«ستاندرد آند بورز» تثبّت تصنيف السعودية الائتماني مع نظرة مستقرة"), []);
  check("a data release is read with its country's market", [ids("نمو الاقتصاد الصيني يتسارع إلى 4.5% في الربع الثالث", "economy"), ids("المركزي المصري يثبّت الفائدة عند 19% و20%", "economy")], [["sse", "usdcny"], ["egx30", "usdegp"]]);
  check("a forecast is not a release", ids("«غولدمان ساكس» و«جي بي مورغان» يرجّحان رفع الفائدة الأمريكية هذا الأسبوع", "economy"), []);
  // 2026-10-28: the UAE's hold «بعد تثبيت الفيدرالي» was given US markets; the place named first is the story's.
  check("a decision is read with the market of the place named first, or none", [ids("المركزي الإماراتي يبقي سعر الأساس عند 3.90% بعد تثبيت الفيدرالي", "economy"), ids("الفيدرالي الأمريكي يبقي الفائدة بين 3.75% و4% رغم مطالبة عضوتين برفعها", "economy"), ids("المركزي المصري يرفع الفائدة 100 نقطة أساس بعد تثبيت الفيدرالي", "economy")], [[], ["spx", "us10y", "dxy"], ["egx30", "usdegp"]]);
  const at = (h) => new Date(Date.parse("2026-09-15T12:00:00Z") + h * 3600000).toISOString();
  const ran = [{ kind: "news", section: "energy", title: "أرامكو تعلّق تحميلات ينبع بعد إغلاق خط الشرق-الغرب.. برنت يرتفع 3%", publishedAt: at(0) }];
  const again = (headlineHint, h) => repeatsInstrument({ headlineHint, section: "energy" }, ran, { now: Date.parse(at(h)) });
  check("the same instrument's move twice in four hours is held", Boolean(again("برنت يقفز فوق 109 دولارات مع تعطل صادرات ينبع", 4)), true);
  check("twelve hours on, or with a record, it is news again", [again("برنت يقترب من 100 دولار بعد هجمات حوثية", 12), again("برنت يصعد إلى أعلى مستوى منذ مايو", 2)], [null, null]);
  const now = Date.parse("2026-10-19T10:35:00Z");
  const days = Array.from({ length: 60 }, (_, i) => ({ d: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`, c: 100 }));
  const quote = async (symbol) => ({ price: symbol === "BZ=F" ? 108.63 : 98.36, prev: symbol === "BZ=F" ? 109.86 : 99.02, time: "2026-10-19T10:25:00Z", history: days });
  const market = await marketData({ story: { headlineHint: "برنت يتراجع بعد إعفاء روسيا", section: "energy" }, now, fetchQuote: quote });
  check("market data carries each price with its time and its move", [market.kind, /108\.63 US dollars per barrel at 10:25 GMT on Monday 19 October 2026/.test(market.text), /down 1\.23 or 1\.12% from the previous close of 109\.86/.test(market.text)], ["market", true, true]);
  // 2026-10-25: Yahoo keeps one daily bar for the EGX30, and its previous close was a session stale (6.85% printed for 3.56%).
  const egx = await marketData({ story: { headlineHint: "البورصة المصرية توقف التداول بعد هبوط مؤشرها", section: "markets" }, now, fetchQuote: async () => ({ price: 49234.3, prev: 52854.9, time: "2026-10-25T11:25:00Z", history: [{ d: "2026-10-25", c: 49234.3 }] }) });
  check("an index whose feed keeps no daily closes gets its price, not a move", [/49234\.30 points/.test(egx?.text ?? ""), /from the previous close/.test(egx?.text ?? ""), /no move is given/.test(egx?.text ?? "")], [true, false, true]);
  // 2026-10-26: Yahoo's BZ=F had rolled to January while the wires quoted December; the story mixed the two.
  const t28 = "2026-10-28T18:20:00Z";
  const brentBook = { "BZ=F": [111.87, 109.41], "BZZ26.NYM": [115.55, 113.88], "BZF27.NYM": [111.87, 109.41] };
  const rolled = await marketData({ story: { headlineHint: "برنت يرتفع وسط ترقب قرار واشنطن", section: "energy" }, now: Date.parse("2026-10-28T18:30:00Z"), fetchQuote: async (symbol) => {
    if (!brentBook[symbol]) throw new Error("no such contract");
    return { price: brentBook[symbol][0], prev: brentBook[symbol][1], time: t28, history: days };
  } });
  check(
    "a rolled futures series names its month, and the nearer contract the wires quote is given beside it",
    [/BZ=F, the contract for January 2027 delivery\): 111\.87/.test(rolled?.text ?? ""), /December 2026 delivery, BZZ26\.NYM.*115\.55/.test(rolled?.text ?? "")],
    [true, true],
  );
  // The review of 2026-10-30: the nearest-priced contract is the one the series repeats (a flat curve), and a contract that
  // expired before the series' last quote is not offered as the one the wires quote.
  const flatBook = { "BZ=F": [65.12, 64.5, t28], "BZZ26.NYM": [65.1, 64.48, t28], "BZF27.NYM": [65.12, 64.5, t28] };
  const flat = await marketData({ story: { headlineHint: "برنت يرتفع", section: "energy" }, now: Date.parse("2026-10-28T18:30:00Z"), fetchQuote: async (symbol) => {
    if (!flatBook[symbol]) throw new Error("no such contract");
    return { price: flatBook[symbol][0], prev: flatBook[symbol][1], time: flatBook[symbol][2], history: days };
  } });
  check("on a flat curve the series is named by the contract it repeats", [/BZ=F, the contract for January 2027 delivery/.test(flat?.text ?? ""), /December 2026 delivery, BZZ26/.test(flat?.text ?? "")], [true, true]);
  const expiredBook = { "BZ=F": [111.87, 109.41, "2026-10-30T21:00:00Z"], "BZZ26.NYM": [115.55, 113.88, "2026-10-30T19:30:00Z"], "BZF27.NYM": [111.87, 109.41, "2026-10-30T21:00:00Z"] };
  const expired = await marketData({ story: { headlineHint: "برنت يرتفع", section: "energy" }, now: Date.parse("2026-10-31T09:00:00Z"), fetchQuote: async (symbol) => {
    if (!expiredBook[symbol]) throw new Error("no such contract");
    return { price: expiredBook[symbol][0], prev: expiredBook[symbol][1], time: expiredBook[symbol][2], history: days };
  } });
  check("a contract that stopped trading before the series is not given beside it", /BZZ26/.test(expired?.text ?? ""), false);
  const noHistory = await marketData({ story: { headlineHint: "الذهب يرتفع", section: "markets" }, now, fetchQuote: async () => ({ price: 4186.3, prev: 4181.2, time: "2026-10-19T10:25:00Z", history: [{ d: "2026-10-19", c: 4186.3 }], historyRead: false }) });
  check("a failed history call takes no move from gold", /from the previous close/.test(noHistory?.text ?? ""), true);
  const weekend = await marketData({ story: { headlineHint: "الذهب يرتفع", section: "markets" }, now, fetchQuote: async () => ({ price: 4186.3, prev: 4181.2, time: "2026-10-16T21:00:00Z" }) });
  check("a quote from a closed market says so", /has not traded since/.test(weekend.text), true);
  check("no priced instrument, no market source", await marketData({ story: { headlineHint: "«فيرتيجلوب» تدرس إنشاء مجمع أسمدة في مصر", section: "companies" }, fetchQuote: quote }), null);
  check("market data never counts as an outlet", independentOutletCount([{ kind: "news", sourceNameEn: "Reuters", text: "a" }, market]), 1);
  const story = { slug: "x", sources: [{ url: market.url, nameEn: "Yahoo Finance" }] };
  let refetched = false;
  const read = await loadSources(story, { fetcher: async () => ((refetched = true), { ok: true, text: "Brent 101.00" }), snapshot: { sources: [{ url: market.url, passages: "Brent 108.63 US dollars per barrel at 10:25 GMT" }] } });
  check("the second look reads a market quote as it stood, never fetched again", [refetched, read[0].text.includes("108.63"), read[0].snapshot], [false, true, true]);
}

// The explainers' and paper readings' machine template (2026-10-23, the owner on four of them: "looks like ai badly
// written topics with bad headlines"). Each check is tested both ways: the template is sent back, the news form passes.
{
  const has = (draft, kind, start) => styleIssues({ subtitle: "", whyItMatters: "", keyFacts: [], ...draft }, { kind }).issues.some((i) => i.startsWith(start));
  const pegged = { title: "لماذا لا يرتفع سعر الخبز فور هبوط الجنيه؟", lede: "تجاوز الدولار 54 جنيهاً الاثنين للمرة الأولى. لكن رغيف الخبز المدعوم لا يتبعه في اليوم نفسه.", body: "## من يدفع الفرق؟\n\nتتحمل الموازنة الفرق حتى موعد مراجعة السعر." };
  check("an explainer opened on the news passes its lede checks", [has(pegged, "explainer", "المقدمة تبدأ بتعريف"), has(pegged, "explainer", "المقدمة لا تذكر الخبر")], [false, false]);
  check("an explainer opened on a definition is sent back", has({ ...pegged, lede: "نسبة تغطية الاكتتاب هي المقياس الذي يقارن الطلب بالمعروض." }, "explainer", "المقدمة تبدأ بتعريف"), true);
  check("an explainer lede without the news is sent back", has({ ...pegged, lede: "الخام القياسي سعر مرجعي يُقاس عليه ثمن خامات كثيرة أخرى." }, "explainer", "المقدمة لا تذكر الخبر"), true);
  check("a news lede with «هي» later on is no definition", has({ ...pegged, lede: "قال المركزي الخميس إن الفائدة هي أداته الأولى." }, "explainer", "المقدمة تبدأ بتعريف"), false);
  check("template subheads are sent back, a reader's question is not", [has({ ...pegged, body: "## مثال توضيحي بالأرقام\n\nنص.\n\n## أخطاء شائعة وما يستحق المتابعة\n\nنص." }, "explainer", "عناوين فرعية من قالب"), has(pegged, "explainer", "عناوين فرعية من قالب")], [true, false]);
  check("a paper's academic labels are sent back", has({ ...pegged, body: "## السؤال\n\nنص.\n\n## البيانات والطريقة\n\nنص." }, "paper", "عناوين فرعية من قالب"), true);
  check("an invented currency unit is sent back", has({ ...pegged, body: "لو بلغ السعر 120 وحدة نقدية ارتفع." }, "explainer", "مثال بعملة مخترعة"), true);
  check("a closing watch-list is sent back", has({ ...pegged, body: "تتحمل الموازنة الفرق.\n\nللمتابعة، تكفي أربعة مؤشرات: الواردات والأجور." }, "explainer", "الشرح يُختم بقائمة"), true);
  const glossed = (n) => ({ ...pegged, body: Array.from({ length: n }, (_, i) => `ارتفع المؤشر ${i + 1}، أي المقياس العام.`).join("\n\n") });
  check("four «، أي» glosses are sent back, three are not", [has(glossed(4), "paper", "شرح المصطلحات بسلسلة"), has(glossed(3), "paper", "شرح المصطلحات بسلسلة")], [true, false]);
  check("the site never quotes itself, in any kind", [has({ ...pegged, body: "في قراءة خازندار، تهم الورقة مديري الاحتياطيات." }, "analysis", "عبارة مترجمة أو حشو"), has({ ...pegged, body: "ترى خازندار أن الأثر مؤقت." }, "news", "عبارة مترجمة أو حشو")], [true, true]);
  // Grounding: an explainer's figures of these weeks trace to its stories; its announced hypothesis computes its own.
  const stories = [{ title: "الدولار يتجاوز 54 جنيهاً", text: "تجاوز الدولار 54 جنيهاً في السوق الرسمية للمرة الأولى." }];
  const missing = (body) => programmaticChecks({ title: pegged.title, subtitle: "", lede: pegged.lede, body, whyItMatters: "", keyFacts: [] }, stories, { explainer: true, minWords: 0 }).issues.some((i) => i.startsWith("أرقام لا تظهر في المصادر"));
  check("an explainer's invented current figure is sent back, its hypothesis is not", [missing("بلغ التضخم 37% في سبتمبر."), missing("لو ارتفع سعر الدولار 25% لارتفع سعر السلعة 16.7% فقط.")], [true, false]);
  // 2026-10-23, the second audit: the analyses' four fixed labels, «رفع الدعم» raised to a level, and a source's own
  // wrong arithmetic, which the fact-check had passed as supported.
  check("an analysis's fixed labels are sent back; the same words in news prose are not", [has({ ...pegged, body: "## ما الذي تغيّر\n\nنص.\n\n## السيناريوهات\n\nنص." }, "analysis", "عناوين فرعية من قالب"), has({ ...pegged, body: "## من يدفع الفرق؟\n\nنص." }, "analysis", "عناوين فرعية من قالب")], [true, false]);
  check("«رفع الدعم» raised to a level is sent back; its removal is not", [has({ ...pegged, body: "يُرجَّح ألا يُموَّل رفع الدعم الاجتماعي إلى مثليه." }, "analysis", "«رفع الدعم"), has({ ...pegged, body: "قررت الحكومة رفع الدعم عن الوقود تدريجياً." }, "news", "«رفع الدعم")], [true, false]);
  // The owner, 2026-10-30: «الأبوظبية» is weird Arabic, and a dek opening «لا،» replies to its headline like a chat.
  check(
    "a nationality coined from a city goes back, the city as a place does not; a dek that replies to its headline goes back",
    [has({ ...pegged, title: "أرباح «2 بوينت زيرو» الأبوظبية تتضاعف" }, "news", "«الأبوظبية» صفة منحوتة"), has({ ...pegged, body: "أعلنت الشركة في بيان إلى سوق أبوظبي للأوراق المالية." }, "news", "«أبوظبي» صفة منحوتة"), has({ ...pegged, subtitle: "لا، فالرقم الأمريكي معدل سنوي يعادل نحو 0.8% خلال الربع" }, "explainer", "الوصف الفرعي يبدأ بردّ"), has({ ...pegged, subtitle: "الرقم الأمريكي معدل سنوي يعادل نحو 0.8% في الربع" }, "explainer", "الوصف الفرعي يبدأ بردّ")],
    [true, false, true, false],
  );
  // The review of 2026-10-30: a removal followed by «إلى» of something else is not a raise to a level.
  check(
    "«رفع الدعم … إلى» is a calque only with a figure or a multiple, never across «عن»",
    [has({ ...pegged, body: "رفع الدعم الاجتماعي المباشر من 500 إلى 600 درهم." }, "news", "«رفع الدعم"), has({ ...pegged, body: "ويقود رفع الدعم عن الكهرباء التضخم إلى مستويات أعلى." }, "news", "«رفع الدعم"), has({ ...pegged, body: "رفع الدعم عن البنزين أدى إلى احتجاجات." }, "news", "«رفع الدعم")],
    [true, false, false],
  );
  const sum = "The three indices moved 2.03%, 2.2% and -1.9%, an average of 0.6%.";
  const arithmetic = (cls) => verifyStory({ story: { title: "Markets end mixed", body: sum }, sources: [{ n: 1, name: "CNBC", title: "Markets", text: sum }], chatWith: checkerReply([{ id: 1, verdict: "not_found", source: null, quote: "" }, { id: 2, verdict: "contradicted", source: 0, quote: sum, class: cls }]) });
  check("a wrong average beside its own inputs is a proved error, even when the source prints it", (await arithmetic("internal")).checks[1].status, "confirmed");
  check("a sentence still cannot prove itself wrong by any other class", (await arithmetic("figure")).checks[1].status, "unverified");
  check("an old explainer checked without its stories' text is not grounded",programmaticChecks({ title: pegged.title, subtitle: "", lede: pegged.lede, body: "بلغ التضخم 37%.", whyItMatters: "", keyFacts: [] }, [{ title: "x" }], { explainer: true, minWords: 0 }).issues.some((i) => i.startsWith("أرقام لا تظهر")), false);
}

// 2026-10-24: a paper reading is written from its notes, never from the paper's English (the owner, on the AI-agents
// reading: "sounds robotic and less human"). The checker knows the paper's English; the notes keep only what the paper
// carries, a regional note only when it names an Arab country, two method notes at most, and every author.
{
  const sent = (body, kind = "paper") => styleIssues({ title: "دراسة: الوكلاء يتولون أجزاء من الوظائف", subtitle: "", lede: "", body, whyItMatters: "", keyFacts: [] }, { kind }).issues.filter((i) => i.startsWith("إنجليزية الورقة")).length;
  check("a reading's paper-English is sent back, one fault per pattern", sent("تنطلق الورقة من تغيّر في الأدوات. وتجد الورقة أن قابلية التفويض ترتفع مع الدخل.\n\nبنى الباحث مؤشره بأن جعل نموذجين يقيّمان المهام وفق قواعد سجّلها مسبقاً، وقيّم مقيّمون بشريون 300 مهمة.\n\nيصفه الباحث بأنه سقف أعلى، ويرتفع الاستخدام، مقيساً بمعدل الفرد، إلى 31.0% وفق إضافة مؤشره."), 9);
  check("the same reading written as reporting passes", sent("وتتسع حصة العاملين في مهام يمكن تفويضها كلما ارتفع دخل البلد، بحسب الدراسة.\n\nوعُرضت 300 مهمة على أشخاص لم يطّلعوا على أحكام النموذجين، فجاءت أحكامهم قريبة منها، ويعدّه الباحثان حداً أقصى لما يمكن تفويضه."), 0);
  check("a news story is not held to the reading's rule", sent("وقال المصرف إن التضخم بلغ 3.0% في سبتمبر.", "news"), 0);
  const paperText = "35.2% of task time is at least partly delegable; 2.5% in full; 22.5% in low-income and 48.7% in high-income countries; 300 tasks; 146 countries; 101 countries.";
  const answer = {
    finding: "يمكن تفويض جزء على الأقل من مهام تشغل 35.2% من وقت العمل",
    authors: [{ en: "Cristian Espinal Maya", ar: "كريستيان إسبينال مايا" }, { en: "Santiago Jiménez Londoño", ar: "سانتياغو خيمينيث لوندونيو" }],
    peer_reviewed: false,
    facts: [
      { fact: "لا يتجاوز ما يمكن تفويضه كاملاً 2.5% من وقت العمل", job: "finding" },
      { fact: "ترتفع الحصة من 22.5% في الدول منخفضة الدخل إلى 48.7% في مرتفعة الدخل", job: "finding" },
      { fact: "تقيس الدراسة ما تسمح به التقنية لا ما يحدث فعلاً", job: "caveat" },
      { fact: "عُرضت 300 مهمة على أشخاص لم يطّلعوا على أحكام النموذجين", job: "method" },
      { fact: "شمل المؤشر 146 دولة", job: "method" },
      { fact: "قورن المؤشر بالاستخدام الفعلي في 101 دولة", job: "method" },
      { fact: "يبلغ المؤشر 99% في المغرب", job: "region" },
      { fact: "قد تقترب الاقتصادات العربية من الدول الغنية", job: "region" },
      { fact: "تعتمد المصارف في الدول الغنية على الوكلاء", job: "region" },
      { fact: "يرتفع الاستخدام في الخليج كلما اتسعت المهام", job: "region" },
    ],
  };
  const made = await paperNotes({ paper: { title_en: "The Delegation Divide", institutionEn: "arXiv" }, text: paperText, log: () => {}, chatWith: async ({ validate }) => { const d = structuredClone(answer); validate(d); return { data: d, model: "scripted" }; } });
  const kept = made.notes.facts.map((f) => f.fact);
  check("the notes drop a figure the paper lacks, a third method note and regional notes naming no Arab country («المصارف» is not Egypt)", [kept.some((f) => f.includes("99%")), kept.some((f) => f.includes("101 دولة")), kept.some((f) => f.includes("الاقتصادات العربية")), kept.some((f) => f.includes("المصارف")), kept.some((f) => f.includes("الخليج"))], [false, false, false, false, true]);
  check("the notes keep every author and the preprint flag", [made.notes.authors.length, made.notes.peerReviewed], [2, false]);
  // The writer is sent back when its draft leaves out an author (any surname counts, in Latin).
  const filler = Array.from({ length: 70 }, () => "وتتسع حصة العاملين في مهام يمكن تفويضها كلما ارتفع الدخل.").join(" ");
  const reading = (lede) => ({ title: "حصة العمل الذي يمكن تفويضه ترتفع مع دخل الدول", subtitle: "دك", slug: "a-b-c-d", lede, body: filler, key_facts: [], why_it_matters: "الأرجح أن الفجوة تعود إلى تركيبة الوظائف.", tags: ["الذكاء الاصطناعي"] });
  const writes = async (lede) => {
    try {
      await writePaperReading({ paper: { title_en: "t", institutionEn: "arXiv", why_it_matters_ar: "", reading_angle_ar: "" }, text: "", notes: made.notes, log: () => {}, chatWith: async ({ validate }) => { const d = reading(lede); validate(d); return { data: d, model: "scripted" }; } });
      return "accepted";
    } catch (error) {
      return /missing Santiago/.test(error.message) ? "sent back" : `error: ${error.message.slice(0, 60)}`;
    }
  };
  check("a reading naming one of two authors is sent back; naming both is accepted", [await writes("خلص الباحث كريستيان إسبينال مايا (Cristian Espinal Maya) إلى أن الحصة ترتفع."), await writes("خلص كريستيان إسبينال مايا (Cristian Espinal Maya) وسانتياغو خيمينيث لوندونيو (Santiago Jiménez Londoño) إلى أن الحصة ترتفع.")], ["sent back", "accepted"]);
}

// 2026-10-25, the Turkish, Iranian and Indian press (the owner: "add the readable Turkish, Iranian and Indian outlets with
// ownership labels, the subscribers-only check and the Persian quote fix").
{
  // A page its publisher marks subscribers-only gives no text, however much of the article it carries.
  const body = `<p>${"The central bank raised its policy rate by 250 basis points on Thursday, the statement said. ".repeat(10)}</p>`;
  const page = (marker) => `<html lang="en"><head><title>Rate decision</title>${marker}</head><body><article><h1>Rate decision</h1>${body}</article></body></html>`;
  const read = (marker) => {
    const r = readArticleHtml(page(marker), "https://example.com/a");
    return [r.ok, r.reason, r.text.length > 0];
  };
  check("a page marked subscribers-only gives no text; one marked free, or unmarked, does", [
    read('<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>'),
    read('<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":"False","hasPart":{"@type":"WebPageElement","isAccessibleForFree":"False","cssSelector":".paywall"}}</script>'),
    read('<meta itemprop="isAccessibleForFree" content="false">'),
    read('<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":true}</script>'),
    read(""),
  ], [[false, "subscribers-only", false], [false, "subscribers-only", false], [false, "subscribers-only", false], [true, "", true], [true, "", true]]);

  // A page that appends the next stories below its own, as Asharq Al-Awsat's does (2026-10-29: its Fed, ECB and GDP pages
  // all read as one longer IMF story): the block marked first is the page's article, the longer followers are not.
  const own = `<p>${"خالفت عضوتان في مجلس الاحتياطي الفيدرالي توجه الأغلبية إلى تثبيت الفائدة ودعتا إلى رفعها ربع نقطة. ".repeat(6)}</p>`;
  const next = `<p>${"يتحرك صندوق النقد الدولي على ثلاثة مسارات اقتصادية متزامنة في المنطقة والاقتصاد العالمي. ".repeat(20)}</p>`;
  const scroll = (marked) => `<html lang="ar"><head><title>معارضتان في الفيدرالي</title></head><body><div class="block-main"><div class="printable-area shareable"><article><div class="entry-content${marked ? " first-article-node" : ""}">${own}</div></article></div></div>`
    + [1, 2].map(() => `<div class="cell large-auto"><div class="printable-area shareable"><div class="entry-content">${next}</div></div></div>`).join("") + `</body></html>`;
  const marked = readArticleHtml(scroll(true), "https://aawsat.com/node/1");
  check("an appended story is never read as the page's own; the block marked first is", [marked.text.includes("عضوتان"), marked.text.includes("صندوق النقد")], [true, false]);
  check("without the publisher's mark nothing is removed", readArticleHtml(scroll(false), "https://aawsat.com/node/1").text.includes("صندوق النقد"), true);
  // The review of 2026-10-30: a short sidebar item classed «first-article» on another publisher's page removes nothing.
  const sidebar = `<html lang="ar"><head><title>عنوان</title></head><body><section class="layout"><article><p>${"ارتفعت صادرات المملكة غير النفطية بنسبة كبيرة في الربع الثالث وفق البيانات الرسمية. ".repeat(12)}</p></article></section><section class="layout"><ul><li class="item first-article">خبر آخر قصير</li></ul></section></body></html>`;
  check("a short sidebar item classed «first-article» takes nothing away", readArticleHtml(sidebar, "https://example.com/a").text.includes("صادرات المملكة"), true);
  // 2026-10-29: the Federal Register's notice to robots was read as a source.
  const wall = `<html><head><title>Notice</title></head><body><article><p>${"Due to aggressive automated scraping of FederalRegister.gov and eCFR.gov, programmatic access to these sites is limited to access to our extensive developer APIs. ".repeat(4)}</p></article></body></html>`;
  const blockedRead = readArticleHtml(wall, "https://www.federalregister.gov/documents/x");
  check("a notice refusing robots is no source text", [blockedRead.ok, blockedRead.reason], [false, "blocked"]);

  // A Turkish or Persian source's figures stand as its language writes them (the Audi story's notes and writer failed three
  // times each over «4,2 milyar» and «4 bin 500»); a Persian date is not read as a decimal.
  check("a story's 4.2 and 4500 stand in a Turkish source and 3.5 in a Persian one; a Persian date gives no decimal", [
    ungroundedNumbers("تستثمر أودي 4.2 مليار دولار وتوفر 4500 وظيفة و1234.5 طناً", ["Audi 4,2 milyar dolar yatırım yapacak; 4 bin 500 kişiye iş; 1.234,5 ton"]),
    ungroundedNumbers("نما الاقتصاد 3.5% وأنتج 2500000 برميل", ["اقتصاد ایران ۳/۵ درصد رشد کرد و تولید به ۲.۵ میلیون بشکه رسید"]),
    [...sourceNumbers("گزارش تاریخ ۱۴۰۵/۰۸/۰۳ و نرخ 1,000 و 4,500")].filter((n) => n.includes(".")),
  ], [[], [], []]);

  // A quote from a Persian source is found when it comes back in Arabic letters (ي، ك), with Western digits, or with a
  // space where the source has a zero-width non-joiner; a changed figure is still not found.
  const persian = "به گزارش شانا، تولید نفت ایران در مهرماه به ۳٫۲ میلیون بشکه در روز رسید و صادرات گاز افزایش می‌یابد.";
  check("a Persian sentence is found in Persian or Arabic letters; a changed figure is not", [
    quoteFound("تولید نفت ایران در مهرماه به ۳٫۲ میلیون بشکه در روز رسید", persian),
    quoteFound("تولید نفت ايران در مهرماه به ۳٫۲ ميليون بشكه در روز رسيد", persian),
    quoteFound("تولید نفت ایران در مهرماه به 3.2 میلیون بشکه در روز رسید", persian),
    quoteFound("صادرات گاز افزایش می یابد", persian),
    quoteFound("تولید نفت ایران در مهرماه به ۴٫۱ میلیون بشکه در روز رسید", persian),
  ], [true, true, true, true, false]);

  // An outlet that speaks for a government, a ministry or its opponents is named as such the first time it is named;
  // a private paper is not checked, and a region or a month that shares an outlet's name is not the outlet.
  const story = (body) => ({ title: "عنوان", subtitle: "", lede: "", body, whyItMatters: "", keyFacts: [] });
  const flagged = (body) => unlabelledOutlets(story(body)).map((o) => o.name);
  check("a labelled outlet named bare is sent back; with its label, as a place or month, or unlabelled, it is not", [
    flagged("وارتفعت صادرات النفط 5%، بحسب وكالة «مهر». وأضافت مهر أن الصادرات زادت."),
    flagged("وارتفعت صادرات النفط 5%، بحسب وكالة «مهر» الإيرانية شبه الرسمية. وأضافت مهر أن الصادرات زادت."),
    flagged("وتقع الحقول في شرق الأناضول، وبدأ الحفر في شهر مهر."),
    flagged("وذكرت وكالة تسنيم أن الحكومة رفعت الأسعار، فيما أكدت صحيفة «ديلي صباح» أن أنقرة سترد."),
    flagged("وقالت صحيفة «إيكونوميك تايمز» الهندية إن الواردات تراجعت."),
  ], [["مهر"], [], [], ["ديلي صباح", "تسنيم"], []]);
  check("every label names its outlet, carries one of its required words, and passes its own check", outletLabels()
    .filter((o) => !o.firstMention.includes(o.name) || (o.mustSay.length && !o.mustSay.some((w) => o.firstMention.includes(w))) || unlabelledOutlets(story(`وارتفعت الصادرات، بحسب ${o.firstMention}.`)).length)
    .map((o) => o.name), []);
  const issues = programmaticChecks(story("وارتفعت صادرات النفط 5%، بحسب وكالة «مهر»."), [{ title: "صادرات", text: "صادرات النفط 5%" }], { minWords: 0 }).issues;
  check("the checks send the story back with the label to write", issues.some((i) => i.includes("وكالة «مهر» الإيرانية شبه الرسمية")), true);
  // The writer sees a source's label under its heading, and the label of an outlet its sources quote (not its own).
  const sources = [{ sourceName: "تجارت نيوز", sourceNameEn: "Tejarat News", title: "قیمت نفت", text: "به گزارش تسنیم، قیمت نفت افزایش یافت." }];
  check("the writer is shown a source's label and the labels of the outlets it quotes", [
    labelLine({ sourceName: "مهر", sourceNameEn: "Mehr News Agency" }).includes("وكالة «مهر» الإيرانية شبه الرسمية"),
    quotedOutletsBlock(sources).includes("وكالة «تسنيم» المقربة من الحرس الثوري"),
    quotedOutletsBlock(sources).includes("تجارت نيوز"),
    labelLine({ sourceName: "الشرق الأوسط", sourceNameEn: "Asharq Al-Awsat" }),
  ], [true, true, false, ""]);
}

{
  // The site's isolation of figures and Latin runs (2026-10-31): a figure ends on a digit, so the sentence's full stop
  // stays in the Arabic line («إلى .17 وتقول» on 196 pages); a percent range is one run; a Latin run gives back the full
  // stop and a bracket it did not open; «10-year» is one run. The headline copy (src/lib/bidi.ts) uses the same patterns.
  const { default: isolate } = await import("../src/lib/rehype-isolate-numbers.mjs");
  const runs = (text) => {
    const tree = { type: "root", children: [{ type: "element", tagName: "p", children: [{ type: "text", value: text }] }] };
    isolate()(tree);
    const out = (n) => (n.type === "text" ? n.value : n.tagName === "bdi" ? `[${n.children.map(out).join("")}]` : n.children.map(out).join(""));
    return out(tree.children[0]);
  };
  check("a figure keeps the sentence's full stop out, a range is one run, a Latin run gives back a stray bracket", [
    runs("إلى 17. وتقول"), runs("بين 3.75%-4% الشهر"), runs("عند 4.82 - 5.30 جنيه"), runs("(تقدير Kpler)"),
    runs("(10-year Treasury yield)"), runs("مؤشر S&P 500."), runs("شركة Apple Inc. أعلنت"), runs("عائد U.S. Treasury اليوم"),
    runs("العام المالي 2026/27 في 2026-09-19 تراجع −3.5%"), runs("ارتفع 5% - وهو أعلى"),
    runs("شراكة Apple & غوغل"), runs("شركة Johnson & Johnson الأمريكية"), runs("فارق Brent - WTI اتسع"), runs("أرباح e& ترتفع"),
  ], [
    "إلى [17]. وتقول", "بين [3.75%-4%] الشهر", "عند [4.82 - 5.30] جنيه", "(تقدير [Kpler])",
    "[(10-year Treasury yield)]", "مؤشر [S&P 500].", "شركة [Apple Inc]. أعلنت", "عائد [U.S. Treasury] اليوم",
    "العام المالي [2026/27] في [2026-09-19] تراجع [−3.5%]", "ارتفع [5%] - وهو أعلى",
    "شراكة [Apple] & غوغل", "شركة [Johnson & Johnson] الأمريكية", "فارق [Brent - WTI] اتسع", "أرباح [e&] ترتفع",
  ]);
  const patterns = (file) => [...readFileSync(file, "utf8").matchAll(/const (NUMBER_SRC|LATIN_SRC) = (String\.raw`[^`]+`)/g)].map((m) => m.slice(1).join("="));
  check("the headlines' isolation (bidi.ts) uses the article bodies' patterns", patterns("src/lib/bidi.ts"), patterns("src/lib/rehype-isolate-numbers.mjs"));
}

{
  // The audit of 31 October. (1) The plan's session limit is the allowance spent, deferred like ChatGPT's (meta.quota),
  // never three tries a step and the rejection mark: a dry run lost two chosen stories that way.
  const { CLAUDE_LIMIT } = await import("../pipeline/lib/llm.mjs");
  check("the plan's limit is read as the allowance spent; a blip is not", [
    CLAUDE_LIMIT.test("You've hit your session limit · resets 5:30am (Europe/Berlin)"),
    CLAUDE_LIMIT.test("You've hit your weekly limit · resets Nov 3"),
    CLAUDE_LIMIT.test("Claude AI usage limit reached|1761901200"),
    CLAUDE_LIMIT.test("API Error: 529 Overloaded"),
    CLAUDE_LIMIT.test("Request timed out"),
  ], [true, true, true, false, false]);
  // (2) The evidence keeps every quoted sentence: a quote the sentences do not hold as written, quotes before the figures'
  // sentences within the cap, past an oversized piece, and glued sentences split without cutting an initial.
  const { passagesOf } = await import("../pipeline/lib/snapshots.mjs");
  const filler = Array.from({ length: 120 }, (_, i) => `Output was ${100 + i}.5 million barrels in month ${i}.`).join(" ");
  check("the evidence keeps every quote the check found", [
    passagesOf("Alpha one. Beta two.", ["a quote not on the page"], []),
    passagesOf("Prices rose to 84.8.Weaker demand hit sales.Governor Lisa D. Cook dissented. Others agreed.", ["Weaker demand hit sales"], []),
    passagesOf(`${filler} The ministry said exports would fall sharply next year. ${filler}`, ["The ministry said exports would fall sharply next year"], Array.from({ length: 120 }, (_, i) => `${100 + i}.5`)).includes("The ministry said exports would fall sharply next year."),
    passagesOf(`${"y".repeat(4500)} with 123.4 tons. The key quote is here. Next one.`, ["The key quote is here"], ["123.4"]),
    passagesOf("ارتفعت الصادرات 5%.وقال الوزير إن الإنتاج سيزيد. وأضاف أن الأسعار مستقرة.", ["وقال الوزير إن الإنتاج سيزيد"], []),
  ], [
    "a quote not on the page",
    "Prices rose to 84.8. Weaker demand hit sales. Governor Lisa D. Cook dissented.",
    true,
    "The key quote is here. Next one.",
    "ارتفعت الصادرات 5%. وقال الوزير إن الإنتاج سيزيد. وأضاف أن الأسعار مستقرة.",
  ]);
  // Every quote before any neighbour (the review of 2026-10-31): fourteen quotes of about 2,000 characters on a page of
  // forty sentences, and the neighbours of the early ones had filled the 4,000 characters before the last quotes.
  const page = Array.from({ length: 40 }, (_, i) => `وذكر مكتب الصرف أن البند ${i + 1} من بيانات الشهر سجل ${1000 + i * 7} مليون درهم مقارنة مع ${2000 + i * 11} مليون درهم قبل عام وفق البيانات المؤقتة.`);
  const pageQuotes = page.filter((_, i) => i % 3 === 1);
  const kept = passagesOf(page.join(" "), pageQuotes, []);
  check("every quoted sentence is kept before its neighbours", pageQuotes.filter((q) => !kept.includes(q)).length, 0);
  // (3) A minus typed after a box's figure is its sign; a spaced range is not touched.
  check("a trailing minus in a box value is the figure's sign", ["46%-", "46% -", "12 - 15%", "2025-2026"].map((v) => figureOnly(v)), ["−46%", "−46%", "12 - 15%", "2025-2026"]);
  // (4) One measure per chart: a company's revenue beside its net profit is two (SpaceX's results).
  // (5) The China factory explainer (the owner, 2026-10-31: "feels like this article is badly written"): a list of
  // questions and answers, a dek and a body built on what things are not, and Reuters' forecast in its glossary.
  const { styleIssues, negativeTurns } = await import("../pipeline/lib/style.mjs");
  // «قام ب» and «لعب دور» from a word's start, their future and purpose forms included (a review of 2026-10-31).
  const calque = (body) => styleIssues({ title: "عنوان", subtitle: "", lede: "", body, whyItMatters: "", keyFacts: [] }, { kind: "news" }).issues.some((i) => /سيقوم ب|لتقوم ب|سيلعب دور/.test(i));
  check("«سيقوم بزيارة», «لتقوم بدور» and «سيلعب دوراً» are the calques; «الأرقام بعد» is not", [calque("وسيقوم بزيارة الرياض الأسبوع المقبل."), calque("وأُنشئت الهيئة لتقوم بدور الرقيب."), calque("وسيلعب دوراً في التمويل."), calque("وجاءت الأرقام بعد إعلان البيانات.")], [true, true, true, false]);
  const explainer = {
    title: "ماذا يعني تراجع مؤشر المصانع الصينية إلى 49.3 نقطة؟",
    subtitle: "القراءة تقيس انتشار التراجع بين المصانع، لا مقدار انكماش إنتاجها",
    lede: "تراجع مؤشر مديري المشتريات في الصين إلى 49.3 نقطة في أكتوبر من 50.1 نقطة في سبتمبر.",
    body: "لا يأتي المؤشر من عدّ السلع المنتجة، بل من استبيان شهري.\n\n## ما الذي لا يقيسه الرقم؟\n\nلا يقيس المؤشر حجم تراجع الإنتاج.\n\n## هل تراجعت المصانع كلها؟\n\nلا. فالمتوسط يخفي قطاعات نمت.\n\n## هل يعني ذلك أن الاقتصاد يتباطأ؟\n\nلا يزال النمو عند 4.5%.",
    whyItMatters: "",
    keyFacts: [],
  };
  const flags = styleIssues(explainer, { kind: "explainer" }).issues;
  const plain = styleIssues({ ...explainer, subtitle: "القراءة تقيس انتشار التراجع بين المصانع", body: "يأتي المؤشر من استبيان شهري.\n\n## الرقم 50 يفصل بين التحسن والتراجع\n\nيقيس المؤشر الاتجاه.\n\n## لماذا تتقارب الكفتان؟\n\nلا يزال النمو عند 4.5%." }, { kind: "explainer" }).issues;
  check("an explainer of questions and answers, a contrasting dek and a body of «لا» turns are sent back; a plain one is not", [
    flags.some((i) => i.includes("كلها أسئلة")), flags.some((i) => i.includes("الوصف الفرعي يقول ما ليس")), flags.some((i) => i.includes("جمل تقول ما ليس")),
    plain.some((i) => /كلها أسئلة|يقول ما ليس|تقول ما ليس/.test(i)),
    negativeTurns("لا يزال النمو قوياً، لا سيما في الصناعة، ولا بد من الحذر").length,
  ], [true, true, true, false, 0]);
  const glossary = normalizeDraft({ title: "ماذا يعني المؤشر؟", subtitle: "د", slug: "x", lede: "ل", body: "ب", key_facts: [{ label: "مؤشر الانتشار", value: "نسبة المتحسنين مضافاً إليها نصف من لم يتغير" }, { label: "توقع استطلاع رويترز لأكتوبر", value: "50 نقطة، مقابل قراءة فعلية عند 49.3 نقطة" }, { label: "النمو بمعدل سنوي", value: "نمو الربع عن الربع السابق مفترضاً تكراره أربعة فصول" }], tags: ["الصين"], regions: ["آسيا"] }, { kind: "explainer" }).keyFacts.map((k) => k.label);
  check("an explainer's glossary keeps terms and drops a figure of the news", glossary, ["مؤشر الانتشار", "النمو بمعدل سنوي"]);
  check("a chart of revenue beside net profit is dropped; profit over time is kept", [
    normalizeChart({ type: "bar", categories: ["الإيرادات", "صافي الربح"], series: [{ name: "فعلي", values: [14.6, 4.4] }, { name: "متوقع", values: [12.72, 1.57] }] }),
    Boolean(normalizeChart({ type: "bar", categories: ["الربع الثالث 2024", "الربع الثالث 2025", "الربع الثالث 2026"], series: [{ name: "صافي الربح", values: [1, 2, 3] }] })),
  ], [null, true]);
}

if (failed) {
  console.log(`\n${failed} case(s) failed: a newsroom safeguard behaves wrongly.`);
  process.exit(1);
}
console.log("\nEvery newsroom safeguard behaves as specified on its known cases.");
