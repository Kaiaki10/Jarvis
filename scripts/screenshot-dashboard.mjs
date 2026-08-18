/**
 * Screenshots the running dashboard so a review pass can look at it rather than
 * infer it from source. Read-only: it browses the live service on :3000 and
 * never mutates anything.
 *
 *   node scripts/screenshot-dashboard.mjs [outputDir]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.JARVIS_WEB_URL ?? "http://localhost:3000";
const outDir = process.argv[2] ?? ".screenshots";

const PAGES = [
  { path: "/", name: "overview", waitFor: "text=Jarvis" },
  { path: "/sessions", name: "sessions", waitFor: "text=Runs" },
  { path: "/automations", name: "automations", waitFor: "text=Automations" },
  { path: "/tasks", name: "tasks", waitFor: "text=Tasks" },
  { path: "/connections", name: "connections", waitFor: "text=Connections" },
  { path: "/settings", name: "settings", waitFor: "text=Business context" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "narrow", width: 900, height: 1000 },
];

async function main() {
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const problems = [];

  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    });
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`[${viewport.name}] console: ${m.text()}`);
    });
    page.on("pageerror", (e) => problems.push(`[${viewport.name}] pageerror: ${e}`));

    for (const target of PAGES) {
      const url = `${BASE}${target.path}`;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
        await page.waitForSelector(target.waitFor, { timeout: 10000 });
        const file = `${outDir}/${viewport.name}-${target.name}.png`;
        await page.screenshot({ path: file, fullPage: true });
        console.log(`captured ${file}`);
      } catch (err) {
        problems.push(`[${viewport.name}] ${target.path} failed: ${err.message}`);
      }
    }
    await page.close();
  }

  await browser.close();

  if (problems.length) {
    console.log("\nPROBLEMS FOUND:");
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log("\nNo console errors or load failures.");
  }
}

main().catch((err) => {
  console.error("screenshot run failed:", err);
  process.exit(1);
});
