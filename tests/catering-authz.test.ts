/**
 * Unit spine — THE CATERING LOCATION BINDS, and the contact-identity fork.
 *
 * WHY THESE LIVE IN THE VITEST SPINE AT ALL. Every write here sits behind a role floor of
 * 6 or 7, and lockLocationContext's all-locations grant does not start until 9 — so at CO,
 * where every level 6/7/8 account holds exactly ONE store (probed live 2026-08-29: both
 * GMs single-shop, the AGM single-shop, MoO/owner/CGS both), the floor alone never answers
 * "which shop?". A missing bind is invisible in a type-check and invisible in a smoke test
 * run by someone who only has one login. It is visible here.
 *
 * THE PERMITTED CALL IS PROVEN BY THE *NEXT* GUARD, NOT BY A DATABASE. Each bind is placed
 * ahead of that function's payload validation, so an all-locations actor sending a
 * deliberately invalid payload comes back with the VALIDATION error while a single-shop
 * actor sending the same payload comes back with `forbidden`. One pair of assertions
 * therefore pins three things at once — the refusal, the grant, and the ORDER (authz
 * before parsing) — and it touches no I/O, so these tests cannot degrade into integration
 * tests against a live project.
 *
 * Where the bind CANNOT precede I/O (a resource addressed by opaque id must be read before
 * its location is known), the guarantee is pinned by source assertion — the house fallback
 * for an I/O-ordering property, same posture as tests/dynamic-pars-walker.test.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { createLtoEvent, type CreateLtoEventInput } from "@/lib/catering/lto";
import { createFaq } from "@/lib/admin/catering/faq";
import { upsertFulfillmentNode } from "@/lib/admin/catering/fulfillment";
import { getRoleLevel } from "@/lib/roles";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** Two shops, so "bound to A, acting on B" is a fact and not a mood. */
const LOCATION_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_B = "22222222-2222-4222-8222-222222222222";

/** A level-6 catering manager who holds shop A only — the LTO/FAQ author. */
const cateringMgrAtA = {
  user: { id: "u1", role: "catering_mgr" as const, language: "en" as const },
  locations: [LOCATION_A],
};
/** A level-7 GM who holds shop A only — the fulfillment-node author. */
const gmAtA = {
  user: { id: "u2", role: "gm" as const, language: "en" as const },
  locations: [LOCATION_A],
};
/** Level 9 carries the all-locations grant with an EMPTY assignment list. */
const ownerAnywhere = {
  user: { id: "u3", role: "owner" as const, language: "en" as const },
  locations: [] as string[],
};

type LtoActor = Parameters<typeof createLtoEvent>[0];
type FaqActor = Parameters<typeof createFaq>[0];
type NodeActor = Parameters<typeof upsertFulfillmentNode>[0];

describe("the floors these binds exist for are all BELOW the all-locations grant", () => {
  it("catering_mgr is 6 and gm is 7 — neither is 9", () => {
    // If a future renumber lifted either to 9 these binds would become no-ops, and the
    // tests below would still pass while asserting nothing. Pin the premise.
    expect(getRoleLevel("catering_mgr")).toBe(6);
    expect(getRoleLevel("gm")).toBe(7);
    expect(getRoleLevel("owner")).toBe(9);
  });
});

// ── LTO / discount events ────────────────────────────────────────────────────
describe("createLtoEvent binds the location before it reads the payload", () => {
  /** Deliberately invalid `kind`: the first check AFTER the bind. */
  const badPayload = (locationId: string): CreateLtoEventInput => ({
    locationId,
    kind: "nope" as unknown as CreateLtoEventInput["kind"],
    name: "Half-price antipasto",
    discountBps: 5000,
    promoPriceCents: null,
    startsOn: "2026-09-01",
    endsOn: "2026-09-03",
    note: null,
    items: [{ itemId: "i1", menuItemId: null, nameSnapshot: "Antipasto", qty: 2, sourcePipelineId: null }],
  });

  it("refuses a catering_mgr at shop A publishing a discount at shop B", async () => {
    // Without the bind this call would have inserted a LIVE price directive into the other
    // store's board — the role floor alone said yes.
    await expect(
      createLtoEvent(cateringMgrAtA as unknown as LtoActor, badPayload(LOCATION_B)),
    ).rejects.toMatchObject({ name: "LtoError", status: 403, code: "forbidden" });
  });

  it("lets the same actor through at their OWN shop (and only then reads the payload)", async () => {
    await expect(
      createLtoEvent(cateringMgrAtA as unknown as LtoActor, badPayload(LOCATION_A)),
    ).rejects.toMatchObject({ name: "LtoError", status: 400, code: "invalid_kind" });
  });

  it("lets an all-locations actor through anywhere, assignment list empty", async () => {
    await expect(
      createLtoEvent(ownerAnywhere as unknown as LtoActor, badPayload(LOCATION_B)),
    ).rejects.toMatchObject({ name: "LtoError", status: 400, code: "invalid_kind" });
  });
});

describe("cancelLtoEvent binds the event's OWN location, and refuses as 404", () => {
  const fn = (() => {
    const s = srcOf("lib/catering/lto.ts");
    return s.slice(s.indexOf("export async function cancelLtoEvent"));
  })();

  it("reads location_id, binds it, and only then flips the status", () => {
    // The event is addressed by opaque id, so the read must come first. What must NOT
    // happen is the read being purely decorative: the bind has to sit between it and the
    // UPDATE, or any level-6 account can kill any live discount in the tenant.
    const read = fn.indexOf('.select("id, location_id")');
    const bind = fn.indexOf("lockLocationContext");
    const update = fn.indexOf('status: "cancelled"');
    expect(read).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(read);
    expect(update).toBeGreaterThan(bind);
  });

  it("answers a foreign event with not_found, never forbidden", () => {
    // A 403 would confirm that this id names a live discount at a shop the actor does not
    // hold — the same posture lib/receiving.ts takes on a delivery id.
    const refusal = fn.slice(fn.indexOf("lockLocationContext"), fn.indexOf('status: "cancelled"'));
    expect(refusal).toContain('LtoError(404, "not_found"');
    expect(refusal).not.toContain('"forbidden"');
  });
});

// ── Catering FAQ ─────────────────────────────────────────────────────────────
describe("createFaq binds a location-scoped FAQ before it reads the payload", () => {
  /** Empty question_en: the first check AFTER the bind. */
  const badPayload = (locationId: string | null) => ({
    locationId,
    questionEn: "   ",
    answerEn: "Yes.",
  });

  it("refuses an AGM-tier actor authoring into a shop they do not hold", async () => {
    await expect(
      createFaq(cateringMgrAtA as unknown as FaqActor, badPayload(LOCATION_B)),
    ).rejects.toMatchObject({ name: "AdminCateringError", status: 403, code: "forbidden" });
  });

  it("lets them author at their own shop", async () => {
    await expect(
      createFaq(cateringMgrAtA as unknown as FaqActor, badPayload(LOCATION_A)),
    ).rejects.toMatchObject({ name: "AdminCateringError", status: 400, code: "invalid_label" });
  });

  it("leaves the GLOBAL (null) lane exactly as it was — that floor is the chair's call", () => {
    // Deliberate: a null location_id is the tenant-wide row, and level 6 authoring it is a
    // standing capability of this editor (the form's picker DEFAULTS to Global). Raising
    // that floor is a role-gate change needing the lib+RLS+UI sweep, not a bug fix — it is
    // filed, not smuggled. This test exists so the deliberate part stays deliberate.
    return expect(
      createFaq(cateringMgrAtA as unknown as FaqActor, badPayload(null)),
    ).rejects.toMatchObject({ status: 400, code: "invalid_label" });
  });
});

describe("the FAQ edit + deactivate paths bind the row's own location", () => {
  const faqSrc = srcOf("lib/admin/catering/faq.ts");
  const body = (name: string): string => {
    const start = faqSrc.indexOf(`export async function ${name}(`);
    const rest = faqSrc.slice(start + 1);
    const end = rest.indexOf("\nexport ");
    return end === -1 ? rest : rest.slice(0, end);
  };

  for (const name of ["updateFaqText", "deactivateFaq"]) {
    it(`${name} asserts the bind before its UPDATE`, () => {
      // Both learn the location from the row they just read, so the guard cannot precede
      // I/O — but it must precede the WRITE. Without it, a retitle or a deactivation of
      // another store's row succeeds silently and looks like ordinary editing in the log.
      const fn = body(name);
      const bind = fn.indexOf("assertFaqLocationWritable");
      const write = fn.indexOf(".update(");
      expect(bind).toBeGreaterThan(-1);
      expect(write).toBeGreaterThan(bind);
    });
  }
});

// ── Fulfillment nodes ────────────────────────────────────────────────────────
describe("upsertFulfillmentNode binds the location before it reads the payload", () => {
  /** Out-of-range radius: the first check AFTER the bind. */
  const badPayload = (locationId: string) => ({
    locationId,
    lat: 38.9,
    lng: -77.03,
    radiusMiles: 0,
    offersDelivery: true,
    offersPickup: true,
  });

  it("refuses a GM at shop A reshaping shop B's delivery map", async () => {
    // catering_fulfillment_nodes is read by lib/catering/fulfillment-routing.ts to decide
    // which store a customer's delivery goes to. An unbound write is not cosmetic.
    await expect(
      upsertFulfillmentNode(gmAtA as unknown as NodeActor, badPayload(LOCATION_B)),
    ).rejects.toMatchObject({ name: "FulfillmentError", status: 403, code: "forbidden" });
  });

  it("lets the same GM configure their own shop", async () => {
    await expect(
      upsertFulfillmentNode(gmAtA as unknown as NodeActor, badPayload(LOCATION_A)),
    ).rejects.toMatchObject({ name: "FulfillmentError", status: 400, code: "invalid_radius" });
  });

  it("scopes the node LIST to the same authority that gates the write", () => {
    // The list feeds the editor's location picker, i.e. it IS the write-target list. If it
    // offers a store the upsert now refuses, the surface ships a dead option that 403s on
    // Save — the zones editor already scopes its groups for exactly this reason.
    const src = srcOf("lib/admin/catering/fulfillment.ts");
    const fn = src.slice(src.indexOf("export async function loadFulfillmentNodes"));
    expect(fn.slice(0, fn.indexOf("export async function upsertFulfillmentNode"))).toContain(
      "lockLocationContext",
    );
  });
});

// ── Contact identity: revive, never fork ─────────────────────────────────────
describe("a deactivated contact is revived, never forked into a second id", () => {
  const companiesSrc = srcOf("lib/catering/companies.ts");
  const magicSrc = srcOf("lib/portal/magic-link.ts");

  const resolvePath = (src: string, fnName: string): string => {
    const start = src.indexOf(`export async function ${fnName}(`);
    const rest = src.slice(start + 1);
    const end = rest.indexOf("\nexport ");
    return end === -1 ? rest : rest.slice(0, end);
  };

  it("reviveInactiveContact treats a NULL `active` as not-active", () => {
    // catering_customers.active is `boolean DEFAULT true` — nullable (migration 0108) —
    // and the partial unique index reads NULL as not-active. A lookup written as
    // `.eq("active", false)` would miss such a row and fork it exactly like a false one.
    const fn = resolvePath(companiesSrc, "reviveInactiveContact");
    expect(fn).toContain("active.is.null,active.is.false");
    expect(fn).not.toContain('.eq("active", false)');
  });

  it("reviveInactiveContact flips the row under a guard, and audits the revival", () => {
    const fn = resolvePath(companiesSrc, "reviveInactiveContact");
    // Compare-and-set: the loser of a double request gets 0 rows, not a second revival.
    const flip = fn.indexOf('.update({ active: true })');
    expect(flip).toBeGreaterThan(-1);
    expect(fn.slice(flip)).toContain("active.is.null,active.is.false");
    // A revival changes who a portal session belongs to; it does not happen unlogged.
    expect(fn).toContain('action: "catering.customer.activate"');
  });

  for (const [label, src, fnName] of [
    ["the portal magic-link path", magicSrc, "resolveOrCreatePortalCustomer"],
    ["the staff quote-capture path", companiesSrc, "resolveOrCreateContact"],
  ] as const) {
    it(`${label} looks for the deactivated row BEFORE inserting a new one`, () => {
      // This is the whole bug: the active-only lookup misses the deactivated row, the
      // partial index permits the insert beside it, and one person becomes two customer
      // ids — with every prior quote and payment stranded on the id they no longer are.
      const fn = resolvePath(src, fnName);
      const revive = fn.indexOf("reviveInactiveContact");
      const insert = fn.indexOf(".insert(");
      expect(revive).toBeGreaterThan(-1);
      expect(insert).toBeGreaterThan(revive);
    });
  }
});
