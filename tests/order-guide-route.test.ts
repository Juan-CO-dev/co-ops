/**
 * tests/order-guide-route.test.ts — the admin order-guide route's FRONT DOOR (V3-A §6, Task 8).
 *
 * What this pins is not the guide model (that is `order-guides-renumber.test.ts`) but the
 * three decisions the route itself owns and nothing else can make for it:
 *
 *   1. WHO READS vs WHO WRITES. Read is key-holder+ (4) on purpose — the PO panel deep-links
 *      here so a KH keying an order can see the sheet order — while the write floor is
 *      ORDER_GUIDE_EDIT_MIN (GM, 7). An AGM is level 6 and must be refused, which is the
 *      assertion that fails loudly if anyone ever spells the floor as ">= 6".
 *   2. CSRF FAILS CLOSED, AND BEFORE ANY WORK. A cross-origin POST never reaches
 *      saveOrderGuide — asserted as "not called", not merely as a 403 status.
 *   3. THE ERROR CONTRACT. OrderGuideError(status, code) → jsonError(status, code); the
 *      409 `guide_stale` the editor's optimistic-concurrency token produces is the one the
 *      panel branches on, so its body shape is pinned here.
 *
 * The lib layer is mocked (it is I/O), but `OrderGuideError` is the REAL class from
 * `@/lib/order-guides-shared` — a stubbed error class would make the `instanceof` mapping
 * pass in the test and fail in production.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/admin/vendors/[id]/order-guide/route";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { createEmptyGuide, loadOrderGuide, OrderGuideError, saveOrderGuide } from "@/lib/order-guides";
import type { GuideModel } from "@/lib/order-guides-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { RoleCode } from "@/lib/roles";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/portal/csrf", () => ({ assertSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/order-guides", async () => {
  // The real error class — the route maps it by `instanceof`.
  const shared = await vi.importActual<typeof import("@/lib/order-guides-shared")>("@/lib/order-guides-shared");
  return {
    OrderGuideError: shared.OrderGuideError,
    ORDER_GUIDE_EDIT_MIN: 7,
    loadOrderGuide: vi.fn(),
    saveOrderGuide: vi.fn(),
    createEmptyGuide: vi.fn(),
  };
});

const VENDOR = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SKU_ON = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const SKU_OFF = "cccccccc-1111-4111-8111-cccccccccccc";

const params = Promise.resolve({ id: VENDOR });
const req = (init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`https://example.com/api/admin/vendors/${VENDOR}/order-guide`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", origin: "https://example.com" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

function actor(role: RoleCode) {
  return { user: { id: "user-1", name: "Marcus Webb", role }, level: 0, role, locations: [], session: {} };
}
const asActor = (role: RoleCode) =>
  vi.mocked(requireSession).mockResolvedValue(actor(role) as unknown as Awaited<ReturnType<typeof requireSession>>);

const guide: GuideModel = {
  guideId: "guide-1",
  vendorId: VENDOR,
  name: "PFG — laminated guide",
  updatedAt: "2026-09-16T12:00:00.000Z",
  sections: [
    { id: "sec-1", name: "Dairy", position: 1, lines: [{ id: "line-1", position: 1, skuId: SKU_ON, label: "Eggs", itemNumber: "439686", note: null }] },
  ],
};

/** Minimal `from("vendor_items").select().eq().eq().order().returns()` chain. */
function stubSkus(rows: Array<{ id: string; name: string; item_number: string | null }>, error: { message: string } | null = null) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.order = () => q;
  q.returns = () => Promise.resolve({ data: error ? null : rows, error });
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => q } as unknown as ReturnType<typeof getServiceRoleClient>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertSameOrigin).mockReturnValue(null);
  vi.mocked(loadOrderGuide).mockResolvedValue(guide);
  stubSkus([
    { id: SKU_ON, name: "Eggs", item_number: "439686" },
    { id: SKU_OFF, name: "Turkey", item_number: null },
  ]);
});

describe("GET — read is key-holder+, and the bucket is what is NOT on the guide", () => {
  it("refuses an employee (3) before any database work", async () => {
    asActor("employee");
    const res = await GET(req(), { params });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    expect(loadOrderGuide).not.toHaveBeenCalled();
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("serves a key holder (4) the guide plus only the SKUs no line already carries", async () => {
    asActor("key_holder");
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      guide,
      skusNotOnGuide: [{ skuId: SKU_OFF, name: "Turkey", itemNumber: null }],
    });
  });

  it("serves a vendor with no guide at all: null guide, every active SKU in the bucket", async () => {
    asActor("gm");
    vi.mocked(loadOrderGuide).mockResolvedValue(null);
    const body = (await (await GET(req(), { params })).json()) as { guide: null; skusNotOnGuide: unknown[] };
    expect(body.guide).toBeNull();
    expect(body.skusNotOnGuide).toHaveLength(2);
  });

  it("maps a SKU read failure to 500 rather than serving a half-true bucket", async () => {
    asActor("gm");
    stubSkus([], { message: "connection reset" });
    expect((await GET(req(), { params })).status).toBe(500);
  });
});

describe("POST — write is GM+, same-origin, and the model round-trips", () => {
  it("saves for a GM (7) with the model and the updatedAt token it loaded", async () => {
    asActor("gm");
    vi.mocked(saveOrderGuide).mockResolvedValue(guide);
    const res = await POST(req({ method: "POST", body: { model: guide, expectedUpdatedAt: guide.updatedAt } }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ guide });
    expect(saveOrderGuide).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }),
      VENDOR,
      guide,
      guide.updatedAt,
    );
  });

  it("refuses an AGM (6) — the floor is GM, not 'a manager'", async () => {
    asActor("agm");
    const res = await POST(req({ method: "POST", body: { model: guide, expectedUpdatedAt: guide.updatedAt } }), { params });
    expect(res.status).toBe(403);
    expect(saveOrderGuide).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin POST before it reaches the session or the save", async () => {
    asActor("gm");
    vi.mocked(assertSameOrigin).mockReturnValue(
      new Response(JSON.stringify({ error: "bad_origin" }), { status: 403 }) as unknown as ReturnType<typeof assertSameOrigin>,
    );
    const res = await POST(req({ method: "POST", body: { model: guide, expectedUpdatedAt: guide.updatedAt } }), { params });
    expect(res!.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
    expect(saveOrderGuide).not.toHaveBeenCalled();
  });

  it("passes a stale token through as 409 guide_stale — the code the panel branches on", async () => {
    asActor("gm");
    vi.mocked(saveOrderGuide).mockRejectedValue(new OrderGuideError(409, "guide_stale", "The guide changed since you loaded it"));
    const res = await POST(req({ method: "POST", body: { model: guide, expectedUpdatedAt: "stale" } }), { params });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "guide_stale" });
  });

  it("rejects a malformed model (sections not an array) as 400 invalid_payload", async () => {
    asActor("gm");
    const res = await POST(req({ method: "POST", body: { model: { ...guide, sections: "Dairy" }, expectedUpdatedAt: guide.updatedAt } }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_payload" });
    expect(saveOrderGuide).not.toHaveBeenCalled();
  });

  it("rejects a missing updatedAt token — an unguarded save is never allowed through", async () => {
    asActor("gm");
    const res = await POST(req({ method: "POST", body: { model: guide } }), { params });
    expect(res.status).toBe(400);
    expect(saveOrderGuide).not.toHaveBeenCalled();
  });

  it("creates an empty guide on { create: true } and answers 201", async () => {
    asActor("gm");
    const empty: GuideModel = { ...guide, name: "PFG — guide", sections: [] };
    vi.mocked(createEmptyGuide).mockResolvedValue(empty);
    const res = await POST(req({ method: "POST", body: { create: true } }), { params });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ guide: empty });
    expect(createEmptyGuide).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }), VENDOR);
  });

  it("maps a second create attempt to 409 exists", async () => {
    asActor("gm");
    vi.mocked(createEmptyGuide).mockRejectedValue(new OrderGuideError(409, "exists", "This vendor already has a guide"));
    const res = await POST(req({ method: "POST", body: { create: true } }), { params });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "exists" });
  });
});
