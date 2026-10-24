// Records the Chesterton demo beats (offline/mock-mode path) to a webm:
// flag card w/ citations -> slack thread -> linear ticket -> silent PR ->
// stale-comment flag -> pin reason (plaque suggestion) -> dashboard fence
// map/verdicts/stats. Uses installed Chrome + the built extension; one
// page throughout so the recording is a single continuous video.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const EXT = "C:/Users/tiffm/Desktop/chesterton/extension/dist";
const OUT_DIR = "C:/Users/tiffm/Desktop/chesterton/docs/demo-backup";
const MOCKS = "http://localhost:4100";
const DASH = "http://localhost:4600";

fs.mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = path.join(process.env.TEMP ?? "/tmp", "chesterton-demo-profile");
fs.rmSync(userDataDir, { recursive: true, force: true });

const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: "C:/Users/tiffm/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: false,
  viewport: { width: 1280, height: 720 },
  // Playwright injects --disable-extensions by default, which defeats
  // --load-extension; strip it.
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
const pause = (ms) => page.waitForTimeout(ms);

// Frame capture at ~2fps; assembled into an mp4 with the system ffmpeg
// afterwards (playwright's native screencast never engaged on this setup).
const FRAMES = path.join(OUT_DIR, "frames");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
let frameN = 0;
let capturing = true;
(async () => {
  while (capturing) {
    try {
      await page.screenshot({ path: path.join(FRAMES, `f-${String(frameN).padStart(4, "0")}.png`) });
      frameN++;
    } catch {
      /* mid-navigation; skip frame */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
})();

// Beat 1+2: the retry-cap PR — flag card with citations.
await page.goto(`${MOCKS}/github/acme/storefront/pull/1/files`);
await page.waitForSelector(".chesterton-card", { timeout: 15000 });
await page.locator(".chesterton-card").first().scrollIntoViewIfNeeded();
await pause(4000);

// Citations: slack thread, then linear ticket (direct nav; links open new tabs).
const slackHref = await page.locator('.chesterton-card a[href*="/slack/"]').first().getAttribute("href");
const linearHref = await page.locator('.chesterton-card a[href*="/linear/"]').first().getAttribute("href");
await page.goto(slackHref);
await pause(3500);
await page.goto(linearHref);
await pause(3500);

// Beat 3: the silence — harmless refactor, no flags.
await page.goto(`${MOCKS}/github/acme/storefront/pull/2/files`);
await pause(3500);
const cardCountPr2 = await page.locator(".chesterton-card").count();
console.log("PR2 cards (expect 0):", cardCountPr2);

// Beat 4: stale comment flag.
await page.goto(`${MOCKS}/github/acme/storefront/pull/3/files`);
await page.waitForSelector(".chesterton-card", { timeout: 15000 });
await page.locator(".chesterton-card").first().scrollIntoViewIfNeeded();
await pause(4000);

// Beat 6: fence plaque — Pin reason on the retry-cap flag, then reload to
// show the rendered suggestion comment.
await page.goto(`${MOCKS}/github/acme/storefront/pull/1/files`);
await page.waitForSelector(".chesterton-card", { timeout: 15000 });
const pin = page.locator('button[data-chesterton-action="pin"]').first();
await pin.scrollIntoViewIfNeeded();
await pin.click();
await page.waitForFunction(
  () => document.querySelector('button[data-chesterton-action="pin"]')?.textContent?.includes("Pinned"),
  { timeout: 10000 }
);
await pause(2000);
await page.goto(`${MOCKS}/github/acme/storefront/pull/1/files`);
await pause(1000);
const suggestion = page.locator("text=suggestion").first();
if (await suggestion.count()) await suggestion.scrollIntoViewIfNeeded();
await pause(3500);

// Beat 8: dashboard — fence map, hottest tile, verdicts, stats.
await page.goto(DASH);
await page.waitForSelector('button[aria-label*="fences"]', { timeout: 15000 });
await pause(2500);
const label = page.locator('button[aria-label^="services/payments/client.py"]').first();
const box = await label.boundingBox();
if (box) await page.mouse.click(box.x + box.width / 2, box.y + 40);
await pause(3500);
await page.locator("text=Verdicts").first().click();
await pause(3000);
await page.locator("text=Stats").first().click();
await pause(3000);

capturing = false;
await new Promise((r) => setTimeout(r, 700));
await ctx.close();

const { execFileSync } = await import("node:child_process");
const FFMPEG = "C:/Users/tiffm/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe";
const target = path.join(OUT_DIR, "chesterton-demo-backup.mp4");
fs.rmSync(target, { force: true });
execFileSync(FFMPEG, [
  "-y", "-framerate", "2", "-i", path.join(FRAMES, "f-%04d.png"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1280:-2", target,
], { stdio: "inherit" });
fs.rmSync(FRAMES, { recursive: true, force: true });
console.log("video:", target, Math.round(fs.statSync(target).size / 1024), "KB,", frameN, "frames");
