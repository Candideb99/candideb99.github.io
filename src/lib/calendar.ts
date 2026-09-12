/**
 * The economic calendar, read from `src/data/calendar.json` (written by `pipeline/calendar.mjs`
 * from the institutions' own schedule pages), and the grouping the front module and the page share.
 */
import data from "@data/calendar.json";
import site from "@data/site.json";

export interface CalendarEvent {
  date: string;
  title: string;
  /** The title for the front's module, one line. */
  short?: string;
  org: string;
  kind: "rates" | "data";
  region: string;
  note?: string;
  time?: string;
  url: string;
  source: string;
}

export interface Calendar {
  updatedAt: string | null;
  events: CalendarEvent[];
}

export const calendar = data as Calendar;

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** Today's date in the site's time zone, as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: site.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p;
}

/** Events from today on, nearest first. */
export function upcoming(limit = 6, from = todayIso()): CalendarEvent[] {
  return calendar.events.filter((e) => e.date >= from).slice(0, limit);
}

/** Events within the next `days` days, grouped by day. */
export function byDay(days = 60, from = todayIso()): { date: string; label: string; events: CalendarEvent[] }[] {
  const end = new Date(Date.parse(from) + days * 86400000).toISOString().slice(0, 10);
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of calendar.events) {
    if (e.date < from || e.date > end) continue;
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date)!.push(e);
  }
  return [...groups.entries()].map(([date, events]) => ({ date, label: dayLabel(date), events }));
}

/** "الثلاثاء 15 سبتمبر" from YYYY-MM-DD, with the year when it is not the current one. */
export function dayLabel(date: string, from = todayIso()): string {
  const d = new Date(date + "T12:00:00Z");
  const base = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return date.slice(0, 4) === from.slice(0, 4) ? base : `${base} ${d.getUTCFullYear()}`;
}

/** "اليوم", "غداً", or the day label. */
export function relativeDay(date: string, from = todayIso()): string {
  const diff = Math.round((Date.parse(date) - Date.parse(from)) / 86400000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "غداً";
  return dayLabel(date, from);
}

/** The local time in the site's zone for an event that carries a UTC time, e.g. "21:00". */
export function localTime(e: CalendarEvent): string | null {
  const m = e.time?.match(/^(\d{2}):(\d{2}) UTC$/);
  if (!m) return null;
  const at = new Date(`${e.date}T${m[1]}:${m[2]}:00Z`);
  return new Intl.DateTimeFormat("en-GB", { timeZone: site.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}
