import sectionsData from "@data/sections.json";

export type SectionId = "economy" | "markets" | "energy" | "companies" | "technology" | "defense" | "analysis" | "explainers";

export interface Section {
  id: SectionId;
  name: string;
  description: string;
}

export const sections = sectionsData as Section[];
/** Sections the newsroom files news into. Analyses and explainers are hubs for their own kinds. */
export const HUB_SECTIONS = new Set(["analysis", "explainers"]);
export const newsSections = sections.filter((s) => !HUB_SECTIONS.has(s.id));

/** The label a story carries in a meta line: its kind when the kind is a hub, else its section. */
export function kindLabel(kind: string, section: string): string {
  if (kind === "explainer") return "شرح مبسّط";
  if (kind === "analysis") return "تحليل";
  if (kind === "paper") return "قراءة في ورقة بحثية";
  if (kind === "weekly") return "حصاد الأسبوع";
  if (kind === "feature") return "في العمق";
  return getSection(section).name;
}

export function getSection(id: string): Section {
  return sections.find((s) => s.id === id) ?? sections[0];
}

export function sectionHref(id: string): string {
  return `/${id}/`;
}

/** "المزيد من …" and "كل …" as a reader says them: تحليلات is not a definite noun, so the hubs
 *  cannot take the pattern the news sections take («المزيد من تحليلات» read as a slip). */
const HUB_PHRASES: Record<string, { more: string; all: string }> = {
  analysis: { more: "المزيد من التحليلات", all: "كل التحليلات" },
  explainers: { more: "المزيد من مدخل إلى الاقتصاد", all: "كل مواد مدخل إلى الاقتصاد" },
};
export function moreLabel(id: string): string {
  return HUB_PHRASES[id]?.more ?? `المزيد من ${getSection(id).name}`;
}
export function allLabel(id: string): string {
  return HUB_PHRASES[id]?.all ?? `كل أخبار ${getSection(id).name}`;
}
