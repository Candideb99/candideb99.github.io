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
import { sourceNumbers, ungroundedNumbers, writeJsonAtomic } from "../pipeline/lib/util.mjs";
import { loadSnapshot, saveSnapshot } from "../pipeline/lib/snapshots.mjs";
import { loadSources, quoteFound, settleDrift, verifyStory } from "../pipeline/lib/factcheck.mjs";
import { readArticleHtml } from "../pipeline/lib/extract.mjs";
import { labelLine, outletLabels, quotedOutletsBlock, unlabelledOutlets } from "../pipeline/lib/outlets.mjs";
import { instrumentsOf, marketData, repeatsInstrument } from "../pipeline/lib/context.mjs";
import { independentOutletCount } from "../pipeline/lib/news-evidence.mjs";
import { boxFacts } from "../pipeline/lib/keyfacts.mjs";
import { deskNotes, newsDepthBrief, newsFloor, normalizeChart, normalizeDraft, paperNotes, prioritizeContext, substantiveFacts, validateDraft, validateWhyBasis, writePaperReading } from "../pipeline/lib/write.mjs";
import { NEWS_DEPTH, NEWS_FLOOR, SHORT_WORDS } from "../pipeline/lib/editorial.mjs";
import { arabicEdition, bestPdf, editionKey, previousEdition, releaseDocument, releaseStory, reportExcerpts } from "../pipeline/lib/reports.mjs";
import { mergeNewsRefresh, serializeArticle } from "../pipeline/lib/article.mjs";
import { cleanTags } from "../pipeline/lib/tags.mjs";
import { groundedRegions } from "../pipeline/lib/regions.mjs";
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
}

// 2. A story is not written twice: a retry of the same event, or the same event from another outlet.
check("the same headline again (a retried round) is caught", repeatsRecent("ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع", ["ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع"]) !== null, true);
check("the same event under another headline is caught", repeatsRecent("ترامب يعلن إنشاء «قوة للذكاء الاصطناعي» على غرار «قوة الفضاء»", ["ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع"]) !== null, true);
check("a different event is not", repeatsRecent("السعودية تعيد تشغيل خط «شرق - غرب» النفطي المتوقف منذ 13 سبتمبر", ["ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع"]), null);
check("one oil move under two names is still one event", repeatsRecent("برنت يقفز فوق 108 دولارات بعد إغلاق خط الأنابيب السعودي", ["النفط يقفز فوق 107 دولارات مع إغلاق خط الأنابيب السعودي"]) !== null, true);
check("two subjects sharing only a running war are two events", repeatsRecent("برنت عند أعلى مستوى في 5 أشهر فوق 111 دولاراً مع هجمات الحوثيين على السعودية", ["السعودية تؤجل مؤتمر مبادرة مستقبل الاستثمار إلى 2027 مع تصاعد هجمات الحوثيين"]), null);
check("two institutions' different forecasts are two events", repeatsRecent("صندوق النقد يتوقع انكماش اقتصادات الخليج 4.8% في 2026 قبل تعافيها 9.1% في 2027", ["البنك الدولي يتوقع انكماش اقتصادات الخليج 4.3% هذا العام"]), null);

// 2a. A Google News sitemap is read like a feed, and an Arabic address is filtered decoded (2026-10-22, Independent Arabia).
{
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  const entry = (section, slug, title) => `<url><loc>https://www.example.com/node/1/${encodeURIComponent(section)}/${encodeURIComponent(slug)}</loc><news:news><news:publication><news:name>x</news:name><news:language>ar</news:language></news:publication><news:title>${title}</news:title><news:publication_date>${fresh}</news:publication_date></news:news></url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${entry("اقتصاد", "تاسي-يهبط", "لماذا هبط &quot;تاسي&quot;؟")}${entry("رياضة", "مباراة", "موعد المباراة")}</urlset>`;
  const items = await fetchFeed({ id: "t", url: `data:text/xml;charset=utf-8,${encodeURIComponent(xml)}`, pathFilter: "/node/\\d+/(اقتصاد|الأخبار)/" });
  check("a news sitemap is read, and its Arabic sections filtered", items.map((i) => i.title), ['لماذا هبط "تاسي"؟']);
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
  check("a short brief is not automatically a flow defect", styleIssues({ ...brief, body: dispatches.slice(0, 2).join("\n\n") }).warnings.some((i) => i.startsWith("ثلاث فقرات قصيرة")), false);
  check("grouped related dispatches do not trigger the same warning", styleIssues({ ...brief, body: dispatches.join(" ") }).warnings.some((i) => i.startsWith("ثلاث فقرات قصيرة")), false);
  check("literal news bullet lists are sent for editing", styleIssues({ ...brief, body: dispatches.map((p) => `- ${p}`).join("\n") }).issues.some((i) => i.startsWith("متن الخبر قائمة")), true);
  check("an explainer's list is not treated as news prose", styleIssues({ ...brief, body: "- سعر الفائدة هو كلفة الاقتراض." }, { kind: "explainer" }).issues.some((i) => i.startsWith("متن الخبر قائمة")), false);
  const regrouped = judgeRewrite(brief, { title: naturalTitle, body: [dispatches[2], dispatches[0], dispatches[1]].join(" ") }, ["title", "body"]);
  check("the fact guard permits regrouping without losing facts", Object.keys(regrouped.accepted).sort(), ["body", "title"]);
  const changedFigure = judgeRewrite(brief, { title: naturalTitle.replace("110", "120") }, ["title"]);
  check("improving the headline cannot change its figure", changedFigure.rejected.some((r) => r.field === "title"), true);
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
  const at = (h) => new Date(Date.parse("2026-09-15T12:00:00Z") + h * 3600000).toISOString();
  const ran = [{ kind: "news", section: "energy", title: "أرامكو تعلّق تحميلات ينبع بعد إغلاق خط الشرق-الغرب.. برنت يرتفع 3%", publishedAt: at(0) }];
  const again = (headlineHint, h) => repeatsInstrument({ headlineHint, section: "energy" }, ran, { now: Date.parse(at(h)) });
  check("the same instrument's move twice in four hours is held", Boolean(again("برنت يقفز فوق 109 دولارات مع تعطل صادرات ينبع", 4)), true);
  check("twelve hours on, or with a record, it is news again", [again("برنت يقترب من 100 دولار بعد هجمات حوثية", 12), again("برنت يصعد إلى أعلى مستوى منذ مايو", 2)], [null, null]);
  const now = Date.parse("2026-10-19T10:35:00Z");
  const quote = async (symbol) => ({ price: symbol === "BZ=F" ? 108.63 : 98.36, prev: symbol === "BZ=F" ? 109.86 : 99.02, time: "2026-10-19T10:25:00Z", history: [] });
  const market = await marketData({ story: { headlineHint: "برنت يتراجع بعد إعفاء روسيا", section: "energy" }, now, fetchQuote: quote });
  check("market data carries each price with its time and its move", [market.kind, /108\.63 US dollars per barrel at 10:25 GMT on Monday 19 October 2026/.test(market.text), /down 1\.23 or 1\.12% from the previous close of 109\.86/.test(market.text)], ["market", true, true]);
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

if (failed) {
  console.log(`\n${failed} case(s) failed: a newsroom safeguard behaves wrongly.`);
  process.exit(1);
}
console.log("\nEvery newsroom safeguard behaves as specified on its known cases.");
