import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { jsonrepair } from "jsonrepair";
import { USER_AGENT, fetchWithTimeout, sleep } from "./util.mjs";

/**
 * Every model call of the newsroom, the copy desk, the picture desk and the tools goes to Claude, on the
 * owner's subscription, through the Claude Code command line. Nothing else: the owner, 2026-09-24, «abandon
 * free models and use claude only». Until then the free OpenRouter models were the backup behind Claude and
 * the only eyes of the picture desk; in that day's test run the free vision models spent fifteen minutes on
 * one story's photograph and answered with nothing half the time, and a free writer padded a story Claude
 * had declined to pad. A call that fails is retried on Claude; there is no other model to fall back to.
 * `role` (editor, writer, desk, critic, vision) only labels the call in the logs.
 */

export const usage = { calls: 0, failures: 0, promptTokens: 0, completionTokens: 0, byModel: {} };
/** The model every role runs on unless KHAZENDAR_CLAUDE_MODEL names another: Claude Opus 5.5 (the owner, 2026-09-24). */
export const CLAUDE_MODEL = "claude-opus-5-5";

let inFlight = 0;
const MAX_CONCURRENCY = Number(process.env.KHAZENDAR_LLM_CONCURRENCY ?? 2);
const waiters = [];
async function acquire() {
  if (inFlight < MAX_CONCURRENCY) {
    inFlight += 1;
    return;
  }
  await new Promise((resolve) => waiters.push(resolve));
  inFlight += 1;
}
function release() {
  inFlight -= 1;
  const next = waiters.shift();
  if (next) next();
}

export class LlmError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.meta = meta;
  }
}

function stripNoise(text) {
  let out = String(text ?? "");
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<\|.*?\|>/g, "");
  const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) out = fence[1];
  return out.trim();
}

function balancedSlice(text, open, close) {
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

export function parseJsonLoose(text) {
  const cleaned = stripNoise(text);
  if (!cleaned) throw new LlmError("Model returned an empty answer", { sample: "" });
  const candidates = [cleaned];
  const obj = balancedSlice(cleaned, "{", "}");
  const arr = balancedSlice(cleaned, "[", "]");
  if (obj) candidates.push(obj);
  if (arr && (!obj || cleaned.indexOf("[") < cleaned.indexOf("{"))) candidates.unshift(arr);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON.parse(jsonrepair(candidate));
      } catch {
        /* try next */
      }
    }
  }
  throw new LlmError("Model output was not valid JSON", { sample: cleaned.slice(0, 300) });
}

/**
 * The Claude Code command line, which uses the owner's Claude subscription (a `claude setup-token` token in
 * CLAUDE_CODE_OAUTH_TOKEN) instead of an API key.
 *
 * The command line is never handed to a shell. On Windows the `claude` on PATH is a .cmd shim that
 * only cmd.exe can start, and cmd.exe cuts an argument at every newline, `&` and `%`: measured on
 * 2026-09-22, the multi-line house-style system prompt reached the model as the single word "You",
 * the rest of its first line became the prompt, and a `%PATH%` inside a prompt was expanded. So the
 * CLI's own entry file runs under this node. The call is also made from a bare temporary directory
 * with settings switched off, so that neither the owner's other projects' CLAUDE.md files nor this
 * repository's agent notes and memories are pasted into the writer's context.
 */
const CLI_ROOTS = [
  path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code"),
  path.join(process.env.HOME ?? "", ".npm-global", "lib", "node_modules", "@anthropic-ai", "claude-code"),
  "/usr/local/lib/node_modules/@anthropic-ai/claude-code",
  "/usr/lib/node_modules/@anthropic-ai/claude-code",
];
// Since 2.1.2xx the package ships a native binary, bin/claude.exe on every platform, and no cli.js (found
// 2026-09-24 when 2.1.81 was updated for Opus 5.5, which needs 2.1.280 or newer). An executable starts with no
// shell, so its arguments arrive whole, as cli.js under node did; the node route stays for older installs.
const CLI_BIN = CLI_ROOTS.map((root) => path.join(root, "bin", "claude.exe")).find((p) => existsSync(p));
const CLI_JS = CLI_BIN ? undefined : CLI_ROOTS.map((root) => path.join(root, "cli.js")).find((p) => existsSync(p));

/** A nested Claude Code session poisons its children ("Not logged in"); only the owner's token and API key pass through. */
function claudeCliEnv() {
  const env = { ...process.env };
  const oauth = env.CLAUDE_CODE_OAUTH_TOKEN;
  for (const key of Object.keys(env)) {
    if (/^CLAUDECODE$|^CLAUDE_/.test(key) || key === "ANTHROPIC_BASE_URL" || key === "ANTHROPIC_AUTH_TOKEN") delete env[key];
  }
  if (oauth) env.CLAUDE_CODE_OAUTH_TOKEN = oauth;
  return env;
}

/**
 * An image for Claude, always as its bytes. The picture desk inlines its thumbnails as data URLs; a plain URL is
 * fetched here, because Claude's servers could not download a Wikimedia thumbnail themselves ("Unable to download
 * the file", 2026-09-24) while this client, with its own user agent, can.
 */
async function imageBlock(url) {
  const m = String(url).match(/^data:([^;,]+);base64,(.*)$/s);
  if (m) return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  const response = await fetchWithTimeout(String(url), { headers: { "user-agent": USER_AGENT } }, 30000);
  if (!response.ok) throw new LlmError(`image ${response.status}: ${String(url).slice(0, 100)}`, { retryable: true });
  const type = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  return { type: "image", source: { type: "base64", media_type: type, data: Buffer.from(await response.arrayBuffer()).toString("base64") } };
}

/**
 * One call. Text goes in on stdin as it is; a call with images goes in as one stream-json user message carrying
 * the text and the image blocks (tested 2026-09-24 on a Commons thumbnail: the CLI described the photograph in
 * three seconds), and its answer is the stream's closing "result" line.
 */
async function callClaudeCli({ system, user, images = [], timeoutMs }) {
  const { spawn } = await import("node:child_process");
  // Opus 5.5 by name (the owner, 2026-09-24: "use claude opus 5.5"): the alias "opus" answered as Opus 4.6
  // under Claude Code 2.1.81, and an alias follows whatever the installed version maps it to.
  const cliModel = process.env.KHAZENDAR_CLAUDE_MODEL || CLAUDE_MODEL;
  const seeing = images.length > 0;
  const args = ["-p", "--output-format", seeing ? "stream-json" : "json", ...(seeing ? ["--input-format", "stream-json", "--verbose"] : []), "--tools", "", "--no-session-persistence", "--setting-sources", "", "--model", cliModel];
  if (system) args.push("--system-prompt", system);
  const input = seeing ? `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: user }, ...(await Promise.all(images.map(imageBlock)))] } })}\n` : user;
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(CLI_BIN ?? (CLI_JS ? process.execPath : "claude"), CLI_BIN ? args : CLI_JS ? [CLI_JS, ...args] : args, { shell: false, windowsHide: true, env: claudeCliEnv(), cwd: os.tmpdir() });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new LlmError(`claude cli timeout after ${timeoutMs}ms`, { retryable: true }));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new LlmError(`claude cli failed to start (${e.message}); install it with npm i -g @anthropic-ai/claude-code`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new LlmError(`claude cli exit ${code}: ${err.slice(0, 200)}`, { retryable: true }));
      resolve(out);
    });
    child.stdin.end(input);
  });
  let payload;
  try {
    payload = seeing
      ? result.split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((line) => line?.type === "result")
      : JSON.parse(result);
  } catch {
    payload = null;
  }
  if (!payload) throw new LlmError("claude cli returned non-JSON output", { sample: result.slice(0, 200), retryable: true });
  // Only a refused login stops the retries; any other error the CLI reports (an API 400, an overloaded server) may pass on the next try.
  if (payload.is_error) {
    const message = String(payload.result ?? "");
    const login = /not logged in|\b401\b|authenticat|oauth|invalid (?:x-)?api[- ]key|credit balance/i.test(message);
    throw new LlmError(`claude cli: ${message.slice(0, 200)}`, login ? { status: 401 } : { retryable: true });
  }
  const used = payload.usage ?? {};
  usage.calls += 1;
  usage.promptTokens += used.input_tokens ?? 0;
  usage.completionTokens += used.output_tokens ?? 0;
  // The model that answered, as the CLI reports it, not the name asked for: an alias hid Opus 4.6 for days.
  const answered = Object.keys(payload.modelUsage ?? {})[0] ?? cliModel;
  usage.byModel[`claude-cli/${answered}`] = (usage.byModel[`claude-cli/${answered}`] ?? 0) + 1;
  return { content: String(payload.result ?? ""), ms: Date.now() - started, usage: { completion_tokens: used.output_tokens } };
}

/** Three tries on Claude: with no other model behind it, a third try costs less than a lost story. */
const ATTEMPTS = 3;

/**
 * Runs one model call on Claude. `validate(data)` may throw to reject a parsed answer, which is then asked
 * again, up to three times in all. The returned `model` ("claude-cli") is what the article records.
 */
export async function chat({ role, system, user, images = [], json = true, validate, timeoutMs = 240000, log = () => {} }) {
  const errors = [];
  // Why the last answer was refused, told to the next try: three identical requests came back three times at the
  // same length (a story refused at 140, 149 and 152 words against a floor of 200, 2026-09-24).
  let refusal = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    await acquire();
    try {
      const told = attempt > 1 && refusal ? `\n\nYour previous answer was refused: ${refusal}. Correct exactly that in this answer.` : "";
      const nudge = attempt > 1 && json ? "\n\nIMPORTANT: Reply with ONE valid JSON value only. No prose, no markdown fences, no comments." : "";
      const result = await callClaudeCli({ system, user: user + told + nudge, images, timeoutMs });
      let data = result.content;
      try {
        if (json) data = parseJsonLoose(result.content);
        if (validate) validate(data);
      } catch (error) {
        refusal = String(error.message).split("\n")[0].slice(0, 300);
        throw error;
      }
      log(`llm ok role=${role} model=claude-cli attempt=${attempt} ms=${result.ms}`);
      return { data, text: result.content, model: "claude-cli", ms: result.ms, usage: result.usage };
    } catch (error) {
      usage.failures += 1;
      errors.push(`claude-cli#${attempt}: ${error.message}`);
      const sample = error.meta?.sample ? ` sample=${JSON.stringify(String(error.meta.sample).slice(0, 140))}` : "";
      log(`llm fail role=${role} model=claude-cli attempt=${attempt}: ${String(error.message).slice(0, 200)}${sample}`);
      // A refused login is not cured by asking again.
      if (error.meta?.status === 401) break;
      if (attempt < ATTEMPTS) await sleep(3000);
    } finally {
      release();
    }
  }
  throw new LlmError(`Claude failed for role ${role}:\n${errors.join("\n")}`);
}
