import { jsonrepair } from "jsonrepair";
import { sleep } from "./util.mjs";

const BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

function chain(envName, fallback) {
  const value = process.env[envName];
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : fallback;
}

/** Ordered fallback chains per newsroom role. Only free OpenRouter models. */
export const ROLES = {
  // Re-benchmarked 2026-09-09 after MiniMax M3 left the free tier: Ling Flash Fin is fast and writes
  // clean Arabic, the Nemotron 3 models are the strongest but slow, Nex N2.5 Mini is a sound reserve.
  editor: chain("KHAZENDAR_MODELS_EDITOR", [
    "inclusionai/ling-3.0-flash-fin:free",
    "nex-agi/nex-n2.5-mini:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
  ]),
  writer: chain("KHAZENDAR_MODELS_WRITER", [
    "inclusionai/ling-3.0-flash-fin:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nex-agi/nex-n2.5-mini:free",
  ]),
  critic: chain("KHAZENDAR_MODELS_CRITIC", [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nex-agi/nex-n2.5-mini:free",
  ]),
  // Gemma is often rate-limited upstream; Nex N2.5 Pro and Nemotron Nano Omni answered reliably.
  vision: chain("KHAZENDAR_MODELS_VISION", [
    "nex-agi/nex-n2.5-pro:free",
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  ]),
};

/** Models whose provider rejects response_format; they get the JSON instruction in the prompt only. */
const NO_JSON_MODE = ["inclusionai/", "cohere/"];
/** Models whose chain-of-thought spills into the content field and truncates the JSON answer. */
const NO_REASONING = ["nvidia/"];

export const usage = { calls: 0, failures: 0, promptTokens: 0, completionTokens: 0, byModel: {} };

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

function buildUserContent(user, images) {
  if (!images?.length) return user;
  return [
    { type: "text", text: user },
    ...images.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
}

/**
 * Provider "claude": runs the prompt through the Claude Code command line, which uses the
 * owner's Claude subscription (after `claude login` or `claude setup-token`) instead of an API key.
 * Vision requests fall back to OpenRouter because the CLI takes text only here.
 */
async function callClaudeCli(model, { system, user, timeoutMs }) {
  const { spawn } = await import("node:child_process");
  const cliModel = process.env.KHAZENDAR_CLAUDE_MODEL ?? "sonnet";
  const args = ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--model", cliModel];
  if (system) args.push("--system-prompt", system);
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn("claude", args, { shell: process.platform === "win32", windowsHide: true });
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
      reject(new LlmError(`claude cli failed to start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new LlmError(`claude cli exit ${code}: ${err.slice(0, 200)}`, { retryable: true }));
      resolve(out);
    });
    child.stdin.end(user);
  });
  let payload;
  try {
    payload = JSON.parse(result);
  } catch {
    throw new LlmError("claude cli returned non-JSON output", { sample: result.slice(0, 200) });
  }
  if (payload.is_error) throw new LlmError(`claude cli: ${String(payload.result).slice(0, 200)}`, { status: 401 });
  usage.calls += 1;
  usage.byModel[`claude-cli/${cliModel}`] = (usage.byModel[`claude-cli/${cliModel}`] ?? 0) + 1;
  return { content: String(payload.result ?? ""), finish: "stop", ms: Date.now() - started, usage: payload.usage ?? {}, provider: "claude-cli" };
}

const PROVIDER = process.env.KHAZENDAR_PROVIDER ?? "openrouter";

async function callModel(model, options) {
  if (PROVIDER === "claude" && !options.images?.length) return callClaudeCli(model, options);
  return callOpenRouter(model, options);
}

async function callOpenRouter(model, { system, user, images, temperature, maxTokens, timeoutMs, jsonMode }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new LlmError("OPENROUTER_API_KEY is not set");
  const body = {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: buildUserContent(user, images) },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  // Reasoning models that leak their thinking into the answer are told to answer directly.
  if (NO_REASONING.some((prefix) => model.startsWith(prefix))) body.reasoning = { enabled: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://candideb99.github.io",
        "X-Title": "Khazendar newsroom",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    const ms = Date.now() - started;
    if (!response.ok || payload.error) {
      const code = payload?.error?.code ?? response.status;
      const message = payload?.error?.message ?? response.statusText;
      const raw = payload?.error?.metadata?.raw;
      throw new LlmError(`${model}: ${code} ${message}${raw ? ` (${String(raw).slice(0, 160)})` : ""}`, {
        status: Number(code) || response.status,
        retryable: [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(code) || response.status),
        unsupportedJsonMode: /structured|json|response_format/i.test(String(raw ?? message)),
      });
    }
    const choice = payload.choices?.[0];
    const content = choice?.message?.content ?? "";
    const finish = choice?.finish_reason;
    const used = payload.usage ?? {};
    usage.calls += 1;
    usage.promptTokens += used.prompt_tokens ?? 0;
    usage.completionTokens += used.completion_tokens ?? 0;
    usage.byModel[model] = (usage.byModel[model] ?? 0) + 1;
    return { content, finish, ms, usage: used, provider: payload.provider };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs a chat completion through the role's fallback chain.
 * `validate(data)` may throw to reject a parsed answer (triggers one retry, then the next model).
 */
export async function chat({
  role,
  system,
  user,
  images = [],
  json = true,
  validate,
  temperature = 0.35,
  maxTokens = 4500,
  timeoutMs = 240000,
  log = () => {},
}) {
  const models = PROVIDER === "claude" && role !== "vision" ? ["claude-cli"] : ROLES[role];
  if (!models?.length) throw new LlmError(`Unknown role ${role}`);
  const errors = [];
  for (const model of models) {
    let jsonMode = json && !NO_JSON_MODE.some((prefix) => model.startsWith(prefix));
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await acquire();
      try {
        const nudge =
          attempt === 2 && json
            ? "\n\nIMPORTANT: Reply with ONE valid JSON value only. No prose, no markdown fences, no comments."
            : "";
        const result = await callModel(model, {
          system,
          user: user + nudge,
          images,
          temperature,
          maxTokens,
          timeoutMs,
          jsonMode,
        });
        let data = result.content;
        if (json) data = parseJsonLoose(result.content);
        if (validate) validate(data);
        log(`llm ok role=${role} model=${model} attempt=${attempt} ms=${result.ms} tokens=${result.usage?.completion_tokens ?? "?"}`);
        return { data, text: result.content, model, ms: result.ms, usage: result.usage };
      } catch (error) {
        usage.failures += 1;
        errors.push(`${model}#${attempt}: ${error.message}`);
        const sample = error.meta?.sample ? ` sample=${JSON.stringify(String(error.meta.sample).slice(0, 140))}` : "";
        log(`llm fail role=${role} model=${model} attempt=${attempt}: ${String(error.message).slice(0, 200)}${sample}`);
        const meta = error.meta ?? {};
        if (meta.unsupportedJsonMode && jsonMode) {
          jsonMode = false; // retry this model without response_format
          continue;
        }
        if (error.name === "AbortError") {
          break; // slow model: move on to the next
        }
        if (meta.status && !meta.retryable && !(error instanceof LlmError && !meta.status)) {
          break; // hard provider error: next model
        }
        if (attempt === 1) await sleep(meta.status === 429 ? 6000 : 2500);
      } finally {
        release();
      }
    }
  }
  throw new LlmError(`All models failed for role ${role}:\n${errors.join("\n")}`);
}
