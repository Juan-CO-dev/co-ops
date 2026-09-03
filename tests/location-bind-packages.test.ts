/**
 * Unit spine — THE CATERING-PACKAGE LOCATION BINDS (audit v2 Batch B2, 2026-09-01).
 *
 * `lib/admin/catering/packages.ts` scopes its READS (`visibleLocationScope`) and gated every
 * WRITE on level only (`requireLevel(actor, 6)`): nine writers reached through opaque ids
 * (package → line item → slot option) never asked whether the actor holds the package's shop.
 * A catering_mgr at Capitol Hill could edit, deactivate, re-line or re-option a P Street
 * package. `tests/location-bind-differential.test.ts` carried these nine as allowlisted DEBT
 * ("B2 follow-up"); this PR retires those lines, so the differential test now enforces them.
 *
 * The chain is real data: `catering_package_items.package_id` → `catering_packages.location_id`;
 * `catering_package_slot_options.package_item_id` → line → package. `requirePackageRow` already
 * returns `location_id`, so each writer reads through to its shop and binds INLINE
 * (grep-visible to the differential test). A GLOBAL package (location_id null) is the
 * tenant-wide row and is not bound (the house `null = global` idiom, as in loadPackages).
 *
 * Refusal: 404 `not_found` — the module's own spelling for a missing package/line/option and
 * the IDOR two-halves 404-mask; never `forbidden`.
 * Technique: tests/catering-authz.test.ts — next-guard pair for the caller-supplied id, source
 * assertion (read → bind → write) for the opaque-id chains.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { createPackage, PACKAGE_WRITE_MIN } from "@/lib/admin/catering/packages";
import { getRoleLevel } from "@/lib/roles";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
const fnOf = (source: string, name: string): string => {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `export async function ${name} must exist`).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
};

const LOCATION_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_B = "22222222-2222-4222-8222-222222222222";

const cateringMgrAtA = { user: { id: "u-cm", role: "catering_mgr" as const, language: "en" as const }, locations: [LOCATION_A] };
const ownerAnywhere = { user: { id: "u-own", role: "owner" as const, language: "en" as const }, locations: [] as string[] };

type Actor = Parameters<typeof createPackage>[0];
type Input = Parameters<typeof createPackage>[1];

describe("premise: the package write floor sits BELOW the all-locations grant", () => {
  it("catering_mgr is 6, PACKAGE_WRITE_MIN is 6, owner is 9", () => {
    expect(getRoleLevel("catering_mgr")).toBe(6);
    expect(PACKAGE_WRITE_MIN).toBe(6);
    expect(getRoleLevel("owner")).toBe(9);
  });
});

describe("createPackage binds a shop-scoped locationId before it validates the label", () => {
  /** Deliberately empty label: the first pure check AFTER the bind. */
  const bad = (locationId: string | null): Input =>
    ({ locationId, labelEn: "", pricingMode: "flat", priceCents: 1000 }) as unknown as Input;

  it("refuses a catering_mgr at shop A creating a package at shop B — 404 not_found", async () => {
    await expect(createPackage(cateringMgrAtA as unknown as Actor, bad(LOCATION_B)))
      .rejects.toMatchObject({ name: "AdminCateringError", status: 404, code: "not_found" });
  });
  it("lets the same actor through at their OWN shop (then validates)", async () => {
    await expect(createPackage(cateringMgrAtA as unknown as Actor, bad(LOCATION_A)))
      .rejects.toMatchObject({ name: "AdminCateringError", status: 400, code: "invalid_label" });
  });
  it("a GLOBAL package (locationId null) is tenant-wide and is not bound", async () => {
    await expect(createPackage(cateringMgrAtA as unknown as Actor, bad(null)))
      .rejects.toMatchObject({ name: "AdminCateringError", status: 400, code: "invalid_label" });
  });
  it("lets an all-locations actor create anywhere", async () => {
    await expect(createPackage(ownerAnywhere as unknown as Actor, bad(LOCATION_B)))
      .rejects.toMatchObject({ name: "AdminCateringError", status: 400, code: "invalid_label" });
  });
});

describe("the opaque-id writers read through to the package's shop and bind BEFORE writing", () => {
  const src = srcOf("lib/admin/catering/packages.ts");

  /** package id → requirePackageRow (returns location_id) → bind → write */
  for (const name of ["updatePackage", "deactivatePackage", "addPackageLine"]) {
    it(`${name}: requirePackageRow → lockLocationContext → write`, () => {
      const fn = fnOf(src, name);
      const read = fn.indexOf("requirePackageRow(");
      const bind = fn.indexOf("lockLocationContext");
      const write = fn.search(/\.(insert|update)\(/);
      expect(read).toBeGreaterThan(-1);
      expect(bind).toBeGreaterThan(read);
      expect(write).toBeGreaterThan(bind);
    });
  }

  /** line-item id → package_id → package → bind → write */
  it("removePackageLineItem: requireLineItemRow → package → bind → write", () => {
    const fn = fnOf(src, "removePackageLineItem");
    const line = fn.indexOf("requireLineItemRow(");
    const bind = fn.indexOf("lockLocationContext");
    const write = fn.indexOf(".update(");
    expect(line).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(line);
    expect(write).toBeGreaterThan(bind);
  });
  it("addSlotOption: line (with package_id) → package → bind → insert", () => {
    const fn = fnOf(src, "addSlotOption");
    expect(fn).toContain("package_id"); // the line read must carry the chain
    const bind = fn.indexOf("lockLocationContext");
    const write = fn.indexOf(".insert(");
    expect(bind).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(bind);
  });

  /** option id → package_item_id → line → package → bind → write */
  for (const name of ["setSlotOptionClassic", "removeSlotOption"]) {
    it(`${name}: option → line → package → bind → update`, () => {
      const fn = fnOf(src, name);
      const chain = fn.indexOf("package_item_id");
      const bind = fn.indexOf("lockLocationContext");
      const write = fn.indexOf(".update(");
      expect(chain).toBeGreaterThan(-1);
      expect(bind).toBeGreaterThan(chain);
      expect(write).toBeGreaterThan(bind);
    });
  }

  it("every refusal on these paths is not_found, never forbidden", () => {
    for (const name of ["updatePackage", "deactivatePackage", "addPackageLine", "removePackageLineItem", "addSlotOption", "setSlotOptionClassic", "removeSlotOption"]) {
      const fn = fnOf(src, name);
      const bind = fn.indexOf("lockLocationContext");
      const after = fn.slice(bind, bind + 400);
      expect(after, name).toContain('"not_found"');
      expect(after, name).not.toContain('"forbidden"');
    }
  });
});

describe("recommendPackagePrice (read) binds the package's shop — a price basis is that shop's data", () => {
  it("reads location_id, binds it, then computes", () => {
    const fn = fnOf(srcOf("lib/admin/catering/package-pricing.ts"), "recommendPackagePrice");
    const read = fn.indexOf("location_id");
    const bind = fn.indexOf("lockLocationContext");
    const compute = fn.indexOf("loadActiveRateRules(");
    expect(read).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(read);
    expect(compute).toBeGreaterThan(bind);
  });
});
