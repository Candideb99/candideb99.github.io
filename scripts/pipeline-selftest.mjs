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
import { MAX_REPAIRS, precheck } from "../pipeline/lib/precheck.mjs";
import { repeatsRecent } from "../pipeline/lib/events.mjs";
import { lessonRuleOk, loadLessons } from "../pipeline/lib/lessons.mjs";
import { writeJsonAtomic } from "../pipeline/lib/util.mjs";
import { loadSnapshot, saveSnapshot } from "../pipeline/lib/snapshots.mjs";
import { loadSources, settleDrift } from "../pipeline/lib/factcheck.mjs";

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

// 2. A story is not written twice: a retry of the same event, or the same event from another outlet.
check("the same headline again (a retried round) is caught", repeatsRecent("ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع", ["ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع"]) !== null, true);
check("the same event under another headline is caught", repeatsRecent("ترامب يعلن إنشاء «قوة للذكاء الاصطناعي» على غرار «قوة الفضاء»", ["ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع"]) !== null, true);
check("a different event is not", repeatsRecent("السعودية تعيد تشغيل خط «شرق - غرب» النفطي المتوقف منذ 13 سبتمبر", ["ترامب يعلن تأسيس قوة للذكاء الاصطناعي وتعيين مسؤول للإشراف على القطاع"]), null);

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
  const story = { slug: "s1", sources: [{ url, name: "رويترز", nameEn: "Reuters" }] };
  const gone = await loadSources(story, { fetcher: async () => ({ ok: false, reason: "http-403" }), snapshot: snap });
  check("a page that no longer answers is read from its saved copy", [gone[0].text.includes("97.55"), Boolean(gone[0].snapshot)], [true, true]);
  const changed = await loadSources(story, { fetcher: async () => ({ ok: true, text: "Brent fell 3.1% to 96.80 dollars a barrel." }), snapshot: snap });
  check("a page that changed is read as it is now, with its publication text alongside", [changed[0].text.includes("96.80"), changed[0].saved.includes("97.55")], [true, true]);
  const settled = settleDrift([{ status: "drift", class: "figure", sentence: "تراجع برنت إلى 97.55 دولار" }, { status: "drift", class: "figure", sentence: "تراجع برنت إلى 91.25 دولار" }], [changed[0].saved]);
  check("a figure the saved copy carries is a changed page; one it never carried is an error", settled.map((c) => c.status), ["drift", "confirmed"]);
}

if (failed) {
  console.log(`\n${failed} case(s) failed: a newsroom safeguard behaves wrongly.`);
  process.exit(1);
}
console.log("\nEvery newsroom safeguard behaves as specified on its known cases.");
