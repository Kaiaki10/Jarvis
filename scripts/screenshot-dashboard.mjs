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
  { path: "/operate", name: "operate", waitFor: "text=The operating loop" },
  { path: "/missions", name: "missions", waitFor: "text=Missions" },
  { path: "/campaigns", name: "campaigns", waitFor: "text=Campaigns" },
  { path: "/paid-growth", name: "paid-growth", waitFor: "text=Paid growth control" },
  { path: "/sessions", name: "sessions", waitFor: "text=Runs" },
  { path: "/automations", name: "automations", waitFor: "text=Automations" },
  { path: "/customers", name: "customers", waitFor: "text=Unified queue" },
  { path: "/memory", name: "memory", waitFor: "text=What Jarvis remembers" },
  { path: "/evolution", name: "evolution", waitFor: "text=Evolution" },
  { path: "/tasks", name: "tasks", waitFor: "text=Tasks" },
  { path: "/notifications", name: "notifications", waitFor: "text=Notifications" },
  { path: "/connections", name: "connections", waitFor: "text=Connections" },
  { path: "/settings", name: "settings", waitFor: "text=Business context" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "narrow", width: 900, height: 1000 },
];

/**
 * Scrolls the page so anything that reveals on approach has actually revealed
 * before the shutter goes.
 *
 * Reveal-on-scroll is driven by IntersectionObserver, which never fires for
 * content below the fold if nothing ever scrolls. A full-page screenshot
 * captures the whole document but does NOT scroll to get it — so without this,
 * every below-the-fold panel photographs as blank, and a reviewer reading these
 * images concludes the page is broken.
 */
async function settleReveals(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.75);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 80));
  });
  // Long enough for the reveal transition itself to finish.
  await page.waitForTimeout(700);
}

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
        await settleReveals(page);
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
