import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function validateCodexAuth(text) {
  let auth;
  try { auth = JSON.parse(text); } catch { throw new Error("The ChatGPT sign-in file is invalid."); }
  if (auth.version === 2) {
    if (!Array.isArray(auth.accounts) || auth.accounts.length < 1 || auth.accounts.length > 2 || new Set(auth.accounts.map((a) => a.id)).size !== auth.accounts.length) throw new Error("Connect one or two distinct ChatGPT accounts.");
    for (const account of auth.accounts) {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(account.id)) throw new Error("Invalid ChatGPT connection id.");
      if (account.auth?.auth_mode !== "chatgpt") throw new Error("Each connection must contain a ChatGPT sign-in.");
      validateCodexAuth(JSON.stringify(account.auth));
    }
    if (auth.backup && auth.primary === auth.backup) throw new Error("The primary and backup must be different accounts.");
    if (!auth.accounts.some((a) => a.id === auth.primary) || (auth.backup && !auth.accounts.some((a) => a.id === auth.backup))) throw new Error("The configured ChatGPT accounts are missing.");
    return auth;
  }
  if (auth.auth_mode !== "chatgpt" || !auth.tokens?.access_token || !auth.tokens?.refresh_token || auth.OPENAI_API_KEY) throw new Error("A ChatGPT subscription sign-in is required; API keys are not accepted.");
  return auth;
}
export function sealCodexAuth(auth, key, session) {
  validateCodexAuth(JSON.stringify(auth));
  if (!/^[a-f0-9]{64}$/i.test(key) || !session) throw new Error("ChatGPT session encryption is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(session));
  const data = Buffer.concat([cipher.update(JSON.stringify(auth)), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}
export function openCodexAuth(text, key, session) {
  try {
    if (!/^[a-f0-9]{64}$/i.test(key) || !session) throw new Error();
    const payload = JSON.parse(text);
    if (payload.version !== 1) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(payload.iv, "base64"));
    cipher.setAAD(Buffer.from(session)); cipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    return validateCodexAuth(Buffer.concat([cipher.update(Buffer.from(payload.data, "base64")), cipher.final()]).toString("utf8"));
  } catch { throw new Error("The saved cloud ChatGPT session cannot be decrypted. Reconnect its account; no API fallback was used."); }
}
