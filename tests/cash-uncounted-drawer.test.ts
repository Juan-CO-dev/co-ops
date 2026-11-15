/**
 * W03/B007 — an untouched cash form must never file a deposit.
 *
 * The bug: with the drawer field empty (hand mode) or no denomination typed, the client sent
 * `drawerTotalCents: 0` (`toCents("")` is 0) and the route accepted it, so the night filed
 * deposit = 0 − $200 float = −$200 and an over/short of −(projected + $200). The fix holds the
 * line on both sides: the route refuses a $0 drawer unless the client says it was COUNTED empty
 * (`drawerCountedEmpty: true`), and the client keeps Submit disabled until the form is filled.
 */
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), pin: vi.fn(), cashSubmit: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: mocks.access }));
vi.mock("@/lib/auth-flows", () => ({ verifyActorPin: mocks.pin }));
// W07 (merged first) routes the cash PIN through the per-session re-check counter; this file tests the
// drawer rules, so the counter wraps the same PIN mock (W07's own tests cover the counter).
vi.mock("@/lib/auth-reauth-pin", () => ({
  verifyActorPinForSession: async (_session: string, user: string, pin: string) => ((await mocks.pin(user, pin)) ? "ok" : "wrong"),
}));
vi.mock("@/lib/cash-toast", () => ({ loadToastCashProjected: mocks.toast }));
vi.mock("@/lib/cash", async () => {
  const shared = await vi.importActual<typeof import("@/lib/cash-shared")>("@/lib/cash-shared");
  return { ...shared, submitCashReport: mocks.cashSubmit };
});

import { POST as cashPost } from "@/app/api/cash/route";
import { drawerFigureEntered, uncountedDrawer } from "@/lib/cash-shared";

const SHOP = "11111111-1111-4111-8111-111111111111";
const USER = "44444444-4444-4444-8444-444444444444";
const base = { locationId: SHOP, date: "2026-11-10", pin: "1234", projectedCents: 50_000, cashTipsCents: 0, floatCents: 20_000 };

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/cash", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: USER }, session: { id: "session-1" }, role: "key_holder", level: 4, locations: [SHOP] });
  mocks.access.mockResolvedValue(true);
  mocks.pin.mockResolvedValue(true);
  mocks.toast.mockResolvedValue(null);
  mocks.cashSubmit.mockResolvedValue({ ok: true, id: "cash-report" });
});

describe("POST /api/cash refuses an uncounted drawer (B007)", () => {
  it("hand mode with drawerTotalCents 0 and no counted-empty flag → 400, nothing filed", async () => {
    const res = await cashPost(req({ ...base, countMethod: "hand", drawerTotalCents: 0 }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("drawer_not_counted");
    expect(mocks.cashSubmit).not.toHaveBeenCalled();
  });

  it("hand mode with no drawer figure at all → 400, nothing filed", async () => {
    const res = await cashPost(req({ ...base, countMethod: "hand" }));
    expect(res.status).toBe(400);
    expect(mocks.cashSubmit).not.toHaveBeenCalled();
  });

  it("denomination mode with nothing entered → 400, nothing filed", async () => {
    const res = await cashPost(req({ ...base, countMethod: "denomination", denominations: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("drawer_not_counted");
    expect(mocks.cashSubmit).not.toHaveBeenCalled();
  });

  it("refuses before the PIN is even checked", async () => {
    await cashPost(req({ ...base, countMethod: "hand", drawerTotalCents: 0 }));
    expect(mocks.pin).not.toHaveBeenCalled();
  });

  it("a $0 drawer the closer COUNTED (flag true) still files — hand and denomination", async () => {
    expect((await cashPost(req({ ...base, countMethod: "hand", drawerTotalCents: 0, drawerCountedEmpty: true }))).status).toBe(200);
    expect((await cashPost(req({ ...base, countMethod: "denomination", denominations: {}, drawerCountedEmpty: true }))).status).toBe(200);
    expect(mocks.cashSubmit).toHaveBeenCalledTimes(2);
    expect(mocks.cashSubmit.mock.calls[0]![1]).toMatchObject({ drawerTotalCents: 0 });
  });

  it("a non-zero drawer files without the flag", async () => {
    expect((await cashPost(req({ ...base, countMethod: "hand", drawerTotalCents: 60_000 }))).status).toBe(200);
    expect((await cashPost(req({ ...base, countMethod: "denomination", denominations: { "2000": 3 } }))).status).toBe(200);
    expect(mocks.cashSubmit).toHaveBeenCalledTimes(2);
  });

  it("only a literal true counts as the flag", async () => {
    for (const flag of ["true", 1, "yes", null]) {
      const res = await cashPost(req({ ...base, countMethod: "hand", drawerTotalCents: 0, drawerCountedEmpty: flag }));
      expect(res.status, String(flag)).toBe(400);
    }
    expect(mocks.cashSubmit).not.toHaveBeenCalled();
  });
});

describe("the pure rules", () => {
  it("uncountedDrawer: zero without the flag is uncounted; zero with it, or any figure, is counted", () => {
    expect(uncountedDrawer(0, undefined)).toBe(true);
    expect(uncountedDrawer(0, false)).toBe(true);
    expect(uncountedDrawer(0, true)).toBe(false);
    expect(uncountedDrawer(1, undefined)).toBe(false);
  });
  it("drawerFigureEntered: empty hand / untouched denominations are not entered; a typed 0 is", () => {
    expect(drawerFigureEntered({ mode: "hand", handTotal: "", denoms: {} })).toBe(false);
    expect(drawerFigureEntered({ mode: "hand", handTotal: " ", denoms: {} })).toBe(false);
    expect(drawerFigureEntered({ mode: "hand", handTotal: "0", denoms: {} })).toBe(true);
    expect(drawerFigureEntered({ mode: "denomination", handTotal: "700", denoms: {} })).toBe(false);
    expect(drawerFigureEntered({ mode: "denomination", handTotal: "", denoms: {}, enteredDenoms: ["2000"] })).toBe(true);
    expect(drawerFigureEntered({ mode: "denomination", handTotal: "", denoms: { "2000": 1 } })).toBe(true);
  });
});

describe("cash-client never submits an untouched form (B007)", () => {
  const src = readFileSync("app/(authed)/cash/cash-client.tsx", "utf8");
  it("holds Submit until the readout would show (projected + a drawer figure)", () => {
    const at = src.indexOf('t("cash.submit.button")');
    const button = src.slice(src.lastIndexOf("<ActionButton", at), at);
    expect(button).toMatch(/disabled=\{!canSubmit\}/);
    expect(src).toMatch(/const canSubmit = cashReadoutVisible\(\{ mode, projected, handTotal, denoms, enteredDenoms \}\);/);
    expect(src).toMatch(/if \(!canSubmit\) return;/);
  });
  it("tells the server when a zero drawer was counted, and never turns an empty hand field into 0", () => {
    expect(src).toContain("drawerCountedEmpty: drawerEntered && drawerTotalCents === 0");
    expect(src).toContain('drawerTotalCents: mode === "hand" && drawerEntered ? drawerTotalCents : undefined');
  });
  it("maps refusals by jsonError's machine code (the `error` field carries the message when one is given)", () => {
    expect(src).toContain("const body = { error: raw.code ?? raw.error };");
    expect(src).toContain('body.error === "drawer_not_counted"');
  });
});

describe("POST /api/cash names a lost double-submit (W03/B147)", () => {
  it("concurrent_submit → 409 cash_concurrent_submit", async () => {
    mocks.cashSubmit.mockResolvedValue({ ok: false, reason: "concurrent_submit" });
    const res = await cashPost(req({ ...base, countMethod: "hand", drawerTotalCents: 60_000 }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("cash_concurrent_submit");
  });
});
