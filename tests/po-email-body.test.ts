/**
 * V3-A §4 — the vendor email's bodies follow the order guide and use THE ONE renderer.
 * The text body's line block equals renderPoBodyLines(...) (byte for byte, indented two
 * spaces); the HTML rows sit under section header rows in the same order.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no I/O in this test"); }) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { renderBodies } from "@/lib/po-email";
import { renderPoBodyLines } from "@/lib/po-body";
import { serverT } from "@/lib/i18n/server";

const line = (name: string, qty: number, guidePos: number | null, guideSection: string | null) =>
  ({ skuId: `id-${name}`, name, itemNumber: "77", qty, unitLabel: "case", priceCents: null, guidePos, guideSection });

const ctx = {
  poId: "po", displayCode: "EM-0916-PFG", vendorId: "v", vendorName: "PFG", locationId: "l", locationName: "P Street",
  locationAddress: "1 Main St", receiptEmail: "pstreet@complimentsonlyoperations.com", recipients: ["rep@pfg.com"],
  lines: [line("Zucchini", 1, null, null), line("Arugula", 2, 2001, "Produce"), line("Eggs", 3, 1001, "Dairy")],
} as unknown as Parameters<typeof renderBodies>[0];

describe("renderBodies (V3-A)", () => {
  const { textBody, htmlBody } = renderBodies(ctx, "Order EM-0916-PFG — Compliments Only P Street");

  it("text body: section headers in guide order, not-on-guide last, via the one renderer", () => {
    const expected = renderPoBodyLines(ctx.lines.map((l) => ({ skuName: l.name, orderQty: l.qty, orderUnitLabel: l.unitLabel, itemNumber: l.itemNumber, guidePosition: l.guidePos, guideSection: l.guideSection })), (k, p) => serverT("en", k, p));
    for (const s of expected) expect(textBody).toContain(`  ${s}`);
    expect(textBody.indexOf("— Dairy —")).toBeLessThan(textBody.indexOf("Eggs"));
    expect(textBody.indexOf("Eggs")).toBeLessThan(textBody.indexOf("— Produce —"));
    expect(textBody.indexOf("— Produce —")).toBeLessThan(textBody.indexOf("Arugula"));
    expect(textBody.indexOf("Arugula")).toBeLessThan(textBody.indexOf("— Not on the guide —"));
    expect(textBody.indexOf("— Not on the guide —")).toBeLessThan(textBody.indexOf("Zucchini"));
  });

  it("html body: header rows precede their lines in the same order", () => {
    const at = (s: string) => htmlBody.indexOf(s);
    expect(at('colspan="2"')).toBeGreaterThan(-1);
    expect(at("Dairy")).toBeLessThan(at("Eggs"));
    expect(at("Eggs")).toBeLessThan(at("Produce"));
    expect(at("Produce")).toBeLessThan(at("Arugula"));
    expect(at("Not on the guide")).toBeLessThan(at("Zucchini"));
  });

  it("no guide anywhere → no header rows at all", () => {
    const plain = { ...ctx, lines: [line("B", 1, null, null), line("A", 1, null, null)] } as typeof ctx;
    const { textBody: t2, htmlBody: h2 } = renderBodies(plain, "s");
    expect(t2).not.toContain("Not on the guide");
    expect(h2).not.toContain('colspan="2"');
    expect(t2.indexOf("A —")).toBeLessThan(t2.indexOf("B —"));
  });
});
