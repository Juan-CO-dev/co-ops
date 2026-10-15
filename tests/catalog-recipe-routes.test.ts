/**
 * Catalog Phase 3b — the pages' routes. Previews are READS (no step-up); applies are Tier E with the preview
 * token; the notice answer is same-origin and bound in the lib, with no password. Source pins for the shape;
 * then the routes run with the session, step-up and libs mocked, so what they PASS ON is asserted: the parsed
 * change (the promote's Spanish name included), the token, the named refusal with its line, and — for a promote
 * refused AFTER its Spanish name was saved — the record that the shop's own label changed (CC note 2 #3).
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { applyMenuChange, computeMenuPreview } from "@/lib/catalog/menu-item-page";
import { applyRecipeChange, computeRecipePreview } from "@/lib/catalog/recipe-item";
import { dismissRecipeNotice, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { MenuShopError } from "@/lib/admin/menu-item-shop";
import { POST as recipePreview } from "@/app/api/admin/catalog/recipe/[id]/preview/route";
import { POST as recipeApply } from "@/app/api/admin/catalog/recipe/[id]/apply/route";
import { POST as noticeDismiss } from "@/app/api/admin/catalog/recipe/[id]/notices/dismiss/route";
import { POST as menuPreview } from "@/app/api/admin/catalog/menu-item/[id]/preview/route";
import { POST as menuApply } from "@/app/api/admin/catalog/menu-item/[id]/apply/route";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn() }));
vi.mock("@/lib/catalog/recipe-item", () => ({ computeRecipePreview: vi.fn(), applyRecipeChange: vi.fn() }));
vi.mock("@/lib/catalog/menu-item-page", () => ({ computeMenuPreview: vi.fn(), applyMenuChange: vi.fn() }));
vi.mock("@/lib/admin/recipe-versions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/recipe-versions")>("@/lib/admin/recipe-versions");
  return { ...actual, dismissRecipeNotice: vi.fn() };
});

const read = (f: string) => readFileSync(f, "utf8");
const HOST = "https://co-ops.example.com";
const R = "7d0c1f2e-0000-4000-8000-000000000001";
const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const V = "7d0c1f2e-0000-4000-8000-0000000000aa";
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${HOST}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("source pins: previews are a read for those who may save", () => {
  for (const [file, call] of [
    ["app/api/admin/catalog/recipe/[id]/preview/route.ts", "computeRecipePreview("],
    ["app/api/admin/catalog/menu-item/[id]/preview/route.ts", "computeMenuPreview("],
  ] as const) {
    it(file, () => {
      const src = read(file);
      expect(src).toContain(call);
      expect(src).not.toContain("assertStepUp");
      expect(src).toMatch(/ctx\.level < (RECIPE_SHOP_WRITE_MIN|MENU_SHOP_WRITE_MIN)/);
    });
  }
});

describe("source pins: applies are Tier E, carry the preview token, and go through the lib", () => {
  for (const [file, call] of [
    ["app/api/admin/catalog/recipe/[id]/apply/route.ts", "applyRecipeChange("],
    ["app/api/admin/catalog/menu-item/[id]/apply/route.ts", "applyMenuChange("],
  ] as const) {
    it(file, () => {
      const src = read(file);
      expect(src).toContain('assertStepUp(ctx, "E")');
      expect(src).toContain(call);
      expect(src).toContain("previewToken");
      expect(src).not.toContain("consumeStepUpGrant");
    });
  }
  it("the notice answer: same-origin, a GM floor, the lib binds; no password", () => {
    const src = read("app/api/admin/catalog/recipe/[id]/notices/dismiss/route.ts");
    expect(src).toContain("assertSameOrigin(req)");
    expect(src).toContain("dismissRecipeNotice(");
    expect(src).not.toContain("assertStepUp");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "u-gm", role: "gm" }, role: "gm", level: 7, locations: [SHOP] } as never);
  vi.mocked(assertStepUp).mockReturnValue({ ok: true } as never);
});

describe("the recipe routes", () => {
  const change = { kind: "back_to_default", shopId: SHOP };
  it("preview: the parsed change reaches the lib and the preview comes back", async () => {
    vi.mocked(computeRecipePreview).mockResolvedValue({ token: "abcd1234" } as never);
    const res = await recipePreview(post(`/api/admin/catalog/recipe/${R}/preview`, { change }), params(R));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preview: { token: "abcd1234" } });
    expect(vi.mocked(computeRecipePreview).mock.calls[0]!.slice(1)).toEqual([R, change]);
  });
  it("preview: a refused line comes back NAMED (position, name, reason)", async () => {
    vi.mocked(computeRecipePreview).mockRejectedValue(new RecipeVersionError(400, "invalid_component_product", undefined, { position: 7, name: "Ham", reason: "invalid_component_product" }));
    const res = await recipePreview(post(`/api/admin/catalog/recipe/${R}/preview`, { change }), params(R));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_component_product", line: { position: 7, name: "Ham", reason: "invalid_component_product" } });
  });
  it("preview: a bad change is refused by name before the lib; below the GM floor is forbidden", async () => {
    const res = await recipePreview(post(`/api/admin/catalog/recipe/${R}/preview`, { change: { kind: "nope" } }), params(R));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_payload", field: "change" });
    vi.mocked(requireSession).mockResolvedValue({ user: { id: "u", role: "agm" }, role: "agm", level: 6, locations: [SHOP] } as never);
    expect((await recipePreview(post(`/api/admin/catalog/recipe/${R}/preview`, { change }), params(R))).status).toBe(403);
    expect(computeRecipePreview).not.toHaveBeenCalled();
  });
  it("apply: Tier E, then the change and the token reach the lib; 201 with the new version", async () => {
    vi.mocked(applyRecipeChange).mockResolvedValue({ versionId: V });
    const res = await recipeApply(post(`/api/admin/catalog/recipe/${R}/apply`, { change, previewToken: "abcd1234" }), params(R));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ versionId: V });
    expect(vi.mocked(assertStepUp).mock.calls[0]![1]).toBe("E");
    expect(vi.mocked(applyRecipeChange).mock.calls[0]!.slice(1)).toEqual([R, change, "abcd1234"]);
  });
  it("apply: no edit window → the step-up code, nothing saved; a stale preview → 409 preview_stale", async () => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_required" } as never);
    const res = await recipeApply(post(`/api/admin/catalog/recipe/${R}/apply`, { change, previewToken: "abcd1234" }), params(R));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "step_up_required" });
    expect(applyRecipeChange).not.toHaveBeenCalled();
    vi.mocked(assertStepUp).mockReturnValue({ ok: true } as never);
    vi.mocked(applyRecipeChange).mockRejectedValue(new RecipeVersionError(409, "preview_stale"));
    const stale = await recipeApply(post(`/api/admin/catalog/recipe/${R}/apply`, { change, previewToken: "abcd1234" }), params(R));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "preview_stale" });
  });
  it("apply: a missing token is refused by name", async () => {
    const res = await recipeApply(post(`/api/admin/catalog/recipe/${R}/apply`, { change }), params(R));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_payload", field: "previewToken" });
  });
});

describe("the notice answer", () => {
  const body = { locationId: SHOP, kind: "source_changed", seenVersionId: V };
  it("same-origin: the answer reaches the lib (which binds the shop)", async () => {
    vi.mocked(dismissRecipeNotice).mockResolvedValue();
    const res = await noticeDismiss(post(`/api/admin/catalog/recipe/${R}/notices/dismiss`, body, { origin: HOST }), params(R));
    expect(res.status).toBe(200);
    expect(vi.mocked(dismissRecipeNotice).mock.calls[0]![1]).toEqual({ locationId: SHOP, recipeId: R, kind: "source_changed", seenVersionId: V });
  });
  it("a cross-site post is refused before the session is read", async () => {
    const res = await noticeDismiss(post(`/api/admin/catalog/recipe/${R}/notices/dismiss`, body, { origin: "https://evil.example.com" }), params(R));
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
    expect(dismissRecipeNotice).not.toHaveBeenCalled();
  });
});

describe("the menu-item routes", () => {
  const promote = { kind: "promote", settingId: V, fields: ["name"], nameEs: "Italiano grande" };
  it("preview: the promote's typed Spanish name reaches the lib (Astra chunk-1 review P2)", async () => {
    vi.mocked(computeMenuPreview).mockResolvedValue({ token: "ffff0000" } as never);
    const res = await menuPreview(post(`/api/admin/catalog/menu-item/${R}/preview`, { change: promote }), params(R));
    expect(res.status).toBe(200);
    expect(vi.mocked(computeMenuPreview).mock.calls[0]!.slice(1)).toEqual([R, promote]);
  });
  it("apply: the change and token reach the lib; 201", async () => {
    vi.mocked(applyMenuChange).mockResolvedValue({ ok: true });
    const res = await menuApply(post(`/api/admin/catalog/menu-item/${R}/apply`, { change: promote, previewToken: "ffff0000" }), params(R));
    expect(res.status).toBe(201);
    expect(vi.mocked(applyMenuChange).mock.calls[0]!.slice(1)).toEqual([R, promote, "ffff0000"]);
  });
  it("apply: a promote refused AFTER its Spanish name was saved says so — the label changed, the promote did not (CC note 2 #3)", async () => {
    const e = new MenuShopError(409, "global_changed");
    e.spanishNameSaved = { settingId: V, locationId: SHOP };
    vi.mocked(applyMenuChange).mockRejectedValue(e);
    const res = await menuApply(post(`/api/admin/catalog/menu-item/${R}/apply`, { change: promote, previewToken: "ffff0000" }), params(R));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "global_changed", spanishNameSaved: { settingId: V, locationId: SHOP }, notice: "catalog.menu.promote.es_saved_not_promoted",
    });
  });
  it("apply: an ordinary refusal carries no such record", async () => {
    vi.mocked(applyMenuChange).mockRejectedValue(new MenuShopError(409, "preview_stale"));
    const res = await menuApply(post(`/api/admin/catalog/menu-item/${R}/apply`, { change: promote, previewToken: "ffff0000" }), params(R));
    const json = await res.json();
    expect(json).toMatchObject({ code: "preview_stale" });
    expect(json).not.toHaveProperty("spanishNameSaved");
  });
});
