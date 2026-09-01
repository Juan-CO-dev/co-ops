/**
 * Unit spine — THE CONTACT-SIDE LOCATION BINDS in lib/catering/companies.ts (audit v2
 * P2-4 + the quotes-route ordering finding, 2026-09-01), plus the lead `customerId` gap.
 *
 * A catering_company is a CROSS-LOCATION account BY DESIGN (companies.ts header) — those
 * writes stay org-scope. The CONTACT (`catering_customers`) is per-shop: its sibling
 * `lib/catering/customers.ts` scopes every access by `primary_location_id` (`assertCanWrite`
 * on writes, `readScopeOr` on reads). `companies.ts` reads and writes the SAME table with a
 * bare level gate on a service-role client — so `attachContactByEmail` was an email-existence
 * + UUID oracle across the whole customer base, `setContactCompany` mutated the other shop's
 * contact by id, `loadCompany` rendered the other shop's contacts, and `resolveOrCreateContact`
 * INSERTed a row stamped with a caller-chosen `primaryLocationId` BEFORE `createQuote`'s own
 * location check ran (the route order) — a 403 that leaves a permanent append-only row.
 *
 * Refusal spelling mirrors customers.ts on this table: 403 `location_access_denied`.
 * Technique: tests/catering-authz.test.ts — permitted call proven by the NEXT guard; opaque-id
 * paths pinned by source assertion.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { resolveOrCreateContact } from "@/lib/catering/companies";

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

/** A level-6 catering manager who holds shop A only. */
const cateringMgrAtA = { user: { id: "u-cm", role: "catering_mgr" as const, language: "en" as const }, locations: [LOCATION_A] };
const ownerAnywhere = { user: { id: "u-own", role: "owner" as const, language: "en" as const }, locations: [] as string[] };

type Actor = Parameters<typeof resolveOrCreateContact>[0];
type Input = Parameters<typeof resolveOrCreateContact>[1];

describe("resolveOrCreateContact binds primaryLocationId before it validates the email (so the route order stops mattering)", () => {
  /** Deliberately invalid email: the first pure check AFTER the bind. */
  const bad = (primaryLocationId: string | null): Input => ({ email: "not-an-email", name: null, company: null, primaryLocationId });

  it("refuses a catering_mgr at shop A minting a contact homed at shop B — 403 location_access_denied", async () => {
    // Without the bind, the quotes route committed this INSERT (append-only, no cleanup) and
    // only THEN 403'd on createQuote's own check.
    await expect(resolveOrCreateContact(cateringMgrAtA as unknown as Actor, bad(LOCATION_B)))
      .rejects.toMatchObject({ name: "CateringCompanyError", status: 403, code: "location_access_denied" });
  });
  it("lets the same actor through at their OWN shop (then validates the email)", async () => {
    await expect(resolveOrCreateContact(cateringMgrAtA as unknown as Actor, bad(LOCATION_A)))
      .rejects.toMatchObject({ name: "CateringCompanyError", status: 400, code: "invalid_payload" });
  });
  it("a contact with NO home shop (null) is not bound — the customers.ts rule", async () => {
    await expect(resolveOrCreateContact(cateringMgrAtA as unknown as Actor, bad(null)))
      .rejects.toMatchObject({ name: "CateringCompanyError", status: 400, code: "invalid_payload" });
  });
  it("lets an all-locations actor through anywhere", async () => {
    await expect(resolveOrCreateContact(ownerAnywhere as unknown as Actor, bad(LOCATION_B)))
      .rejects.toMatchObject({ name: "CateringCompanyError", status: 400, code: "invalid_payload" });
  });
});

describe("the opaque-id and lookup paths on catering_customers are scoped (source-pinned)", () => {
  const companies = srcOf("lib/catering/companies.ts");

  it("setContactCompany reads the contact's primary_location_id and binds it BEFORE the UPDATE", () => {
    const fn = fnOf(companies, "setContactCompany");
    const read = fn.indexOf("primary_location_id");
    // The bind is customers.ts' spelling on this table: assertCanWrite (level floor +
    // lockLocationContext + 403 location_access_denied), so the two siblings refuse alike.
    const bind = fn.search(/assertCanWrite|lockLocationContext/);
    const update = fn.indexOf(".update(");
    expect(read).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(read);
    expect(update).toBeGreaterThan(bind);
  });

  it("attachContactByEmail scopes the email lookup to the actor's shops (no cross-tenant existence oracle)", () => {
    const fn = fnOf(companies, "attachContactByEmail");
    // The lookup itself must carry the scope — a post-hoc 404 would still leak
    // "exists elsewhere" through timing/shape. Mirror customers.ts readScopeOr.
    expect(fn).toMatch(/readScopeOr|isAllLocationsAccess|accessibleLocations/);
  });

  it("loadCompany lists only contacts the actor may see", () => {
    const fn = fnOf(companies, "loadCompany");
    expect(fn).toMatch(/readScopeOr|isAllLocationsAccess|accessibleLocations/);
  });
});

describe("createLead / editLead validate a supplied customerId through a scoped read, like assignedTo", () => {
  const pipeline = srcOf("lib/catering/pipeline.ts");
  it("createLead checks customerId is a contact the actor may see before writing customer_id", () => {
    const fn = fnOf(pipeline, "createLead");
    const check = fn.search(/requireVisibleCustomer|assertCustomerVisible/);
    const write = fn.indexOf("customer_id:");
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(check);
  });
  it("editLead does the same", () => {
    const fn = fnOf(pipeline, "editLead");
    const check = fn.search(/requireVisibleCustomer|assertCustomerVisible/);
    const write = fn.indexOf("patch.customer_id");
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(check);
  });
});
