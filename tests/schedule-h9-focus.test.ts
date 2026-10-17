/**
 * CC chunk H9 fix 1 (2026-10-17) — runbook step 4 FAILED: after → / ← on a shift handle the edit landed but
 * `document.activeElement` was <body>, so keyboard and screen-reader editing was unusable. The board now keeps the SAME handle
 * focused across the re-render: handles stay mounted while the edit is in flight (busy, not removed), the bar is keyed by its
 * identity (date + person + its place in the row, not its start time), and the handle that was used is focused again after the
 * commit or a refusal's remount (`useFocusMemo`). This runs the real `PersonRow` in headless Chromium (esbuild bundle of
 * tests/fixtures/schedule/focus-harness.tsx — no server, no network): focus stays, and the accessible label reads the new time.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const hasBrowser = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();

describe.runIf(hasBrowser)("H9 fix 1: keyboard edits keep focus on the same handle", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const out = await build({
      entryPoints: [path.join(ROOT, "tests/fixtures/schedule/focus-harness.tsx")], bundle: true, write: false, format: "iife", platform: "browser",
      jsx: "automatic", alias: { "@": ROOT }, define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "silent",
    });
    browser = await chromium.launch();
    page = await browser.newPage();
    const js = out.outputFiles[0]!.text.split("</script>").join("<\\/script>");
    await page.setContent(`<!doctype html><html><body><div id="root"></div><script>${js}</script></body></html>`);
    await page.waitForSelector("[data-handle=end]");
  }, 120_000);
  afterAll(async () => { await browser?.close(); });

  const active = () => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName ?? null, handle: el?.getAttribute("data-handle") ?? null, label: el?.getAttribute("aria-label") ?? null };
  });
  const settle = async (edits: number) => {
    await page.waitForFunction((n) => window.__h9.edits >= n, edits);
    await page.waitForTimeout(250);
  };

  it("ArrowRight on the END handle: focus stays on it and its label reads the new end time", async () => {
    await page.focus("[data-handle=end]");
    expect((await active()).label).toContain("10:00 AM–6:00 PM");
    await page.keyboard.press("ArrowRight");
    await settle(1);
    const a = await active();
    expect(a.tag).toBe("BUTTON");
    expect(a.handle).toBe("end");
    expect(a.label).toContain("10:00 AM–6:15 PM");
  }, 60_000);

  it("ArrowLeft on the START handle (the shift's key changes): focus stays on the start handle, label updated", async () => {
    await page.focus("[data-handle=start]");
    await page.keyboard.press("ArrowLeft");
    await settle(2);
    const a = await active();
    expect(a.handle).toBe("start");
    expect(a.label).toContain("9:45 AM–6:15 PM");
  }, 60_000);

  it("two steps in a row on the same handle land two edits, focus never leaving it", async () => {
    await page.keyboard.press("ArrowLeft");
    await settle(3);
    await page.keyboard.press("ArrowLeft");
    await settle(4);
    const a = await active();
    expect(a.handle).toBe("start");
    expect(a.label).toContain("9:15 AM–6:15 PM");
  }, 60_000);

  it("a refused edit remounts the timeline (snap-back) and focus returns to the same handle", async () => {
    await page.focus("[data-handle=divider]");
    await page.evaluate(() => { window.__h9.refuseNext = true; });
    await page.keyboard.press("ArrowRight");
    await settle(5);
    const a = await active();
    expect(a.handle).toBe("divider");
    expect(a.label).toContain("2:00 PM");
  }, 60_000);
});
