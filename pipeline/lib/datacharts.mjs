/**
 * Charts from official open data, for the pieces that explain (the owner, 2026-09-24: "explainers usually add
 * graphs etc should we make claude build these or get them online?"). Neither alone: Claude chooses WHAT to chart
 * from a fixed menu of indicators and countries; code fetches the figures from the IMF (World Economic Outlook,
 * DataMapper API) or the World Bank (World Development Indicators), with no key; the site's own chart draws them.
 * No figure ever comes from a model's memory, and a chart that cannot be filled is not drawn.
 */
import { chat } from "./llm.mjs";
import { USER_AGENT, fetchWithTimeout } from "./util.mjs";

const IMF = "صندوق النقد الدولي، آفاق الاقتصاد العالمي";
const WB = "البنك الدولي، مؤشرات التنمية العالمية";

/** The menu: what can be charted, where it comes from, how the site names it. */
export const INDICATORS = {
  inflation: { source: "imf", code: "PCPIPCH", title: "معدل التضخم السنوي", unit: "%", credit: IMF, about: "annual consumer-price inflation, the rate readers know" },
  growth: { source: "imf", code: "NGDP_RPCH", title: "نمو الناتج المحلي الإجمالي الحقيقي", unit: "%", credit: IMF, about: "real GDP growth" },
  debt: { source: "imf", code: "GGXWDG_NGDP", title: "الدين الحكومي العام", unit: "% من الناتج المحلي", credit: IMF, about: "general government gross debt, % of GDP" },
  fiscal: { source: "imf", code: "GGXCNL_NGDP", title: "رصيد الموازنة العامة", unit: "% من الناتج المحلي", credit: IMF, about: "general government net lending (+) or borrowing (-), % of GDP" },
  current: { source: "imf", code: "BCA_NGDPD", title: "رصيد الحساب الجاري", unit: "% من الناتج المحلي", credit: IMF, about: "current account balance, % of GDP" },
  unemployment: { source: "imf", code: "LUR", title: "معدل البطالة", unit: "%", credit: IMF, about: "unemployment rate (few Gulf countries report it)" },
  realrate: { source: "wb", code: "FR.INR.RINR", title: "سعر الفائدة الحقيقي", unit: "%", credit: WB, about: "real lending interest rate (lending rate less GDP deflator)" },
  lending: { source: "wb", code: "FR.INR.LEND", title: "سعر فائدة الإقراض", unit: "%", credit: WB, about: "bank lending interest rate" },
  marketcap: { source: "wb", code: "CM.MKT.LCAP.GD.ZS", title: "القيمة السوقية للشركات المدرجة", unit: "% من الناتج المحلي", credit: WB, about: "market capitalisation of listed companies, % of GDP" },
  trade: { source: "wb", code: "NE.TRD.GNFS.ZS", title: "التجارة الخارجية", unit: "% من الناتج المحلي", credit: WB, about: "exports plus imports of goods and services, % of GDP" },
  fuel: { source: "wb", code: "TX.VAL.FUEL.ZS.UN", title: "صادرات الوقود", unit: "% من صادرات السلع", credit: WB, about: "fuel exports, % of merchandise exports" },
};

export const COUNTRIES = {
  EGY: "مصر", SAU: "السعودية", ARE: "الإمارات", QAT: "قطر", KWT: "الكويت", BHR: "البحرين", OMN: "عُمان", IRQ: "العراق",
  JOR: "الأردن", LBN: "لبنان", MAR: "المغرب", DZA: "الجزائر", TUN: "تونس", LBY: "ليبيا", TUR: "تركيا", IRN: "إيران",
  USA: "الولايات المتحدة", CHN: "الصين", JPN: "اليابان", IND: "الهند", DEU: "ألمانيا", GBR: "بريطانيا", FRA: "فرنسا",
};

const lastFull = () => new Date().getUTCFullYear() - 1;

/** One more try after a slow or failed answer: the World Bank's API timed out once in thirteen (2026-09-24). */
async function getJson(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, { headers: { "user-agent": USER_AGENT } }, 45000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/** { ISO3: { year: value } } for the countries asked, years inclusive. */
async function fetchValues(ind, countries, from, to) {
  const out = {};
  if (ind.source === "imf") {
    const data = await getJson(`https://www.imf.org/external/datamapper/api/v1/${ind.code}`);
    const all = data?.values?.[ind.code] ?? {};
    for (const c of countries) {
      out[c] = {};
      for (const [year, value] of Object.entries(all[c] ?? {})) if (+year >= from && +year <= to && Number.isFinite(+value)) out[c][year] = +value;
    }
  } else {
    const data = await getJson(`https://api.worldbank.org/v2/country/${countries.join(";")}/indicator/${ind.code}?format=json&date=${from}:${to}&per_page=500`);
    for (const c of countries) out[c] = {};
    for (const row of data?.[1] ?? []) if (row?.value != null && out[row.countryiso3code]) out[row.countryiso3code][row.date] = +row.value;
  }
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;
const joinAr = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join("، ")} و${names[names.length - 1]}`);

/**
 * Builds a chart from a spec: { indicator, countries: [ISO3], shape: "trend" | "compare", from?, to? }.
 * trend: one to three countries over the years (a line); compare: three to eight countries in one year (bars).
 * Returns null when the figures are not there (a year missing for a country, fewer than three points).
 */
export async function buildDataChart(spec) {
  const ind = INDICATORS[spec?.indicator];
  if (!ind) return null;
  const countries = [...new Set((spec.countries ?? []).filter((c) => COUNTRIES[c]))];
  const to = Math.min(Number(spec.to) || lastFull(), lastFull());
  if (spec.shape === "compare") {
    const asked = countries.slice(0, 8);
    if (asked.length < 3) return null;
    const values = await fetchValues(ind, asked, to - 3, to);
    // The latest year at least three of the countries have; a country without it leaves the chart, so the bars
    // compare like with like (the World Bank has no real rate for the Gulf states).
    let year = to;
    while (year >= to - 3 && asked.filter((c) => values[c]?.[year] != null).length < 3) year -= 1;
    if (year < to - 3) return null;
    const pool = asked.filter((c) => values[c]?.[year] != null);
    return {
      type: "bar",
      title: `${ind.title} في ${year}`,
      unit: ind.unit,
      source: ind.credit,
      categories: pool.map((c) => COUNTRIES[c]),
      series: [{ name: `${ind.title} (${year})`, values: pool.map((c) => round1(values[c][year])) }],
    };
  }
  const asked = countries.slice(0, 3);
  if (!asked.length) return null;
  const from = Math.max(Number(spec.from) || to - 7, to - 11);
  const values = await fetchValues(ind, asked, from, to);
  // A country with fewer than three years of the series leaves the chart rather than taking it down.
  const pool = asked.filter((c) => Object.keys(values[c] ?? {}).length >= 3);
  if (!pool.length) return null;
  const years = [];
  for (let y = from; y <= to; y += 1) if (pool.every((c) => values[c]?.[y] != null)) years.push(String(y));
  if (years.length < 3) return null;
  return {
    type: "line",
    title: `${ind.title} في ${joinAr(pool.map((c) => COUNTRIES[c]))}`,
    unit: ind.unit,
    source: ind.credit,
    categories: years,
    series: pool.map((c) => ({ name: COUNTRIES[c], values: years.map((y) => round1(values[c][y])) })),
  };
}

/**
 * Asks Claude which chart, if any, a piece should carry, from the menu only, and builds it. Returns
 * { chart, spec } or { chart: null } when nothing on the menu serves the piece.
 */
export async function pickDataChart({ draft, log = () => {} }) {
  const menu = Object.entries(INDICATORS).map(([id, ind]) => `- ${id}: ${ind.about} (${ind.source === "imf" ? "IMF World Economic Outlook" : "World Bank"})`).join("\n");
  const { data } = await chat({
    role: "editor",
    system: "You are the graphics editor of خازندار, an Arabic economics news website. You choose one chart of official data for a piece, or none. Reply with one JSON object only.",
    user: `THE PIECE
Headline: ${draft.title}
Dek: ${draft.subtitle ?? ""}
Lede: ${draft.lede ?? ""}
Body (start): ${String(draft.body ?? "").slice(0, 2500)}

INDICATORS YOU MAY CHART (official annual data, fetched by code, up to ${lastFull()})
${menu}

COUNTRIES (ISO3): ${Object.entries(COUNTRIES).map(([k, v]) => `${k} ${v}`).join(", ")}

Choose the one chart that shows a reader what this piece explains, with real figures from the region the site serves: Arab economies first, and a world economy beside them only when the piece is about it. "trend": one to three countries over about eight years (a line); "compare": three to eight countries in the latest year (bars). If no indicator on the list shows the piece's subject (a pipeline, a refining margin), answer {"chart": null}: a chart of something else is worse than none.
Answer: {"chart": null} or {"chart": {"indicator": "<id>", "shape": "trend" | "compare", "countries": ["ISO3", ...], "why": "<one short English sentence>"}}`,
    temperature: 0.1,
    maxTokens: 600,
    timeoutMs: 120000,
    log,
    validate: (d) => {
      if (!d || typeof d !== "object" || !("chart" in d)) throw new Error("no chart field");
      if (d.chart && !INDICATORS[d.chart.indicator]) throw new Error(`unknown indicator ${d.chart.indicator}`);
    },
  });
  if (!data.chart) {
    log("data chart: none fits this piece");
    return { chart: null };
  }
  try {
    const chart = await buildDataChart(data.chart);
    log(chart ? `data chart: ${data.chart.indicator} ${data.chart.shape} ${data.chart.countries.join(",")} (${data.chart.why ?? ""})` : `data chart: the figures for ${data.chart.indicator} are not all there; none drawn`);
    return { chart, spec: data.chart };
  } catch (error) {
    log(`data chart: fetch failed (${error.message}); none drawn`);
    return { chart: null };
  }
}
