#!/usr/bin/env node
/**
 * The newsroom's safeguards, tested on cases whose right answer is known, with scripted stand-ins for the model: no
 * Claude call. Written 2026-09-26 with the check before publication (the owner's go to "check, repair, hold"), so that
 * a change to it, to the duplicate rule, to the lessons' lint or to the state files cannot pass the site's gate while
 * behaving wrongly. The gate runs it (scripts/gate.mjs).
 *
 *   node scripts/pipeline-selftest.mjs
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_REPAIRS, precheck } from "../pipeline/lib/precheck.mjs";
import { repeatsRecent } from "../pipeline/lib/events.mjs";
import { lessonRuleOk, loadLessons } from "../pipeline/lib/lessons.mjs";
import { writeJsonAtomic } from "../pipeline/lib/util.mjs";

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

if (failed) {
  console.log(`\n${failed} case(s) failed: a newsroom safeguard behaves wrongly.`);
  process.exit(1);
}
console.log("\nEvery newsroom safeguard behaves as specified on its known cases.");
