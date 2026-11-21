import sectionsData from "@data/sections.json";

export type SectionId = "economy" | "markets" | "energy" | "companies" | "technology" | "analysis" | "explainers";

export interface Section {
  id: SectionId;
  name: string;
  description: string;
}

export const sections = sectionsData as Section[];
/** Sections the newsroom files news into. Analyses and explainers are hubs for their own kinds. */
export const HUB_SECTIONS = new Set(["analysis", "explainers"]);
export const newsSections = sections.filter((s) => !HUB_SECTIONS.has(s.id));

/**
 * The kinds of «مدخل إلى الاقتصاد», in the order its page sets them out: each has its own page
 * (src/pages/explainers/kind/[kind].astro), its block on the section's page (src/pages/explainers/index.astro, with the
 * `take` newest) and its line in the section bar's panel. One list, read by all three.
 */
export const EXPLAINER_KINDS = [
  { id: "concepts", kind: "explainer", name: "شروح مبسّطة", all: "كل الشروح المبسّطة", take: 6, intro: "مفاهيم الاقتصاد من أولها، مشروحة بأمثلة وأرقام." },
  // «الفكر الاقتصادي», not «أفكار اقتصادية», which the owner read as business or project ideas (2026-11-20).
  { id: "thought", kind: "idea", name: "الفكر الاقتصادي", all: "كل حلقات الفكر الاقتصادي", take: 3, intro: "كل أسبوع فكرة من أفكار علم الاقتصاد ومن قالها: كيف تعمل، وما الذي غيّرته، وأين يختلف الاقتصاديون فيها، مشروحة بخبر من أخبار الأسبوع." },
  { id: "papers", kind: "paper", name: "قراءات في أوراق بحثية", all: "كل القراءات", take: 3, intro: "أوراق بحثية متاحة مجاناً، مشروحة بالعربية الواضحة." },
] as const;

/** The label a story carries in a meta line: its kind when the kind is a hub, else its section. */
export function kindLabel(kind: string, section: string): string {
  if (kind === "explainer") return "شرح مبسّط";
  if (kind === "idea") return "الفكر الاقتصادي";
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
