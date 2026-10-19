/**
 * Load the built app in a headless browser and report what it says.
 *
 * `npm run build` succeeding proves the modules resolve; it does not prove the
 * scene mounts. This serves dist/ and opens it, then prints whether a canvas
 * exists, any page or console errors, and the text on screen — which is the
 * cheapest possible answer to "does it still come up".
 *
 *   npm run build && node scratch/load.mjs
 *
 * It is NOT a substitute for watching the game. Every visual fault this
 * project has had arrived as a bug report, never as a failing check.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("../dist/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const p = join(root, req.url === "/" ? "index.html" : req.url.split("?")[0]);
    const body = await readFile(p);
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForTimeout(4000);

console.log("canvas:", !!(await page.$("canvas")));
console.log("errors:", errors.length ? errors.slice(0, 5) : "none");
console.log("text:", (await page.evaluate(() => document.body.innerText)).slice(0, 400));
await browser.close();
server.close();
