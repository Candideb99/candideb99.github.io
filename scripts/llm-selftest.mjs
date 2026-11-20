#!/usr/bin/env node
// OpenAI compatibility and the Control Room connection probe, with no network or real key.
import assert from "node:assert/strict";

process.env.KHAZENDAR_PROVIDER = "openai";
process.env.KHAZENDAR_OPENAI_MODEL = "gpt-6.1-sol";
process.env.OPENAI_API_KEY = "sk-offline-test";
let request;
let payload;
let status = 200;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://api.openai.com/v1/chat/completions", "Never contact another provider");
  request = { body: JSON.parse(options.body), headers: options.headers };
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
};
const { chat, testOpenAIConnection, usage } = await import("../pipeline/lib/llm.mjs");
const success = () => ({
  choices: [{ message: { content: '{"ok":true,"message":"نجح الاتصال"}' }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200 } },
});
try {
  payload = success();
  const result = await chat({ role: "writer", system: "Return JSON.", user: "Test", temperature: 0.2, maxTokens: 8000, images: ["data:image/png;base64,AA=="] });
  assert.equal(result.model, "openai/gpt-6.1-sol");
  assert.equal(result.data.ok, true);
  assert.equal(request.body.reasoning_effort, "medium");
  assert.equal("temperature" in request.body, false);
  assert.equal("max_tokens" in request.body, false);
  assert.equal(request.body.max_completion_tokens, 8000);
  assert.equal(request.body.response_format.type, "json_object");
  assert.equal(request.body.messages[1].content[1].image_url.url, "data:image/png;base64,AA==");
  assert.equal(usage.cacheReadTokens, 200);
  assert.ok(Math.abs(usage.costUsd - 0.00262) < 1e-10);
  console.log("ok  Sol request, Arabic JSON, vision, cached tokens and cost");

  process.env.KHAZENDAR_PROVIDER = "gemini";
  const probe = await testOpenAIConnection({ apiKey: "sk-probe-test" });
  assert.equal(probe.ok, true);
  assert.equal(request.headers.authorization, "Bearer sk-probe-test");
  assert.equal(request.body.model, "gpt-6.1-sol");
  assert.equal(request.body.max_completion_tokens, 4096);
  assert.equal(process.env.KHAZENDAR_PROVIDER, "gemini");
  console.log("ok  Probe uses its saved key and leaves the active provider unchanged");

  process.env.KHAZENDAR_PROVIDER = "openai";
  process.env.KHAZENDAR_OPENAI_MODEL = "gpt-4o";
  await chat({ role: "assistant", user: "Hello", json: false, temperature: 0.4, maxTokens: 500 });
  assert.equal(request.body.temperature, 0.4);
  assert.equal("reasoning_effort" in request.body, false);
  assert.equal("response_format" in request.body, false);
  console.log("ok  Legacy OpenAI text requests keep sampling and plain text");

  payload = success();
  payload.choices[0].finish_reason = "length";
  await assert.rejects(testOpenAIConnection({ apiKey: "sk-probe-test" }), /completion token limit/);
  payload = success();
  payload.choices[0].message = { content: "", refusal: "refused" };
  await assert.rejects(testOpenAIConnection({ apiKey: "sk-probe-test" }), /request refused/);
  payload = success();
  payload.choices[0].message.content = "";
  await assert.rejects(testOpenAIConnection({ apiKey: "sk-probe-test" }), /empty answer/);
  payload = success();
  payload.choices[0].message.content = '{"ok":true,"message":"English only"}';
  await assert.rejects(testOpenAIConnection({ apiKey: "sk-probe-test" }), /Arabic JSON/);
  console.log("ok  Truncated, refused, empty and non-Arabic probes fail");

  status = 401;
  payload = { error: { message: "Incorrect API key: sk-probe-test" } };
  await assert.rejects(testOpenAIConnection({ apiKey: "sk-probe-test" }), (error) => error.meta.status === 401 && error.message.includes("[redacted]") && !error.message.includes("sk-probe-test"));
  status = 429;
  payload = { error: { message: "Insufficient quota; check billing" } };
  await assert.rejects(testOpenAIConnection({ apiKey: "sk-probe-test" }), (error) => error.meta.status === 429 && /billing/.test(error.message));
  console.log("ok  Key and billing failures preserve status and redact the key");
} finally {
  globalThis.fetch = originalFetch;
}

// The control room's chat reads text made from strangers' pages: its commands never see the Claude credential, its
// newsroom keys are dropped, and .env is barred to its Read tool (2026-11-17).
{
  const { readFileSync } = await import("node:fs");
  const room = readFileSync(new URL("./control-room.mjs", import.meta.url), "utf8");
  const chatEnvBody = room.slice(room.indexOf("function chatEnv()"), room.indexOf("const CHAT_RULES"));
  assert.match(chatEnvBody, /env\.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = "1";\s*return env;/, "the chat's commands must not inherit the Claude token");
  assert.match(chatEnvBody, /_KEY\|_TOKEN\|_SECRET/, "the chat must not carry the newsroom's keys");
  assert.match(room, /"Read\(\.\/\.env\)"/, "the chat may not read .env");
  assert.match(readFileSync(new URL("../pipeline/lib/llm.mjs", import.meta.url), "utf8"), /"--tools", ""/, "the newsroom's Claude calls run without tools");
  console.log("ok  The chat's commands and the newsroom's model calls cannot reach the keys");
}

// The prompt cache (2026-11-20): a Claude subscription made Claude Code write every call's whole prompt to an hour's
// cache at twice the price of reading it fresh, though nearly nothing was read back. Only the house prompts a story sends
// again within minutes are cached now, for five minutes; every other call caches nothing; a cache setting inherited
// from a shell or a desktop session never decides it.
{
  const { claudeCliEnv, promptCache } = await import("../pipeline/lib/llm.mjs");
  const { WRITER_SYSTEM } = await import("../pipeline/lib/write.mjs");
  const { DESK_SYSTEM } = await import("../pipeline/lib/copydesk.mjs");
  const inherited = { ENABLE_PROMPT_CACHING_1H: "1", FORCE_PROMPT_CACHING_5M: "1", DISABLE_PROMPT_CACHING_OPUS: "1", CLAUDE_CODE_PROMPT_CACHE_TTL: "1h" };
  Object.assign(process.env, inherited);
  try {
    const writer = claudeCliEnv(WRITER_SYSTEM);
    const desk = claudeCliEnv(DESK_SYSTEM);
    const picture = claudeCliEnv("You are a strict newspaper picture editor. Answer with one JSON object only.");
    assert.equal(writer.CLAUDE_CODE_PROMPT_CACHE_TTL, "5m", "the writer's house prompt is cached for five minutes");
    assert.equal(writer.DISABLE_PROMPT_CACHING, undefined);
    assert.equal(desk.CLAUDE_CODE_PROMPT_CACHE_TTL, "5m", "the copy desk's house prompt is cached for five minutes");
    assert.equal(picture.DISABLE_PROMPT_CACHING, "1", "a prompt not sent again is not cached");
    assert.equal(picture.CLAUDE_CODE_PROMPT_CACHE_TTL, undefined);
    for (const env of [writer, desk, picture]) for (const key of ["ENABLE_PROMPT_CACHING_1H", "FORCE_PROMPT_CACHING_5M", "DISABLE_PROMPT_CACHING_OPUS"]) assert.equal(env[key], undefined, `${key} inherited`);
    assert.equal(promptCache(`${WRITER_SYSTEM}\nfor this story only`), "off", "a prompt that changes per call is not the house prompt");
  } finally {
    for (const key of Object.keys(inherited)) delete process.env[key];
  }
  console.log("ok  Only the house prompts a story sends again are cached, for five minutes; every other Claude call caches nothing");
}
