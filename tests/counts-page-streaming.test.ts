/**
 * B9 step 6 — /operations/counts streams: the count sheet renders first, the on-hand panel
 * arrives behind <Suspense>, and a failed or overlong panel read lands in a translated
 * notice + retry (never an endless "Loading…"). Structural pins over the page source, plus
 * the en + es keys (translate-from-day-one).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const page = readFileSync("app/(authed)/operations/counts/page.tsx", "utf8");
const boundary = readFileSync("components/counts/OnHandBoundary.tsx", "utf8");

describe("the counts page streams its on-hand panel", () => {
  it("starts the panel's read before awaiting the sheet, and never awaits them together", () => {
    const start = page.indexOf("const onHand = ");
    const sheet = page.indexOf("const formData = await");
    expect(start).toBeGreaterThan(0);
    expect(sheet).toBeGreaterThan(start);
    expect(page).not.toMatch(/Promise\.all\(\[[^\]]*loadOnHand/s);
    expect(page).toContain("onHand?.catch(() => {});");
  });

  it("renders the panel behind <Suspense> inside the error boundary, with a translated loading line", () => {
    const b = page.indexOf("<OnHandBoundary");
    const s = page.indexOf("<Suspense fallback=");
    const sec = page.indexOf("<OnHandSection");
    expect(b).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(b);
    expect(sec).toBeGreaterThan(s);
    expect(page).toMatch(/<Suspense fallback=\{<p role="status"[^>]*>\{serverT\(lang, "counts\.onhand\.loading"\)\}/);
  });

  it("bounds the panel's read with a deadline so the fallback cannot hang forever", () => {
    expect(page).toMatch(/withDeadline\(loadOnHand\(auth, location, undefined, refs\), ON_HAND_DEADLINE_MS\)/);
    expect(page).toMatch(/clearTimeout\(timer\)/);
  });

  it("the boundary retries through next/error and never prints the raw error", () => {
    expect(boundary).toContain('"use client"');
    expect(boundary).toContain("unstable_catchError");
    expect(boundary).toContain('role="alert"');
    expect(boundary).toContain("unstable_retry()");
    expect(boundary).not.toMatch(/error\.message/);
  });

  it("ships en + es text for loading, failure and retry", () => {
    for (const key of ["counts.onhand.loading", "counts.onhand.load_failed", "counts.onhand.retry"] as const) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
      expect(es[key]).not.toBe(en[key]);
    }
  });
});
