import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { accountPool, quotaStateFile } from "./codex-accounts.mjs";
import { codexRateLimits, runCodex } from "./codex.mjs";

export function quotaSnapshot(response, now = Date.now()) {
  const buckets = response?.rateLimitsByLimitId;
  const bucket = buckets?.codex || buckets?.["gpt-6.1-sol"] || response?.rateLimits;
  if (!bucket) throw new Error("OpenAI did not return a usage allowance for this account.");
  const windows = [bucket.primary, bucket.secondary].filter(Boolean).map((w) => ({
    usedPercent: Number.isFinite(w.usedPercent) ? w.usedPercent : null,
    windowDurationMins: w.windowDurationMins ?? null,
    resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt * 1000 : null,
  }));
  if (!windows.some((w) => w.usedPercent !== null)) throw new Error("OpenAI returned no measurable quota windows.");
  const blocked = windows.filter((w) => w.usedPercent >= 100);
  return { checkedAt: now, windows, exhausted: blocked.length > 0 || Boolean(bucket.rateLimitReachedType),
    // Every exhausted window must reset before this account is eligible again.
    retryAt: blocked.length && blocked.every((w) => w.resetsAt) ? Math.max(...blocked.map((w) => w.resetsAt)) : null };
}
export function readQuotaState(file = quotaStateFile()) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { accounts: {} }; throw new Error("The saved ChatGPT usage state could not be read."); }
}
function saveState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 }); renameSync(temp, file);
}
export function isQuotaError(error) {
  return error.meta?.quota === true || /usage_limit_reached|usage limit|quota (?:exceeded|exhausted)|rate_limit_exceeded|rate limit (?:reached|exceeded)|too many requests/i.test(error.message || "");
}
export function quotaWaitError(state, accounts) {
  const resets = accounts.map((a) => state.accounts[a.id]?.retryAt).filter((t) => t > Date.now());
  const retryAt = resets.length ? Math.min(...resets) : null;
  const error = new Error(`The connected ChatGPT accounts have no available allowance.${retryAt ? ` Earliest reported reset: ${new Date(retryAt).toISOString()}.` : " Refresh usage to check for a reset."} No paid API fallback was used.`);
  error.meta = { status: 429, quota: true, retryAt };
  return error;
}

/** Serialize this process's calls so a depleted account is not selected by two calls at once. */
let queue = Promise.resolve();
export function runSubscription(options, outside = {}) {
  const task = queue.then(() => routeSubscription(options, outside));
  queue = task.catch(() => {}); return task;
}
export async function routeSubscription(options, { pool = accountPool(), run = runCodex, limits = codexRateLimits, now = () => Date.now() } = {}) {
  if (options.codexHome || !pool?.enabled) return run(options);
  const state = readQuotaState(pool.stateFile);
  const ordered = [pool.primary, pool.backup].map((id) => pool.accounts.find((a) => a.id === id)).filter(Boolean);
  if (!ordered.length) throw new Error("No ChatGPT accounts are configured for this newsroom.");
  for (const account of ordered) {
    let quota = state.accounts[account.id];
    const fresh = quota && now() - quota.checkedAt < 60000 && !(quota.retryAt && quota.retryAt <= now());
    if (!fresh) {
      try { quota = quotaSnapshot(await limits({ codexHome: account.home }), now()); }
      catch { quota = { ...quota, checkedAt: now(), unavailable: true }; }
      state.accounts[account.id] = quota; saveState(pool.stateFile, state);
    }
    // An unavailable meter must preserve known future/unknown caps, but must not lock an
    // account forever after every recorded exhausted window has reset. One normal request
    // asks the service to decide; it never resets a quota or changes the billing provider.
    const blocked = (quota.windows ?? []).filter((w) => w.usedPercent >= 100);
    const resetProbe = quota.exhausted && quota.unavailable && blocked.length > 0
      && blocked.every((w) => Number.isFinite(w.resetsAt) && w.resetsAt <= now())
      && !(quota.probeAfter > now());
    if (quota.exhausted && !resetProbe) continue;
    if (resetProbe) {
      quota = { ...quota, probeAfter: now() + 300000 };
      state.accounts[account.id] = quota; saveState(pool.stateFile, state);
    }
    try {
      const result = await run({ ...options, codexHome: account.home });
      if (resetProbe) {
        // Acceptance confirms availability, not a guessed percentage. Expired readings are unknown.
        state.accounts[account.id] = { ...quota, exhausted: false, retryAt: null, probeAfter: null,
          windows: quota.windows.map((w) => Number.isFinite(w.resetsAt) && w.resetsAt <= now() ? { ...w, usedPercent: null } : w) };
      }
      state.active = account.id; state.lastSwitchAt = now(); saveState(pool.stateFile, state);
      return result;
    } catch (error) {
      // Content refusals, network failures and authentication failures do not spend the other account's allowance.
      if (!isQuotaError(error)) throw error;
      try { quota = quotaSnapshot(await limits({ codexHome: account.home }), now()); } catch {}
      if (!quota?.exhausted && !/usage_limit_reached|usage limit|quota (?:exceeded|exhausted)/i.test(error.message || "")) throw error;
      state.accounts[account.id] = { ...quota, checkedAt: now(), exhausted: true,
        ...(resetProbe ? { probeAfter: now() + 300000 } : {}) };
      saveState(pool.stateFile, state);
    }
  }
  throw quotaWaitError(state, ordered);
}

export async function refreshAccountUsage(account, stateFile = quotaStateFile()) {
  const quota = quotaSnapshot(await codexRateLimits({ codexHome: account.home }));
  // Re-read after the network call so another account's updated data is retained.
  const current = readQuotaState(stateFile);
  current.accounts[account.id] = quota; saveState(stateFile, current);
  return quota;
}
