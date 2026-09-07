import type { APIContext } from "astro";
import site from "@data/site.json";

/** Authorised digital sellers file; only meaningful once an AdSense publisher id is configured. */
export function GET(_context: APIContext) {
  const client = String(site.adsenseClient ?? "").replace(/^ca-/, "");
  const body = client ? `google.com, ${client}, DIRECT, f08c47fec0942fa0\n` : "# No advertising partner configured yet.\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
