// Pictures for the visual suite (HC-SH-139, ADR-096, GAPS #119 / #20). Every capture is saved under e2e/__screenshots__
// as before (docs/guide embeds those files) and, with E2E_PIXELS=1, compared against the committed baseline in
// e2e/__baselines__/<name>-<project>-<platform>.png within the tolerance set in playwright.config.ts. The committed
// baselines are the CI runner's (Chromium on Linux, written by the manual "baseline" job in .github/workflows/ci.yml);
// a laptop run with the flag writes its own win32 pictures on the first pass (gitignored) and compares on the next, so
// it can prove a change is pixel-identical here before CI does. The suite runs under playwright.visual.config.ts: the
// mock stack is pinned to VISUAL_NOW (no ticks, the recording as recorded) and every page's clock is pinned to the same
// instant (preparePage), so expiries, days to expiry, prices and dates are the same on any real day at any hour. A
// picture waits for the data and for the toasts to be gone and hides the Next dev overlay (its "issue" toast pops up
// on its own); a caller masks what the mock stack stamps to the minute (ShotOptions.mask).
import { type Locator, type Page, expect } from "@playwright/test";
import { VISUAL_NOW } from "../test/expiry-shift";

export const PIXELS = process.env["E2E_PIXELS"] === "1";

/** Where a suite's captures go and how its baselines are named. */
const SUITES = {
  visual: { dir: "e2e/__screenshots__", baseline: (name: string) => `${name}.png` },
  guide: { dir: "e2e/__screenshots__/guide", baseline: (name: string) => `guide/${name}.png` },
} as const;

/** Before the first navigation: pin `Date` to VISUAL_NOW (timers keep running). */
export async function preparePage(page: Page): Promise<void> {
  await page.clock.setFixedTime(VISUAL_NOW);
}

/** Hide the Next dev overlay (its badge and "issue" toast pop up on their own). Added after hydration: React owns the
 * whole document in the App Router and drops a style injected before it hydrates. */
async function hideDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

export interface ShotOptions {
  fullPage?: boolean;
  /** Regions painted over before the comparison: text the mock stack stamps to the minute (its clock flows from VISUAL_NOW). */
  mask?: Locator[];
}

/** Save the capture and, under E2E_PIXELS, assert it against the baseline. */
export async function shot(page: Page, suite: keyof typeof SUITES, name: string, opts: ShotOptions = {}): Promise<void> {
  const s = SUITES[suite];
  const fullPage = opts.fullPage ?? false;
  // data first: a picture taken while a request is in flight shows a loading state in one run and rows in the next
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0); // a toast fades on its own clock; wait it out
  await hideDevOverlay(page);
  // /analyse is wider than a 1280 px viewport, so a click on the settings gear scrolls the page sideways by an amount
  // that differs from run to run (GAPS #125); a picture is always taken from the left edge
  await page.evaluate(() => {
    window.scrollTo(0, window.scrollY);
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
    return new Promise<void>((done) => requestAnimationFrame(() => done())); // anchored popovers follow the scroll first
  });
  await page.screenshot({ path: `${s.dir}/${name}.png`, fullPage });
  if (!PIXELS) return;
  await expect(page).toHaveScreenshot(s.baseline(name), { fullPage, mask: opts.mask ?? [] });
}

