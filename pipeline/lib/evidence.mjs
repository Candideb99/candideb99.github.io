/**
 * The evidence that decides whether the newsroom's lessons are kept, and whether they help at all (2026-09-25, the
 * owner: "how can we make sure that this self-improving loop really gets better?"). Pure arithmetic: no model call.
 *
 * The research behind it (a statistics review of the loop, the same day, with simulations at this newsroom's error
 * rates of 0.2–0.45 proved errors a story): most paired stories are ties, so one week decides nothing, and a rule that
 * decides week by week reverts working lessons about 23 times a year on noise alone. What works is evidence that
 * accumulates across weeks and stays valid however often it is looked at: an e-value on the discordant pairs (pairs
 * whose two drafts differ in proved errors), counted since the kept version was set, with the thresholds fixed here in
 * advance. By Ville's inequality the chance of ever crossing 1/α by luck is at most α:
 *   promote at e ≥ 20 (a false promotion ≤ 5% ever; simulated 2% a year),
 *   revert on harm at e ≥ 10 (≤ 10% ever; simulated 5–6% a year),
 *   revert on a content guard at e ≥ 20 (stories that say less; simulated 2% a year),
 *   otherwise keep the live lessons as "unproven" and keep counting.
 * With lessons that halve errors it promotes within a year 90% of the time (median week 18 at 7 pairs a week); lessons
 * that double errors are reverted 99% of the time (median week 9). A change of 10–20% between two versions cannot be
 * proven at this budget, and the report says so rather than pretending.
 */

/**
 * The mixture e-value for "the first side is better more often than not", from b pairs where it was better and w where
 * it was worse: 2^(b+w+1) · ∫ from 0.5 to 1 of p^b (1−p)^w dp (p uniform on [0.5, 1]). Needs b = 7 with w = 0 to reach
 * 20, b = 10 with w = 1, 12 with 2, 14 with 3.
 */
export function eValue(b, w) {
  const steps = 2000;
  const h = 0.5 / steps;
  const f = (p) => p ** b * (1 - p) ** w;
  let sum = f(0.5) + f(1);
  for (let i = 1; i < steps; i += 1) sum += (i % 2 ? 4 : 2) * f(0.5 + i * h);
  return 2 ** (b + w + 1) * (sum * h) / 3;
}

export const PROMOTE_AT = 20;
export const HARM_AT = 10;
export const GUARD_AT = 20;
/** A draft "says less" when its supported sentences fall more than 10% below the other draft's (the guard's dead zone). */
const DEAD_ZONE = 0.1;

/**
 * Counts one comparison over the pairs given: `side` is the live draft, `other` the reference ("kept" or "none").
 * Only pairs judged by the same checker version and written with a live version different from the reference count.
 */
export function tally(pairs, other, { checker = null, since = null } = {}) {
  let better = 0;
  let worse = 0;
  let tied = 0;
  let down = 0;
  let up = 0;
  let n = 0;
  for (const p of pairs) {
    const ref = p[other];
    if (!ref || !p.live) continue;
    if (checker && p.checker !== checker) continue;
    if (since && String(p.at) < since) continue;
    n += 1;
    if (p.live.errors < ref.errors) better += 1;
    else if (p.live.errors > ref.errors) worse += 1;
    else tied += 1;
    if (ref.supported > 0) {
      if (p.live.supported < ref.supported * (1 - DEAD_ZONE)) down += 1;
      else if (p.live.supported > ref.supported * (1 + DEAD_ZONE)) up += 1;
    }
  }
  return { n, better, worse, tied, down, up, e: eValue(better, worse), harm: eValue(worse, better), saysLess: eValue(down, up) };
}

/**
 * The decision on the live lessons, from the live-vs-kept pairs since the kept version was set. `frozen` (the checker's
 * canary failing) stops every decision: a judge that has drifted cannot promote or revert anything.
 */
export function decide(t, { frozen = false } = {}) {
  if (frozen) return { decision: "frozen", reason: "the fact-check's canary is failing: no decision until it is trusted again" };
  if (t.saysLess >= GUARD_AT) return { decision: "revert", reason: `the live lessons wrote less: supported sentences fell in ${t.down} pairs and rose in ${t.up} (evidence ×${t.saysLess.toFixed(1)}, ${GUARD_AT} decides)` };
  if (t.harm >= HARM_AT) return { decision: "revert", reason: `the live lessons made more proved errors: worse in ${t.worse} pairs, better in ${t.better} (evidence of harm ×${t.harm.toFixed(1)}, ${HARM_AT} decides)` };
  if (t.e >= PROMOTE_AT) return { decision: "promote", reason: `the live lessons made fewer proved errors: better in ${t.better} pairs, worse in ${t.worse} (evidence ×${t.e.toFixed(1)}, ${PROMOTE_AT} decides)` };
  return { decision: "keep", reason: `unproven so far: better in ${t.better} pairs, worse in ${t.worse}, tied in ${t.tied} (evidence ×${t.e.toFixed(1)} of ${PROMOTE_AT}; harm ×${t.harm.toFixed(1)} of ${HARM_AT})` };
}

/** The planted-error canary: an alarm when the fact-check found 7 or fewer of the last 12 planted errors. */
export function canaryAlarm(history) {
  let seeded = 0;
  let found = 0;
  for (const c of [...history].reverse()) {
    if (seeded >= 12) break;
    seeded += c.seeded;
    found += c.found;
  }
  return { seeded, found, alarm: seeded >= 12 && found <= 7 };
}
