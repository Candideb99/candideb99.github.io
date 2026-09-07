import sharp from "sharp";
import { writeFile } from "node:fs/promises";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#e5a52b"/><circle cx="820" cy="250" r="190" fill="#171512"/><path d="M0 630V430a250 250 0 0 1 500 0v200z" fill="#fbfaf6"/><rect x="560" y="520" width="240" height="26" fill="#171512"/><circle cx="1040" cy="520" r="34" fill="#fbfaf6"/><defs><pattern id="h" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="2.2" fill="#171512" fill-opacity="0.25"/></pattern></defs><rect x="0" y="0" width="520" height="300" fill="url(#h)"/></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile("public/og-default.png", png);
console.log("og-default.png written", png.length, "bytes");
