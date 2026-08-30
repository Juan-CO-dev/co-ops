/**
 * Unit spine — THE THREE SKU-ADMIN WRITE CONTRACTS the wiring audit pinned (2026-08-29).
 *
 * All three findings live in server modules whose writes are I/O, so the DECISIONS are
 * extracted into pure functions here and the SHAPE of each fix is asserted at the source —
 * the same posture tests/dynamic-pars-walker.test.ts and tests/loader-scale-ceilings.test.ts
 * take, and for the same reason: when the guarantee is "this module never sets that column
 * directly", the ABSENCE is what has to be asserted, and no test over the module's exports
 * can see an absence.
 *
 *   1. MEMBERSHIP IS NOT A COLUMN SET (lib/admin/skus.ts, updateSku). `vendor_items.product_id`
 *      is one half of `product_primaries_member_fk` (migration 0179), so a raw column set on a
 *      SKU that some product_primaries row names raises 23503 — which updateSku re-threw as a
 *      bare Error and the route turned into a 500, where the dedicated /members endpoint
 *      already answers a named 409. Live at the time of the fix: 11 products, 11 primaries,
 *      23 member SKUs — so 11 of 23 member SKUs could 500 the SKU editor's own Product picker.
 *
 *   2. THE OVERLAY EDITOR MAY NOT CLOBBER A SLOT IT DID NOT SEE (lib/admin/skus.ts,
 *      upsertLocationSkuSettings). The editor PUTs BOTH day-class pars from state loaded at
 *      mount; the walker's accept per-slot-patches ONE of them. Without a baseline the stale
 *      slot is written back over the walker's number, and — worse — the row-fresh comparison
 *      then counts that slot as "directly edited", nulling its auto lane and CLEARING ITS PIN.
 *      AGENTS.md: "A PIN IS CLEARED ONLY BY A DIRECT HUMAN EDIT AT THE SAME SLOT."
 *
 *   3. A SWALLOWED FLAT-FIELD SYNC MUST STILL LEAVE A RECORD (lib/admin/pack-chain.ts).
 *      Staying non-fatal is the documented design; being invisible was not.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
  AdminSkuError,
  SKU_WRITE_MIN,
  classifyMembershipChange,
  membershipErrorAsAdminSkuError,
  overlayBaselineConflicts,
  upsertLocationSkuSettings,
  type OverlayBaseline,
} from "@/lib/admin/skus";
import { ProductError, PRODUCT_WRITE_MIN } from "@/lib/products";
import { getRoleLevel } from "@/lib/roles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const PRODUCT_X = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_Y = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Membership — what a submitted productId MEANS
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyMembershipChange — the four things a Product picker submit can mean", () => {
  it("a resubmit of the SAME membership is NOT a change", () => {
    // The SKU form posts `productId` on EVERY save once any product exists, so the common
    // case is a no-op. It has to classify as one: a detach delegated on a SKU that is
    // already a singleton would write a `product.member_detach` audit row on every save.
    expect(classifyMembershipChange(null, null)).toBe("none");
    expect(classifyMembershipChange(PRODUCT_X, PRODUCT_X)).toBe("none");
  });

  it("singleton → a product is an ATTACH; a product → singleton is a DETACH", () => {
    expect(classifyMembershipChange(null, PRODUCT_X)).toBe("attach");
    expect(classifyMembershipChange(PRODUCT_X, null)).toBe("detach");
  });

  it("product → a DIFFERENT product is a REPARENT, named separately from an attach", () => {
    // attachMember refuses this with a named 409 (`already_member`). Naming the case here
    // is what lets updateSku hand it to that one authority instead of silently re-parenting
    // a member with none of its guards and none of its audit vocabulary.
    expect(classifyMembershipChange(PRODUCT_X, PRODUCT_Y)).toBe("reparent");
  });
});

describe("membershipErrorAsAdminSkuError — one error contract at the route", () => {
  it("re-clothes a ProductError with its status and code intact", () => {
    // The SKU route catches AdminSkuError ONLY; anything else is re-thrown into an
    // unhandled 500. A 409 that arrives as a 500 is the exact defect being fixed, so the
    // delegation may not smuggle a foreign error class back out.
    for (const [status, code] of [
      [409, "already_member"],
      [409, "primary_must_be_reassigned"],
      [400, "invalid_product"],
      [503, "products_schema_pending"],
      [404, "sku_not_found"],
      [403, "forbidden"],
    ] as const) {
      const mapped = membershipErrorAsAdminSkuError(new ProductError(status, code, "m"));
      expect(mapped).toBeInstanceOf(AdminSkuError);
      expect(mapped).toMatchObject({ status, code });
    }
  });

  it("leaves anything else alone — a real failure must stay a real failure", () => {
    expect(membershipErrorAsAdminSkuError(new Error("boom"))).toBeNull();
    expect(membershipErrorAsAdminSkuError(new AdminSkuError(400, "invalid_name"))).toBeNull();
    expect(membershipErrorAsAdminSkuError(undefined)).toBeNull();
  });
});

describe("the delegation cannot lower the membership floor", () => {
  it("PRODUCT_WRITE_MIN and SKU_WRITE_MIN are the same GM floor", () => {
    // If they ever diverged, routing membership through lib/products.ts would either refuse
    // an edit the SKU editor permits, or permit one it should not. Pinned to the ROLE.
    expect(SKU_WRITE_MIN).toBe(getRoleLevel("gm"));
    expect(PRODUCT_WRITE_MIN).toBe(SKU_WRITE_MIN);
  });
});

describe("updateSku no longer sets vendor_items.product_id itself", () => {
  const src = read("lib/admin/skus.ts");

  it("has no raw `update.product_id =` column set anywhere", () => {
    // THE ABSENCE IS THE FIX. `product_id` is one half of a composite FK; setting it here
    // bypassed attachMember/detachMember's guards, their 409s and their audit vocabulary.
    expect(src).not.toMatch(/update\.product_id\s*=/);
  });

  it("delegates to lib/products.ts's two membership writers", () => {
    expect(src).toMatch(/from "@\/lib\/products"/);
    expect(src).toMatch(/await attachMember\(/);
    expect(src).toMatch(/await detachMember\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The overlay editor's optimistic-concurrency baseline
// ─────────────────────────────────────────────────────────────────────────────

const BASE: OverlayBaseline = { activeOverride: null, weekdayPar: 5, weekendPar: 8 };

describe("overlayBaselineConflicts — which fields moved under the editor", () => {
  it("an untouched row conflicts on nothing", () => {
    expect(overlayBaselineConflicts(BASE, { ...BASE })).toEqual([]);
  });

  it("THE FINDING'S CASE: the walker moved weekend while the admin was editing weekday", () => {
    // /ordering's accept per-slot-patches weekend_par 8 → 12. The admin's tab still holds 8
    // and PUTs both slots. Exactly one field moved, and it is the one the admin never saw.
    expect(overlayBaselineConflicts(BASE, { ...BASE, weekendPar: 12 })).toEqual(["weekend_par"]);
  });

  it("catches a slot that appeared, and a slot that was blanked", () => {
    expect(overlayBaselineConflicts({ ...BASE, weekdayPar: null }, BASE)).toEqual(["weekday_par"]);
    expect(overlayBaselineConflicts(BASE, { ...BASE, weekdayPar: null })).toEqual(["weekday_par"]);
  });

  it("catches an activation flip, including the null/false pair the tri-state depends on", () => {
    // `null` (inherit) and `false` (off here) are DIFFERENT answers, and a loose == would
    // read them as the same one.
    expect(overlayBaselineConflicts(BASE, { ...BASE, activeOverride: false })).toEqual(["active_override"]);
    expect(overlayBaselineConflicts({ ...BASE, activeOverride: false }, { ...BASE, activeOverride: true }))
      .toEqual(["active_override"]);
  });

  it("names EVERY field that moved, not just the first", () => {
    expect(overlayBaselineConflicts(BASE, { activeOverride: true, weekdayPar: 6, weekendPar: 12 }))
      .toEqual(["active_override", "weekday_par", "weekend_par"]);
  });

  it("a row that did not exist reads as all-inherit, so a first write is not a conflict", () => {
    const absent: OverlayBaseline = { activeOverride: null, weekdayPar: null, weekendPar: null };
    expect(overlayBaselineConflicts(absent, absent)).toEqual([]);
    // …but a row the walker INSERTED under the editor is one.
    expect(overlayBaselineConflicts(absent, { ...absent, weekendPar: 12 })).toEqual(["weekend_par"]);
  });
});

describe("upsertLocationSkuSettings refuses below the floor before any I/O", () => {
  // The pair proves the refusal precedes the database: the refused call returns an
  // AdminSkuError, the permitted one dies on the absent test-env Supabase config — which is
  // the boundary the refused call never reached.
  const agm = { user: { id: "u1", role: "agm" as const, language: "en" as const }, locations: [] };
  const gm = { user: { id: "u2", role: "gm" as const, language: "en" as const }, locations: [] };
  const args = {
    skuId: "sku-1",
    locationId: "11111111-1111-4111-8111-111111111111",
    activeOverride: null,
    weekdayPar: 5,
    weekendPar: 8,
    expected: BASE,
  };

  it("403s an AGM", async () => {
    await expect(
      upsertLocationSkuSettings(agm as unknown as Parameters<typeof upsertLocationSkuSettings>[0], args),
    ).rejects.toMatchObject({ name: "AdminSkuError", status: 403, code: "forbidden" });
  });

  it("lets a GM through to the DB boundary", async () => {
    const err = await upsertLocationSkuSettings(
      gm as unknown as Parameters<typeof upsertLocationSkuSettings>[0],
      args,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { name?: string }).name).not.toBe("AdminSkuError");
    expect(String((err as Error).message)).toMatch(/must be set/);
  });
});

describe("the overlay write reads the whole row it is about to overwrite", () => {
  const src = read("lib/admin/skus.ts");

  it("selects active_override alongside both pars, so the baseline can be compared", () => {
    expect(src).toMatch(/select\("id, active_override, weekday_par, weekend_par"\)/);
  });

  it("raises a named 409 rather than writing over a field that moved", () => {
    expect(src).toMatch(/overlayBaselineConflicts\(/);
    expect(src).toMatch(/"overlay_changed"/);
  });
});

describe("the overlay route and its editor carry the baseline end to end", () => {
  it("the PUT parses `expected` and REFUSES a payload without one", () => {
    // Required, not optional: the only client is the editor in this same PR, and a save
    // that cannot say what it saw is precisely the save that must not land.
    const route = read("app/api/admin/skus/[id]/location-settings/route.ts");
    expect(route).toMatch(/b\.expected/);
    expect(route).toMatch(/field: "expected"/);
    expect(route).toMatch(/expected:/);
  });

  it("the editor sends what it LOADED, not what is on screen", () => {
    const ui = read("components/admin/skus/SkuLocationOverlay.tsx");
    expect(ui).toMatch(/const \[baseline, setBaseline\]/);
    expect(ui).toMatch(/expected: baseline/);
    // …and re-baselines after a save, because router.refresh() does NOT reset client state.
    expect(ui).toMatch(/setBaseline\(/);
  });

  it("`overlay_changed` is a localized message in BOTH languages, never the generic one", () => {
    expect(read("components/admin/skus/shared.ts")).toMatch(/"overlay_changed"/);
    for (const lang of ["en", "es"] as const) {
      expect(read(`lib/i18n/${lang}.json`)).toMatch(/"admin\.skus\.error\.overlay_changed"/);
    }
  });

  it("the membership refusals are localized too — a named 409 with a generic message is half a fix", () => {
    const shared = read("components/admin/skus/shared.ts");
    for (const code of ["already_member", "primary_must_be_reassigned", "invalid_product", "products_schema_pending"]) {
      expect(shared).toContain(`"${code}"`);
      for (const lang of ["en", "es"] as const) {
        expect(read(`lib/i18n/${lang}.json`)).toContain(`"admin.skus.error.${code}"`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The pack-chain flat-field mirror
// ─────────────────────────────────────────────────────────────────────────────

describe("syncSkuFlatFieldsFromChain stays non-fatal but stops being invisible", () => {
  const src = read("lib/admin/pack-chain.ts");

  it("reports its outcome instead of only logging it", () => {
    expect(src).toMatch(/async function syncSkuFlatFieldsFromChain\([\s\S]*?\): Promise<boolean>/);
    expect(src).toMatch(/flatFieldsSynced/);
  });

  it("still never throws — the chain is the source of truth and is already saved", () => {
    // The non-fatal posture is deliberate and documented; only the silence was the defect.
    const fn = src.slice(src.indexOf("async function syncSkuFlatFieldsFromChain"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).not.toMatch(/\bthrow\b/);
    expect(body).toMatch(/console\.error/);
  });

  it("retries once before giving up on a transient write", () => {
    expect(src).toMatch(/SYNC_ATTEMPTS/);
  });

  it("records the outcome on the audit row the chain save already writes", () => {
    // audit_log is the admin-visible surface here, and `sku.pack_chain_update` is an
    // already-registered action — the vocabulary is closed, so the signal rides its metadata
    // rather than inventing a name.
    expect(src).toMatch(/flat_fields_synced:/);
    expect(src).toMatch(/action: "sku\.pack_chain_update"/);
  });
});
