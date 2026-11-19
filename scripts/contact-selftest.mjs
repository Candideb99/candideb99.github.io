#!/usr/bin/env node
/**
 * The contact form's endpoint and its inbox decide their known cases correctly (functions/api/contact.js and
 * inbox.js, 2026-11-19). They are Cloudflare Pages Functions, which no build or type check here runs: this drives
 * them as Cloudflare does, with a stand-in for the KV store.
 *
 *   node scripts/contact-selftest.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestPost, onRequestOptions, onRequest as contactOther, TOPICS } from "../functions/api/contact.js";
import { onRequest as inbox } from "../functions/api/inbox.js";

function store() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    put: async (k, v) => void map.set(k, String(v)),
    delete: async (k) => void map.delete(k),
    list: async ({ prefix }) => ({ keys: [...map.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })) }),
  };
}
const SITE = "https://khazendar.pages.dev";
const send = (kv, body, headers = {}) =>
  onRequestPost({ request: new Request(`${SITE}/api/contact`, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), env: { MESSAGES: kv } });
const good = { topic: "correction", message: "الرقم في الفقرة الثانية غير صحيح.", name: "قارئ", email: "reader@example.com", story: "egypt-rates-1a2b3c", website: "", elapsed: 9000 };
const messages = (kv) => [...kv.map.keys()].filter((k) => k.startsWith("msg:"));

// A real message is kept whole, without the sender's address.
{
  const kv = store();
  const res = await send(kv, good);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(messages(kv).length, 1);
  const saved = JSON.parse(kv.map.get(messages(kv)[0]));
  assert.equal(saved.topic, "correction");
  assert.equal(saved.message, good.message);
  assert.equal(saved.email, good.email);
  assert.equal(saved.story, good.story);
  assert.ok(!JSON.stringify([...kv.map]).includes("203.0.113.7"), "the sender's IP address is never stored");
  console.log("ok  a message is kept with its subject and story, and without the sender's address");
}

// What a program sends is dropped; what a person gets wrong is answered.
{
  const kv = store();
  assert.deepEqual(await (await send(kv, { ...good, website: "http://spam.example" })).json(), { ok: true });
  assert.equal(messages(kv).length, 0, "the hidden field filled: answered ok, nothing kept");
  assert.equal((await send(kv, { ...good, elapsed: 300 })).status, 400);
  assert.equal((await send(kv, { ...good, message: "هه" })).status, 400);
  assert.equal((await send(kv, { ...good, email: "not-an-address" })).status, 400);
  assert.equal((await send(kv, "{not json")).status, 400);
  assert.equal((await send(kv, "[1]")).status, 400, "a body that is not an object");
  assert.equal((await send(kv, { ...good, message: "م".repeat(30000) })).status, 413);
  assert.equal(messages(kv).length, 0);
  assert.equal(kv.map.size, 0, "a refused message writes nothing to the store");
  const odd = await send(kv, { ...good, topic: "<script>", story: "../../admin", name: "a\u0000b\nc", message: "سطر أول\nسطر ثانٍ" });
  assert.equal(odd.status, 200);
  const saved = JSON.parse(kv.map.get(messages(kv)[0]));
  assert.equal(saved.topic, "other");
  assert.equal(saved.story, "");
  assert.equal(saved.name, "abc");
  assert.equal(saved.message, "سطر أول\nسطر ثانٍ");
  console.log("ok  the trap, a too-quick send, an empty message, a bad address and an oversized body are refused");
}

// One sender is held to five an hour; the store never gets a flood.
{
  const kv = store();
  for (let i = 0; i < 5; i++) assert.equal((await send(kv, good)).status, 200);
  assert.equal((await send(kv, good)).status, 429);
  assert.equal((await send(kv, good, { "CF-Connecting-IP": "203.0.113.8" })).status, 200, "another sender is not held by the first");
  assert.equal(messages(kv).length, 6);
  const flood = store();
  let kept = 0;
  for (let i = 0; i < 70; i++) if ((await send(flood, good, { "CF-Connecting-IP": `198.51.100.${i}` })).status === 200) kept++;
  assert.equal(kept, 60, "every sender together: sixty an hour");
  console.log("ok  five an hour from one sender, sixty an hour from all");
}

// Without its store the form says so; the mirror may post across, a stranger's site may not.
{
  const res = await onRequestPost({ request: new Request(`${SITE}/api/contact`, { method: "POST", body: JSON.stringify(good) }), env: {} });
  assert.equal(res.status, 503);
  const kv = store();
  const mirror = await send(kv, good, { Origin: "https://candideb99.github.io" });
  assert.equal(mirror.headers.get("Access-Control-Allow-Origin"), "https://candideb99.github.io");
  const stranger = await send(kv, good, { Origin: "https://evil.example" });
  assert.equal(stranger.headers.get("Access-Control-Allow-Origin"), null);
  const pre = await onRequestOptions({ request: new Request(`${SITE}/api/contact`, { method: "OPTIONS", headers: { Origin: "https://candideb99.github.io" } }) });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  assert.equal((await contactOther({ request: new Request(`${SITE}/api/contact`) })).status, 405);
  console.log("ok  no store: 503; the mirror posts across origins, no other site does");
}

// The inbox answers only to its key.
{
  const kv = store();
  await send(kv, good);
  await new Promise((r) => setTimeout(r, 5));
  await send(kv, { ...good, topic: "business", message: "استفسار عن الإعلان في الموقع." });
  const KEY = "k".repeat(64);
  const ask = (method, { key, env = { MESSAGES: kv, INBOX_KEY: KEY }, query = "" } = {}) =>
    inbox({ request: new Request(`${SITE}/api/inbox${query}`, { method, headers: key ? { Authorization: `Bearer ${key}` } : {} }), env });
  assert.equal((await ask("GET")).status, 401, "no key");
  assert.equal((await ask("GET", { key: "k".repeat(63) })).status, 401, "a wrong key");
  assert.equal((await ask("GET", { key: KEY, env: { MESSAGES: kv } })).status, 503, "no secret set: closed to everyone");
  assert.equal((await ask("GET", { key: "short", env: { MESSAGES: kv, INBOX_KEY: "short" } })).status, 503, "a short secret is no secret");
  assert.deepEqual(await (await ask("GET", { key: KEY, env: { INBOX_KEY: KEY } })).json(), { setup: ["MESSAGES"] });
  const listed = await (await ask("GET", { key: KEY })).json();
  assert.equal(listed.messages.length, 2);
  assert.equal(listed.messages[0].topic, "business", "newest first");
  assert.ok(!Object.keys(listed.messages[0]).includes("ip"));
  assert.equal((await ask("DELETE", { key: KEY, query: "?key=rl:abc" })).status, 400, "only a message can be deleted");
  assert.equal((await ask("DELETE", { query: `?key=${encodeURIComponent(listed.messages[0].key)}` })).status, 401);
  assert.equal((await ask("DELETE", { key: KEY, query: `?key=${encodeURIComponent(listed.messages[0].key)}` })).status, 200);
  assert.equal((await (await ask("GET", { key: KEY })).json()).messages.length, 1);
  assert.equal((await ask("POST", { key: KEY })).status, 405);
  console.log("ok  the inbox lists and deletes for its key alone");
}

// The page sends what the endpoint reads, and the two agree on the subjects.
{
  const page = readFileSync(new URL("../src/pages/contact.astro", import.meta.url), "utf8");
  for (const field of ["topic", "message", "name", "email", "story", "website", "elapsed"]) assert.match(page, new RegExp(`\\b${field}:`), `the page sends ${field}`);
  const ids = [...page.matchAll(/\{ id: "(\w+)", name:/g)].map((m) => m[1]);
  assert.deepEqual(ids, TOPICS, "the page's subjects are the endpoint's");
  const routes = JSON.parse(readFileSync(new URL("../public/_routes.json", import.meta.url), "utf8"));
  assert.deepEqual(routes.include, ["/api/*"], "only /api/ runs a Function: no page view may count against the Functions quota");
  console.log("ok  the page, the endpoint and the routes file agree");
}
