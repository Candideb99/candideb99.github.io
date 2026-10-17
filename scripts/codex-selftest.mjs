#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { codexEnvironment, codexRateLimits, runCodex } from "../pipeline/lib/codex.mjs";

const env = codexEnvironment({ PATH: "bin", CODEX_HOME: "auth-store", OPENAI_API_KEY: "fake-key", CODEX_API_KEY: "fake-key", OPENAI_BASE_URL: "https://example.invalid", CODEX_ACCESS_TOKEN: "fake-token" });
assert.deepEqual(env, { PATH: "bin", CODEX_HOME: "auth-store" });
console.log("ok  Subscription environment removes API keys, endpoints and token overrides");

let spawned = false;
await assert.rejects(runCodex({ user: "test" }, {
  spawnSync: () => ({ status: 0, stdout: "Logged in using an API key" }),
  spawn: () => { spawned = true; },
}), /API-key login is not accepted/);
assert.equal(spawned, false);
console.log("ok  API-key authentication is refused before any inference");

let workingDirectory;
const user = "source text ".repeat(10000);
const result = await runCodex({ system: "Keep all figures; return JSON only.", user, images: [{ mimeType: "image/png", base64: "AA==" }] }, {
  spawnSync: () => ({ status: 0, stdout: "", stderr: "Logged in using ChatGPT" }),
  spawn: (binary, args, options) => {
    workingDirectory = options.cwd;
    assert.equal(options.shell, false);
    assert.ok(args.includes('forced_login_method="chatgpt"'));
    assert.ok(args.includes('model_reasoning_effort="high"'), "Newsroom calls use the owner's high reasoning setting");
    assert.ok(args.includes("--ignore-user-config"));
    assert.ok(args.includes("--ephemeral"));
    assert.ok(args.includes("features.shell_tool=false"));
    assert.ok(args.includes("read-only"));
    assert.equal(args.includes(user), false, "Large source text goes over stdin");
    const instructions = JSON.parse(args.find((a) => a.startsWith("model_instructions_file=")).split("=").slice(1).join("="));
    assert.match(readFileSync(instructions, "utf8"), /Keep all figures/);
    assert.equal(readFileSync(args[args.indexOf("--image") + 1]).length, 1);
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = (input) => {
      assert.equal(input, user);
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}\n{"type":"turn.completed","usage":{"input_tokens":50,"output_tokens":10}}\n');
        child.emit("close", 0);
      });
    };
    return child;
  },
});
assert.equal(result.content, '{"ok":true}');
assert.equal(result.model, "codex-cli/gpt-6.1-sol");
assert.equal(result.usage.input_tokens, 50);
assert.equal(existsSync(workingDirectory), false);
console.log("ok  House instructions, long stdin, vision, usage and temporary-file cleanup");

const allowance = await codexRateLimits({ codexHome: "isolated-cloud-home" }, (binary, args, options) => {
  assert.ok(args.includes('cli_auth_credentials_store="file"'), "The isolated usage reader uses the same file credential store as inference");
  assert.equal(options.env.CODEX_HOME, "isolated-cloud-home");
  assert.equal(options.shell, false);
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = () => {}; child.kill = () => {};
  child.stdin.write = (line) => {
    const message = JSON.parse(line);
    if (!message.id) return;
    queueMicrotask(() => child.stdout.emit("data", JSON.stringify({ id: message.id, result: message.id === 1 ? {} : { rateLimits: { primary: { usedPercent: 20 } } } }) + "\n"));
  };
  return child;
});
assert.equal(allowance.rateLimits.primary.usedPercent, 20);
console.log("ok  Isolated cloud usage lookup reads its file credentials and completes the RPC handshake");
