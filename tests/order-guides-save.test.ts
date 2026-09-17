/**
 * tests/order-guides-save.test.ts — `saveOrderGuide` after the Astra review (2026-09-17).
 *
 * Findings 1 and 2 were both about the WRITE SHAPE, not the model: three separate PostgREST
 * requests (delete → "+100000 park" upsert → final upsert) that two savers could interleave,
 * and upserts that never asked whether a submitted id belonged to this vendor's guide. The fix
 * is migration 0207's `save_order_guide` RPC, so what this file pins is exactly that:
 *
 *   1. ONE CALL, AND IT IS THE RPC. No `.upsert(` and no `100000` survive in the module — if
 *      anyone reintroduces a client-side write sequence, this fails before it reaches review.
 *   2. THE REFUSAL MAP. The RPC raises its CODE as the message; each one has to land as the
 *      status the admin panel branches on (409 guide_stale is the one the editor reloads on).
 *   3. THE AUDIT IS STILL THE RECOVERY PATH — one row, full before/after, and `before` is the
 *      state read BEFORE the RPC ran.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveOrderGuide, OrderGuideError } from "@/lib/order-guides";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import type { GuideModel } from "@/lib/order-guides-shared";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const VENDOR = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const GUIDE = "dddddddd-1111-4111-8111-dddddddddddd";
const TOKEN = "2026-09-17T12:00:00.000Z";

const rows = () => ({
  vendor_order_guides: [{ id: GUIDE, vendor_id: VENDOR, name: "PFG — laminated guide", updated_at: TOKEN }],
  order_guide_sections: [
    { id: "s1", guide_id: GUIDE, name: "Produce", position: 1 },
    { id: "s2", guide_id: GUIDE, name: "Dairy", position: 2 },
  ],
  order_guide_lines: [
    { id: "l1", section_id: "s1", position: 1, sku_id: "sku-a", label: "Arugula", item_number: "1", note: null },
    { id: "l2", section_id: "s2", position: 1, sku_id: "sku-b", label: "Eggs", item_number: null, note: null },
  ],
});

type Rows = ReturnType<typeof rows>;

/** A supabase stub just wide enough for loadOrderGuide's three reads plus `.rpc`. */
function stub(state: Rows, rpcError: { message: string } | null) {
  const rpc = vi.fn(async () => (rpcError ? { data: null, error: rpcError } : { data: { updated_at: TOKEN }, error: null }));
  const writes: string[] = [];
  const from = (table: keyof Rows) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    Object.assign(b, {
      select: self, eq: self, in: self, order: self, returns: self,
      upsert: () => { writes.push(`upsert:${table}`); return b; },
      delete: () => { writes.push(`delete:${table}`); return b; },
      update: () => { writes.push(`update:${table}`); return b; },
      maybeSingle: async () => ({ data: state[table][0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: state[table], error: null }).then(res, rej),
    });
    return b;
  };
  return { client: { from, rpc }, rpc, writes };
}

const actor = { user: { id: "user-1", name: "Marcus Webb", role: "gm" } } as unknown as AuthContext;

const model = (): GuideModel => ({
  guideId: GUIDE, vendorId: VENDOR, name: "PFG — laminated guide", updatedAt: TOKEN,
  sections: [
    { id: "s2", name: "Dairy", position: 1, lines: [{ id: "l2", position: 1, skuId: "sku-b", label: "Eggs", itemNumber: null, note: null }] },
    { id: "s1", name: "Produce", position: 2, lines: [{ id: "l1", position: 1, skuId: "sku-a", label: "Arugula", itemNumber: "1", note: null }] },
  ],
});

function install(rpcError: { message: string } | null) {
  const s = stub(rows(), rpcError);
  vi.mocked(getServiceRoleClient).mockReturnValue(s.client as unknown as ReturnType<typeof getServiceRoleClient>);
  return s;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("saveOrderGuide — one transactional RPC (Astra findings 1 + 2)", () => {
  it("sends the renumbered model, the guide id and the token to save_order_guide, and writes nothing itself", async () => {
    const s = install(null);
    await saveOrderGuide(actor, VENDOR, model(), TOKEN);
    expect(s.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = s.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("save_order_guide");
    expect(args.p_guide_id).toBe(GUIDE);
    expect(args.p_expected_updated_at).toBe(TOKEN);
    expect(args.p_name).toBe("PFG — laminated guide");
    expect((args.p_sections as GuideModel["sections"]).map((x) => [x.name, x.position])).toEqual([["Dairy", 1], ["Produce", 2]]);
    expect(s.writes).toEqual([]); // no delete/upsert/update from the app layer at all
  });

  it("audits exactly once, with the before read BEFORE the RPC and the after it just saved", async () => {
    install(null);
    await saveOrderGuide(actor, VENDOR, model(), TOKEN);
    expect(audit).toHaveBeenCalledTimes(1);
    const meta = vi.mocked(audit).mock.calls[0]![0]!.metadata as { before: { sections: { name: string }[] }; after: { sections: { name: string }[] } };
    expect(meta.before.sections.map((x) => x.name)).toEqual(["Produce", "Dairy"]);
    expect(meta.after.sections.map((x) => x.name)).toEqual(["Dairy", "Produce"]);
  });

  it("a token that no longer matches the stored one is a 409 guide_stale before any RPC", async () => {
    const s = install(null);
    await expect(saveOrderGuide(actor, VENDOR, model(), "2026-09-17T11:59:59.000Z"))
      .rejects.toMatchObject({ status: 409, code: "guide_stale" });
    expect(s.rpc).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([
    ["guide_stale", 409],
    ["sku_already_placed", 409],
    ["section_name_taken", 409],
    ["foreign_section", 400],
    ["foreign_line", 400],
    ["foreign_sku", 400],
    ["invalid_payload", 400],
    ["guide_not_found", 404],
  ])("maps the RPC refusal %s to %i, and audits nothing", async (code, status) => {
    install({ message: code });
    const err = await saveOrderGuide(actor, VENDOR, model(), TOKEN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrderGuideError);
    expect(err).toMatchObject({ status, code });
    expect(audit).not.toHaveBeenCalled();
  });

  it("an unrecognised RPC failure is a real error, never a silent 400", async () => {
    install({ message: "connection reset by peer" });
    await expect(saveOrderGuide(actor, VENDOR, model(), TOKEN)).rejects.toThrow(/saveOrderGuide: connection reset/);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses a model that places one SKU twice without spending an RPC", async () => {
    const s = install(null);
    const m = model();
    m.sections[1]!.lines[0]!.skuId = "sku-b";
    await expect(saveOrderGuide(actor, VENDOR, m, TOKEN)).rejects.toMatchObject({ status: 409, code: "sku_already_placed" });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("refuses two sections whose names differ only by case", async () => {
    const s = install(null);
    const m = model();
    m.sections[1]!.name = "dairy";
    await expect(saveOrderGuide(actor, VENDOR, m, TOKEN)).rejects.toMatchObject({ status: 409, code: "section_name_taken" });
    expect(s.rpc).not.toHaveBeenCalled();
  });
});

describe("lib/order-guides.ts source pins", () => {
  const src = readFileSync("lib/order-guides.ts", "utf8");
  it("the two-phase park/final upsert is gone — no upserts, no +100000 parking", () => {
    expect(src).not.toContain(".upsert(");
    expect(src).not.toContain("100000");
  });
  it("saveOrderGuide goes through the 0207 RPC", () => {
    expect(src).toContain('sb.rpc("save_order_guide"');
  });
});
