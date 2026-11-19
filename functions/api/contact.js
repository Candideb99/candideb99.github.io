// The contact form's endpoint (Cloudflare Pages Function; src/pages/contact.astro posts here).
// Messages are kept in the MESSAGES KV namespace and read in the control room (functions/api/inbox.js);
// no address is printed on the site and nothing passes through an outside service.
// Stored: the message, its subject, the optional name and reply address the sender typed, the story it is about,
// the time, and the country Cloudflare reports. Not stored: the sender's IP address (a hash is kept for an hour,
// to limit floods).

export const LIMITS = { name: 100, email: 200, message: 5000 };
export const TOPICS = ["correction", "suggestion", "business", "other"];
const PER_HOUR = 5; // one sender
const ALL_PER_HOUR = 60; // every sender together: the free store takes 1,000 writes a day
const MAX_BODY = 20000;

// The GitHub Pages mirror has no Functions, so its copy of the form posts here from another origin.
const MIRRORS = ["https://candideb99.github.io"];

export async function onRequestPost({ request, env }) {
  const cors = corsOf(request);
  const kv = env.MESSAGES;
  if (!kv) return json({ ok: false, error: "نموذج المراسلة غير مفعّل بعد." }, 503, cors);

  let b;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ ok: false, error: "الرسالة أطول مما يُقبل." }, 413, cors);
    b = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "تعذّرت قراءة الرسالة." }, 400, cors);
  }
  if (!b || typeof b !== "object") return json({ ok: false, error: "تعذّرت قراءة الرسالة." }, 400, cors);

  const name = clean(b.name, LIMITS.name);
  const email = clean(b.email, LIMITS.email);
  const message = clean(b.message, LIMITS.message, true);
  const topic = TOPICS.includes(b.topic) ? b.topic : "other";
  const story = typeof b.story === "string" && /^[a-z0-9][a-z0-9-]{0,159}$/.test(b.story) ? b.story : "";

  // Spam checks: a hidden field people never see is dropped quietly. Time on the form is measured on the sender's
  // own device (comparing its clock with ours drops real messages when a phone's clock runs fast); a send under two
  // seconds gets a visible answer, so a person who pasted quickly can simply send again.
  if (b.website) return json({ ok: true }, 200, cors);
  if (typeof b.elapsed === "number" && b.elapsed >= 0 && b.elapsed < 2000) return json({ ok: false, error: "أُرسلت الرسالة بسرعة غير معتادة. اضغط «إرسال» مرة أخرى." }, 400, cors);
  if (message.length < 5) return json({ ok: false, error: "اكتب رسالتك أولاً." }, 400, cors);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "عنوان البريد لا يبدو صحيحاً." }, 400, cors);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = "rl:" + (await sha256(ip)).slice(0, 32);
  const capKey = "cap:" + new Date().toISOString().slice(0, 13);
  const [sent, all] = (await Promise.all([kv.get(rlKey), kv.get(capKey)])).map((v) => Number(v) || 0);
  if (sent >= PER_HOUR || all >= ALL_PER_HOUR) return json({ ok: false, error: "وصلتنا رسائل كثيرة في الساعة الأخيرة. حاول مرة أخرى لاحقاً." }, 429, cors);
  await Promise.all([kv.put(rlKey, String(sent + 1), { expirationTtl: 3600 }), kv.put(capKey, String(all + 1), { expirationTtl: 7200 })]);

  const at = new Date().toISOString();
  // Newest first when listed: keys sort as text, so count down from a large number.
  const key = `msg:${String(9999999999999 - Date.now()).padStart(13, "0")}:${crypto.randomUUID().slice(0, 8)}`;
  await kv.put(key, JSON.stringify({ at, topic, name, email, message, story, country: request.cf?.country || "" }));
  return json({ ok: true }, 200, cors);
}

export const onRequestOptions = ({ request }) => new Response(null, { status: 204, headers: { ...corsOf(request), "Access-Control-Max-Age": "86400" } });

export const onRequest = ({ request }) => json({ ok: false, error: "Use POST." }, 405, corsOf(request));

function corsOf(request) {
  const origin = request.headers.get("Origin") || "";
  if (!MIRRORS.includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
}

function clean(v, max, multiline = false) {
  let s = typeof v === "string" ? v : "";
  s = s.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "").trim();
  return s.slice(0, max);
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
