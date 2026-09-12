import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const keyFact = z.object({ label: z.string().default(""), value: z.string() });

/** YAML parses bare ISO timestamps as Date objects; normalise both forms to ISO strings. */
const isoString = z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString() : v));

const source = z.object({
  name: z.string(),
  nameEn: z.string().optional(),
  title: z.string(),
  url: z.string(),
  publishedAt: isoString.nullable().optional(),
  lang: z.string().optional(),
});

const image = z
  .object({
    url: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    alt: z.string(),
    credit: z.string().optional(),
    license: z.string().optional(),
    licenseUrl: z.string().optional(),
    pageUrl: z.string().optional(),
  })
  .nullable()
  .optional();

const chart = z
  .object({
    type: z.enum(["bar", "line"]),
    title: z.string().nullable().optional(),
    unit: z.string().default(""),
    source: z.string().default(""),
    categories: z.array(z.string()).min(3).max(12),
    series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })).min(1).max(3),
  })
  .nullable()
  .optional();

const table = z
  .object({
    title: z.string().nullable().optional(),
    source: z.string().default(""),
    columns: z.array(z.string()).min(2).max(5),
    rows: z.array(z.array(z.string())).min(2).max(12),
  })
  .nullable()
  .optional();

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/articles" }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().default(""),
    slug: z.string(),
    section: z.enum(["economy", "markets", "energy", "companies", "technology", "defense", "analysis", "explainers"]),
    kind: z.enum(["news", "explainer", "analysis", "paper"]).default("news"),
    publishedAt: isoString,
    updatedAt: isoString.optional(),
    lede: z.string().default(""),
    keyFacts: z.array(keyFact).default([]),
    whyItMatters: z.string().default(""),
    tags: z.array(z.string()).default([]),
    regions: z.array(z.string()).default([]),
    readingMinutes: z.number().default(3),
    chart,
    table,
    image,
    sources: z.array(source).default([]),
    models: z.record(z.string(), z.string().nullable()).optional(),
    quality: z
      .object({
        score: z.number().optional(),
        verdict: z.string().optional(),
        revised: z.boolean().optional(),
        importance: z.number().optional(),
        warnings: z.array(z.string()).optional(),
        criticSummary: z.string().optional(),
      })
      .optional(),
    ai: z.boolean().default(true),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };
