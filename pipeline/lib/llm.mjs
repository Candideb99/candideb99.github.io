import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { jsonrepair } from "jsonrepair";
import "./env.mjs";
import { USER_AGENT, fetchWithTimeout, sleep } from "./util.mjs";
import { runSubscription } from "./codex-pool.mjs";

/**
 * Khazendar multi-provider LLM module.
 *
 * Supported providers:
 * - "gemini": Google Gemini (Default & Active controller, fast, native multimodal & structured output)
 * - "claude": Anthropic Claude (via Claude Code CLI subscription or Anthropic API; idle mode by default)
 * - "openai": OpenAI API (GPT-6.1 Sol; legacy GPT-4o models also supported)
 * - "qwen": Alibaba Qwen (DashScope API or OpenRouter)
 * - "openrouter": Multi-model router for third-party models
 *
 * Active provider is controlled by KHAZENDAR_PROVIDER (default "gemini").
 * All other configured providers stay in "idle mode" with their credentials safely preserved.
 */

export const usage = { calls: 0, failures: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, costUsd: 0, byModel: {} };

export const PROVIDERS = ["gemini", "claude", "codex", "openai", "qwen", "openrouter"];

export const DEFAULT_MODELS = {
  gemini: "gemini-3.8-flash",
  claude: "claude-opus-5-5",
  openai: "gpt-6.1-sol",
  codex: "gpt-6.1-sol",
  qwen: "qwen-plus",
  openrouter: "google/gemini-3.8-flash",
};

/** Backward compatibility: export CLAUDE_MODEL as referenced in factcheck and tests. */
export const CLAUDE_MODEL = "claude-opus-5-5";
export const GEMINI_MODEL = "gemini-3.8-flash";

export function getActiveProvider() {
  const p = (process.env.KHAZENDAR_PROVIDER || "gemini").toLowerCase().trim();
  return PROVIDERS.includes(p) ? p : "gemini";
}

export function getActiveModel(provider = getActiveProvider()) {
  if (provider === "codex") return process.env.KHAZENDAR_CODEX_MODEL || DEFAULT_MODELS.codex;
  if (provider === "gemini") return process.env.KHAZENDAR_GEMINI_MODEL || process.env.KHAZENDAR_MODEL || DEFAULT_MODELS.gemini;
  if (provider === "claude") return process.env.KHAZENDAR_CLAUDE_MODEL || process.env.KHAZENDAR_MODEL || DEFAULT_MODELS.claude;
  if (provider === "openai") return process.env.KHAZENDAR_OPENAI_MODEL || process.env.KHAZENDAR_MODEL || DEFAULT_MODELS.openai;
  if (provider === "qwen") return process.env.KHAZENDAR_QWEN_MODEL || process.env.KHAZENDAR_MODEL || DEFAULT_MODELS.qwen;
  if (provider === "openrouter") return process.env.KHAZENDAR_OPENROUTER_MODEL || process.env.KHAZENDAR_MODEL || DEFAULT_MODELS.openrouter;
  return DEFAULT_MODELS.gemini;
}

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

async function fetchImageBuffer(url) {
  const m = String(url).match(/^data:([^;,]+);base64,(.*)$/s);
  if (m) return { mimeType: m[1], base64: m[2] };
  const response = await fetchWithTimeout(String(url), { headers: { "user-agent": USER_AGENT } }, 30000);
  if (!response.ok) throw new LlmError(`image ${response.status}: ${String(url).slice(0, 100)}`, { retryable: true });
  const mimeType = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
  return { mimeType, base64 };
}

// ------------------------------------------------------------------ Claude CLI / API
const CLI_ROOTS = [
  path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code"),
  path.join(process.env.HOME ?? "", ".npm-global", "lib", "node_modules", "@anthropic-ai", "claude-code"),
  "/usr/local/lib/node_modules/@anthropic-ai/claude-code",
  "/usr/lib/node_modules/@anthropic-ai/claude-code",
];
const CLI_BIN = CLI_ROOTS.map((root) => path.join(root, "bin", "claude.exe")).find((p) => existsSync(p));
const CLI_JS = CLI_BIN ? undefined : CLI_ROOTS.map((root) => path.join(root, "cli.js")).find((p) => existsSync(p));

function claudeCliEnv() {
  const env = { ...process.env };
  const oauth = env.CLAUDE_CODE_OAUTH_TOKEN;
  for (const key of Object.keys(env)) {
    if (/^CLAUDECODE$|^CLAUDE_/.test(key) || key === "ANTHROPIC_BASE_URL" || key === "ANTHROPIC_AUTH_TOKEN") delete env[key];
  }
  if (oauth) {
    env.CLAUDE_CODE_OAUTH_TOKEN = oauth;
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
}

async function callClaudeCli({ model, system, user, images = [], timeoutMs }) {
  const { spawn } = await import("node:child_process");
  const cliModel = model || process.env.KHAZENDAR_CLAUDE_MODEL || CLAUDE_MODEL;
  const seeing = images.length > 0;
  const args = ["-p", "--output-format", seeing ? "stream-json" : "json", ...(seeing ? ["--input-format", "stream-json", "--verbose"] : []), "--tools", "", "--no-session-persistence", "--setting-sources", "", "--model", cliModel];
  if (system) args.push("--system-prompt", system);

  let input;
  if (seeing) {
    const blocks = [{ type: "text", text: user }];
    for (const img of images) {
      const { mimeType, base64 } = await fetchImageBuffer(img);
      blocks.push({ type: "image", source: { type: "base64", media_type: mimeType, data: base64 } });
    }
    input = `${JSON.stringify({ type: "user", message: { role: "user", content: blocks } })}\n`;
  } else {
    input = user;
  }

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
  if (payload.is_error) {
    const message = String(payload.result ?? "");
    const login = /not logged in|\b401\b|authenticat|oauth|invalid (?:x-)?api[- ]key|credit balance/i.test(message);
    throw new LlmError(`claude cli: ${message.slice(0, 200)}`, login ? { status: 401 } : { retryable: true });
  }
  const used = payload.usage ?? {};
  usage.calls += 1;
  usage.promptTokens += (used.input_tokens ?? 0) + (used.cache_creation_input_tokens ?? 0) + (used.cache_read_input_tokens ?? 0);
  usage.cacheReadTokens += used.cache_read_input_tokens ?? 0;
  usage.completionTokens += used.output_tokens ?? 0;
  usage.costUsd = Number((usage.costUsd + (Number(payload.total_cost_usd) || 0)).toFixed(4));
  const answered = Object.keys(payload.modelUsage ?? {})[0] ?? cliModel;
  usage.byModel[`claude-cli/${answered}`] = (usage.byModel[`claude-cli/${answered}`] ?? 0) + 1;
  return { content: String(payload.result ?? ""), ms: Date.now() - started, usage: { completion_tokens: used.output_tokens }, model: `claude-cli/${answered}` };
}

async function callClaudeApi({ model, system, user, images = [], timeoutMs, temperature, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmError("Claude is active but ANTHROPIC_API_KEY is not set. Add your key or subscription token in the Control Room Settings or .env.", { status: 401 });
  }
  const started = Date.now();
  const content = [{ type: "text", text: user }];
  for (const img of images) {
    const { mimeType, base64 } = await fetchImageBuffer(img);
    content.push({
      type: "image",
      source: { type: "base64", media_type: mimeType, data: base64 },
    });
  }

  const actualModel = model.startsWith("claude-") ? model : "claude-3-5-sonnet-20241022";
  const body = {
    model: actualModel,
    max_tokens: maxTokens || 4096,
    messages: [{ role: "user", content }],
    temperature: typeof temperature === "number" ? temperature : 0.2,
  };
  if (system) body.system = system;

  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const err = payload.error || {};
    const code = response.status;
    const message = err.message || response.statusText;
    const login = code === 401 || /invalid (?:x-)?api[- ]key/i.test(message);
    throw new LlmError(`claude-api (${actualModel}): ${code} ${message}`, login ? { status: 401 } : { retryable: [429, 500, 502, 503, 504].includes(code) });
  }

  const text = payload.content?.map((c) => c.text || "").join("") ?? "";
  const used = payload.usage ?? {};
  usage.calls += 1;
  usage.promptTokens += (used.input_tokens ?? 0) + (used.cache_creation_input_tokens ?? 0) + (used.cache_read_input_tokens ?? 0);
  usage.completionTokens += used.output_tokens ?? 0;
  const modelKey = `claude/${actualModel}`;
  usage.byModel[modelKey] = (usage.byModel[modelKey] ?? 0) + 1;

  return {
    content: text,
    ms: Date.now() - started,
    usage: { completion_tokens: used.output_tokens },
    model: modelKey,
  };
}

async function callClaude(options) {
  const hasOauth = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (hasOauth || (CLI_BIN && !hasApiKey)) {
    return callClaudeCli(options);
  }
  return callClaudeApi(options);
}

// ------------------------------------------------------------------ Google Gemini
const QUOTA_EXHAUSTED_GEMINI_MODELS = new Set();

async function callGemini({ model, system, user, images = [], timeoutMs, temperature, maxTokens, json = true }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new LlmError("Gemini is active but GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Add your key in the Control Room Settings or .env.", { status: 401 });
  }
  const started = Date.now();
  let actualModel = model || DEFAULT_MODELS.gemini;
  if (QUOTA_EXHAUSTED_GEMINI_MODELS.has(actualModel) && actualModel !== "gemini-3.7-flash") {
    actualModel = "gemini-3.7-flash";
  }

  const userParts = [{ text: user }];
  for (const img of images) {
    const { mimeType, base64 } = await fetchImageBuffer(img);
    userParts.push({
      inlineData: {
        mimeType,
        data: base64,
      },
    });
  }

  const contents = [{ role: "user", parts: userParts }];
  const body = {
    contents,
    generationConfig: {
      temperature: typeof temperature === "number" ? temperature : 0.2,
      ...(json ? { responseMimeType: "application/json" } : {}),
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      // Configurable reasoning/thinking depth (default -1 = maximum/unlimited).
      // Controlled via KHAZENDAR_THINKING_BUDGET env var or Control Room UI.
      thinkingConfig: {
        thinkingBudget: process.env.KHAZENDAR_THINKING_BUDGET !== undefined
          ? (Number(process.env.KHAZENDAR_THINKING_BUDGET) || 0)
          : -1,
      },
    },
  };
  if (system) {
    body.systemInstruction = {
      parts: [{ text: system }],
    };
  }

  let url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(actualModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);

  let payload = await response.json().catch(() => ({}));
  // If an experimental or preview model hits free tier quota limit or 503 demand spike, fallback to gemini-3.7-flash
  if ((response.status === 429 || response.status === 503) && actualModel !== "gemini-3.7-flash") {
    if (response.status === 429) QUOTA_EXHAUSTED_GEMINI_MODELS.add(actualModel);
    const fallbackModel = "gemini-3.7-flash";
    const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(fallbackModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    await sleep(1500);
    const fbRes = await fetchWithTimeout(fallbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, timeoutMs);
    const fbPayload = await fbRes.json().catch(() => ({}));
    if (fbRes.ok && !fbPayload.error) {
      response = fbRes;
      payload = fbPayload;
      actualModel = fallbackModel;
    }
  }

  if (!response.ok || payload.error) {
    const err = payload.error || {};
    const code = err.code || response.status;
    const message = err.message || response.statusText;
    const login = (code === 400 && /API_KEY_INVALID|key not valid/i.test(message)) || code === 401 || code === 403;
    throw new LlmError(`gemini (${actualModel}): ${code} ${message}`, login ? { status: 401 } : { retryable: [429, 500, 502, 503, 504].includes(code) });
  }

  const candidate = payload.candidates?.[0];
  if (!candidate) throw new LlmError(`gemini (${actualModel}) returned no candidates`, { retryable: true });
  // When thinking is enabled, the API returns parts with `thought: true` for internal reasoning.
  // We extract only the non-thought text parts as the actual response.
  const allParts = candidate.content?.parts ?? [];
  const text = allParts.filter((p) => !p.thought).map((p) => p.text || "").join("");
  const used = payload.usageMetadata ?? {};
  const promptTokens = used.promptTokenCount ?? 0;
  const completionTokens = used.candidatesTokenCount ?? 0;
  const thinkingTokens = used.thoughtsTokenCount ?? 0;

  usage.calls += 1;
  usage.promptTokens += promptTokens;
  usage.completionTokens += completionTokens + thinkingTokens;
  const modelKey = `gemini/${actualModel}`;
  usage.byModel[modelKey] = (usage.byModel[modelKey] ?? 0) + 1;

  return {
    content: text,
    ms: Date.now() - started,
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, thinking_tokens: thinkingTokens },
    model: modelKey,
  };
}

// ------------------------------------------------------------------ OpenAI / ChatGPT
async function callOpenAI({ model, system, user, images = [], timeoutMs, temperature, maxTokens, json = true, apiKey = process.env.OPENAI_API_KEY }) {
  if (!apiKey) {
    throw new LlmError("OpenAI is active but OPENAI_API_KEY is not set. Add your key in the Control Room Settings or .env.", { status: 401 });
  }
  const started = Date.now();
  let userContent = user;
  if (images.length > 0) {
    userContent = [{ type: "text", text: user }];
    for (const img of images) {
      const { mimeType, base64 } = await fetchImageBuffer(img);
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64}` },
      });
    }
  }

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: userContent });

  const actualModel = model || DEFAULT_MODELS.openai;
  // Reasoning models reject temperature; their completion limit includes thinking tokens.
  const reasoning = /^(?:gpt-[56](?:[.\-]|$)|o[134](?:-|$))/.test(actualModel);
  const body = {
    model: actualModel,
    messages,
    ...(reasoning ? { reasoning_effort: "medium" } : { temperature: typeof temperature === "number" ? temperature : 0.2 }),
    ...(json ? { response_format: { type: "json_object" } } : {}),
    ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
  };

  const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const err = payload.error || {};
    const code = response.status;
    const message = String(err.message || response.statusText).split(apiKey).join("[redacted]");
    const login = code === 401 || /invalid api key/i.test(message);
    throw new LlmError(`openai (${actualModel}): ${code} ${message}`, { status: login ? 401 : code, retryable: [429, 500, 502, 503, 504].includes(code) });
  }

  const choice = payload.choices?.[0];
  const text = choice?.message?.content ?? "";
  const used = payload.usage ?? {};
  usage.calls += 1;
  usage.promptTokens += used.prompt_tokens ?? 0;
  usage.completionTokens += used.completion_tokens ?? 0;
  const cached = used.prompt_tokens_details?.cached_tokens ?? 0;
  usage.cacheReadTokens += cached;
  // Standard API rates, USD per million tokens (OpenAI model page, 2026-10-17).
  if (actualModel === "gpt-6.1-sol") {
    usage.costUsd += (Math.max(0, (used.prompt_tokens ?? 0) - cached) * 2 + cached * 0.1 + (used.completion_tokens ?? 0) * 10) / 1e6;
  }
  const modelKey = `openai/${actualModel}`;
  usage.byModel[modelKey] = (usage.byModel[modelKey] ?? 0) + 1;

  if (choice?.message?.refusal) throw new LlmError(`openai (${actualModel}): request refused`);
  if (choice?.finish_reason === "length") throw new LlmError(`openai (${actualModel}): completion token limit reached; increase maxTokens to leave room for reasoning and the answer`);
  if (!text.trim()) throw new LlmError(`openai (${actualModel}): empty answer`);

  return {
    content: text,
    ms: Date.now() - started,
    usage: used,
    model: modelKey,
  };
}

/** One bounded request with the saved key; does not switch providers or write an article. */
export async function testOpenAIConnection({ apiKey, model = DEFAULT_MODELS.openai }) {
  const result = await callOpenAI({
    apiKey,
    model,
    system: 'Reply with JSON only: {"ok":true,"message":"a short Arabic sentence confirming the connection"}.',
    user: "Confirm the API connection in Arabic.",
    json: true,
    maxTokens: 4096,
    timeoutMs: 60000,
  });
  const data = parseJsonLoose(result.content);
  if (data.ok !== true || typeof data.message !== "string" || !/[\u0600-\u06ff]/.test(data.message)) {
    throw new LlmError("OpenAI answered, but the Arabic JSON connection check did not pass.");
  }
  return { ok: true, model: result.model, message: data.message, ms: result.ms, usage: result.usage };
}

// ------------------------------------------------------------------ Alibaba Qwen
async function callQwen({ model, system, user, images = [], timeoutMs, temperature, maxTokens, json = true }) {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
  if (!apiKey) {
    throw new LlmError("Qwen is active but DASHSCOPE_API_KEY (or QWEN_API_KEY) is not set. Add your key in the Control Room Settings or .env.", { status: 401 });
  }
  const started = Date.now();
  const baseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

  let userContent = user;
  if (images.length > 0) {
    userContent = [{ type: "text", text: user }];
    for (const img of images) {
      const { mimeType, base64 } = await fetchImageBuffer(img);
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64}` },
      });
    }
  }

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: userContent });

  const actualModel = model || DEFAULT_MODELS.qwen;
  const body = {
    model: actualModel,
    messages,
    temperature: typeof temperature === "number" ? temperature : 0.2,
    ...(json ? { response_format: { type: "json_object" } } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };

  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const err = payload.error || {};
    const code = response.status;
    const message = err.message || response.statusText;
    const login = code === 401 || /invalid api key/i.test(message);
    throw new LlmError(`qwen (${actualModel}): ${code} ${message}`, login ? { status: 401 } : { retryable: [429, 500, 502, 503, 504].includes(code) });
  }

  const choice = payload.choices?.[0];
  const text = choice?.message?.content ?? "";
  const used = payload.usage ?? {};
  usage.calls += 1;
  usage.promptTokens += used.prompt_tokens ?? 0;
  usage.completionTokens += used.completion_tokens ?? 0;
  const modelKey = `qwen/${actualModel}`;
  usage.byModel[modelKey] = (usage.byModel[modelKey] ?? 0) + 1;

  return {
    content: text,
    ms: Date.now() - started,
    usage: used,
    model: modelKey,
  };
}

// ------------------------------------------------------------------ OpenRouter
async function callOpenRouter({ model, system, user, images = [], timeoutMs, temperature, maxTokens, json = true }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LlmError("OpenRouter is active but OPENROUTER_API_KEY is not set. Add your key in the Control Room Settings or .env.", { status: 401 });
  }
  const started = Date.now();
  let userContent = user;
  if (images.length > 0) {
    userContent = [{ type: "text", text: user }];
    for (const img of images) {
      const { mimeType, base64 } = await fetchImageBuffer(img);
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64}` },
      });
    }
  }

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: userContent });

  const actualModel = model || DEFAULT_MODELS.openrouter;
  const body = {
    model: actualModel,
    messages,
    temperature: typeof temperature === "number" ? temperature : 0.2,
    ...(json ? { response_format: { type: "json_object" } } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };

  const response = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "http-referer": "https://candideb99.github.io",
      "x-title": "Khazendar newsroom",
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const err = payload.error || {};
    const code = response.status;
    const message = err.message || response.statusText;
    const login = code === 401 || /invalid api key/i.test(message);
    throw new LlmError(`openrouter (${actualModel}): ${code} ${message}`, login ? { status: 401 } : { retryable: [429, 500, 502, 503, 504].includes(code) });
  }

  const choice = payload.choices?.[0];
  const text = choice?.message?.content ?? "";
  const used = payload.usage ?? {};
  usage.calls += 1;
  usage.promptTokens += used.prompt_tokens ?? 0;
  usage.completionTokens += used.completion_tokens ?? 0;
  const modelKey = `openrouter/${actualModel}`;
  usage.byModel[modelKey] = (usage.byModel[modelKey] ?? 0) + 1;

  return {
    content: text,
    ms: Date.now() - started,
    usage: used,
    model: modelKey,
  };
}

// ------------------------------------------------------------------ Dispatcher
async function callCodex(options) {
  const images = [];
  for (const url of options.images || []) images.push(await fetchImageBuffer(url));
  const result = await runSubscription({ ...options, images });
  usage.calls += 1;
  usage.promptTokens += result.usage.input_tokens || 0;
  usage.completionTokens += result.usage.output_tokens || 0;
  usage.cacheReadTokens += result.usage.cached_input_tokens || 0;
  usage.byModel[result.model] = (usage.byModel[result.model] || 0) + 1;
  return result;
}

export async function testCodexConnection({ model = DEFAULT_MODELS.codex, codexHome } = {}) {
  const result = await callCodex({ model, codexHome, system: 'Reply with JSON only: {"ok":true,"message":"a short Arabic connection confirmation"}.', user: "Confirm the ChatGPT subscription connection.", timeoutMs: 60000 });
  const data = parseJsonLoose(result.content);
  if (data.ok !== true || typeof data.message !== "string" || !/[\u0600-\u06ff]/.test(data.message)) throw new LlmError("Codex answered, but the Arabic JSON connection check did not pass.");
  return { ok: true, model: result.model, message: data.message, ms: result.ms, billing: "ChatGPT subscription allowance; no Platform API key" };
}

async function dispatchCall(options) {
  const provider = getActiveProvider();
  const model = getActiveModel(provider);
  const callOpts = { ...options, model };

  if (provider === "gemini") return callGemini(callOpts);
  if (provider === "claude") return callClaude(callOpts);
  if (provider === "openai") return callOpenAI(callOpts);
  if (provider === "codex") return callCodex(callOpts);
  if (provider === "qwen") return callQwen(callOpts);
  if (provider === "openrouter") return callOpenRouter(callOpts);
  return callGemini(callOpts);
}

const ATTEMPTS = 3;

/**
 * Runs one model call through the active provider (Gemini by default; Claude, OpenAI, Qwen in idle mode).
 * `validate(data)` may throw to reject a parsed answer, which is retried up to three times.
 */
export async function chat({ role, system, user, images = [], json = true, validate, temperature, maxTokens, timeoutMs = 240000, log = () => {} }) {
  const provider = getActiveProvider();
  const modelName = getActiveModel(provider);
  const errors = [];
  let refusal = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    await acquire();
    try {
      const told = attempt > 1 && refusal ? `\n\nYour previous answer was refused: ${refusal}. Correct exactly that in this answer.` : "";
      const nudge = attempt > 1 && json ? "\n\nIMPORTANT: Reply with ONE valid JSON value only. No prose, no markdown fences, no comments." : "";
      const result = await dispatchCall({ system, user: user + told + nudge, images, timeoutMs, temperature, maxTokens, json });
      let data = result.content;
      try {
        if (json) data = parseJsonLoose(result.content);
        if (validate) validate(data);
      } catch (error) {
        refusal = String(error.message).split("\n")[0].slice(0, 300);
        throw error;
      }
      log(`llm ok role=${role} provider=${provider} model=${result.model || modelName} attempt=${attempt} ms=${result.ms}`);
      return { data, text: result.content, model: result.model || modelName, ms: result.ms, usage: result.usage };
    } catch (error) {
      usage.failures += 1;
      errors.push(`${provider}:${modelName}#${attempt}: ${error.message}`);
      const sample = error.meta?.sample ? ` sample=${JSON.stringify(String(error.meta.sample).slice(0, 140))}` : "";
      log(`llm fail role=${role} provider=${provider} model=${modelName} attempt=${attempt}: ${String(error.message).slice(0, 200)}${sample}`);
      if (error.meta?.quota) throw error;
      if (error.meta?.status === 401) break;
      if (attempt < ATTEMPTS) {
        const is503 = /503|high demand|temporarily unavailable/i.test(error.message);
        const is429 = error.meta?.status === 429 || /rate limit|quota|resource exhausted/i.test(error.message);
        const delayMs = is503 ? attempt * 8000 : is429 ? attempt * 6000 : 3000;
        await sleep(delayMs);
      }
    } finally {
      release();
    }
  }
  throw new LlmError(`Model (${provider}/${modelName}) failed for role ${role}:\n${errors.join("\n")}`);
}
