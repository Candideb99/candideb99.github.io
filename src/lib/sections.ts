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
  if (kind === "explainer") return "شرح";
  if (kind === "analysis") return "تحليل";
  return getSection(section).name;
}

export function getSection(id: string): Section {
  return sections.find((s) => s.id === id) ?? sections[0];
}

export function sectionHref(id: string): string {
  return `/${id}/`;
}
