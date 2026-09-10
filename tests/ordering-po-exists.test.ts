import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { etCalendarDate, operationalDayUtcRange } from "@/lib/operational-day";

const source = readFileSync("lib/ordering.ts", "utf8");
const ast = ts.createSourceFile("ordering.ts", source, ts.ScriptTarget.Latest, true);
function body(name: string) {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return fn.body.getText(ast);
}

describe("LRA-206: both ordering entry points share day idempotency", () => {
  it("guards every ordered vendor before the first walk write", () => {
    const walk = body("submitParPass");
    expect(walk).toContain("for (const vendorId of byVendor.keys())");
    expect(walk).toContain("await assertNoLivePoToday(sb, locationId, vendorId)");
    expect(walk.indexOf("await assertNoLivePoToday")).toBeLessThan(walk.indexOf('.insert('));
    expect(walk).toContain("resolved.filter((r) => r.input.orderQty > 0)");
    expect(walk).toContain("if (vid == null) continue");
  });

  it("preserves the cutoff guard before loading the seeding walker", () => {
    const draft = body("generateDraftForVendor");
    expect(draft).toContain("await assertNoLivePoToday(sb, locationId, vendorId)");
    expect(draft.indexOf("await assertNoLivePoToday")).toBeLessThan(draft.indexOf("await loadWalkerData"));
    const guard = body("assertNoLivePoToday");
    expect(guard).toContain('.eq("location_id", locationId).eq("vendor_id", vendorId)');
    expect(guard).toContain('.in("status", ["draft", "confirmed"])');
    expect(guard).toContain('operationalDayUtcRange(dateEt)');
    expect(guard).toContain('.gte("created_at", startIso).lt("created_at", endExclusiveIso)');
    expect(guard).toContain('new OrderingError(409, "po_exists"');
  });

  it("uses the same base-code allocator without suffix retries in both paths", () => {
    expect(body("submitParPass")).toContain("createDraftsFromLines(actor, locationId, byVendor, ev.id, { noCodeSuffixRetry: true })");
    expect(body("generateDraftForVendor")).toContain("createDraftsFromLines(actor, locationId, byVendor, null, { noCodeSuffixRetry: true })");
    const po = readFileSync("lib/purchase-orders.ts", "utf8");
    expect(po).toContain("opts?.noCodeSuffixRetry ? base : nextFreeCode(base, takenCodes)");
    expect(po).toMatch(/if \(\(poErr as \{ code\?: string \}\)\.code === "23505"\)\s*\{\s*if \(opts\?\.noCodeSuffixRetry\)\s*\{[\s\S]*?throw new PurchaseOrderError\(409, "po_exists"/);
    expect(readFileSync("supabase/migrations/0174_vendor_ordering.sql", "utf8")).toContain("UNIQUE (display_code)");
  });

  it("surfaces a race conflict instead of swallowing it as poError", () => {
    const walk = body("submitParPass");
    expect(walk).toMatch(/if \(err instanceof PurchaseOrderError && err.code === "po_exists"\)\s*\{\s*throw new OrderingError\(err.status, err.code, err.message\)/);
    expect(walk.indexOf("throw new OrderingError(err.status")).toBeLessThan(walk.indexOf("poError = true"));
  });

  // Existing helper retained: DST transition-day fixed-24h limitation is out of scope.
  it.each([
    ["2026-09-10", "2026-09-10T04:00:00.000Z", "2026-09-11T04:00:00.000Z"],
    ["2026-01-15", "2026-01-15T05:00:00.000Z", "2026-01-16T05:00:00.000Z"],
  ])("uses the ET day window for %s", (date, start, end) => {
    expect(operationalDayUtcRange(date)).toEqual({ startIso: start, endExclusiveIso: end });
    expect(etCalendarDate(new Date(Date.parse(end) - 1).toISOString())).toBe(date);
    expect(etCalendarDate(end)).not.toBe(date);
  });
});
