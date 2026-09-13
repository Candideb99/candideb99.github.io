#!/usr/bin/env node
/**
 * The economic calendar (`src/data/calendar.json`): the dated decisions and releases the paper
 * prints in الأجندة, read from the institutions' own schedule pages, never from memory:
 *
 *   - Federal Reserve: FOMC meeting dates (the decision falls on the last day)
 *   - European Central Bank: monetary policy meetings of the Governing Council (the day with the press conference)
 *   - Bank of England: MPC announcement dates
 *   - US Bureau of Labor Statistics: the CPI and the Employment Situation release dates
 *
 * Best effort, like the market quotes: a source that cannot be read keeps its stored events, the
 * script never fails a build, and a date that does not parse is dropped rather than guessed.
 *
 *   node pipeline/calendar.mjs            refresh src/data/calendar.json
 *   node pipeline/calendar.mjs --check    print the coming events and exit
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("src/data/calendar.json");
const CHECK = process.argv.includes("--check");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

const monthIndex = (name) => MONTHS_EN.findIndex((m) => m.startsWith(String(name).toLowerCase().replace(/\./g, "").slice(0, 3)));
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** The wall clock of an instant in an IANA zone, expressed as a UTC millisecond value. */
function wallClock(ms, zone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
}

/**
 * "HH:MM UTC" of a local time ("14:00" in an IANA zone) on a given date, so summer time is honoured per event:
 * 14:00 in New York is 18:00 UTC in September and 19:00 UTC in December. The stored `time` keeps the
 * "HH:MM UTC" form the site reads.
 */
function utcTime(date, local, zone) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = local.split(":").map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  let instant = wanted;
  // Two corrections settle the offset even on a day the clocks change.
  for (let i = 0; i < 2; i += 1) instant += wanted - wallClock(instant, zone);
  const t = new Date(instant);
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** The sources: each returns events { date, title, org, kind, region, url, time }; `local` and `zone` are the institution's own clock. */
const SOURCES = [
  {
    id: "fed",
    url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    local: "14:00",
    zone: "America/New_York",
    async parse(html) {
      const events = [];
      for (const year of html.matchAll(/(\d{4}) FOMC Meetings([\s\S]*?)(?=\d{4} FOMC Meetings|<\/main|$)/g)) {
        const y = Number(year[1]);
        for (const row of year[2].matchAll(/fomc-meeting__month[^>]*>\s*<strong>([A-Za-z/]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g)) {
          // "January" 27-28, or "Jan/Feb" 31-1 for a meeting spanning two months.
          const months = row[1].split("/").map(monthIndex);
          const days = row[2].replace(/\*/g, "").match(/\d+/g);
          if (!days || months.some((m) => m < 0)) continue;
          const lastDay = Number(days[days.length - 1]);
          const m = months[months.length - 1];
          const date = iso(y, m, lastDay);
          events.push({ date, title: "قرار الفائدة: الاحتياطي الفيدرالي الأمريكي", short: "الفيدرالي: قرار الفائدة", org: "الاحتياطي الفيدرالي", kind: "rates", region: "الأمريكتان", note: "يليه مؤتمر صحفي؛ البنوك المركزية الخليجية المرتبطة بالدولار تتبعه عادة في اليوم نفسه", time: utcTime(date, this.local, this.zone), url: this.url });
        }
      }
      return events;
    },
  },
  {
    id: "ecb",
    url: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
    local: "14:15",
    zone: "Europe/Berlin",
    async parse(html) {
      const events = [];
      for (const m of html.matchAll(/<dt>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
        const what = text(m[4]);
        if (!/monetary policy meeting/i.test(what) || /non-monetary/i.test(what)) continue;
        if (/Day 1\b/i.test(what) && !/press conference/i.test(what)) continue;
        const date = iso(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        events.push({ date, title: "قرار الفائدة: البنك المركزي الأوروبي", short: "المركزي الأوروبي: قرار الفائدة", org: "البنك المركزي الأوروبي", kind: "rates", region: "أوروبا", note: "يليه مؤتمر صحفي", time: utcTime(date, this.local, this.zone), url: this.url });
      }
      return events;
    },
  },
  {
    id: "boe",
    url: "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates",
    local: "12:00",
    zone: "Europe/London",
    async parse(html) {
      const events = [];
      const body = text(html);
      for (const block of body.matchAll(/(\d{4}) (?:confirmed|provisional) dates([\s\S]*?)(?=\d{4} (?:confirmed|provisional) dates|Current Bank Rate|$)/g)) {
        const y = Number(block[1]);
        for (const d of block[2].matchAll(/(?:Monday|Tuesday|Wednesday|Thursday|Friday) (\d{1,2}) ([A-Z][a-z]+)/g)) {
          const m = monthIndex(d[2]);
          if (m < 0) continue;
          const date = iso(y, m, Number(d[1]));
          events.push({ date, title: "قرار الفائدة: بنك إنجلترا", short: "بنك إنجلترا: قرار الفائدة", org: "بنك إنجلترا", kind: "rates", region: "أوروبا", time: utcTime(date, this.local, this.zone), url: this.url });
        }
      }
      return events;
    },
  },
  {
    id: "bls-cpi",
    url: "https://www.bls.gov/schedule/news_release/cpi.htm",
    local: "08:30",
    zone: "America/New_York",
    async parse(html) {
      return blsTable(html, this, (ref) => `التضخم الأمريكي (مؤشر أسعار المستهلكين) عن ${ref}`, (ref) => `التضخم الأمريكي عن ${ref}`);
    },
  },
  {
    id: "bls-jobs",
    url: "https://www.bls.gov/schedule/news_release/empsit.htm",
    local: "08:30",
    zone: "America/New_York",
    async parse(html) {
      return blsTable(html, this, (ref) => `تقرير الوظائف الأمريكي عن ${ref}`, (ref) => `الوظائف الأمريكية عن ${ref}`);
    },
  },
];

/** BLS release tables: reference month | "Sep. 11, 2026" | 08:30 AM (Eastern). */
function blsTable(html, source, title, short = title) {
  const events = [];
  const table = html.match(/<table class="release-list">[\s\S]*?<\/table>/);
  if (!table) return events;
  for (const row of table[0].matchAll(/<tr[^>]*>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>/g)) {
    const ref = row[1].trim().match(/([A-Za-z]+) (\d{4})/);
    const rel = row[2].trim().match(/([A-Za-z]+)\.? (\d{1,2}), (\d{4})/);
    if (!ref || !rel) continue;
    const refM = monthIndex(ref[1]);
    const relM = monthIndex(rel[1]);
    if (refM < 0 || relM < 0) continue;
    const date = iso(Number(rel[3]), relM, Number(rel[2]));
    events.push({ date, title: title(MONTHS_AR[refM]), short: short(MONTHS_AR[refM]), org: "مكتب إحصاءات العمل الأمريكي", kind: "data", region: "الأمريكتان", time: utcTime(date, source.local, source.zone), url: source.url });
  }
  return events;
}

async function main() {
  let previous = { events: [] };
  try {
    previous = JSON.parse(await readFile(OUT, "utf8"));
  } catch {}
  const fresh = new Map();
  const failed = [];
  for (const source of SOURCES) {
    try {
      const events = (await source.parse(await get(source.url))).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !Number.isNaN(Date.parse(e.date)));
      if (!events.length) throw new Error("no events parsed");
      fresh.set(source.id, events.map((e) => ({ ...e, source: source.id })));
      console.log(`calendar: ${source.id}: ${events.length} events`);
    } catch (error) {
      failed.push(`${source.id}: ${error.message}`);
    }
  }
  // A source that failed keeps its stored events; a source that answered replaces them wholesale.
  const events = [];
  for (const source of SOURCES) {
    if (fresh.has(source.id)) events.push(...fresh.get(source.id));
    else events.push(...(previous.events || []).filter((e) => e.source === source.id));
  }
  const seen = new Set();
  const merged = events
    .filter((e) => {
      const key = `${e.date}|${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const data = { updatedAt: fresh.size ? new Date().toISOString() : previous.updatedAt || null, events: merged };
  if (CHECK) {
    const today = new Date().toISOString().slice(0, 10);
    for (const e of merged.filter((e) => e.date >= today).slice(0, 20)) console.log(`${e.date}  ${e.title}`);
  } else {
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
  }
  console.log(`calendar: ${merged.length} events, ${fresh.size}/${SOURCES.length} sources fresh${failed.length ? `; failed: ${failed.join("; ")}` : ""}`);
}

main().catch((error) => {
  console.error(`calendar: ${error.message || error}`);
  process.exit(0);
});
