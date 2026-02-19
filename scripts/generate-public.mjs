import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const siteDir = resolve(root, "site");
const publicDir = resolve(root, "public");
const appUrl = (process.env.APP_URL ?? "https://example.com").replace(/\/$/, "");

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await cp(siteDir, publicDir, { recursive: true });

const frameObject = {
  version: "next",
  imageUrl: `${appUrl}/og.svg`,
  button: {
    title: "Open Build & Arena",
    action: {
      type: "launch_frame",
      name: "Build & Arena",
      url: appUrl,
      splashBackgroundColor: "#0b1220"
    }
  }
};

const indexPath = resolve(publicDir, "index.html");
const currentIndex = await readFile(indexPath, "utf8");
const nextIndex = currentIndex.replace("__FC_FRAME__", escapeHtmlAttribute(JSON.stringify(frameObject)));
await writeFile(indexPath, nextIndex, "utf8");

await writeFile(resolve(publicDir, "og.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#0b1220"/><text x="50%" y="50%" fill="#ffffff" font-size="72" text-anchor="middle" dominant-baseline="middle">Build & Arena</text></svg>`, "utf8");

function escapeHtmlAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
