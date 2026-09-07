import sectionsData from "@data/sections.json";

export type SectionId = "economy" | "markets" | "energy" | "companies" | "technology" | "explainers";

export interface Section {
  id: SectionId;
  name: string;
  color: string;
  ink: string;
  description: string;
}

export const sections = sectionsData as Section[];
export const newsSections = sections.filter((s) => s.id !== "explainers");

export function getSection(id: string): Section {
  return sections.find((s) => s.id === id) ?? sections[0];
}

export function sectionHref(id: string): string {
  return `/${id}/`;
}
