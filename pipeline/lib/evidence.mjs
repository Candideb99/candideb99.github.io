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

/** The pairs a version must have on its own before it can be promoted: pooled evidence proves the process, not the latest text. */
export const OWN_PAIRS = 6;

/**
 * The decision on the live lessons. `pooled` counts every live-vs-kept pair since the kept version was set; `own` only
 * the pairs written with the text the writer reads now (a second review of the design, 2026-09-25: pooled wins of
 * earlier versions must neither crown the newest one nor hide its harm).
 *   - Rollback is never frozen: stories that say less, or harm in the pooled pairs (evidence 10) or in the newest
 *     version's own pairs (evidence 20, the stricter bar for the second look at the same data), revert at once.
 *   - `frozen` (the fact-check's canary failing) stops promotion only: a judge in doubt may not crown anything.
 *   - Promotion needs the pooled evidence (20) and the newest text's own pairs: at least OWN_PAIRS of them, and no more
 *     worse than better among them.
 */
export function decide(pooled, own = pooled, { frozen = false } = {}) {
  if (pooled.saysLess >= GUARD_AT || own.saysLess >= GUARD_AT) {
    const t = pooled.saysLess >= GUARD_AT ? pooled : own;
    return { decision: "revert", reason: `the live lessons wrote less: supported sentences fell in ${t.down} pairs and rose in ${t.up} (evidence ×${t.saysLess.toFixed(1)}, ${GUARD_AT} decides)` };
  }
  if (pooled.harm >= HARM_AT) return { decision: "revert", reason: `the live lessons made more proved errors: worse in ${pooled.worse} pairs, better in ${pooled.better} (evidence of harm ×${pooled.harm.toFixed(1)}, ${HARM_AT} decides)` };
  if (own.harm >= PROMOTE_AT) return { decision: "revert", reason: `the newest lessons made more proved errors in their own pairs: worse in ${own.worse}, better in ${own.better} (evidence of harm ×${own.harm.toFixed(1)}, ${PROMOTE_AT} decides)` };
  if (frozen) return { decision: "frozen", reason: "the fact-check's canary is failing: nothing is promoted or learned until it is trusted again; a rollback would still act" };
  if (pooled.e >= PROMOTE_AT) {
    if (own.n >= OWN_PAIRS && own.worse <= own.better) return { decision: "promote", reason: `the live lessons made fewer proved errors: better in ${pooled.better} pairs, worse in ${pooled.worse} (evidence ×${pooled.e.toFixed(1)}, ${PROMOTE_AT} decides), and the newest text held up in its own ${own.n} pairs (${own.better} better, ${own.worse} worse)` };
    return { decision: "keep", reason: `the lessons' record is strong (evidence ×${pooled.e.toFixed(1)}), but the newest text has ${own.n} pair(s) of its own (${own.better} better, ${own.worse} worse); it is promoted once it has ${OWN_PAIRS} with no more worse than better` };
  }
  return { decision: "keep", reason: `unproven so far: better in ${pooled.better} pairs, worse in ${pooled.worse}, tied in ${pooled.tied} (evidence ×${pooled.e.toFixed(1)} of ${PROMOTE_AT}; harm ×${pooled.harm.toFixed(1)} of ${HARM_AT})` };
}

/**
 * The planted-error canary: an alarm when the fact-check found 7 or fewer of the last 12 planted errors (it misses), or
 * called 4 or more untouched sentences of clean stories contradicted in the last three canaries (it cries wolf).
 */
export function canaryAlarm(history) {
  let seeded = 0;
  let found = 0;
  for (const c of [...history].reverse()) {
    if (seeded >= 12) break;
    seeded += c.seeded;
    found += c.found;
  }
  const falseFlags = history.slice(-3).reduce((n, c) => n + (c.falseFlags ?? 0), 0);
  return { seeded, found, falseFlags, alarm: (seeded >= 12 && found <= 7) || falseFlags >= 4 };
}
