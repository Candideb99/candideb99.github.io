import site from "@data/site.json";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function partsIn(date: Date, timeZone = site.timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map.weekday);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    weekday: weekdayIndex,
  };
}

/** "الأحد 7 سبتمبر 2026" */
export function formatDate(iso: string | Date, { weekday = true } = {}): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = partsIn(d);
  const base = `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
  return weekday ? `${DAYS[p.weekday]} ${base}` : base;
}

/** "7 سبتمبر" */
export function formatShortDate(iso: string | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = partsIn(d);
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

/** "14:05" in the site time zone. */
export function formatTime(iso: string | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = partsIn(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Relative Arabic time: "قبل 3 ساعات". Falls back to a date beyond 2 days. */
export function timeAgo(iso: string | Date, now = new Date()): string {
  const d = new Date(iso);
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return "الآن";
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return minutes === 1 ? "قبل دقيقة" : minutes === 2 ? "قبل دقيقتين" : minutes <= 10 ? `قبل ${minutes} دقائق` : `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "قبل ساعة" : hours === 2 ? "قبل ساعتين" : hours <= 10 ? `قبل ${hours} ساعات` : `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "أمس";
  if (days === 2) return "قبل يومين";
  if (days <= 10) return `قبل ${days} أيام`;
  return formatDate(d, { weekday: false });
}

export function readingLabel(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m === 1) return "دقيقة قراءة";
  if (m === 2) return "دقيقتا قراءة";
  if (m <= 10) return `${m} دقائق قراءة`;
  return `${m} دقيقة قراءة`;
}

/** Issue number counted in days since launch (issue 1 on launch day). */
export function issueNumber(date = new Date()): number {
  const launch = new Date(`${site.launchDate}T00:00:00Z`);
  const days = Math.floor((date.getTime() - launch.getTime()) / 86_400_000);
  return Math.max(1, days + 1);
}

export function isoDate(iso: string | Date): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function stripMarkdown(text: string): string {
  return String(text ?? "")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(text: string, max = 180): string {
  const clean = stripMarkdown(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at > 60 ? at : max)}…`;
}
