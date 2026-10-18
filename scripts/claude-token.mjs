/**
 * Connects the newsroom to Claude with a new subscription token, for the owner to run himself:
 *   node scripts/claude-token.mjs
 * 1. starts `claude setup-token`, which opens the browser for him to sign in and authorise;
 * 2. asks him to paste the token it prints;
 * 3. tests it with one tiny Claude call BEFORE saving anything (2026-10-18: the token of 21 Sept was refused with
 *    "Your organization has disabled Claude subscription access for Claude Code", and every cloud run from 1 to 17
 *    October failed on it unseen);
 * 4. saves it in .env and as the GitHub secret CLAUDE_CODE_OAUTH_TOKEN (passed on stdin, never on a command line).
 * The token is never printed by this script, never logged and never sent anywhere but Anthropic and GitHub.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const REPO = "Candideb99/candideb99.github.io";
const MODEL = "claude-opus-5-5";
const ROOTS = [
  path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code"),
  "/usr/local/lib/node_modules/@anthropic-ai/claude-code",
  "/usr/lib/node_modules/@anthropic-ai/claude-code",
];
const BIN = ROOTS.map((r) => path.join(r, "bin", process.platform === "win32" ? "claude.exe" : "claude")).find((p) => existsSync(p)) ?? "claude";

/** A Claude Code session exports variables that point a child CLI at its own proxy; a clean login needs none of them. */
function cleanEnv(token) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^CLAUDECODE$|^CLAUDE_/.test(k) || /^ANTHROPIC_/.test(k)) delete env[k];
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}

const ask = (question) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
});

function test(token) {
  const r = spawnSync(BIN, ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--model", MODEL], {
    input: "Reply with the single word OK.", env: cleanEnv(token), cwd: os.tmpdir(), encoding: "utf8", windowsHide: true, timeout: 180000,
  });
  try {
    const out = JSON.parse(r.stdout);
    if (out.is_error) return { ok: false, message: String(out.result ?? "").slice(0, 300) };
    const model = Object.keys(out.modelUsage ?? {})[0] ?? MODEL;
    return { ok: true, model };
  } catch {
    return { ok: false, message: `${r.stderr || r.stdout || r.error?.message || "no answer"}`.slice(0, 300) };
  }
}

function saveEnv(token) {
  const file = path.join(process.cwd(), ".env");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const line = `CLAUDE_CODE_OAUTH_TOKEN=${token}`;
  const next = /^CLAUDE_CODE_OAUTH_TOKEN=.*$/m.test(text) ? text.replace(/^CLAUDE_CODE_OAUTH_TOKEN=.*$/m, line) : `${text.replace(/\s*$/, "\n")}${line}\n`;
  writeFileSync(file, next);
}

function saveGitHub(token) {
  const r = spawnSync("gh", ["secret", "set", "CLAUDE_CODE_OAUTH_TOKEN", "--repo", REPO], { input: token, encoding: "utf8", windowsHide: true, timeout: 60000 });
  return r.status === 0 ? null : (r.stderr || r.error?.message || "gh failed").trim().slice(0, 200);
}

console.log("\nConnect Khazendar's newsroom to Claude\n");
console.log("Step 1 of 2. Your browser will open. Sign in to Claude with the account you use in the Claude app,");
console.log("            then click Authorize. A long line starting with sk-ant-oat01 will appear here.\n");
await new Promise((resolve) => {
  const child = spawn(BIN, ["setup-token"], { stdio: "inherit", env: cleanEnv(), windowsHide: false });
  child.on("close", resolve);
  child.on("error", (e) => { console.log(`Could not start Claude Code (${e.message}).`); resolve(); });
});

console.log("\nStep 2 of 2. Select that whole sk-ant-oat01 line, copy it (Ctrl+C), then paste it below (right-click or Ctrl+V).");
const token = (await ask("Token: ")).replace(/\s+/g, "");
if (!/^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/.test(token)) {
  console.log("\nThat does not look like a subscription token (it should start with sk-ant-oat01-). Nothing was saved. Run this again.");
  process.exit(1);
}

console.log("\nTesting the token with one short Claude call…");
const result = test(token);
if (!result.ok) {
  console.log(`\nClaude refused this token: ${result.message}`);
  if (/organization has disabled/i.test(result.message)) {
    console.log("This account belongs to an organisation that does not allow Claude Code. Run this again and sign in with");
    console.log("another account (a personal Pro or Max plan), or ask that organisation's admin to turn Claude Code on.");
  }
  console.log("Nothing was saved.");
  process.exit(1);
}
console.log(`It works (${result.model}).`);
saveEnv(token);
console.log("Saved on this laptop (.env).");
const ghError = saveGitHub(token);
console.log(ghError ? `GitHub refused it: ${ghError}\nPaste it in the control room's Settings instead (tick "send to GitHub").` : "Saved on GitHub for the scheduled newsroom.");
console.log("\nDone. You can close this tab.");
