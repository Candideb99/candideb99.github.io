#!/usr/bin/env node
/**
 * The decision rule of the lessons (pipeline/lib/evidence.mjs), tested on cases whose right answer is known, so a change
 * to it cannot pass the site's gate (scripts/gate.mjs) while deciding wrongly. Pure arithmetic, no model call.
 * Written 2026-09-25 after a second review of the design asked for exactly this: "a test where early lesson versions
 * help but the newest one harms", and "a calibration failure cannot block emergency rollback".
 */
import { decide, eValue, OWN_PAIRS, tally } from "../pipeline/lib/evidence.mjs";

const pair = (hash, live, kept, { supportedLive = 20, supportedKept = 20 } = {}) => ({ at: "2026-10-01T00:00:00Z", checker: "c", lessonsHash: hash, keptVersion: 0, live: { errors: live, supported: supportedLive }, kept: { errors: kept, supported: supportedKept } });
const many = (n, make) => Array.from({ length: n }, make);
let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got}${ok ? "" : ` (expected ${want})`}`);
}
const judgeOn = (pairs, hash, opts) => decide(tally(pairs, "kept", { checker: "c" }), tally(pairs.filter((p) => p.lessonsHash === hash), "kept", { checker: "c" }), opts).decision;

// The e-value against the table of the statistics review (7 better and 0 worse reach 20; 6 do not).
check("e(7,0) reaches 20", eValue(7, 0) >= 20, true);
check("e(6,0) stays under 20", eValue(6, 0) < 20, true);
check("e(10,1) reaches 20", eValue(10, 1) >= 20, true);
check("harm e(5,0) reaches 10", eValue(5, 0) >= 10, true);

// Nothing known: keep.
check("no pairs: keep", judgeOn([], "v3"), "keep");
// Ties only: keep.
check("30 ties: keep", judgeOn(many(30, () => pair("v1", 0, 0)), "v1"), "keep");
// A version that helps, with enough pairs of its own: promote.
check("one helpful version, 14 better: promote", judgeOn(many(14, () => pair("v1", 0, 1)), "v1"), "promote");
// Early versions help, the newest harms: never promote the newest on the older versions' record.
const early = many(14, () => pair("v1", 0, 1));
const late = many(4, () => pair("v3", 1, 0));
check("early help, newest harms in 4 pairs: not promoted", judgeOn([...early, ...late], "v3") !== "promote", true);
// ... and with enough harm of its own, reverted even though the pooled record is positive.
const lateMore = many(7, () => pair("v3", 1, 0));
check("early help, newest harms in 7 pairs: revert", judgeOn([...early, ...lateMore], "v3"), "revert");
// Early help, newest too new to judge: wait, do not promote.
check(`early help, newest with ${OWN_PAIRS - 1} tied pairs: keep`, judgeOn([...early, ...many(OWN_PAIRS - 1, () => pair("v4", 0, 0))], "v4"), "keep");
check(`early help, newest with ${OWN_PAIRS} tied pairs: promote`, judgeOn([...early, ...many(OWN_PAIRS, () => pair("v4", 0, 0))], "v4"), "promote");
// Pooled harm: revert.
check("pooled harm, 6 worse: revert", judgeOn(many(6, () => pair("v2", 1, 0)), "v2"), "revert");
// Stories that say less (supported sentences down more than 10% in most pairs): revert.
check("says less: revert", judgeOn(many(12, () => pair("v2", 0, 0, { supportedLive: 15, supportedKept: 20 })), "v2"), "revert");
// A failing canary freezes promotion...
check("canary failing, would promote: frozen", judgeOn(many(14, () => pair("v1", 0, 1)), "v1", { frozen: true }), "frozen");
// ...but never a rollback.
check("canary failing, harm: still revert", judgeOn(many(6, () => pair("v2", 1, 0)), "v2", { frozen: true }), "revert");
// Pairs judged by another checker version do not count.
check("other checker's pairs ignored", decide(tally(many(14, () => ({ ...pair("v1", 0, 1), checker: "old" })), "kept", { checker: "c" })).decision, "keep");

if (failed) {
  console.log(`\n${failed} case(s) failed: the lessons' decision rule is wrong.`);
  process.exit(1);
}
console.log("\nThe lessons' decision rule decides every known case correctly.");
