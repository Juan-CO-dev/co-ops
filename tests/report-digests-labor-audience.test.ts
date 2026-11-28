/**
 * Digests round 3, PR 4, fix round 2 (CC ruling D-7; Fable F1): THE AUDIENCE PIN.
 *
 * A role bucket with one real earner prints that person's straight-time pay to within cents. CC's ruling: that is NO
 * NEW EXPOSURE if everyone who can be shown the digest's cost-by-role line (F5, `labor_cost_by_role`) is already shown
 * each hourly person's labor cost by the business report itself, at that shop. This file pins the two audiences and
 * proves the first is a SUBSET of the second, over every role, every GM visibility setting the run can read, every
 * digest kind, and every relation of the recipient to the shop.
 *
 *   DIGEST audience  = `digestCan(access, "labor_cost_by_role", { shop, day })`, with `access` built exactly as the
 *                      engine builds it: `laborBusinessAccess(role, what phase A sealed)` → `digestAccessFor(viewer,
 *                      delivery, business)` (lib/report-digests-engine.ts `laborAccess` / `sendOnce`).
 *   REPORT audience  = the business report serves this viewer `people[].straightCostCents` for this shop:
 *                      `businessAccessFor(role, stored settings)` (what `resolveBusinessAccess` computes from the stored
 *                      row, lib/business-report.ts) puts that path in `businessDtoPaths`, the people list is there to
 *                      carry it, the report is on, and `businessShopAllowed` opens the shop.
 *
 * If this file ever fails, D-7's condition no longer holds and the ruling's fallback applies: hide a role bucket's
 * dollars unless it has at least 2 earners and no earner is over 80% of its pay. Pure: no I/O. Synthetic ids only.
 */
import { describe, expect, it } from "vitest";
import {
  businessAccessFor, businessDtoPaths, businessShopAllowed, gmVisibilityCombinations, GM_VISIBILITY_DEFAULTS, GM_VISIBILITY_KEYS,
  type GmVisibility,
} from "@/lib/business-access-shared";
import { digestAccessFor, digestCan, type DigestDelivery } from "@/lib/report-digests-access-shared";
import { laborBusinessAccess, type GmSettingsResult } from "@/lib/report-digests-labor-shared";
import type { LinkViewer } from "@/lib/report-digests-links";
import { ROLES, isRoleCode, type RoleCode } from "@/lib/roles";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const DAY = "2026-10-07";
const PERSON_COST_PATH = "people[].straightCostCents";
const PERSON_LABEL_PATH = "people[].label";

const ROLE_CODES = Object.keys(ROLES).filter(isRoleCode) as RoleCode[];
/** Roles the role table does not know: nobody anywhere. */
const UNKNOWN_ROLES = ["", "GM", "admin", "accountant", "owner "];

/** What phase A can seal for a run, and the STORED settings each one stands for (undefined = the report cannot know). */
const SETTINGS: Array<{ name: string; sealed: GmSettingsResult | null; stored: GmVisibility | null | undefined }> = [
  { name: "not read (no settings piece, or it did not finish)", sealed: null, stored: undefined },
  { name: "unavailable (read failed, malformed row, missing table)", sealed: { kind: "unavailable" }, stored: undefined },
  { name: "no row saved (the defaults)", sealed: { kind: "settings", settings: null }, stored: null },
  ...gmVisibilityCombinations().map((s) => ({
    name: `saved: ${GM_VISIBILITY_KEYS.filter((k) => s[k]).join("+") || "everything off"}`,
    sealed: { kind: "settings", settings: s } as GmSettingsResult, stored: s,
  })),
];

/** The recipient's active memberships, relative to shops A and B. */
const MEMBERSHIPS: Array<[string, string[]]> = [["no shop", []], ["A only", [A]], ["B only", [B]], ["A and B", [A, B]]];
/** The deliveries an email can carry (the engine's `deliveryFor`): which digest, and the shops it delivers. */
const DELIVERIES: Array<[string, DigestDelivery | null]> = [
  ["shop digest of A", { kind: "gm_shop", shops: [A] }],
  ["shop digest of B", { kind: "gm_shop", shops: [B] }],
  ["unified, A and B", { kind: "unified", shops: [A, B] }],
  ["unified, A only (narrowed)", { kind: "unified", shops: [A] }],
  ["catering digest, A and B", { kind: "catering", shops: [A, B] }],
  ["no delivery (a package send)", null],
];

/** Is this viewer served each hourly person's labor cost at `shop` by the business report, under these stored settings? */
function reportShowsPersonCost(role: string, memberships: readonly string[], stored: GmVisibility | null | undefined, shop: string): boolean {
  if (!isRoleCode(role)) return false;
  // Settings the run could not read: for THIS comparison assume the most generous stored row a GM could have, so the
  // subset claim is tested against what the digest gives, not helped by an assumption. (The digest gives a GM nothing.)
  const access = businessAccessFor(role, stored === undefined ? { ...GM_VISIBILITY_DEFAULTS, loaded: true, person_salary: true } : stored);
  const paths = businessDtoPaths(access);
  return access.report && paths.includes(PERSON_COST_PATH) && paths.includes(PERSON_LABEL_PATH) && businessShopAllowed({ role, locations: memberships }, shop);
}

/** May this recipient be shown the digest's cost-by-role line for `shop`? Built as the engine builds the access. */
function digestShowsCostByRole(role: string, memberships: readonly string[], sealed: GmSettingsResult | null, delivery: DigestDelivery | null, shop: string): boolean {
  const business = laborBusinessAccess(role, sealed);
  const viewer: LinkViewer = { role, level: isRoleCode(role) ? ROLES[role].level : 0, locations: [...memberships] };
  return digestCan(digestAccessFor(viewer, delivery, business), "labor_cost_by_role", { locationId: shop, day: DAY });
}

describe("D-7: everyone who can be shown cost by role in a digest is already shown each hourly person's cost by the business report, at that shop", () => {
  it("the report's per-person cost path is what this file thinks it is (a pin on the pin)", () => {
    const full = businessDtoPaths(businessAccessFor("owner", null));
    expect(full).toContain(PERSON_COST_PATH);
    expect(full).toContain(PERSON_LABEL_PATH);
    const noCost = businessDtoPaths(businessAccessFor("gm", { ...GM_VISIBILITY_DEFAULTS, person_cost: false }));
    expect(noCost).not.toContain(PERSON_COST_PATH);
    expect(noCost).toContain(PERSON_LABEL_PATH);
  });

  it("SUBSET, exhaustively: role × settings × memberships × delivery × shop", () => {
    let cases = 0;
    let digestYes = 0;
    const outside: string[] = [];
    for (const role of [...ROLE_CODES, ...UNKNOWN_ROLES]) {
      for (const s of SETTINGS) {
        for (const [mName, memberships] of MEMBERSHIPS) {
          for (const [dName, delivery] of DELIVERIES) {
            for (const shop of [A, B, "all", ""]) {
              cases++;
              if (!digestShowsCostByRole(role, memberships, s.sealed, delivery, shop)) continue;
              digestYes++;
              if (!reportShowsPersonCost(role, memberships, s.stored, shop)) outside.push(`${role} | ${s.name} | ${mName} | ${dName} | ${shop}`);
            }
          }
        }
      }
    }
    expect(outside).toEqual([]);
    // The test has teeth: the digest audience is not empty, and the space is the size it claims.
    expect(digestYes).toBeGreaterThan(0);
    expect(cases).toBe((ROLE_CODES.length + UNKNOWN_ROLES.length) * SETTINGS.length * MEMBERSHIPS.length * DELIVERIES.length * 4);
  });

  it("the digest audience, named: MoO / Owner / CGS at a delivered shop; a GM with people AND cost per person on, at a delivered shop they belong to; nobody else", () => {
    const who = new Set<string>();
    for (const role of ROLE_CODES) for (const s of SETTINGS) for (const [, memberships] of MEMBERSHIPS) for (const [, delivery] of DELIVERIES) {
      if (digestShowsCostByRole(role, memberships, s.sealed, delivery, A)) who.add(role);
    }
    expect([...who].sort()).toEqual(["cgs", "gm", "moo", "owner"]);
    const shopA: DigestDelivery = { kind: "gm_shop", shops: [A] };
    const saved = (over: Partial<GmVisibility>): GmSettingsResult => ({ kind: "settings", settings: { ...GM_VISIBILITY_DEFAULTS, ...over } });
    // A GM: both switches, their own shop, the settings readable.
    expect(digestShowsCostByRole("gm", [A], saved({}), shopA, A)).toBe(true);
    expect(digestShowsCostByRole("gm", [A], saved({ person_cost: false }), shopA, A)).toBe(false);
    expect(digestShowsCostByRole("gm", [A], saved({ people: false, person_cost: false, person_salary: false }), shopA, A)).toBe(false);
    expect(digestShowsCostByRole("gm", [A], saved({ hourly_cost: false, loaded: false, quarter_cost: false, person_cost: false, person_salary: false }), shopA, A)).toBe(false);
    expect(digestShowsCostByRole("gm", [A], saved({ report: false }), shopA, A)).toBe(false);
    expect(digestShowsCostByRole("gm", [B], saved({}), shopA, A)).toBe(false); // not their shop
    expect(digestShowsCostByRole("gm", [A], { kind: "unavailable" }, shopA, A)).toBe(false);
    expect(digestShowsCostByRole("gm", [A], null, shopA, A)).toBe(false);
    // Never on the catering digest, never without a delivery, never for a shop the email does not deliver.
    expect(digestShowsCostByRole("owner", [], null, { kind: "catering", shops: [A] }, A)).toBe(false);
    expect(digestShowsCostByRole("owner", [], null, null, A)).toBe(false);
    expect(digestShowsCostByRole("owner", [], null, shopA, B)).toBe(false);
    expect(digestShowsCostByRole("owner", [], null, shopA, A)).toBe(true);
  });

  it("the subset is PROPER and one-directional: the report shows per-person cost to people the digest line never reaches (so the line adds no one)", () => {
    // A GM reads per-person cost in the report for their shop on any day; the digest line exists only in a shop or
    // unified digest that delivers that shop. The catering digest of the same GM: report yes, digest no.
    expect(reportShowsPersonCost("gm", [A], null, A)).toBe(true);
    expect(digestShowsCostByRole("gm", [A], { kind: "settings", settings: null }, { kind: "catering", shops: [A] }, A)).toBe(false);
  });

  it("every other role, whatever is passed, is in NEITHER audience", () => {
    for (const role of [...ROLE_CODES.filter((r) => !["gm", "moo", "owner", "cgs"].includes(r)), ...UNKNOWN_ROLES]) {
      for (const s of SETTINGS) for (const [, memberships] of MEMBERSHIPS) for (const [, delivery] of DELIVERIES) {
        expect(digestShowsCostByRole(role, memberships, s.sealed, delivery, A), role).toBe(false);
        expect(reportShowsPersonCost(role, memberships, s.stored, A), role).toBe(false);
      }
    }
  });
});
