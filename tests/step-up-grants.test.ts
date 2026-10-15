/**
 * Catalog Phase 1 (Astra r1 P1-1) — always-prompt acts need a ONE-SHOT, action-bound grant.
 * A fresh edit window (or a fresh shared unlock) is never enough; a grant for X/T is refused
 * for Y or T'; a replay and an expired grant are refused; the step-up POST mints exactly the
 * grant it was asked for, only after a correct password.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  session: vi.fn(),
  unlock: vi.fn(),
  verify: vi.fn(),
  audit: vi.fn(),
  setActive: vi.fn(),
  deactivateRecipe: vi.fn(),
  deactivateSku: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({
  audit: h.audit,
  // The step-up POST records its success row with the CHECKED twin (review #2).
  auditChecked: async (input: unknown) => { await h.audit(input); return { ok: true }; },
}));
vi.mock("@/lib/session", () => ({ requireSession: h.session, unlockStepUp: h.unlock }));
vi.mock("@/lib/auth", () => ({ verifyPassword: h.verify }));
vi.mock("@/lib/auth-flows", () => ({ upgradeLegacyPasswordHash: async () => undefined }));
vi.mock("@/lib/products", () => ({
  setProductActive: h.setActive,
  ProductError: class ProductError extends Error { constructor(public status: number, public code: string) { super(code); } },
}));
vi.mock("@/lib/recipes", () => ({
  updateRecipe: vi.fn(),
  deactivateRecipe: h.deactivateRecipe,
  RecipeError: class RecipeError extends Error { constructor(public status: number, public code: string) { super(code); } },
  RECIPE_WRITE_MIN: 7,
  RECIPE_DELETE_MIN: 8,
}));
vi.mock("@/lib/admin/skus", () => ({
  updateSku: vi.fn(),
  deactivateSku: h.deactivateSku,
  AdminSkuError: class AdminSkuError extends Error { constructor(public status: number, public code: string) { super(code); } },
  isSkuClass: () => true,
}));

import { consumeStepUpGrant, mintStepUpGrant } from "@/lib/admin/step-up-grants";
import { POST as stepUpPOST } from "@/app/api/auth/step-up/route";
import { POST as productActivePOST } from "@/app/api/admin/products/[id]/active/route";
import { DELETE as recipeDELETE } from "@/app/api/admin/recipes/[id]/route";
import { PATCH as skuPATCH } from "@/app/api/admin/skus/[id]/route";
import type { AuthContext } from "@/lib/session";

const SESSION = "5e551011-0000-4000-8000-000000000001";
const USER = "05e20001-0000-4000-8000-000000000001";
const T = "7a12e700-0000-4000-8000-000000000001";
const T2 = "7a12e700-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-15T15:00:00.000Z");

function ctx(role = "gm", sessionId = SESSION): AuthContext {
  const fresh = new Date().toISOString();
  return {
    user: { id: USER, role },
    session: { id: sessionId, stepUpUnlocked: true, stepUpUnlockedAt: fresh, catalogEditUnlockedAt: fresh },
  } as unknown as AuthContext;
}
const grants = () => h.db.tables.step_up_grants as Array<Record<string, unknown>>;
const json = (url: string, method: string, body: unknown) => new NextRequest(url, { method, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.db = fakeSupabase({ step_up_grants: [], users: [{ id: USER, password_hash: "hmac2$stored" }] });
  h.setActive.mockResolvedValue({ pinnedRecipeCount: 0 });
});

describe("consumeStepUpGrant — one-shot, action-bound, session-bound", () => {
  beforeEach(async () => {
    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "product.retire", targetId: T }, now: NOW });
  });
  const at = (ms: number) => new Date(NOW.getTime() + ms);

  it("mint stores who, what, when", () => {
    expect(grants()[0]).toMatchObject({
      session_id: SESSION, user_id: USER, action: "product.retire", target_id: T,
      created_at: NOW.toISOString(), expires_at: at(120_000).toISOString(), consumed_at: null,
    });
  });

  it("refused for another action or another target — and those refusals do not spend it", async () => {
    expect(await consumeStepUpGrant(ctx(), "recipe.delete", T, at(1_000))).toEqual({ ok: false, code: "step_up_grant_required" });
    expect(await consumeStepUpGrant(ctx(), "product.retire", T2, at(1_000))).toEqual({ ok: false, code: "step_up_grant_required" });
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(1_000))).toEqual({ ok: true });
  });

  it("works once; a replay is refused", async () => {
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(1_000))).toEqual({ ok: true });
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(2_000))).toEqual({ ok: false, code: "step_up_grant_required" });
  });

  it("refused at and after expiry", async () => {
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(120_000))).toEqual({ ok: false, code: "step_up_grant_required" });
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(119_999))).toEqual({ ok: true });
  });

  it("refused on another session", async () => {
    expect(await consumeStepUpGrant(ctx("gm", "5e551011-0000-4000-8000-000000000002"), "product.retire", T, at(1_000)))
      .toEqual({ ok: false, code: "step_up_grant_required" });
  });
});

describe("the destructive routes demand the grant — a fresh edit window is not enough", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("retire a product: refused without a grant, accepted once with it, replay refused", async () => {
    h.session.mockResolvedValue(ctx());
    const call = () => productActivePOST(json(`http://localhost/api/admin/products/${T}/active`, "POST", { active: false }), params(T));
    const refused = await call();
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("step_up_grant_required");
    expect(h.setActive).not.toHaveBeenCalled();

    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "product.retire", targetId: T } });
    expect((await call()).status).toBe(200);
    expect(h.setActive).toHaveBeenCalledTimes(1);
    expect((await call()).status).toBe(403);
  });

  it("restoring a product is an ordinary edit inside the window", async () => {
    h.session.mockResolvedValue(ctx());
    const res = await productActivePOST(json(`http://localhost/api/admin/products/${T}/active`, "POST", { active: true }), params(T));
    expect(res.status).toBe(200);
  });

  it("delete a recipe: a grant for ANOTHER recipe is refused; the right one works", async () => {
    h.session.mockResolvedValue(ctx("moo"));
    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "recipe.delete", targetId: T2 } });
    const call = () => recipeDELETE(new NextRequest(`http://localhost/api/admin/recipes/${T}`, { method: "DELETE" }), params(T));
    expect((await call()).status).toBe(403);
    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "recipe.delete", targetId: T } });
    expect((await call()).status).toBe(200);
    expect(h.deactivateRecipe).toHaveBeenCalledTimes(1);
  });

  it("deactivate a SKU needs the grant; reactivate needs only the window", async () => {
    h.session.mockResolvedValue(ctx());
    const call = (active: boolean) => skuPATCH(json(`http://localhost/api/admin/skus/${T}`, "PATCH", { active }), params(T));
    expect((await call(false)).status).toBe(403);
    expect(h.deactivateSku).not.toHaveBeenCalled();
    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "sku.deactivate", targetId: T } });
    expect((await call(false)).status).toBe(200);
    expect((await call(true)).status).toBe(200);
    expect(h.deactivateSku).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/auth/step-up mints exactly what it was asked for", () => {
  const call = (body: unknown) => stepUpPOST(json("http://localhost/api/auth/step-up", "POST", body));

  it("a malformed purpose is a 400 before the password is checked", async () => {
    h.session.mockResolvedValue(ctx());
    const res = await call({ password: "right", purpose: { action: "user.delete", targetId: T } });
    expect(res.status).toBe(400);
    expect(h.verify).not.toHaveBeenCalled();
    expect(grants()).toEqual([]);
  });

  it("a wrong password mints nothing", async () => {
    h.session.mockResolvedValue(ctx());
    h.verify.mockResolvedValue(false);
    expect((await call({ password: "wrong", purpose: { action: "recipe.delete", targetId: T } })).status).toBe(401);
    expect(grants()).toEqual([]);
    expect(h.unlock).not.toHaveBeenCalled();
  });

  it("a right password opens the catalog window when asked and mints the one grant", async () => {
    h.session.mockResolvedValue(ctx());
    h.verify.mockResolvedValue(true);
    const res = await call({ password: "right", catalogWindow: true, purpose: { action: "recipe.delete", targetId: T } });
    expect(res.status).toBe(200);
    expect(h.unlock).toHaveBeenCalledWith(SESSION, { catalogWindow: true });
    expect(grants()).toHaveLength(1);
    expect(grants()[0]).toMatchObject({ session_id: SESSION, user_id: USER, action: "recipe.delete", target_id: T });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth_step_up_success",
      metadata: { edit_window_seconds: 900, grant: { action: "recipe.delete", target_id: T } },
    }));
  });
});

describe("a malformed target id is a 400 before any grant is touched", () => {
  const BAD = "not-a-uuid";
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const updates = () => h.db.writes.filter((w) => w.table === "step_up_grants" && w.op === "update");

  beforeEach(async () => {
    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "product.retire", targetId: T } });
  });

  it("retire a product", async () => {
    h.session.mockResolvedValue(ctx());
    const res = await productActivePOST(json(`http://localhost/api/admin/products/${BAD}/active`, "POST", { active: false }), params(BAD));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_id");
    expect(updates()).toEqual([]);
    expect(grants()[0]?.consumed_at).toBeNull();
    expect(h.setActive).not.toHaveBeenCalled();
  });

  it("delete a recipe", async () => {
    h.session.mockResolvedValue(ctx("moo"));
    const res = await recipeDELETE(new NextRequest(`http://localhost/api/admin/recipes/${BAD}`, { method: "DELETE" }), params(BAD));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_id");
    expect(updates()).toEqual([]);
    expect(h.deactivateRecipe).not.toHaveBeenCalled();
  });

  it("deactivate a SKU", async () => {
    h.session.mockResolvedValue(ctx());
    const res = await skuPATCH(json(`http://localhost/api/admin/skus/${BAD}`, "PATCH", { active: false }), params(BAD));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_id");
    expect(updates()).toEqual([]);
    expect(h.deactivateSku).not.toHaveBeenCalled();
  });
});

describe("a grant that cannot be minted stamps no clock (review P3)", () => {
  it("the mint failing → 500, no unlock, no success audit, no grant", async () => {
    h.session.mockResolvedValue(ctx());
    h.verify.mockResolvedValue(true);
    h.db.failInserts = 1;
    await expect(
      stepUpPOST(json("http://localhost/api/auth/step-up", "POST", { password: "right", catalogWindow: true, purpose: { action: "recipe.delete", targetId: T } })),
    ).rejects.toThrow(/mintStepUpGrant/);
    expect(h.unlock).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "auth_step_up_success" }));
    expect(grants()).toEqual([]);
  });
});

describe("a minted grant never outlives a failed success path (chunk-3 review f)", () => {
  it("unlockStepUp throwing after the mint (and the checked success row) voids the grant", async () => {
    h.session.mockResolvedValue(ctx());
    h.verify.mockResolvedValue(true);
    h.unlock.mockRejectedValueOnce(new Error("unlock boom"));
    await expect(
      stepUpPOST(json("http://localhost/api/auth/step-up", "POST", { password: "right", purpose: { action: "recipe.delete", targetId: T } })),
    ).rejects.toThrow(/unlock boom/);
    expect(grants()).toHaveLength(1);
    expect(grants()[0]!.consumed_at).toEqual(expect.any(String));
    // The success row is written BEFORE the stamp (review #2: a checked audit gates the stamp),
    // so it records the verified password; the grant it names is void.
    // …and the voided grant cannot be spent.
    expect(await consumeStepUpGrant(ctx(), "recipe.delete", T)).toEqual({ ok: false, code: "step_up_grant_required" });
  });
});
