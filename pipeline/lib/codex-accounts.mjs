import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { codexEnvironment } from "./codex.mjs";

const base = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Khazendar", "chatgpt");
const file = () => path.join(base(), "accounts.json");
export const quotaStateFile = () => path.join(base(), "usage.json");
export const defaultCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export function readAccountStore() {
  if (!existsSync(file())) return { accounts: [], reminders: {} };
  try { return JSON.parse(readFileSync(file(), "utf8")); } catch { throw new Error("The ChatGPT account list is damaged; it has been left unchanged."); }
}
function save(store) {
  mkdirSync(base(), { recursive: true });
  const temp = `${file()}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(temp, file());
}
function claims(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { return {}; }
}
/** Display metadata only. JWT expiry and old subscription-period claims are NOT billing expiry. */
export function accountIdentity(home) {
  try {
    const auth = JSON.parse(readFileSync(path.join(home, "auth.json"), "utf8"));
    const id = claims(auth.tokens?.id_token || "");
    const access = claims(auth.tokens?.access_token || "");
    return { email: id.email || access["https://api.openai.com/profile"]?.email || "", plan: access["https://api.openai.com/auth"]?.chatgpt_plan_type || id["https://api.openai.com/auth"]?.chatgpt_plan_type || "", hasFile: auth.auth_mode === "chatgpt" };
  } catch { return { email: "", plan: "", hasFile: false }; }
}
export function accountById(id) {
  if (id === "desktop") return { id, label: "Current Codex desktop account", home: defaultCodexHome(), target: "local" };
  const account = readAccountStore().accounts.find((a) => a.id === id);
  if (!account) throw new Error("Unknown ChatGPT account.");
  return account;
}
export function listAccounts(source = process.env) {
  const store = readAccountStore();
  const home = source.KHAZENDAR_CODEX_HOME || defaultCodexHome();
  return [accountById("desktop"), ...store.accounts].map((a) => ({ id: a.id, label: a.label, target: a.target, active: path.resolve(a.home) === path.resolve(home), ...accountIdentity(a.home), expectedEnd: store.reminders?.[a.id] || "", expirySource: "user reminder; OpenAI billing expiry is not available here" }));
}
export function setAccountReminder(id, date) {
  accountById(id);
  const stamp = Date.parse(date);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date)) throw new Error("Enter a valid date or leave it blank.");
  const store = readAccountStore();
  store.reminders ||= {};
  store.reminders[id] = date;
  save(store);
}

export function setAccountPool({ primary, backup = "", enabled = false }) {
  const first = accountById(primary);
  const second = backup ? accountById(backup) : null;
  if (first.target !== "local" || (second && second.target !== "local")) throw new Error("Choose local sign-ins for this laptop's account pair.");
  if (enabled && (!second || first.id === second.id)) throw new Error("Connect and choose two different accounts first.");
  if (second) {
    const a = accountIdentity(first.home), b = accountIdentity(second.home);
    if (a.email && a.email.toLowerCase() === b.email.toLowerCase()) throw new Error("These sign-ins belong to the same account; they share its allowance. Choose the other account.");
  }
  const store = readAccountStore();
  store.pool = { primary: first.id, backup: second?.id || "", enabled: Boolean(enabled) };
  save(store);
  return store.pool;
}

export function accountPool(source = process.env) {
  if (source.KHAZENDAR_CODEX_POOL_FILE) return JSON.parse(readFileSync(source.KHAZENDAR_CODEX_POOL_FILE, "utf8"));
  const pool = readAccountStore().pool;
  if (!pool?.enabled) return null;
  return { ...pool, stateFile: quotaStateFile(), accounts: [pool.primary, pool.backup].map(accountById) };
}

let login = null;
export function loginState() {
  if (!login) return { running: false };
  const { child, ...visible } = login;
  return visible;
}
export function beginAccountLogin({ target = "local", label = "" } = {}, run = spawn) {
  if (login?.running) throw new Error("Finish the ChatGPT sign-in already in progress first.");
  const id = randomUUID();
  const home = path.join(base(), id);
  mkdirSync(home, { recursive: true });
  const account = { id, home, target: target === "cloud" ? "cloud" : "local", label: String(label || (target === "cloud" ? "Scheduled publishing account" : "Newsroom account")).slice(0, 80) };
  const child = run(process.env.KHAZENDAR_CODEX_BIN || (process.platform === "win32" ? "codex.exe" : "codex"), ["--config", 'cli_auth_credentials_store="file"', "--config", 'forced_login_method="chatgpt"', "login", "--device-auth"], { env: codexEnvironment({ ...process.env, KHAZENDAR_CODEX_HOME: home }), cwd: home, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60 * 1000 });
  const state = { running: true, accountId: id, target: account.target, url: "", code: "", error: "", complete: false, child };
  login = state;
  let output = "";
  const feed = (chunk) => {
    output = (output + chunk).replace(/\x1b\[[0-9;]*m/g, "").slice(-8000);
    const url = output.match(/https:\/\/auth\.openai\.com\/[a-zA-Z0-9/_-]+/);
    const code = output.match(/\b[A-Z0-9]{4,6}-[A-Z0-9]{4,6}\b/);
    if (url) state.url = url[0];
    if (code) state.code = code[0];
  };
  child.stdout.on("data", feed); child.stderr.on("data", feed);
  child.once("error", () => { state.running = false; state.error = "Could not start Codex sign-in. Check that Codex is installed."; });
  child.once("close", (code) => {
    state.running = false;
    try {
      if (code === 0 && accountIdentity(home).hasFile) {
        const store = readAccountStore(); store.accounts.push(account); save(store);
        state.complete = true; state.code = ""; state.url = "";
      } else if (!state.error) state.error = "Sign-in did not finish. You can retry; device-code login may need enabling in ChatGPT Settings → Security.";
    } catch { state.error = "The sign-in finished but its account record could not be saved. Existing accounts were left unchanged."; }
  });
  return loginState();
}
