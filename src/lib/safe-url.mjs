/**
 * Which addresses the site prints as links and pictures (2026-10-23). A story's data comes from other websites through
 * the newsroom, and an address in another scheme («javascript:» above all) runs in the reader's browser when clicked,
 * so only a web page, a mail address or a place on the site itself is printed.
 */

/** As a browser reads an address: tabs, line breaks and control characters fall out before the scheme is read. */
export function safeAddress(url) {
  const u = String(url ?? "").replace(/[\u0000- \u007f]+/g, "");
  const colon = u.indexOf(":");
  if (colon === -1) return true;
  const end = u.search(/[/?#]/);
  if (end !== -1 && end < colon) return true;
  return /^(?:https?|mailto):/i.test(u);
}

/**
 * The address to print as a link, or undefined (the text then stands unlinked).
 * @param {string | null | undefined} url
 * @returns {string | undefined}
 */
export function safeHref(url) {
  const u = String(url ?? "").trim();
  return u && safeAddress(u) ? u : undefined;
}
