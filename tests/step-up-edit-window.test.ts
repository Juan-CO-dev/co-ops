/**
 * Catalog Phase 1 — the pure step-up surface. Tier E reads its OWN clock (the catalog
 * window, a fixed 15 minutes from an admin password), the client only decides whether to
 * SHOW a prompt, and destructive acts carry a one-shot purpose.
 */
import { afterEach, describe, expect, it } from "vitest";
import { assertStepUp, stepUpEditWindowMs, stepUpFreshWindowMs } from "@/lib/admin/step-up";
import type { AuthContext } from "@/lib/session";
import {
  CLIENT_EDIT_WINDOW_MARGIN_MS,
  DEFAULT_EDIT_WINDOW_MS,
  GRANT_ACTIONS,
  GRANT_TTL_MS,
  grantExpiresAt,
  confirmClientUnlock,
  isFreshWithin,
  isInsideWindow,
  isStepUpRefusal,
  parseStepUpPurpose,
  parseWindowSeconds,
  stepUpDecision,
  type ClientUnlock,
} from "@/lib/admin/step-up-shared";

const NOW = Date.parse("2026-10-15T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const UUID = "7d0c1f2e-0000-4000-8000-000000000001";

describe("the client decision — when to SHOW the password prompt", () => {
  it("Tier A proceeds whenever the shared flag is set", () => {
    expect(stepUpDecision("A", { unlocked: true, catalogUnlockedAt: null }, NOW)).toBe("proceed");
    expect(stepUpDecision("A", { unlocked: false, catalogUnlockedAt: ago(1) }, NOW)).toBe("prompt");
  });

  it("Tier B always prompts, even for a one-second-old unlock", () => {
    expect(stepUpDecision("B", { unlocked: true, catalogUnlockedAt: ago(1_000) }, NOW)).toBe("prompt");
  });

  it("Tier E reads the CATALOG clock only, inside the window minus the client margin", () => {
    const edge = DEFAULT_EDIT_WINDOW_MS - CLIENT_EDIT_WINDOW_MARGIN_MS;
    expect(stepUpDecision("E", { unlocked: false, catalogUnlockedAt: ago(edge - 1) }, NOW)).toBe("proceed");
    expect(stepUpDecision("E", { unlocked: true, catalogUnlockedAt: ago(edge) }, NOW)).toBe("prompt");
    expect(stepUpDecision("E", { unlocked: true, catalogUnlockedAt: null }, NOW)).toBe("prompt");
  });

  it("Tier E honours the window the server passed down", () => {
    expect(stepUpDecision("E", { unlocked: false, catalogUnlockedAt: ago(20 * 60_000) }, NOW, 30 * 60_000)).toBe("proceed");
  });
});

describe("destructive purposes and grants", () => {
  it("the closed set of grant actions", () => {
    expect([...GRANT_ACTIONS].sort()).toEqual(["product.retire", "recipe.delete", "sku.deactivate"]);
  });

  it("parseStepUpPurpose: absent is null, a known action + uuid is a purpose, anything else is invalid", () => {
    expect(parseStepUpPurpose(undefined)).toBeNull();
    expect(parseStepUpPurpose(null)).toBeNull();
    expect(parseStepUpPurpose({ action: "recipe.delete", targetId: UUID })).toEqual({ action: "recipe.delete", targetId: UUID });
    expect(parseStepUpPurpose({ action: "user.delete", targetId: UUID })).toBe("invalid");
    expect(parseStepUpPurpose({ action: "recipe.delete", targetId: "not-a-uuid" })).toBe("invalid");
    expect(parseStepUpPurpose("recipe.delete")).toBe("invalid");
    expect(parseStepUpPurpose([])).toBe("invalid");
  });

  it("a grant lives 120 seconds", () => {
    expect(GRANT_TTL_MS).toBe(120_000);
    expect(grantExpiresAt(new Date(NOW)).toISOString()).toBe(new Date(NOW + 120_000).toISOString());
  });
});

describe("a confirm from ANY admin modal advances the client's catalog clock (Astra r3 #1)", () => {
  it("catalog modal confirm → router.refresh → a recipe edit proceeds without a second prompt", () => {
    // Server-rendered state: no window yet.
    let unlock: ClientUnlock = { unlocked: false, catalogUnlockedAt: null };
    // The Items catalog's reactive modal posts the password with catalogWindow and reports the 200
    // to the provider (noteStepUpConfirmed → confirmClientUnlock).
    unlock = confirmClientUnlock(unlock, ago(1_000), true);
    // router.refresh() re-renders the admin layout, but the provider is not re-seeded from props:
    // its memory is exactly `unlock`. The recipe builder's next Tier E request:
    expect(stepUpDecision("E", unlock, NOW)).toBe("proceed");
  });

  it("a confirm without the catalog window (counts, catering) never starts the catalog clock", () => {
    expect(confirmClientUnlock({ unlocked: false, catalogUnlockedAt: null }, ago(1_000), false))
      .toEqual({ unlocked: true, catalogUnlockedAt: null });
  });
});

describe("helpers", () => {
  it("isInsideWindow (Tier E) is EXCLUSIVE at the edge", () => {
    expect(isInsideWindow(ago(499), NOW, 500)).toBe(true);
    expect(isInsideWindow(ago(500), NOW, 500)).toBe(false);
    expect(isInsideWindow(ago(501), NOW, 500)).toBe(false);
    expect(isInsideWindow(new Date(NOW + 1).toISOString(), NOW, 500)).toBe(false);
    expect(isInsideWindow(null, NOW, 500)).toBe(false);
  });

  it("isFreshWithin (Tier B, unchanged) is inclusive at the edge and refuses negative ages and garbage", () => {
    expect(isFreshWithin(ago(500), NOW, 500)).toBe(true);
    expect(isFreshWithin(ago(501), NOW, 500)).toBe(false);
    expect(isFreshWithin(new Date(NOW + 1).toISOString(), NOW, 500)).toBe(false);
    expect(isFreshWithin("nope", NOW, 500)).toBe(false);
    expect(isFreshWithin(null, NOW, 500)).toBe(false);
  });

  it("isStepUpRefusal knows the two window codes, not the grant code", () => {
    expect(isStepUpRefusal("step_up_required")).toBe(true);
    expect(isStepUpRefusal("step_up_stale")).toBe(true);
    expect(isStepUpRefusal("step_up_grant_required")).toBe(false);
    expect(isStepUpRefusal(undefined)).toBe(false);
  });

  it("parseWindowSeconds takes positive integers only", () => {
    expect(parseWindowSeconds("900", 1)).toBe(900);
    expect(parseWindowSeconds("0", 7)).toBe(7);
    expect(parseWindowSeconds("-5", 7)).toBe(7);
    expect(parseWindowSeconds(undefined, 7)).toBe(7);
  });
});

function ctx(sharedAt: string | null, catalogAt: string | null, shared = sharedAt !== null): AuthContext {
  return { session: { stepUpUnlocked: shared, stepUpUnlockedAt: sharedAt, catalogEditUnlockedAt: catalogAt } } as unknown as AuthContext;
}
afterEach(() => {
  delete process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS;
  delete process.env.ADMIN_STEP_UP_FRESH_SECONDS;
});

describe("Tier E on the server — its own clock, checked on every write", () => {
  it("defaults to 15 minutes with an EXCLUSIVE deadline: 899 999 ms ok, 900 000 and 900 001 refused", () => {
    expect(stepUpEditWindowMs()).toBe(900_000);
    expect(assertStepUp(ctx(null, ago(899_999)), "E", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(null, ago(900_000)), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
    expect(assertStepUp(ctx(null, ago(900_001)), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("Tier B's boundary is unchanged: inclusive at 120 000 ms", () => {
    expect(assertStepUp(ctx(ago(120_000), null), "B", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(120_001), null), "B", NOW)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("the SHARED unlock never satisfies E, and the catalog clock never satisfies B", () => {
    expect(assertStepUp(ctx(ago(1_000), null), "E", NOW)).toEqual({ ok: false, code: "step_up_required" });
    expect(assertStepUp(ctx(null, ago(1_000)), "B", NOW)).toEqual({ ok: false, code: "step_up_required" });
  });

  it("garbage or future timestamps are stale", () => {
    expect(assertStepUp(ctx(null, "nope"), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
    expect(assertStepUp(ctx(null, new Date(NOW + 60_000).toISOString()), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("A and B are unchanged", () => {
    expect(assertStepUp(ctx(ago(3_600_000), null), "A", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(30_000), null), "B", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(121_000), null), "B", NOW)).toEqual({ ok: false, code: "step_up_stale" });
    expect(stepUpFreshWindowMs()).toBe(120_000);
  });

  it("the env override works, garbage falls back, and E is never shorter than B", () => {
    process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS = "1800";
    expect(stepUpEditWindowMs()).toBe(1_800_000);
    process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS = "abc";
    expect(stepUpEditWindowMs()).toBe(900_000);
    process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS = "60";
    expect(stepUpEditWindowMs()).toBe(120_000);
  });
});
