/**
 * Astra full-branch review #1 — the catalog's seasonal/catering-flag edits reach two catering
 * routes; they now ride the SAME 15-minute catalog clock (Tier E). A fresh SHARED step-up flag
 * with an EXPIRED catalog clock is refused; a fresh catalog clock is accepted. The real
 * assertStepUp runs (only the session and the libs are mocked).
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ session: vi.fn(), flags: vi.fn(), update: vi.fn(), deactivate: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/admin/catering/menu", () => ({
  setCateringFlags: h.flags,
  AdminCateringMenuError: class extends Error {},
  MENU_ADMIN_MIN: 7,
}));
vi.mock("@/lib/admin/catering/packages", () => ({
  updatePackage: h.update,
  deactivatePackage: h.deactivate,
  addPackageLineItem: vi.fn(), addPackageLine: vi.fn(), addSlotOption: vi.fn(), removeSlotOption: vi.fn(),
  setSlotOptionClassic: vi.fn(), removePackageLineItem: vi.fn(),
  AdminCateringError: class extends Error {},
}));

import { PATCH as menuPATCH } from "@/app/api/admin/catering/menu/[id]/route";
import { PATCH as packagePATCH } from "@/app/api/admin/catering/packages/[id]/route";

const ID = "7a12e700-0000-4000-8000-000000000001";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ctx = (catalogAt: string | null) => ({
  user: { id: "u-gm", role: "gm" },
  session: { id: "s-1", stepUpUnlocked: true, stepUpUnlockedAt: ago(1_000), catalogEditUnlockedAt: catalogAt },
});
const req = (url: string, body: unknown) => new NextRequest(url, { method: "PATCH", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.flags.mockResolvedValue({ cateringAvailable: true, cateringOnly: false, cateringPortionable: false });
  h.update.mockResolvedValue(undefined);
});

describe("seasonal / catering-flag edits ride the catalog clock", () => {
  it("menu flags: an expired catalog clock is refused even with a fresh shared unlock", async () => {
    h.session.mockResolvedValue(ctx(ago(16 * 60_000)));
    const res = await menuPATCH(req(`http://localhost/api/admin/catering/menu/${ID}`, { kind: "menu_item", seasonal: true }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("step_up_stale");
    expect(h.flags).not.toHaveBeenCalled();
  });

  it("menu flags: no catalog clock at all is step_up_required", async () => {
    h.session.mockResolvedValue(ctx(null));
    const res = await menuPATCH(req(`http://localhost/api/admin/catering/menu/${ID}`, { kind: "item", seasonal: false }), params);
    expect((await res.json()).code).toBe("step_up_required");
  });

  it("menu flags: inside the window it writes", async () => {
    h.session.mockResolvedValue(ctx(ago(60_000)));
    const res = await menuPATCH(req(`http://localhost/api/admin/catering/menu/${ID}`, { kind: "menu_item", seasonal: true }), params);
    expect(res.status).toBe(200);
    expect(h.flags).toHaveBeenCalledTimes(1);
  });

  it("package fields (seasonal): an expired catalog clock is refused even with a fresh shared unlock", async () => {
    h.session.mockResolvedValue(ctx(ago(16 * 60_000)));
    const res = await packagePATCH(req(`http://localhost/api/admin/catering/packages/${ID}`, { seasonal: true }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("step_up_stale");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("package fields: inside the window they write", async () => {
    h.session.mockResolvedValue(ctx(ago(60_000)));
    const res = await packagePATCH(req(`http://localhost/api/admin/catering/packages/${ID}`, { seasonal: true }), params);
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it("package activation keeps its stricter Tier B (a fresh shared unlock, any catalog clock)", async () => {
    h.session.mockResolvedValue(ctx(null));
    const res = await packagePATCH(req(`http://localhost/api/admin/catering/packages/${ID}`, { active: false }), params);
    expect(res.status).toBe(200);
    expect(h.deactivate).toHaveBeenCalledTimes(1);
  });
});

describe("every client of those routes uses the catalog (Tier E) flow", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  it("MenuClient's reactive modal opens the window and reports to the provider", () => {
    const menu = src("components/admin/catering/menu/MenuClient.tsx");
    expect(menu).toMatch(/<PasswordModal\s+catalogWindow/);
    expect(menu).toContain("noteStepUpConfirmed();");
    expect(menu).toContain("forgetStepUp();");
  });
  it("PackagesClient and RecipeCateringFlags ask for E and forget a refused unlock", () => {
    for (const p of ["components/admin/catering/packages/PackagesClient.tsx", "components/admin/recipes/RecipeCateringFlags.tsx"]) {
      const s = src(p);
      expect(s, p).not.toContain('requestStepUp("A")');
      expect(s, p).toContain('requestStepUp("E")');
      expect(s, p).toContain("useStepUpPost");
    }
  });
});
