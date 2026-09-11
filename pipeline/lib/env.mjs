/**
 * Loads `.env` from the project root into process.env (variables already set win), so local
 * runs find OPENROUTER_API_KEY without exporting it by hand. Import this module before any
 * module that reads the environment at load time. Values are never logged.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

try {
  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env: rely on the environment (GitHub Actions passes the secret) */
}
