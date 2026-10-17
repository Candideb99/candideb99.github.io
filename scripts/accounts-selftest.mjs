#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { sealCodexAuth, openCodexAuth } from "../pipeline/lib/codex-cloud.mjs";

const temp = mkdtempSync(path.join(os.tmpdir(), "khazendar-account-test-"));
process.env.LOCALAPPDATA = path.join(temp, "appdata");
process.env.CODEX_HOME = path.join(temp, "desktop");
delete process.env.KHAZENDAR_CODEX_HOME;
const jwt = (claims) => `fake.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fake`;
const auth = { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { access_token: jwt({ "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }), refresh_token: "fake-private-refresh", id_token: jwt({ email: "test@example.invalid", "https://api.openai.com/auth": { chatgpt_subscription_active_until: "2020-01-01T00:00:00Z" } }) } };
mkdirSync(process.env.CODEX_HOME, { recursive: true });
writeFileSync(path.join(process.env.CODEX_HOME, "auth.json"), JSON.stringify(auth));
try {
  const accounts = await import("../pipeline/lib/codex-accounts.mjs");
  const listed = accounts.listAccounts();
  assert.equal(listed[0].email, "test@example.invalid");
  assert.equal(listed[0].expectedEnd, "", "An old token's subscription period is never used as expiry");
  assert.equal(JSON.stringify(listed).includes(auth.tokens.refresh_token), false);
  accounts.setAccountReminder("desktop", "2026-11-05");
  assert.equal(accounts.listAccounts()[0].expectedEnd, "2026-11-05");
  assert.throws(() => accounts.setAccountReminder("desktop", "2026-02-30"));
  assert.throws(() => accounts.accountById("../../escape"));
  console.log("ok  Account identity is displayed without tokens; expiry is explicitly a user reminder");

  let child, profile;
  accounts.beginAccountLogin({ target: "cloud" }, (binary, args, options) => {
    assert.equal(options.shell, false); assert.ok(args.includes("--device-auth"));
    profile = options.env.CODEX_HOME;
    assert.notEqual(profile, process.env.CODEX_HOME, "A new sign-in never logs out the desktop account");
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    return child;
  });
  child.stdout.emit("data", "Open https://auth.openai.com/codex/device and enter ABCD-EFGH");
  assert.equal(accounts.loginState().code, "ABCD-EFGH");
  assert.throws(() => accounts.beginAccountLogin(), /already in progress/);
  writeFileSync(path.join(profile, "auth.json"), JSON.stringify(auth));
  child.emit("close", 0);
  assert.equal(accounts.loginState().complete, true);
  assert.equal(accounts.loginState().code, "");
  assert.equal(accounts.listAccounts()[1].target, "cloud");
  assert.equal(accounts.listAccounts()[0].active, true);
  assert.equal(accounts.listAccounts({ ...process.env, KHAZENDAR_CODEX_HOME: profile })[1].active, true, "Selected profiles remain active when loaded from local settings after restart");
  console.log("ok  Device sign-in has an isolated profile and does not replace the current account");

  accounts.beginAccountLogin({ target: "local" }, (binary, args, options) => {
    profile = options.env.CODEX_HOME;
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    return child;
  });
  writeFileSync(path.join(profile, "auth.json"), JSON.stringify(auth)); child.emit("close", 0);
  const backup = accounts.listAccounts().at(-1);
  assert.throws(() => accounts.setAccountPool({ primary: "desktop", backup: backup.id, enabled: true }), /same account/);
  const other = { ...auth, tokens: { ...auth.tokens, id_token: jwt({ email: "second@example.invalid" }) } };
  writeFileSync(path.join(profile, "auth.json"), JSON.stringify(other));
  accounts.setAccountPool({ primary: "desktop", backup: backup.id, enabled: true });
  assert.equal(accounts.accountPool().accounts.length, 2);
  assert.equal(accounts.readAccountStore().pool.enabled, true);
  accounts.setAccountPool({ primary: "desktop", enabled: false });
  assert.equal(accounts.accountPool(), null);
  console.log("ok  Both accounts remain connected; duplicate identities cannot create an extra allowance");

  const key = "a".repeat(64), session = "new-session";
  const encrypted = sealCodexAuth(auth, key, session);
  assert.equal(encrypted.includes(auth.tokens.refresh_token), false);
  assert.deepEqual(openCodexAuth(encrypted, key, session), auth);
  assert.notEqual(encrypted, sealCodexAuth(auth, key, session));
  assert.throws(() => openCodexAuth(encrypted, "b".repeat(64), session));
  assert.throws(() => openCodexAuth(encrypted, key, "another-account-session"));
  const damaged = JSON.parse(encrypted); damaged.data = (damaged.data[0] === "A" ? "B" : "A") + damaged.data.slice(1);
  assert.throws(() => openCodexAuth(JSON.stringify(damaged), key, session));
  assert.throws(() => sealCodexAuth({ ...auth, OPENAI_API_KEY: "fake-api-key" }, key, session));
  console.log("ok  Cloud session ciphertext rejects tampering, wrong accounts, wrong keys and API credentials");

  const runner = path.join(temp, "runner"); mkdirSync(runner);
  const home = path.join(runner, "khazendar-codex");
  const script = path.resolve("scripts/codex-cloud-auth.mjs");
  const env = { ...process.env, RUNNER_TEMP: runner, CODEX_HOME: home, KHAZENDAR_CODEX_AUTH_JSON: JSON.stringify(auth), KHAZENDAR_CODEX_STATE_KEY: key, KHAZENDAR_CODEX_SESSION: session };
  const restore = spawnSync(process.execPath, [script, "restore"], { env, encoding: "utf8" });
  assert.equal(restore.status, 0, restore.stderr);
  const refreshed = { ...auth, tokens: { ...auth.tokens, refresh_token: "new-private-refresh" } };
  writeFileSync(path.join(home, "primary", "auth.json"), JSON.stringify(refreshed));
  const saved = spawnSync(process.execPath, [script, "save"], { env, encoding: "utf8" });
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(readFileSync(path.join(runner, "khazendar-codex-auth.enc"), "utf8").includes("new-private-refresh"), false);
  const restored = spawnSync(process.execPath, [script, "restore"], { env, encoding: "utf8" });
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(home, "primary", "auth.json"))).tokens.refresh_token, "new-private-refresh", "A rotated token wins over the original bootstrap secret");
  console.log("ok  Cloud bootstrap, token refresh persistence and encrypted restore work without a model call");

  const second = { ...auth, tokens: { ...auth.tokens, refresh_token: "second-private-refresh" } };
  const bundle = { version: 2, primary: "one", backup: "two", accounts: [{ id: "one", auth }, { id: "two", auth: second }] };
  const poolEnv = { ...env, KHAZENDAR_CODEX_SESSION: "two-accounts", KHAZENDAR_CODEX_AUTH_JSON: JSON.stringify(bundle) };
  // A new session starts without an old session's ciphertext cache.
  const runner2 = path.join(temp, "runner-two"); mkdirSync(runner2);
  poolEnv.RUNNER_TEMP = runner2; poolEnv.CODEX_HOME = path.join(runner2, "khazendar-codex");
  assert.equal(spawnSync(process.execPath, [script, "restore"], { env: poolEnv }).status, 0);
  assert.equal(JSON.parse(readFileSync(path.join(poolEnv.CODEX_HOME, "two", "auth.json"))).tokens.refresh_token, "second-private-refresh");
  assert.equal(spawnSync(process.execPath, [script, "save"], { env: poolEnv }).status, 0);
  const opened = openCodexAuth(readFileSync(path.join(runner2, "khazendar-codex-auth.enc"), "utf8"), key, "two-accounts");
  assert.equal(opened.accounts.length, 2);
  assert.equal(opened.accounts[1].auth.tokens.refresh_token, "second-private-refresh");
  assert.throws(() => sealCodexAuth({ ...bundle, accounts: [{ id: "../../escape", auth }] }, key, session));
  console.log("ok  Two independent cloud sessions and their rotated credentials survive encrypted save and restore");
} finally {
  if (path.dirname(temp) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith("khazendar-account-test-")) rmSync(temp, { recursive: true, force: true });
}
