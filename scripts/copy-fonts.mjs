// Copies the self-hosted font files from node_modules into public/fonts before dev/build.
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "public", "fonts");
const files = [
  ["@fontsource/amiri/files/amiri-arabic-400-normal.woff2", "amiri-arabic-400.woff2"],
  ["@fontsource/amiri/files/amiri-arabic-700-normal.woff2", "amiri-arabic-700.woff2"],
  ["@fontsource/amiri/files/amiri-latin-400-normal.woff2", "amiri-latin-400.woff2"],
  ["@fontsource/amiri/files/amiri-latin-700-normal.woff2", "amiri-latin-700.woff2"],
  ["@fontsource-variable/noto-naskh-arabic/files/noto-naskh-arabic-arabic-wght-normal.woff2", "naskh-arabic.woff2"],
  ["@fontsource-variable/noto-naskh-arabic/files/noto-naskh-arabic-latin-wght-normal.woff2", "naskh-latin.woff2"],
  ["@fontsource/tajawal/files/tajawal-arabic-400-normal.woff2", "tajawal-arabic-400.woff2"],
  ["@fontsource/tajawal/files/tajawal-arabic-500-normal.woff2", "tajawal-arabic-500.woff2"],
  ["@fontsource/tajawal/files/tajawal-arabic-700-normal.woff2", "tajawal-arabic-700.woff2"],
  ["@fontsource/tajawal/files/tajawal-arabic-800-normal.woff2", "tajawal-arabic-800.woff2"],
  ["@fontsource/tajawal/files/tajawal-latin-400-normal.woff2", "tajawal-latin-400.woff2"],
  ["@fontsource/tajawal/files/tajawal-latin-500-normal.woff2", "tajawal-latin-500.woff2"],
  ["@fontsource/tajawal/files/tajawal-latin-700-normal.woff2", "tajawal-latin-700.woff2"],
  ["@fontsource/tajawal/files/tajawal-latin-800-normal.woff2", "tajawal-latin-800.woff2"],
];

await mkdir(out, { recursive: true });
for (const [source, target] of files) {
  await copyFile(path.join(root, "node_modules", source), path.join(out, target));
}
console.log(`fonts: copied ${files.length} files to public/fonts`);
