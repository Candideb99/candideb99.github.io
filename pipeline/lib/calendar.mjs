/**
 * The economic calendar's sources and their readers. `pipeline/calendar.mjs` runs them and writes
 * `src/data/calendar.json`; `scripts/calendar-selftest.mjs` holds each reader to the institutions' own markup.
 *
 * What the agenda carries (2026-11-15, the owner: "is this section well organized or still needs some
 * work/improvement/expansion"): for the large economies, the rate decision, inflation, and growth or jobs, and
 * nothing below that tier (no final revisions, no surveys), so the page stays a list a reader can take in:
 *
 *   - rate decisions: the Federal Reserve, the European Central Bank, the Bank of England, the Bank of Japan,
 *     the Central Bank of the Republic of Türkiye; the Fed's minutes
 *   - United States: CPI and the jobs report (BLS, from FRED when bls.gov refuses the reader), GDP and
 *     personal income and outlays, which carries the PCE price index (BEA)
 *   - euro area: the flash estimates of inflation and of GDP (Eurostat)
 *   - China: the monthly activity data, with GDP in the quarter's first month, and CPI (NBS)
 *
 * Not read, each tried that day with the newsroom's own reader, which never takes a browser's name: the Central
 * Bank of Egypt («Request Rejected», a firewall), OPEC (Cloudflare refuses every page), and Saudi Arabia's GASTAT,
 * whose statistical calendar is drawn by script from a service the page does not name. No date is ever entered
 * from memory or by hand.
 *
 * Every date is the institution's own; a reader that cannot place a date drops the event rather than guess, and a
 * layout it does not recognise yields nothing, so the stored events stay.
 */
import { USER_AGENT, fetchWithTimeout } from "./util.mjs";

const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const QUARTERS_AR = ["الأول", "الثاني", "الثالث", "الرابع"];

/** The month a name or its abbreviation stands for ("Sept.", "Dec", "January"), or -1. An empty name is no month:
 *  every month's name starts with the empty string, and it had read as January. */
export function monthIndex(name) {
  const key = String(name ?? "").toLowerCase().replace(/\./g, "").slice(0, 3);
  return key.length < 3 ? -1 : MONTHS_EN.findIndex((m) => m.startsWith(key));
}
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const text = (html) =>
  String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The newsroom's own reader, never a browser's name (2026-10-28: the Fed, the ECB and the Bank of England answer it;
 *  bls.gov refused the disguise as well, and the declared name; since 2026-11-21 the plain name, which bls.gov answers,
 *  with the declared one asked after a refusal: util.mjs fetchWithTimeout()). */
export async function get(url) {
  const res = await fetchWithTimeout(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/json,*/*" } }, 25000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** The wall clock of an instant in an IANA zone, expressed as a UTC millisecond value. */
function wallClock(ms, zone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
  const part = (type) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour") % 24, part("minute"));
}

/**
 * "HH:MM UTC" of a local time ("14:00" in an IANA zone) on a given date, so summer time is honoured per event:
 * 14:00 in New York is 18:00 UTC in September and 19:00 UTC in December. The stored `time` keeps the
 * "HH:MM UTC" form the site reads.
 */
export function utcTime(date, local, zone) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = local.split(":").map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  let instant = wanted;
  // Two corrections settle the offset even on a day the clocks change.
  for (let i = 0; i < 2; i += 1) instant += wanted - wallClock(instant, zone);
  const t = new Date(instant);
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** "08:30" from "8:30 AM" or "2:00 p.m.", or null. */
function clock(value) {
  const m = String(value ?? "").match(/(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i);
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const timed = (source, date, local = source.local) => (local ? { time: utcTime(date, local, source.zone) } : {});

/** A rate decision: the page prints its kind beside the institution, the front's module the short line. */
const decision = (source, date) => ({
  date,
  title: `قرار الفائدة: ${source.org}`,
  short: `${source.brief}: قرار الفائدة`,
  org: source.org,
  kind: "rates",
  ...(source.note ? { note: source.note } : {}),
  ...timed(source, date),
  url: source.url,
});

const release = (source, date, { title, short, note, local, url }) => ({
  date,
  title,
  short,
  org: source.org,
  kind: "data",
  ...(note ? { note } : {}),
  ...timed(source, date, local),
  url: url ?? source.url,
});

/* ----- The readers: each takes the institution's page and returns its events. ----- */

/** FOMC meetings: the decision falls on the last day. */
export function parseFed(html, source = FED) {
  const events = [];
  for (const year of html.matchAll(/(\d{4}) FOMC Meetings([\s\S]*?)(?=\d{4} FOMC Meetings|<\/main|$)/g)) {
    const y = Number(year[1]);
    for (const row of year[2].matchAll(/fomc-meeting__month[^>]*>\s*<strong>([A-Za-z/]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g)) {
      // A scheduled meeting's day cell holds days alone («27-28», «31-1*»). A cell with words is something else: the
      // page lists «22 (notation vote)» under August 2025, a vote taken on paper between meetings, which had been
      // stored as a rate decision of 22 August; an unscheduled or cancelled meeting is marked the same way.
      const cell = row[2].replace(/\*/g, "");
      if (/[a-z]/i.test(cell)) continue;
      // "January" 27-28, or "Jan/Feb" 31-1 for a meeting spanning two months.
      const months = row[1].split("/").map(monthIndex);
      const days = cell.match(/\d+/g);
      if (!days || months.some((m) => m < 0)) continue;
      events.push(decision(source, iso(y, months[months.length - 1], Number(days[days.length - 1]))));
    }
  }
  return events;
}

/** The Fed's minutes, from the Board's own calendar file: { title: "FOMC Minutes", month: "2026-11", days: "18", time: "2:00 p.m." }. */
export function parseFedMinutes(json, source = FED_MINUTES) {
  const events = [];
  const data = typeof json === "string" ? JSON.parse(json.replace(/^﻿/, "")) : json;
  for (const e of data?.events ?? []) {
    if (e?.title !== "FOMC Minutes" || !/^\d{4}-\d{2}$/.test(e.month ?? "") || !/^\d{1,2}$/.test(String(e.days ?? "").trim())) continue;
    const date = `${e.month}-${String(e.days).trim().padStart(2, "0")}`;
    // "Meeting of October 27-28", written with its markup escaped.
    const of = text(String(e.description ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).match(/^Meeting of ([A-Z][a-z]+) (\d{1,2})-(\d{1,2})$/);
    const month = of ? monthIndex(of[1]) : -1;
    events.push({
      date,
      title: `محضر اجتماع ${source.org}`,
      short: `${source.brief}: محضر الاجتماع`,
      org: source.org,
      kind: "minutes",
      ...(month >= 0 ? { note: `عن اجتماع يومي ${Number(of[2])} و${Number(of[3])} ${MONTHS_AR[month]}` } : {}),
      ...timed(source, date, clock(e.time) ?? source.local),
      url: source.url,
    });
  }
  return events;
}

/** ECB monetary policy meetings: the day with the press conference. */
export function parseEcb(html, source = ECB) {
  const events = [];
  for (const m of html.matchAll(/<dt>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
    const what = text(m[4]);
    if (!/monetary policy meeting/i.test(what) || /non-monetary/i.test(what)) continue;
    if (/Day 1\b/i.test(what) && !/press conference/i.test(what)) continue;
    events.push(decision(source, iso(Number(m[3]), Number(m[2]) - 1, Number(m[1]))));
  }
  return events;
}

/** Bank of England MPC announcement dates. */
export function parseBoe(html, source = BOE) {
  const events = [];
  for (const block of text(html).matchAll(/(\d{4}) (?:confirmed|provisional) dates([\s\S]*?)(?=\d{4} (?:confirmed|provisional) dates|Current Bank Rate|$)/g)) {
    const y = Number(block[1]);
    for (const d of block[2].matchAll(/(?:Monday|Tuesday|Wednesday|Thursday|Friday) (\d{1,2}) ([A-Z][a-z]+)/g)) {
      const m = monthIndex(d[2]);
      if (m >= 0) events.push(decision(source, iso(y, m, Number(d[1]))));
    }
  }
  return events;
}

/**
 * Bank of Japan Monetary Policy Meetings: one table a year («Table : 2026»), the meeting's days in its first column
 * («Dec. 17 (Thurs.), 18 (Fri.)», or «Apr. 30 (Thurs.), May 1 (Fri.)»); the decision is announced on the last day.
 * The Bank gives no hour for it, so the event carries none.
 */
export function parseBoj(html, source = BOJ) {
  const events = [];
  for (const table of html.matchAll(/<caption[^>]*>\s*Table\s*:\s*(\d{4})\s*<\/caption>([\s\S]*?)<\/table>/g)) {
    const y = Number(table[1]);
    for (const row of table[2].matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
      let month = -1;
      let day = 0;
      for (const m of text(row[1]).matchAll(/(?:([A-Z][a-z]{2,8})\.?\s+)?(\d{1,2})\s*\(/g)) {
        if (m[1]) month = monthIndex(m[1]);
        day = Number(m[2]);
      }
      if (month >= 0 && day) events.push(decision(source, iso(y, month, day)));
    }
  }
  return events;
}

/**
 * The Central Bank of the Republic of Türkiye's calendar: a table whose first column is the Monetary Policy
 * Committee's decision day and whose others are its summary and two reports. Only a table that still opens with
 * that column is read. The page gives no hour.
 */
export function parseCbrt(html, source = CBRT) {
  const events = [];
  const table = html.match(/<table[^>]*id="midTable"[\s\S]*?<\/table>/);
  if (!table) return events;
  const head = table[0].match(/<thead[\s\S]*?<\/thead>/);
  const first = head?.[0].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/);
  if (!first || !/Monetary Policy Committee Decision/i.test(text(first[1]))) return events;
  for (const row of table[0].replace(head[0], "").matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
    const d = text(row[1]).match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
    const m = d ? monthIndex(d[1]) : -1;
    if (m >= 0) events.push(decision(source, iso(Number(d[3]), m, Number(d[2]))));
  }
  return events;
}

/** BLS release tables: reference month | "Sep. 11, 2026" | 08:30 AM (Eastern). */
export function parseBls(html, source) {
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
    events.push(blsEvent(source, iso(Number(rel[3]), relM, Number(rel[2])), MONTHS_AR[refM], source.url));
  }
  return events;
}

const blsEvent = (source, date, ref, url) => release(source, date, { title: source.title(ref), short: source.short(ref), url });

/**
 * The same release days from FRED, the St. Louis Fed's release calendar, when bls.gov refuses the reader: from October
 * 2026 it answered every request with 403, its robots.txt included, so the agenda ran on stored dates that end on 10
 * December. FRED republishes BLS's schedule (the dates matched the stored ones exactly) and allows readers. It gives the
 * days only: the reference month is the one before the release, as on BLS's normal schedule, and a month holding two
 * releases (a disrupted schedule, as in the shutdown of 2025) names none rather than guess.
 */
export function parseFred(pages, source) {
  const days = [];
  for (const { url, html } of pages) {
    for (const m of html.matchAll(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) ([A-Z][a-z]+) (\d{1,2}), (\d{4})/g)) {
      const month = monthIndex(m[1]);
      if (month >= 0) days.push({ date: iso(Number(m[3]), month, Number(m[2])), url });
    }
  }
  const unique = [...new Map(days.map((d) => [d.date, d])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const perMonth = new Map();
  for (const d of unique) perMonth.set(d.date.slice(0, 7), (perMonth.get(d.date.slice(0, 7)) ?? 0) + 1);
  return unique.map((d) => {
    const month = Number(d.date.slice(5, 7)) - 1;
    const ref = perMonth.get(d.date.slice(0, 7)) === 1 ? MONTHS_AR[(month + 11) % 12] : null;
    return blsEvent(source, d.date, ref, d.url);
  });
}

async function fredEvents(source, fetchPage) {
  const year = new Date().getUTCFullYear();
  const pages = [];
  for (const y of [year, year + 1]) {
    const url = `https://fred.stlouisfed.org/releases/calendar?rid=${source.fred}&y=${y}`;
    pages.push({ url, html: await fetchPage(url) });
  }
  return parseFred(pages, source);
}

/**
 * BEA's release schedule, one table a year («Year 2026»): day | hour (Eastern) | title. Two releases are taken: GDP by
 * its estimate («GDP (Second Estimate) and Corporate Profits, 3rd Quarter 2026») and Personal Income and Outlays, the
 * release that carries the PCE price index. «GDP by County», «Gross Domestic Product by State» and the rest are not.
 */
export function parseBea(html, source = BEA) {
  const events = [];
  const heads = [...html.matchAll(/<th[^>]*>\s*Year (\d{4})\s*<\/th>/g)];
  heads.forEach((head, i) => events.push(...beaYear(html.slice(head.index, heads[i + 1]?.index ?? html.length), Number(head[1]), source)));
  return events;
}

function beaYear(html, y, source) {
  const events = [];
  const ESTIMATES = { advance: "التقدير الأول", second: "التقدير الثاني", third: "التقدير الثالث", updated: "تقدير محدَّث" };
  let last = -1;
  for (const row of html.matchAll(/release-date">([^<]+)<\/div>\s*<small[^>]*>([^<]*)<\/small>[\s\S]*?release-title[^>]*>([^<]+)</g)) {
    const day = row[1].trim().match(/^([A-Z][a-z]+) (\d{1,2})$/);
    const m = day ? monthIndex(day[1]) : -1;
    if (m < 0) continue;
    // The rows carry no year of their own. A month earlier than the row before it is the next year's under this
    // year's head (a list of coming releases read in December): what follows is left rather than dated a year back.
    if (m < last) break;
    last = m;
    const date = iso(y, m, Number(day[2]));
    const local = clock(row[2]);
    const title = text(row[3]);
    if (/^(?:GDP|Gross Domestic Product)(?= \(|,)/.test(title)) {
      const estimate = ESTIMATES[title.match(/(Advance|Second|Third|Updated) Estimate/i)?.[1].toLowerCase()];
      const quarter = title.match(/([1-4])(?:st|nd|rd|th) Quarter/);
      const named = estimate && quarter;
      events.push(
        release(source, date, {
          title: named ? `الناتج المحلي الأمريكي للربع ${QUARTERS_AR[Number(quarter[1]) - 1]} (${estimate})` : "الناتج المحلي الإجمالي الأمريكي",
          short: named ? `الناتج المحلي الأمريكي للربع ${QUARTERS_AR[Number(quarter[1]) - 1]}` : "الناتج المحلي الأمريكي",
          local,
        }),
      );
    } else if (/^Personal Income and Outlays,/.test(title)) {
      // "October 2026", or "October and November 2025" after a disrupted schedule.
      const months = [...title.matchAll(/\b([A-Z][a-z]+)\b/g)].map((w) => monthIndex(w[1])).filter((i) => i >= 0);
      const ref = months.length ? ` عن ${months.map((i) => MONTHS_AR[i]).join(" و")}` : "";
      events.push(
        release(source, date, {
          title: `مؤشر نفقات الاستهلاك الشخصي الأمريكي${ref}`,
          short: `نفقات الاستهلاك الأمريكية${ref}`,
          note: "مقياس التضخم الذي يعتمده الاحتياطي الفيدرالي",
          local,
        }),
      );
    }
  }
  return events;
}

/**
 * Eurostat's release calendar (its own JSON): the flash estimate of euro-area inflation and the preliminary flash
 * estimate of GDP. `start` carries the release hour in Luxembourg's time under a «Z» (11:00, the hour of every euro indicator,
 * winter and summer alike), so it is read as local time.
 */
export function parseEurostat(json, source = EUROSTAT) {
  const events = [];
  const list = typeof json === "string" ? JSON.parse(json) : json;
  for (const e of Array.isArray(list) ? list : []) {
    const at = String(e?.start ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if (!at) continue;
    const title = String(e.title ?? "");
    const period = String(e.period ?? "");
    if (/^Flash estimate inflation euro area/i.test(title)) {
      const m = monthIndex(period.split(" ")[0]);
      const ref = m >= 0 ? ` عن ${MONTHS_AR[m]}` : "";
      events.push(release(source, at[1], { title: `التضخم في منطقة اليورو${ref} (تقدير أولي)`, short: `تضخم منطقة اليورو${ref}`, local: at[2] }));
    } else if (/^Preliminary flash estimate GDP\b/i.test(title) && /euro area/i.test(title)) {
      // The first reading, thirty days after the quarter; the «flash estimate» two weeks later revises it.
      const q = period.match(/^Q([1-4])\//);
      const ref = q ? ` للربع ${QUARTERS_AR[Number(q[1]) - 1]}` : "";
      events.push(release(source, at[1], { title: `الناتج المحلي لمنطقة اليورو${ref} (تقدير أولي)`, short: `ناتج منطقة اليورو${ref}`, local: at[2] }));
    }
  }
  return events;
}

/**
 * China's National Bureau of Statistics prints one table a year: a row per release, a cell per month («15/Tue», or
 * «……» for a month without one), and under it a row of hours. Two rows are taken: «National Economic Performance»,
 * the monthly activity data, which in the first month of a quarter is the release that carries the quarter's GDP,
 * and the consumer price index, each month's for the month before.
 */
export function parseNbs(html, year, source = NBS) {
  const events = [];
  const rowOf = (label) => {
    const at = html.indexOf(label);
    if (at < 0) return null;
    const start = html.lastIndexOf("<tr", at);
    const end = html.indexOf("</tr>", at);
    if (start < 0 || end < 0) return null;
    const cells = [...html.slice(start, end).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
    // No. | the release | twelve months.
    if (cells.length !== 14) return null;
    const hoursEnd = html.indexOf("</tr>", end + 5);
    const hours = hoursEnd < 0 ? [] : [...html.slice(end + 5, hoursEnd).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
    // One hour for the whole row, or none: the hours' cells cannot be matched to months when one is missing.
    const hour = hours.length && hours.every((h) => /^\d{1,2}:\d{2}$/.test(h) && h === hours[0]) ? hours[0].padStart(5, "0") : null;
    return { months: cells.slice(2), hour };
  };
  const each = (row, make) => {
    if (!row) return;
    row.months.forEach((cell, month) => {
      const day = cell.match(/^(\d{1,2})\/[A-Z][a-z]{2}\b/);
      if (day) events.push(release(source, iso(year, month, Number(day[1])), { ...make(month), local: row.hour }));
    });
  };
  each(rowOf("National Economic Performance"), (month) =>
    month % 3 === 0
      ? { title: `الناتج المحلي الصيني للربع ${QUARTERS_AR[(month / 3 + 3) % 4]} وبيانات النشاط الشهرية`, short: `الناتج المحلي الصيني للربع ${QUARTERS_AR[(month / 3 + 3) % 4]}` }
      : { title: "بيانات النشاط الاقتصادي في الصين (الإنتاج الصناعي ومبيعات التجزئة)", short: "بيانات النشاط في الصين" },
  );
  each(rowOf("Consumer Price Index (CPI)"), (month) => ({ title: `التضخم في الصين عن ${MONTHS_AR[(month + 11) % 12]}`, short: `التضخم الصيني عن ${MONTHS_AR[(month + 11) % 12]}` }));
  return events;
}

/** The yearly calendars the bureau's index lists, this year's and any later one: [{ year, url }]. */
export function nbsCalendars(index, base, from = new Date().getUTCFullYear()) {
  const found = [];
  for (const a of index.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const year = text(a[2]).match(/Regular Press Release Calendar of NBS in (\d{4})/);
    if (year && Number(year[1]) >= from) found.push({ year: Number(year[1]), url: new URL(a[1], base).href });
  }
  return found;
}

/* ----- The sources. `org` is the institution as the page names it, `what` the schedule it keeps, `url` the page a
   reader is sent to; `local` and `zone` are the institution's own clock. ----- */

const FED = {
  id: "fed",
  org: "الاحتياطي الفيدرالي الأمريكي",
  brief: "الفيدرالي",
  what: "جدول اجتماعات لجنة السوق المفتوحة",
  url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  local: "14:00",
  zone: "America/New_York",
  note: "يليه مؤتمر صحفي؛ البنوك المركزية الخليجية المرتبطة بالدولار تتبعه عادة في اليوم نفسه",
  read: async (fetchPage) => parseFed(await fetchPage(FED.url)),
};

const FED_MINUTES = {
  id: "fed-minutes",
  org: FED.org,
  brief: FED.brief,
  what: "مواعيد نشر محاضر الاجتماعات",
  url: "https://www.federalreserve.gov/newsevents/calendar.htm",
  data: "https://www.federalreserve.gov/json/calendar.json",
  local: "14:00",
  zone: "America/New_York",
  read: async (fetchPage) => parseFedMinutes(await fetchPage(FED_MINUTES.data)),
};

const ECB = {
  id: "ecb",
  org: "البنك المركزي الأوروبي",
  brief: "المركزي الأوروبي",
  what: "جدول اجتماعات مجلس المحافظين",
  url: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
  local: "14:15",
  zone: "Europe/Berlin",
  note: "يليه مؤتمر صحفي",
  read: async (fetchPage) => parseEcb(await fetchPage(ECB.url)),
};

const BOE = {
  id: "boe",
  org: "بنك إنجلترا",
  brief: "بنك إنجلترا",
  what: "مواعيد لجنة السياسة النقدية",
  url: "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates",
  local: "12:00",
  zone: "Europe/London",
  read: async (fetchPage) => parseBoe(await fetchPage(BOE.url)),
};

const BOJ = {
  id: "boj",
  org: "بنك اليابان",
  brief: "بنك اليابان",
  what: "جدول اجتماعات السياسة النقدية",
  url: "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm",
  read: async (fetchPage) => parseBoj(await fetchPage(BOJ.url)),
};

const CBRT = {
  id: "cbrt",
  org: "البنك المركزي التركي",
  brief: "المركزي التركي",
  what: "تقويم لجنة السياسة النقدية",
  url: "https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB+EN/Main+Menu/Announcements/Calendar",
  read: async (fetchPage) => parseCbrt(await fetchPage(CBRT.url)),
};

const BLS = { org: "مكتب إحصاءات العمل الأمريكي", local: "08:30", zone: "America/New_York", via: "عن نسخة بنك الاحتياطي الفيدرالي في سانت لويس" };

const BLS_CPI = {
  ...BLS,
  id: "bls-cpi",
  what: "مواعيد إصدار مؤشر أسعار المستهلكين",
  url: "https://www.bls.gov/schedule/news_release/cpi.htm",
  title: (ref) => (ref ? `التضخم الأمريكي (مؤشر أسعار المستهلكين) عن ${ref}` : "التضخم الأمريكي (مؤشر أسعار المستهلكين)"),
  short: (ref) => (ref ? `التضخم الأمريكي عن ${ref}` : "التضخم الأمريكي"),
  fred: 10,
  read: async (fetchPage) => parseBls(await fetchPage(BLS_CPI.url), BLS_CPI),
};

const BLS_JOBS = {
  ...BLS,
  id: "bls-jobs",
  what: "مواعيد إصدار تقرير الوظائف",
  url: "https://www.bls.gov/schedule/news_release/empsit.htm",
  title: (ref) => (ref ? `تقرير الوظائف الأمريكي عن ${ref}` : "تقرير الوظائف الأمريكي"),
  short: (ref) => (ref ? `الوظائف الأمريكية عن ${ref}` : "الوظائف الأمريكية"),
  fred: 50,
  read: async (fetchPage) => parseBls(await fetchPage(BLS_JOBS.url), BLS_JOBS),
};

const BEA = {
  id: "bea",
  org: "مكتب التحليل الاقتصادي الأمريكي",
  what: "جدول إصدار الناتج المحلي ونفقات الاستهلاك الشخصي",
  url: "https://www.bea.gov/news/schedule",
  pages: ["https://www.bea.gov/news/schedule", "https://www.bea.gov/news/schedule/next-year"],
  zone: "America/New_York",
  async read(fetchPage) {
    // The coming releases must answer; next year's table is published late in the year and may not be there yet.
    const events = parseBea(await fetchPage(BEA.pages[0]));
    try {
      events.push(...parseBea(await fetchPage(BEA.pages[1])));
    } catch {}
    return events;
  },
};

const EUROSTAT = {
  id: "eurostat",
  org: "مكتب الإحصاء الأوروبي (يوروستات)",
  what: "تقويم الإصدارات: التقديرات الأولية للتضخم والناتج المحلي",
  url: "https://ec.europa.eu/eurostat/news/release-calendar",
  zone: "Europe/Luxembourg",
  async read(fetchPage) {
    const day = (ms) => `${new Date(ms).toISOString().slice(0, 10)}T00%3A00%3A00.000Z`;
    return parseEurostat(await fetchPage(`https://ec.europa.eu/eurostat/o/calendars/eventsJson?start=${day(Date.now() - 86400000)}&end=${day(Date.now() + 370 * 86400000)}`));
  },
};

const NBS = {
  id: "nbs",
  org: "المكتب الوطني للإحصاء في الصين",
  what: "تقويم الإصدارات الدورية",
  url: "https://www.stats.gov.cn/english/PressRelease/ReleaseCalendar/",
  zone: "Asia/Shanghai",
  async read(fetchPage) {
    const events = [];
    for (const { year, url } of nbsCalendars(await fetchPage(NBS.url), NBS.url)) events.push(...parseNbs(await fetchPage(url), year));
    return events;
  },
};

export const SOURCES = [FED, FED_MINUTES, ECB, BOE, BOJ, CBRT, BLS_CPI, BLS_JOBS, BEA, EUROSTAT, NBS];

const valid = (list) => list.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !Number.isNaN(Date.parse(e.date)));

/** One source's events, from its own page or, for BLS, from FRED when the page refuses: { events, via }. */
export async function readSource(source, fetchPage = get, log = () => {}) {
  try {
    const events = valid(await source.read(fetchPage));
    if (!events.length) throw new Error("no events parsed");
    return { events };
  } catch (error) {
    if (!source.fred) throw error;
    const events = valid(await fredEvents(source, fetchPage));
    if (!events.length) throw new Error(`${error.message}; FRED: no events parsed`);
    log(`calendar: ${source.id}: ${error.message} at bls.gov; read from FRED`);
    return { events, via: { note: source.via, url: `https://fred.stlouisfed.org/releases/calendar?rid=${source.fred}` } };
  }
}

/**
 * The calendar file from this run's readings and the stored one. A source that answered replaces its events
 * wholesale; one that failed keeps its stored events and the day it was last read, which the page prints once it is
 * old. Days gone by are dropped (the Fed's page lists its meetings back to 2021: 42 of the 115 stored events were
 * past decisions no page showed), a day's events run in the order of their hours, and each source says how far its
 * schedule reaches (`until`), so a reader can see that a month is thin because a schedule is not out yet.
 *
 * @param previous the stored file
 * @param readings Map of source id → { events, via? } for the sources that answered
 * @param now      the run's time, ms
 */
export function buildCalendar(previous, readings, now = Date.now(), sources = SOURCES) {
  const floor = new Date(now - 86400000).toISOString().slice(0, 10);
  const stamp = new Date(now).toISOString();
  const stored = new Map((previous?.sources ?? []).map((s) => [s.id, s]));
  const events = [];
  const listed = [];
  sources.forEach((source, order) => {
    const fresh = readings.get(source.id);
    const own = (fresh ? fresh.events : (previous?.events ?? []).filter((e) => e.source === source.id)).filter((e) => e.date >= floor);
    for (const e of own) events.push({ ...e, source: source.id, order });
    const was = stored.get(source.id);
    const via = fresh ? fresh.via : was?.via ? { note: was.via, url: was.url } : null;
    listed.push({
      id: source.id,
      name: source.org,
      what: source.what,
      url: via?.url ?? source.url,
      ...(via?.note ? { via: via.note } : {}),
      // The stored file of before this change carried no per-source record: its one stamp stands for each source.
      readAt: fresh ? stamp : was?.readAt ?? previous?.updatedAt ?? null,
      until: own.reduce((last, e) => (e.date > last ? e.date : last), "") || null,
    });
  });
  const seen = new Set();
  const merged = events
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.order - b.order)
    .filter((e) => {
      const key = `${e.date}|${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ order, ...e }) => e);
  return { updatedAt: readings.size ? stamp : previous?.updatedAt ?? null, sources: listed, events: merged };
}
