/**
 * Audit W17 / B102 + B187 — product membership writes are conditional on the state they checked.
 *
 * B102: DELETE /api/admin/products/[id]/members ignored `[id]`; detach updated by SKU id alone, so
 *       a stale product screen removed the SKU from whichever product it was in NOW, and the audit
 *       row did not say which product lost it.
 * B187: attach checked `product_id IS NULL` and then updated by SKU id alone, so two racing attaches
 *       both succeeded and the second silently undid the first.
 *
 * Both writes are now compare-and-set: the UPDATE carries the checked state, and zero matched rows
 * is a NAMED 409.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { audit } from "@/lib/audit";
import { attachMember, detachMember, ProductError } from "@/lib/products";
import type { AuthContext } from "@/lib/session";

let db: ReturnType<typeof createFakeDb>;
/** Runs just before a `vendor_items` UPDATE executes: the other manager's write landing first. */
let beforeUpdate: (() => void) | null = null;
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      const q = (db.client as unknown as { from(t: string): Record<string, unknown> }).from(table);
      if (table !== "vendor_items") return q;
      const realUpdate = q.update as (patch: unknown) => unknown;
      q.update = (patch: unknown) => { beforeUpdate?.(); beforeUpdate = null; return realUpdate(patch); };
      return q;
    },
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const gm = { user: { id: "u-gm", role: "owner" }, role: "owner", level: 9, locations: [] } as unknown as AuthContext;
const X = "prod-X", Y = "prod-Y", S = "sku-S", T = "sku-T";

let seeded: Record<string, Array<Record<string, unknown>>> = {};
const currentRow = (skuId: string) => seeded.vendor_items!.find((r) => r.id === skuId)!;

/** Install and keep a handle on the table rows (the fake mutates them in place). */
function seed(skuProduct: string | null, primaries: Array<Record<string, unknown>> = []) {
  seeded = {
    vendor_items: [
      { id: S, location_id: null, product_id: skuProduct },
      { id: T, location_id: null, product_id: X },
    ],
    product_primaries: primaries,
  };
  db = createFakeDb(seeded);
}
const auditCalls = () => vi.mocked(audit).mock.calls.map(([a]) => ({ action: a.action, resourceId: a.resourceId, metadata: a.metadata }));
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ProductError ? { status: e.status, code: e.code } : Promise.reject(e)));

beforeEach(() => { vi.mocked(audit).mockClear(); beforeUpdate = null; });

describe("detachMember names the product it detaches from (B102)", () => {
  it("detach from a stale product refuses when the SKU moved", async () => {
    seed(Y); // manager B already moved S from X to Y
    expect(await refusal(detachMember(gm, { skuId: S, productId: X }))).toEqual({ status: 409, code: "member_moved" });
    expect(currentRow(S).product_id).toBe(Y); // Y keeps its member
    expect(auditCalls()).toEqual([]);
  });

  it("detach records which product lost the member", async () => {
    seed(X);
    await detachMember(gm, { skuId: S, productId: X });
    expect(currentRow(S).product_id).toBeNull();
    expect(currentRow(T).product_id).toBe(X); // only the named SKU
    expect(auditCalls()).toEqual([{ action: "product.member_detach", resourceId: S, metadata: { product_id: X } }]);
  });

  it("a SKU already detached is the same named refusal, and a missing SKU is a 404", async () => {
    seed(null);
    expect(await refusal(detachMember(gm, { skuId: S, productId: X }))).toEqual({ status: 409, code: "member_moved" });
    expect(await refusal(detachMember(gm, { skuId: "sku-gone", productId: X }))).toEqual({ status: 404, code: "sku_not_found" });
    expect(auditCalls()).toEqual([]);
  });

  it("the SKU moving between the check and the write is caught by the write itself", async () => {
    seed(X);
    beforeUpdate = () => { currentRow(S).product_id = Y; };
    expect(await refusal(detachMember(gm, { skuId: S, productId: X }))).toEqual({ status: 409, code: "member_moved" });
    expect(currentRow(S).product_id).toBe(Y);
    expect(auditCalls()).toEqual([]);
  });

  it("still refuses to detach a SKU a primary names", async () => {
    seed(X, [{ id: "pp-1", product_id: X, location_id: null, primary_sku_id: S, note: null }]);
    expect(await refusal(detachMember(gm, { skuId: S, productId: X }))).toEqual({ status: 409, code: "primary_must_be_reassigned" });
    expect(currentRow(S).product_id).toBe(X);
  });
});

describe("attachMember is a compare-and-set on a free SKU (B187)", () => {
  it("a racing attach to another product is refused, not silently re-parented", async () => {
    seed(null);
    // Both managers read product_id NULL; the other one's attach to X lands first.
    beforeUpdate = () => { currentRow(S).product_id = X; };
    expect(await refusal(attachMember(gm, { productId: Y, skuId: S }))).toEqual({ status: 409, code: "already_member" });
    expect(currentRow(S).product_id).toBe(X); // the winner's attach stands
    expect(auditCalls()).toEqual([]); // no product.member_attach for Y
  });

  it("the same attach made concurrently is idempotent and adds no second audit row", async () => {
    seed(null);
    beforeUpdate = () => { currentRow(S).product_id = Y; };
    await expect(attachMember(gm, { productId: Y, skuId: S })).resolves.toBeUndefined();
    expect(currentRow(S).product_id).toBe(Y);
    expect(auditCalls()).toEqual([]);
  });

  it("the same attach twice is idempotent and audits once", async () => {
    seed(null);
    await attachMember(gm, { productId: Y, skuId: S });
    await attachMember(gm, { productId: Y, skuId: S });
    expect(currentRow(S).product_id).toBe(Y);
    expect(auditCalls()).toEqual([{ action: "product.member_attach", resourceId: S, metadata: { product_id: Y } }]);
  });

  it("an uncontended attach still writes, and a SKU already in another product is the named 409", async () => {
    seed(null);
    await attachMember(gm, { productId: X, skuId: S });
    expect(currentRow(S).product_id).toBe(X);
    expect(await refusal(attachMember(gm, { productId: Y, skuId: S }))).toEqual({ status: 409, code: "already_member" });
    expect(currentRow(S).product_id).toBe(X);
  });
});
