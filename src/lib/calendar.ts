/**
 * The economic calendar, read from `src/data/calendar.json` (written by `pipeline/calendar.mjs`
 * from the institutions' own schedule pages), and the grouping the front module and the page share.
 */
// Relative addresses with their type, so Node reads this module in scripts/pipeline-selftest.mjs as it reads regions.ts.
import data from "../data/calendar.json" with { type: "json" };
import site from "../data/site.json" with { type: "json" };

export interface CalendarEvent {
  date: string;
  title: string;
  /** The title for the front's module, one line. */
  short?: string;
  org: string;
  /** A rate decision, a data release, or a central bank's minutes. */
  kind: "rates" | "data" | "minutes";
  note?: string;
  time?: string;
  url: string;
  source: string;
}

/** One schedule the calendar is read from: whose it is, what it lists, and how far it reaches. */
export interface CalendarSource {
  id: string;
  name: string;
  what: string;
  url: string;
  /** Set when the schedule is read from another institution's copy of it. */
  via?: string;
  /** The last time the schedule was read. */
  readAt: string | null;
  /** The last date the schedule holds, or null when it holds none ahead. */
  until: string | null;
}

export interface Calendar {
  updatedAt: string | null;
  sources?: CalendarSource[];
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

/**
 * The page's months: the next `count` months that hold an event, each with its days. Whole months, so a month's
 * head never stands over half of it, and a month with nothing left is passed over.
 */
export function byMonth(count = 3, from = todayIso()): { key: string; label: string; days: { date: string; label: string; events: CalendarEvent[] }[] }[] {
  const months = new Map<string, Map<string, CalendarEvent[]>>();
  for (const e of calendar.events) {
    if (e.date < from) continue;
    const key = e.date.slice(0, 7);
    if (!months.has(key)) {
      if (months.size === count) break;
      months.set(key, new Map());
    }
    const days = months.get(key)!;
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date)!.push(e);
  }
  return [...months.entries()].map(([key, days]) => ({
    key,
    label: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`,
    days: [...days.entries()].map(([date, events]) => ({ date, label: weekdayLabel(date), events })),
  }));
}

/**
 * The schedules that have published no date in a month yet, by name: their dates end before it starts (2026-11-20, the
 * owner: "check the agenda page design and organization too"). January showed no US inflation, no US jobs and no
 * Chinese data, the BLS and NBS calendars ending in December, and said so only inside the folded list of sources: a
 * month without them read as a quiet month. Minutes are left out: they follow meetings, and a month without them is
 * not a schedule unpublished.
 */
export function notYetIn(monthKey: string, sources: CalendarSource[] = calendar.sources ?? [], events: CalendarEvent[] = calendar.events): string[] {
  const start = `${monthKey}-01`;
  const onlyMinutes = (id: string) => {
    const kinds = new Set(events.filter((e) => e.source === id).map((e) => e.kind));
    return kinds.size > 0 && [...kinds].every((k) => k === "minutes");
  };
  return [...new Set(sources.filter((s) => !(s.until && s.until >= start) && !onlyMinutes(s.id)).map((s) => s.name))];
}

/** "الثلاثاء 15" under a month's own head. */
export function weekdayLabel(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** "15 سبتمبر", with the year when it is not the current one. */
export function shortDate(date: string, from = todayIso()): string {
  const d = new Date(date.slice(0, 10) + "T12:00:00Z");
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return date.slice(0, 4) === from.slice(0, 4) ? base : `${base} ${d.getUTCFullYear()}`;
}

/** A source's last successful reading counts as old after this many days: the page then says when it was. */
export const SOURCE_STALE_DAYS = 3;

/**
 * The schedules behind the page, each with what a reader should know about it: that it was last read days ago (the
 * institution's page has stopped answering, and its dates are the stored ones), or that its published dates end
 * before the page's last day (next year's schedule is not out, so a month may look emptier than it will be).
 */
export function sourceNotes(until: string, from = todayIso()): (CalendarSource & { detail: string })[] {
  return (calendar.sources ?? []).map((s) => {
    const notes: string[] = [];
    if (s.via) notes.push(s.via);
    const age = s.readAt ? (Date.parse(from) - Date.parse(s.readAt.slice(0, 10))) / 86400000 : Infinity;
    if (age > SOURCE_STALE_DAYS) notes.push(s.readAt ? `آخر قراءة في ${shortDate(s.readAt, from)}` : "لم يُقرأ بعد");
    if (!s.until || s.until < from) notes.push("لا مواعيد معلنة للفترة المقبلة");
    else if (s.until < until) notes.push(`المواعيد المعلنة تنتهي في ${shortDate(s.until, from)}`);
    return { ...s, detail: notes.join("، ") };
  });
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
