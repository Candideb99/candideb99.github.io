import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { routeSubscription, readQuotaState, quotaSnapshot } from "../pipeline/lib/codex-pool.mjs";
import { precheck } from "../pipeline/lib/precheck.mjs";

const temp = mkdtempSync(path.join(os.tmpdir(), "khazendar-pool-test-"));
let now = Date.now(), serial = 0;
const usage = (short, week, shortReset = now + 300000, weekReset = now + 86400000) => ({ rateLimitsByLimitId: { codex: { primary: { usedPercent: short, windowDurationMins: 300, resetsAt: shortReset / 1000 }, secondary: { usedPercent: week, windowDurationMins: 10080, resetsAt: weekReset / 1000 } } } });
const config = () => ({ enabled: true, primary: "one", backup: "two", accounts: [{ id: "one", home: "one" }, { id: "two", home: "two" }], stateFile: path.join(temp, `case-${serial++}.json`) });
try {
  const windows = quotaSnapshot(usage(100, 100));
  assert.equal(windows.retryAt, now + 86400000, "A five-hour reset cannot clear an exhausted weekly window");
  assert.throws(() => quotaSnapshot({}), /did not return/);
  const pool = config(), calls = [];
  let primaryUsed = 100;
  const deps = { pool, now: () => now, limits: async ({ codexHome }) => usage(codexHome === "one" ? primaryUsed : 10, 20), run: async (o) => { calls.push(o.codexHome); return { content: "ok" }; } };
  await routeSubscription({ user: "test" }, deps);
  assert.deepEqual(calls, ["two"]);
  assert.equal(readQuotaState(pool.stateFile).active, "two");
  now += 301000; primaryUsed = 0;
  await routeSubscription({ user: "test" }, deps);
  assert.deepEqual(calls, ["two", "one"], "The primary is preferred again only after a fresh availability check");
  console.log("ok  Primary quota exhaustion uses backup; reset returns to primary; weekly limits are respected");

  const capped = config(); let attempts = 0;
  await assert.rejects(routeSubscription({ user: "test" }, { pool: capped, limits: async () => usage(100, 100), run: async () => { attempts++; } }), (e) => e.meta?.quota && e.meta.retryAt > now);
  assert.equal(attempts, 0, "Both capped accounts cause no inference calls and no switching loop");
  console.log("ok  Both exhausted stops with the earliest usable reset and no API fallback");

  const race = config(), chosen = [];
  await routeSubscription({ user: "test" }, { pool: race, limits: async () => usage(10, 10), run: async (o) => { chosen.push(o.codexHome); if (o.codexHome === "one") throw new Error("You've hit your usage limit."); return {}; } });
  assert.deepEqual(chosen, ["one", "two"]);
  const offline = config(); let failures = 0;
  await assert.rejects(routeSubscription({ user: "test" }, { pool: offline, limits: async () => usage(10, 10), run: async () => { failures++; throw new Error("Network unavailable"); } }), /Network/);
  assert.equal(failures, 1, "Network or content failures never cycle to another account");
  let burstAttempts = 0;
  await assert.rejects(routeSubscription({}, { pool: config(), limits: async () => usage(10, 10), run: async () => { burstAttempts++; throw new Error("Too many requests"); } }), /Too many requests/);
  assert.equal(burstAttempts, 1, "A temporary burst limit without exhausted allowance must not switch accounts");
  console.log("ok  A quota race retries once on backup; unrelated failures preserve account selection");

  const stale = config();
  await assert.rejects(routeSubscription({}, { pool: stale, limits: async () => usage(100, 100), run: async () => assert.fail() }));
  now += 61000;
  await assert.rejects(routeSubscription({}, { pool: stale, now: () => now, limits: async () => { throw new Error("Usage offline"); }, run: async () => assert.fail("An unknown lookup must not clear a known cap") }));
  console.log("ok  Unavailable usage never clears a previously exhausted account");

  const quotaError = new Error("Both account allowances exhausted"); quotaError.meta = { quota: true, status: 429 };
  const common = { draft: { body: "draft" }, sources: [{ title: "source", text: "fetched evidence", url: "https://example.invalid/source" }] };
  await assert.rejects(precheck({ ...common, verify: async () => { throw quotaError; } }), (e) => e === quotaError);
  await assert.rejects(precheck({ ...common, verify: async () => ({ counts: {}, checks: [{ verdict: "contradicted", status: "confirmed", sentence: "bad figure", class: "figure" }] }), repairWith: async () => { throw quotaError; } }), (e) => e === quotaError);
  console.log("ok  Quota exhaustion at verification or repair defers the event instead of rejecting it");
} finally {
  if (path.dirname(temp) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith("khazendar-pool-test-")) rmSync(temp, { recursive: true, force: true });
}
