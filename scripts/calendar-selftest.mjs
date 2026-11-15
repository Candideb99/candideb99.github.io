#!/usr/bin/env node
/**
 * The economic calendar's readers on the institutions' own markup, captured on 2026-11-15 and cut to the rows each
 * case needs, and the rules of the merged file. Offline. The first two cases fail on the calendar as it stood before
 * that day: a vote on paper was stored as a rate decision, and a day's events ran in the order of the sources.
 */
import assert from "node:assert/strict";
import { SOURCES, buildCalendar, monthIndex, nbsCalendars, parseBea, parseBoe, parseBoj, parseCbrt, parseEcb, parseEurostat, parseFed, parseFedMinutes, parseFred, parseNbs, readSource, utcTime } from "../pipeline/lib/calendar.mjs";

const dates = (events) => events.map((e) => e.date);
const source = (id) => SOURCES.find((s) => s.id === id);

// 1. The Fed: a meeting's last day; a meeting across two months; and a vote on paper is no decision. The page lists
//    «22 (notation vote)» under August 2025, which the old reader stored as a decision of 22 August.
const fedRow = (month, days) => `<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>${month}</strong></div> <div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-2">${days}</div></div>`;
const fed = parseFed(`<main><h4><a id="x">2025 FOMC Meetings</a></h4>${fedRow("July", "29-30")}${fedRow("August", "22 (notation vote)")}${fedRow("September", "16-17*")}<h4>2027 FOMC Meetings</h4>${fedRow("Jan/Feb", "31-1")}${fedRow("March", "(unscheduled)")}</main>`);
assert.deepEqual(dates(fed), ["2025-07-30", "2025-09-17", "2027-02-01"], "a notation vote or an unscheduled call is not a scheduled decision");
assert.equal(fed[0].time, "18:00 UTC", "14:00 in New York in summer");
assert.equal(fed[0].kind, "rates");
assert.equal(fed[0].title, "قرار الفائدة: الاحتياطي الفيدرالي الأمريكي");

// 2. A day's events run by their hour, whatever the order of the sources: the Bank of England's noon decision stood
//    under the ECB's 14:15 one. An event without an hour leads its day.
const day = "2026-12-17";
const stamp = Date.parse("2026-11-15T12:00:00Z");
const built = buildCalendar(
  { updatedAt: "2026-11-01T00:00:00.000Z", events: [{ date: day, title: "قرار الفائدة: بنك إنجلترا", kind: "rates", time: "12:00 UTC", source: "boe" }] },
  new Map([
    ["ecb", { events: [{ date: day, title: "قرار الفائدة: البنك المركزي الأوروبي", kind: "rates", time: "13:15 UTC" }] }],
    ["boj", { events: [{ date: day, title: "قرار الفائدة: بنك اليابان", kind: "rates" }, { date: "2021-01-21", title: "قرار الفائدة: بنك اليابان", kind: "rates" }] }],
  ]),
  stamp,
);
assert.deepEqual(built.events.map((e) => e.source), ["boj", "boe", "ecb"], "by hour within the day");
assert.ok(!built.events.some((e) => e.date < "2026-11-14"), "days gone by leave the file");
// A source that failed keeps its stored events and the day it was last read; one that answered is stamped now.
const listed = Object.fromEntries(built.sources.map((s) => [s.id, s]));
assert.equal(listed.boe.readAt, "2026-11-01T00:00:00.000Z");
assert.equal(listed.boe.until, day);
assert.equal(listed.ecb.readAt, new Date(stamp).toISOString());
assert.equal(listed.fed.until, null, "a source with nothing ahead says so");
assert.equal(built.sources.length, SOURCES.length);
const later = buildCalendar(built, new Map(), stamp + 5 * 86400000);
assert.equal(later.updatedAt, built.updatedAt, "a run that read nothing keeps the file's stamp");
assert.equal(later.events.length, 3);
assert.equal(Object.fromEntries(later.sources.map((s) => [s.id, s])).ecb.readAt, listed.ecb.readAt);

// 3. The ECB: the day with the press conference; a non-monetary meeting is not one.
const ecb = parseEcb(`<dl><dt>16/12/2026</dt><dd>Governing Council of the ECB: monetary policy meeting in Frankfurt (Day 1)</dd><dt>17/12/2026</dt><dd>Governing Council of the ECB: monetary policy meeting in Frankfurt (Day 2), followed by press conference</dd><dt>20/01/2027</dt><dd>Governing Council of the ECB: non-monetary policy meeting</dd></dl>`);
assert.deepEqual(dates(ecb), ["2026-12-17"]);
assert.equal(ecb[0].time, "13:15 UTC");

// 4. The Bank of England.
const boe = parseBoe(`<h2>2026 confirmed dates</h2><p>Thursday 17 December</p><h2>2027 provisional dates</h2><p>Thursday 4 February</p><p>Thursday 29 April</p><h2>Current Bank Rate</h2><p>Thursday 1 January</p>`);
assert.deepEqual(dates(boe), ["2026-12-17", "2027-02-04", "2027-04-29"]);
assert.equal(boe[2].time, "11:00 UTC", "noon in London in summer");

// 5. The Bank of Japan: the meeting's last day, from the table's first column only, across two months, no hour.
const boj = parseBoj(`<table><caption>Table : 2026</caption><thead><tr><th>Date of MPM</th><th>Outlook Report</th></tr></thead><tbody>
  <tr> <td>Oct. 29 (Thurs.), 30 (Fri.) <a href="k.pdf">[PDF 172KB]</a></td> <td>Oct. 30 (Fri.)</td> <td>Nov. 10 (Tues.)</td> <td>Dec. 23 (Wed.)</td> </tr>
  <tr> <td>Dec. 17 (Thurs.), 18 (Fri.)</td> <td>-</td> <td>Dec. 28 (Mon.)</td> <td>Jan. 27 (Wed.), 2027</td> </tr></tbody></table>
  <table><caption>Table : 2027</caption><tbody><tr> <td>Apr. 30 (Fri.), May 1 (Sat.)</td> <td>-</td> </tr></tbody></table>`);
assert.deepEqual(dates(boj), ["2026-10-30", "2026-12-18", "2027-05-01"]);
assert.equal(boj[0].time, undefined, "the Bank gives no hour");

// 6. Türkiye: the decision column only, and only while the table still opens with it.
const cbrtTable = (first) => `<table dir="ltr" id="midTable"> <thead> <tr> <td> <h3>${first}</h3> </td> <td> <h3>Summary of The MPC Meeting</h3> </td> <td> <h3>Inflation Report</h3> </td> </tr> </thead> <tbody> <tr> <td>December 10, 2026</td> <td>December 17, 2026</td> <td>&nbsp;</td> </tr> <tr> <td>January 21, 2027</td> <td>January 28, 2027</td> <td>February 11, 2027</td> </tr> </tbody></table>`;
assert.deepEqual(dates(parseCbrt(cbrtTable("Monetary Policy Committee Decision"))), ["2026-12-10", "2027-01-21"]);
assert.deepEqual(parseCbrt(cbrtTable("Summary of The MPC Meeting")), [], "a table whose first column changed is not read");

// 7. BEA: GDP by its estimate and the release that carries the PCE price index; never a county's or a state's GDP;
//    and a list that runs into the next year under this year's head stops there.
const beaRow = (day, hour, title) => `<tr class="scheduled-releases-type-press"> <td class="scheduled-date no-wrap"><div class="release-date">${day}</div> <small class="text-muted">${hour}</small> </td> <td><div class="icon-letter"><span class="caps">N</span><span class="tail">ews</span></div> </td> <td class="release-title views-field">${title} </td> </tr>`;
const bea = parseBea(`<table id="release-schedule-table"><thead><tr><th id="a" scope="col">Year 2026</th></tr></thead><tbody>
  ${beaRow("November 25", "8:30 AM", "GDP (Second Estimate) and Corporate Profits, 3rd Quarter 2026")}
  ${beaRow("November 25", "8:30 AM", "Personal Income and Outlays, October 2026")}
  ${beaRow("December 2", "8:30 AM", "GDP by County and Personal Income by County, 2025")}
  ${beaRow("December 23", "8:30 AM", "Gross Domestic Product by State and Personal Income by State, 3rd Quarter 2026")}
  ${beaRow("January 28", "8:30 AM", "GDP (Advance Estimate), 4th Quarter and Year 2026")}</tbody></table>`);
assert.deepEqual(bea.map((e) => `${e.date} ${e.title}`), ["2026-11-25 الناتج المحلي الأمريكي للربع الثالث (التقدير الثاني)", "2026-11-25 مؤشر نفقات الاستهلاك الشخصي الأمريكي عن أكتوبر"]);
assert.equal(bea[0].time, "13:30 UTC");
assert.equal(parseBea(`<th scope="col">Year 2025</th>${beaRow("January 22", "10:00 AM", "Personal Income and Outlays, October and November 2025")}`)[0].title, "مؤشر نفقات الاستهلاك الشخصي الأمريكي عن أكتوبر ونوفمبر");

// 8. Eurostat: the two flash estimates, at the hour it gives, read as Luxembourg's; nothing else of its 180 releases.
const euro = parseEurostat([
  { start: "2026-11-18T11:00Z", title: "Inflation (HICP)", period: "October 2026" },
  { start: "2026-12-01T11:00Z", title: "Flash estimate inflation euro area", period: "November 2026" },
  { start: "2027-01-29T11:00Z", title: "Preliminary flash estimate GDP - EU and euro area", period: "Q4/2026" },
  { start: "2027-02-15T11:00Z", title: "Flash estimate GDP and employment - EU and euro area", period: "Q4/2026" },
  { start: "2027-07-01T11:00Z", title: "Flash estimate inflation euro area", period: "June 2027" },
]);
assert.deepEqual(euro.map((e) => `${e.date} ${e.time} ${e.title}`), ["2026-12-01 10:00 UTC التضخم في منطقة اليورو عن نوفمبر (تقدير أولي)", "2027-01-29 10:00 UTC الناتج المحلي لمنطقة اليورو للربع الرابع (تقدير أولي)", "2027-07-01 09:00 UTC التضخم في منطقة اليورو عن يونيو (تقدير أولي)"]);

// 9. The Fed's minutes, with the meeting they report.
const minutes = parseFedMinutes(JSON.stringify({ events: [{ description: "&lt;p&gt;Meeting of October 27-28&lt;/p&gt;", title: "FOMC Minutes", time: "2:00 p.m.", month: "2026-11", days: "18", type: "FOMC" }, { title: "FOMC Meeting", time: "2:00 p.m.", month: "2026-12", days: "9", type: "FOMC" }, { title: "FOMC Minutes", month: "2026-12", days: "30, 31", type: "FOMC" }] }));
assert.equal(minutes.length, 1);
assert.deepEqual([minutes[0].date, minutes[0].time, minutes[0].kind, minutes[0].note], ["2026-11-18", "19:00 UTC", "minutes", "عن اجتماع يومي 27 و28 أكتوبر"]);

// 10. China: a cell a month, «……» for none, the hour of the row under it; GDP in a quarter's first month.
const cell = (v, span = "") => `<td${span}> <p><span>${v}</span></p></td>`;
const nbsRow = (n, label, cells, hours) => `<tr>${cell(n, ' rowspan="2"')}${cell(label, ' rowspan="2"')}${cells.map((c) => cell(c, c === "……" ? ' rowspan="2"' : "")).join("")}</tr> <tr>${hours.map((h) => cell(h)).join("")}</tr>`;
const nbs = parseNbs(
  `<table>${nbsRow(1, "National Economic Performance", ["19/Mon", "……", "16/Mon", "16/Thu", "18/Mon", "16/Tue", "15/Wed", "17/Mon", "15/Tue", "19/Mon", "16/Mon", "15/Tue"], Array(11).fill("10:00"))}
   ${nbsRow(5, "Monthly Report on Consumer Price Index (CPI)", ["9/Fri", "11/Wed", "9/Mon", "10/Fri", "11/Mon", "10/Wed", "9/Thu", "9/Sun", "9/Wed", "14/Wed", "9/Mon", "9/Wed"], Array(12).fill("9:30"))}</table>`,
  2026,
);
assert.equal(nbs.length, 23);
assert.deepEqual([nbs[0].date, nbs[0].time, nbs[0].title], ["2026-01-19", "02:00 UTC", "الناتج المحلي الصيني للربع الرابع وبيانات النشاط الشهرية"]);
assert.equal(nbs[1].date, "2026-03-16", "February holds no release");
assert.equal(nbs.find((e) => e.date === "2026-10-19").title, "الناتج المحلي الصيني للربع الثالث وبيانات النشاط الشهرية");
assert.deepEqual([nbs.at(-1).date, nbs.at(-1).time, nbs.at(-1).title], ["2026-12-09", "01:30 UTC", "التضخم في الصين عن نوفمبر"]);
assert.equal(nbs.find((e) => e.date === "2026-01-09").title, "التضخم في الصين عن ديسمبر");
assert.deepEqual(parseNbs("<table><tr><td>1</td><td>National Economic Performance</td><td>19/Mon</td></tr></table>", 2026), [], "a row that is not twelve months is not read");
assert.deepEqual(
  nbsCalendars(`<a href="./202512/t20251226_1962154.html">1.Regular Press Release Calendar of NBS in 2026</a><a href="./202412/t20241231_1.html">2.Regular Press Release Calendar of NBS in 2025</a>`, "https://www.stats.gov.cn/english/PressRelease/ReleaseCalendar/", 2026),
  [{ year: 2026, url: "https://www.stats.gov.cn/english/PressRelease/ReleaseCalendar/202512/t20251226_1962154.html" }],
);

// 11. BLS through FRED when bls.gov refuses: the month before the release, and none named in a month holding two.
const cpi = source("bls-cpi");
const fred = parseFred([{ url: "https://fred.example/2026", html: "<td>Thursday December 10, 2026</td><td>Tuesday January 12, 2027</td><td>Friday January 29, 2027</td>" }], cpi);
assert.deepEqual(fred.map((e) => e.title), ["التضخم الأمريكي (مؤشر أسعار المستهلكين) عن نوفمبر", "التضخم الأمريكي (مؤشر أسعار المستهلكين)", "التضخم الأمريكي (مؤشر أسعار المستهلكين)"]);
const viaFred = await readSource(cpi, async (url) => {
  if (url.includes("bls.gov")) throw new Error("HTTP 403");
  return url.endsWith(String(new Date().getUTCFullYear())) ? "<td>Thursday December 10, 2026</td>" : "";
});
assert.equal(viaFred.events.length, 1);
assert.match(viaFred.via.url, /fred\.stlouisfed\.org/);
const viaListed = buildCalendar({ events: [] }, new Map([["bls-cpi", viaFred]]), stamp).sources.find((s) => s.id === "bls-cpi");
assert.match(viaListed.url, /fred\.stlouisfed\.org/, "the page links the copy that was read");
assert.ok(viaListed.via);
await assert.rejects(readSource(source("boj"), async () => "<html>moved</html>"), /no events parsed/, "a page that parses to nothing is a failed reading, so the stored events stay");

// 12. Small things the readers stand on.
assert.equal(monthIndex(""), -1, "an empty name is no month (it had read as January)");
assert.equal(monthIndex("Sept."), 8);
assert.equal(utcTime("2026-12-09", "14:00", "America/New_York"), "19:00 UTC");

console.log("The calendar: eleven readers on the institutions' markup, order by hour, pruning, stored fallbacks and source records pass.");
