// GitHub Actions only. Plaintext credentials stay in RUNNER_TEMP, never in the checkout or logs.
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { openCodexAuth, sealCodexAuth, validateCodexAuth } from "../pipeline/lib/codex-cloud.mjs";

try {
  const runner = path.resolve(process.env.RUNNER_TEMP || "");
  const home = path.resolve(process.env.CODEX_HOME || "");
  if (!process.env.RUNNER_TEMP || !process.env.CODEX_HOME || path.dirname(home) !== runner) throw new Error("Cloud ChatGPT credentials must stay inside the runner's temporary folder.");
  const encrypted = path.join(runner, "khazendar-codex-auth.enc");
  const key = process.env.KHAZENDAR_CODEX_STATE_KEY || "";
  const session = process.env.KHAZENDAR_CODEX_SESSION || "";
  if (!key || !session) throw new Error("Connect a ChatGPT account for scheduled publishing in the Control Room first.");
  if (process.argv[2] === "restore") {
    let cached = null;
    try { cached = await readFile(encrypted, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const auth = cached ? openCodexAuth(cached, key, session) : validateCodexAuth(process.env.KHAZENDAR_CODEX_AUTH_JSON || "");
    await mkdir(home, { recursive: true, mode: 0o700 });
    await chmod(home, 0o700);
    const accounts = auth.version === 2 ? auth.accounts : [{ id: "primary", auth }];
    const pool = { enabled: true, primary: auth.primary || "primary", backup: auth.backup || "", stateFile: path.join(home, "usage.json"), accounts: accounts.map((a) => ({ id: a.id, home: path.join(home, a.id) })) };
    for (const account of accounts) {
      for (const value of Object.values(account.auth.tokens || {})) if (typeof value === "string" && value) console.log(`::add-mask::${value}`);
      const dir = path.join(home, account.id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(path.join(dir, "auth.json"), JSON.stringify(account.auth), { mode: 0o600 });
      await writeFile(path.join(dir, "config.toml"), 'cli_auth_credentials_store = "file"\nforced_login_method = "chatgpt"\n', { mode: 0o600 });
    }
    await writeFile(path.join(home, "pool.json"), JSON.stringify(pool), { mode: 0o600 });
    await writeFile(pool.stateFile, JSON.stringify(auth.quotaState || { accounts: {} }), { mode: 0o600 });
    if (process.env.GITHUB_ENV) await writeFile(process.env.GITHUB_ENV, `KHAZENDAR_CODEX_POOL_FILE=${path.join(home, "pool.json")}\n`, { flag: "a" });
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, "ready=true\n", { flag: "a" });
    console.log("ChatGPT subscription session restored; Platform API keys are not used.");
  } else if (process.argv[2] === "save") {
    const pool = JSON.parse(await readFile(path.join(home, "pool.json"), "utf8"));
    const accounts = [];
    for (const account of pool.accounts) {
      if (path.dirname(path.resolve(account.home)) !== home) throw new Error("Invalid cloud account directory.");
      accounts.push({ id: account.id, auth: validateCodexAuth(await readFile(path.join(account.home, "auth.json"), "utf8")) });
    }
    const quotaState = JSON.parse(await readFile(pool.stateFile, "utf8"));
    const auth = { version: 2, primary: pool.primary, backup: pool.backup, accounts, quotaState };
    await writeFile(encrypted, sealCodexAuth(auth, key, session), { mode: 0o600 });
    await writeFile(path.join(runner, "khazendar-chatgpt-usage.json"), JSON.stringify({ ...quotaState, primary: pool.primary, backup: pool.backup, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    console.log("Refreshed ChatGPT session encrypted for the next scheduled run.");
    if (process.env.GITHUB_STEP_SUMMARY) {
      const rows = accounts.map((a) => {
        const state = quotaState.accounts[a.id];
        const windows = state?.windows?.map((w) => `${w.windowDurationMins ?? "?"} min: ${w.usedPercent ?? "?"}% used${w.resetsAt ? `; resets ${new Date(w.resetsAt).toISOString()}` : ""}`).join(" · ") || "not checked this run";
        return `- ${a.id === pool.primary ? "Primary" : "Backup"}: ${windows}`;
      });
      await writeFile(process.env.GITHUB_STEP_SUMMARY, `\n### ChatGPT account allowances\n\n${rows.join("\n")}\n`, { flag: "a" });
    }
  } else throw new Error("Choose restore or save.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
