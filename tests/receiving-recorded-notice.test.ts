/**
 * B9 step 7 — a normal receiving save now CONFIRMS itself. Before, a successful POST reset
 * the form and refreshed with no word at all (the only notices were for credit closures),
 * although the route already returned the new deliveryId. Structural pins (the vitest
 * spine has no DOM) plus the en + es keys.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const form = readFileSync("components/receiving/ReceivingForm.tsx", "utf8");
const route = readFileSync("app/api/operations/receiving/route.ts", "utf8");

describe("receiving: the 'Delivery recorded' notice", () => {
  it("the route hands back the new delivery's id on success", () => {
    expect(route).toMatch(/jsonOk\(\s*\{\s*deliveryId: res\.deliveryId/);
  });

  it("captures vendor + line count BEFORE resetForm, and sets the notice after it", () => {
    const capture = form.indexOf("const recordedVendorName = vendors.find((v) => v.id === vendorId)?.name ?? null;");
    const reset = form.indexOf("resetForm();", capture);
    const set = form.indexOf("setRecorded(typeof ok.deliveryId === \"string\"", reset);
    expect(capture).toBeGreaterThan(0);
    expect(reset).toBeGreaterThan(capture);
    expect(set).toBeGreaterThan(reset);
    expect(form).toContain("const recordedLineCount = payload.lines.length;");
  });

  it("renders a role=status notice with a link to the delivery", () => {
    const at = form.indexOf("{recorded ? (");
    const block = form.slice(at, at + 1200);
    expect(block).toContain('role="status"');
    expect(block).toContain('t("receiving.recorded.notice", { n: recorded.lineCount, vendor: recorded.vendorName })');
    expect(block).toContain('t("receiving.recorded.notice_no_vendor", { n: recorded.lineCount })');
    expect(block).toContain("href={`/operations/receiving/${recorded.deliveryId}`}");
    expect(block).toContain('t("receiving.recorded.view")');
  });

  it("clears on the next submit and on a vendor change (a new truck)", () => {
    expect(form.match(/setRecorded\(null\);/g)?.length).toBe(2);
  });

  it("ships en + es text", () => {
    for (const key of ["receiving.recorded.notice", "receiving.recorded.notice_no_vendor", "receiving.recorded.view"] as const) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
      expect(es[key]).not.toBe(en[key]);
    }
    expect(en["receiving.recorded.notice"]).toContain("{vendor}");
    expect(es["receiving.recorded.notice"]).toContain("{vendor}");
  });
});
