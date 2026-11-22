/**
 * «من زمن الفكرة»: a drawing of an idea's own time printed with its «الفكر الاقتصادي» piece, a cartoon or an engraving
 * from the debate the idea answered (the owner, 2026-11-22, asked whether the site should run caricatures and whether
 * any current ones are free to use; they are not: the free ones are old, a few US politicians' caricaturists, or
 * NonCommercial, which an advertised site cannot run. He took "public-domain cartoons from the old tariff and gold
 * fights" for the section: "Yes, try it").
 *
 * Chosen and looked at by hand, never by a model or a search at run time: a machine picking old cartoons would meet
 * the period's ethnic caricatures, and the caption says what the drawing shows, which a model reading a file name
 * cannot hold. So each one is a catalogue record (pipeline/ideas.json `exhibit`), its cropped copy kept on the site
 * (public/photos/exhibits/, from Commons' copy of the Library of Congress's or the Encyclopédie's scan), and the page
 * reads it by the piece's idea (src/pages/articles/[slug].astro): a caption mended here mends every page, and a piece
 * already published gains its drawing when its idea gets one, nothing in the story touched.
 *
 * It is no photograph: the section prints none (photoFree(), photo-key.mjs, the owner's ruling of 2026-11-20); it
 * never becomes a piece's picture, its card, its search thumbnail or its sharing preview, only a document inside the
 * text, beside its figures and worked example.
 *
 * Public domain both in the United States and where copyright runs the author's life and 70 years, read from the
 * record, never assumed from Commons' tag: published 95 years before this year began at the latest (US, 1930 and
 * earlier in 2026), and its artist dead 70 full years (Udo Keppler, d. 1956, waits for 2027), or, with no artist
 * named, published 120 years ago at least.
 */
import catalogue from "../ideas.json" with { type: "json" };

export const PD_PUBLISHED_YEARS = 96;
export const PD_LIFE_YEARS = 71;
export const PD_ANONYMOUS_YEARS = 120;

/** Whether a record's drawing is free in the US and in life-plus-70 countries in `year`. */
export function inPublicDomain(exhibit, year = new Date().getUTCFullYear()) {
  const published = exhibit?.published;
  if (!Number.isInteger(published) || published > year - PD_PUBLISHED_YEARS) return false;
  if (exhibit.artistDied != null) return Number.isInteger(exhibit.artistDied) && exhibit.artistDied <= year - PD_LIFE_YEARS;
  return published <= year - PD_ANONYMOUS_YEARS;
}

/** A record the page can print: kept on the site, free, captioned, credited and linked to its source. */
export function printable(exhibit, year) {
  return Boolean(
    exhibit &&
      /^\/photos\/exhibits\/[a-z0-9-]+\.jpg$/.test(String(exhibit.file ?? "")) &&
      Number.isInteger(exhibit.width) && exhibit.width > 0 &&
      Number.isInteger(exhibit.height) && exhibit.height > 0 &&
      String(exhibit.alt ?? "").trim() &&
      String(exhibit.caption ?? "").trim() &&
      /ملكية عامة/.test(String(exhibit.credit ?? "")) &&
      /^https:\/\/commons\.wikimedia\.org\/wiki\/File/.test(String(exhibit.source ?? "")) &&
      inPublicDomain(exhibit, year),
  );
}

/** The drawing an idea's piece prints, or undefined: none recorded, or one that fails a test above. */
export function exhibitOf(ideaId, { ideas = catalogue.ideas, year } = {}) {
  if (!ideaId) return undefined;
  const exhibit = ideas.find((i) => i.id === ideaId)?.exhibit;
  return printable(exhibit, year) ? exhibit : undefined;
}
