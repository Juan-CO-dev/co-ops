/**
 * Unit spine — THE SKU-ADMIN LOCATION BINDS (audit v2 P1-2, 2026-09-01).
 *
 * `lib/admin/skus.ts` gated every write on LEVEL (`requireLevel(actor, 7)`) and never on
 * LOCATION: `grep -c lockLocationContext lib/admin/skus.ts` was 0. `lockLocationContext`'s
 * all-locations grant starts at 9, and at CO every GM holds exactly ONE shop — so a GM
 * scoped to Capitol Hill could PUT a P Street par overlay (dropping an ingredient out of
 * that shop's order walk = a silent stockout), mint a SKU scoped to P Street, reassign a
 * P Street SKU's location, or deactivate it. AGENTS.md § Dynamic pars: "the location bind
 * lives IN THE LIB… Level 7 is NOT all-locations". The walker's accept/revert obeyed it;
 * this admin path — writing the SAME table — did not. `lib/products.ts` setPrimary has the
 * exact guard, with a comment naming this attack, from the same T0 sweep.
 *
 * Technique (tests/catering-authz.test.ts): the permitted call is proven by the NEXT
 * guard. The bind sits ahead of payload validation, so an out-of-scope actor gets the
 * tenancy refusal while an in-scope (or all-locations) actor sending the SAME invalid
 * payload gets the VALIDATION error — refusal, grant and ORDER pinned in one pair, no I/O
 * (the vitest env has no Supabase; reaching getServiceRoleClient throws loudly).
 * Where the bind CANNOT precede I/O (a SKU addressed by opaque id must be read before its
 * location is known), the ordering is pinned by source assertion.
 *
 * Refusal shape: 404 `not_found` (the IDOR two-halves law's 404-mask; `lib/products.ts`
 * setPrimary's spelling), never `forbidden` — a 403 would confirm the foreign location exists.
 * `null` location = the GLOBAL/org-scope row and is deliberately NOT bound (same rule as
 * products.ts: "null is the GLOBAL default row and is deliberately org-scope").
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { createSku, upsertLocationSkuSettings, SKU_WRITE_MIN } from "@/lib/admin/skus";
import { getRoleLevel } from "@/lib/roles";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(repoRoot, "lib/admin/skus.ts"), "utf8");
const fnSrc = (name: string): string => {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `export async function ${name} must exist`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
};

const LOCATION_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_B = "22222222-2222-4222-8222-222222222222";
const SKU_ID = "33333333-3333-4333-8333-333333333333";

/** A level-7 GM who holds shop A only — exactly today's par-write floor. */
const gmAtA = { user: { id: "u-gm", role: "gm" as const, language: "en" as const }, locations: [LOCATION_A] };
/** Level 9 carries the all-locations grant with an EMPTY assignment list. */
const ownerAnywhere = { user: { id: "u-own", role: "owner" as const, language: "en" as const }, locations: [] as string[] };

type SkuActor = Parameters<typeof createSku>[0];
type CreateInput = Parameters<typeof createSku>[1];
type OverlayInput = Parameters<typeof upsertLocationSkuSettings>[1];

describe("premise: the SKU write floor sits BELOW the all-locations grant", () => {
  it("gm is 7, SKU_WRITE_MIN is 7, owner is 9", () => {
    expect(getRoleLevel("gm")).toBe(7);
    expect(SKU_WRITE_MIN).toBe(7);
    expect(getRoleLevel("owner")).toBe(9);
  });
});

describe("upsertLocationSkuSettings (the par overlay) binds locationId before it reads the payload", () => {
  /** Deliberately invalid activeOverride: the first pure check AFTER the bind. */
  const badPayload = (locationId: string): OverlayInput =>
    ({ skuId: SKU_ID, locationId, activeOverride: "bogus", weekdayPar: null, weekendPar: null }) as unknown as OverlayInput;

  it("refuses a GM at shop A writing shop B's overlay — 404 not_found, never forbidden", async () => {
    await expect(upsertLocationSkuSettings(gmAtA as unknown as SkuActor, badPayload(LOCATION_B)))
      .rejects.toMatchObject({ name: "AdminSkuError", status: 404, code: "not_found" });
  });
  it("lets the same GM through at their OWN shop (and only then validates the payload)", async () => {
    await expect(upsertLocationSkuSettings(gmAtA as unknown as SkuActor, badPayload(LOCATION_A)))
      .rejects.toMatchObject({ name: "AdminSkuError", status: 400, code: "invalid_active_override" });
  });
  it("lets an all-locations actor through anywhere, assignment list empty", async () => {
    await expect(upsertLocationSkuSettings(ownerAnywhere as unknown as SkuActor, badPayload(LOCATION_B)))
      .rejects.toMatchObject({ name: "AdminSkuError", status: 400, code: "invalid_active_override" });
  });
});

describe("createSku binds a shop-scoped locationId before it validates the name", () => {
  /** Deliberately empty name: the first pure check AFTER the bind. */
  const badPayload = (locationId: string | null): CreateInput =>
    ({ name: "", packFormat: "case", locationId }) as unknown as CreateInput;

  it("refuses a GM at shop A minting a SKU scoped to shop B — 404 not_found", async () => {
    await expect(createSku(gmAtA as unknown as SkuActor, badPayload(LOCATION_B)))
      .rejects.toMatchObject({ name: "AdminSkuError", status: 404, code: "not_found" });
  });
  it("lets the same GM mint at their OWN shop (then validates)", async () => {
    await expect(createSku(gmAtA as unknown as SkuActor, badPayload(LOCATION_A)))
      .rejects.toMatchObject({ name: "AdminSkuError", status: 400, code: "invalid_name" });
  });
  it("a GLOBAL SKU (locationId null) is org-scope and is not bound", async () => {
    await expect(createSku(gmAtA as unknown as SkuActor, badPayload(null)))
      .rejects.toMatchObject({ name: "AdminSkuError", status: 400, code: "invalid_name" });
  });
  it("lets an all-locations actor mint anywhere", async () => {
    await expect(createSku(ownerAnywhere as unknown as SkuActor, badPayload(LOCATION_B)))
      .rejects.toMatchObject({ name: "AdminSkuError", status: 400, code: "invalid_name" });
  });
});

describe("updateSku binds BOTH the SKU's current shop and the reassignment target (opaque id → read first)", () => {
  const fn = fnSrc("updateSku");
  it("reads the current location_id, binds it, and only then UPDATEs", () => {
    const read = fn.indexOf("location_id");
    const bind = fn.indexOf("lockLocationContext");
    const update = fn.indexOf(".update(");
    expect(read).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(read);
    expect(update).toBeGreaterThan(bind);
  });
  it("binds the reassignment TARGET too (changes.locationId), and refuses as not_found", () => {
    // Two binds: the SKU's own shop (so a GM at A cannot move B's SKU) and the destination
    // (so a GM at A cannot park a SKU at B). Moving a SKU is a write against both shops.
    const binds = fn.split("lockLocationContext").length - 1;
    expect(binds).toBeGreaterThanOrEqual(2);
    expect(fn).toContain('AdminSkuError(404, "not_found"');
  });
});

describe("deactivateSku binds the SKU's own shop before flipping active (opaque id → read first)", () => {
  const fn = fnSrc("deactivateSku");
  it("reads location_id, binds it, and only then UPDATEs; foreign SKU answers not_found", () => {
    const read = fn.indexOf("location_id");
    const bind = fn.indexOf("lockLocationContext");
    const update = fn.indexOf(".update(");
    expect(read).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(read);
    expect(update).toBeGreaterThan(bind);
    const refusal = fn.slice(bind, update);
    expect(refusal).toContain('AdminSkuError(404, "not_found"');
    expect(refusal).not.toContain('"forbidden"');
  });
});

describe("loadLocationSkuSettings scopes the overlay READ to the actor's shops (a GM at A must not see B's pars)", () => {
  const fn = fnSrc("loadLocationSkuSettings");
  it("filters location_id by the actor's accessible locations unless all-locations", () => {
    expect(fn).toMatch(/isAllLocationsAccess|accessibleLocations|visibleLocationScope/);
    expect(fn).toContain('"location_id"');
  });
});
