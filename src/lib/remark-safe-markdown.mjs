/**
 * A story's body is the newsroom's writing from what other websites published, so it is printed as text and never as
 * markup (2026-10-23): raw HTML in a body is dropped, and so is a link or picture whose address is not a web page or a
 * mail address (lib/safe-url.mjs), a link keeping its words. Astro passes raw HTML through by default, so a source
 * that talked the writer into a <script> would have run in every reader's browser. No published body used either
 * (checked that day over all 335): nothing a reader sees changes.
 */
import { safeAddress } from "./safe-url.mjs";

export default function remarkSafeMarkdown() {
  return (tree) => {
    const clean = (node) => {
      if (!Array.isArray(node.children)) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "html") return [];
        if ((child.type === "image" || child.type === "definition") && !safeAddress(child.url)) return [];
        clean(child);
        return child.type === "link" && !safeAddress(child.url) ? child.children : [child];
      });
    };
    clean(tree);
  };
}
