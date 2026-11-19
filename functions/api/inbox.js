// The contact form's inbox, read by the control room on the owner's laptop (scripts/control-room.mjs, «Messages»).
// GET lists the newest messages; DELETE ?key=msg:... removes one. Both need the INBOX_KEY secret as a bearer token:
// the same long random string is set in Cloudflare (Settings → Variables and secrets) and kept in the laptop's .env
// as KHAZENDAR_INBOX_KEY. Without the secret the inbox answers nothing to anyone.

export async function onRequest({ request, env }) {
  if (!env.INBOX_KEY || env.INBOX_KEY.length < 32) return json({ setup: ["INBOX_KEY"] }, 503);
  const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(await same(given, env.INBOX_KEY))) return json({ error: "key" }, 401);
  const kv = env.MESSAGES;
  if (!kv) return json({ setup: ["MESSAGES"] }, 503);

  if (request.method === "GET") {
    const { keys } = await kv.list({ prefix: "msg:", limit: 200 });
    // The store's list can still name a key for up to a minute after it was deleted; its value is then gone: skip it.
    const items = await Promise.all(keys.map(async (k) => {
      try {
        const v = JSON.parse(await kv.get(k.name));
        return v && v.at ? { key: k.name, ...v } : null;
      } catch {
        return null;
      }
    }));
    return json({ messages: items.filter(Boolean) });
  }
  if (request.method === "DELETE") {
    const key = new URL(request.url).searchParams.get("key") || "";
    if (!/^msg:\d{13}:[0-9a-f]{8}$/.test(key)) return json({ error: "Bad key." }, 400);
    await kv.delete(key);
    return json({ ok: true });
  }
  return json({ error: "Use GET or DELETE." }, 405);
}

// Two hashes of equal length compared without an early exit, so the answer's time says nothing about the key.
async function same(a, b) {
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
