/**
 * Catering delivery D1 — the access gates (plan r6 section 5), by trusted ROLE. The whole matrix: every role x own shop /
 * other shop, plus the job-scoped pickup-shop history gate. The SQL twin of the write gate (delivery_actor_role) is
 * exercised role by role in scripts/sql-harness-0356.mjs.
 */
import { describe, expect, it } from "vitest";
import { ROLES, type RoleCode } from "@/lib/roles";
import {
  deliveryActorOf, deliveryCostReadAllowed, deliveryDetailReadAllowed, deliveryJobHistoryReadAllowed, deliveryReadPossible, deliverySettingsWriteAllowed,
  deliveryStatusReadAllowed, deliveryWriteAllowed, type DeliveryActor,
} from "@/lib/delivery/access-shared";

const OWN = "shop-own", OTHER = "shop-other";
const actor = (role: RoleCode, over: Partial<DeliveryActor> = {}): DeliveryActor => ({ role, active: true, locations: [OWN], ...over });
const ALL = Object.keys(ROLES) as RoleCode[];

/** [status own, status other, detail own, detail other, write own, write other, cost own, cost other, settings] */
const MATRIX: Record<RoleCode, string> = {
  cgs:                  "YY YY YY YY Y",
  owner:                "YY YY YY YY Y",
  moo:                  "YY YY YY YY Y",
  gm:                   "Y- Y- Y- Y- -",
  agm:                  "Y- Y- Y- Y- -",
  catering_mgr:         "YY YY YY YY -",
  prep_mgr:             "Y- -- -- -- -",
  social_media_mgr:     "-- -- -- -- -",
  shift_lead:           "Y- -- -- -- -",
  key_holder:           "Y- -- -- -- -",
  trainer:              "Y- -- -- -- -",
  employee:             "-- -- -- -- -",
  trainee:              "-- -- -- -- -",
  hired_not_yet_worked: "-- -- -- -- -",
  prospect:             "-- -- -- -- -",
};

describe("the role matrix", () => {
  it("names every role", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...ALL].sort());
  });

  it.each(ALL)("%s", (role) => {
    const a = actor(role);
    const got = [
      [deliveryStatusReadAllowed(a, OWN), deliveryStatusReadAllowed(a, OTHER)],
      [deliveryDetailReadAllowed(a, OWN), deliveryDetailReadAllowed(a, OTHER)],
      [deliveryWriteAllowed(a, OWN), deliveryWriteAllowed(a, OTHER)],
      [deliveryCostReadAllowed(a, OWN), deliveryCostReadAllowed(a, OTHER)],
      [deliverySettingsWriteAllowed(a)],
    ].map((pair) => pair.map((ok) => (ok ? "Y" : "-")).join("")).join(" ");
    expect(got).toBe(MATRIX[role]);
  });

  it("level alone never admits: the prep manager and the social media manager are level 6 like the AGM", () => {
    expect(ROLES.prep_mgr.level).toBe(ROLES.agm.level);
    expect(ROLES.social_media_mgr.level).toBe(ROLES.agm.level);
    for (const role of ["prep_mgr", "social_media_mgr"] as const) {
      expect(deliveryWriteAllowed(actor(role), OWN)).toBe(false);
      expect(deliveryDetailReadAllowed(actor(role), OWN)).toBe(false);
      expect(deliveryCostReadAllowed(actor(role), OWN)).toBe(false);
    }
    expect(deliveryStatusReadAllowed(actor("social_media_mgr"), OWN)).toBe(false);
  });

  it("the cost gate is the write gate (a person who may type the cost may read it)", () => {
    for (const role of ALL) for (const shop of [OWN, OTHER, null]) {
      expect(deliveryCostReadAllowed(actor(role), shop)).toBe(deliveryWriteAllowed(actor(role), shop));
    }
  });

  it("an inactive person passes no gate", () => {
    for (const role of ALL) {
      const a = actor(role, { active: false });
      expect([deliveryStatusReadAllowed(a, OWN), deliveryDetailReadAllowed(a, OWN), deliveryWriteAllowed(a, OWN), deliveryCostReadAllowed(a, OWN),
        deliveryJobHistoryReadAllowed(a, OWN), deliverySettingsWriteAllowed(a), deliveryReadPossible(a)]).toEqual(Array(7).fill(false));
    }
  });

  it("a lead with no shop: only the any-shop roles", () => {
    for (const role of ALL) {
      const any = ["cgs", "owner", "moo", "catering_mgr"].includes(role);
      expect([role, deliveryWriteAllowed(actor(role), null), deliveryStatusReadAllowed(actor(role), null)]).toEqual([role, any, any]);
    }
  });

  it("membership is the list on the actor, nothing else", () => {
    expect(deliveryWriteAllowed(actor("gm", { locations: [] }), OWN)).toBe(false);
    expect(deliveryWriteAllowed(actor("agm", { locations: [OTHER, OWN] }), OWN)).toBe(true);
    expect(deliveryStatusReadAllowed(actor("key_holder", { locations: [] }), OWN)).toBe(false);
  });
});

describe("pickup-shop history (job-scoped, r6)", () => {
  it.each(ALL)("%s", (role) => {
    const a = actor(role);
    const allowed = role === "gm" || role === "agm";
    // The job was recorded for pickup at the actor's shop.
    expect(deliveryJobHistoryReadAllowed(a, OWN)).toBe(allowed);
    // ... at another shop: never.
    expect(deliveryJobHistoryReadAllowed(a, OTHER)).toBe(false);
  });

  it("after a transfer A -> B: A's GM reads A's job only, through this gate, and passes no lead-scoped gate at B", () => {
    const gmA = actor("gm", { locations: ["A"] });
    expect(deliveryJobHistoryReadAllowed(gmA, "A")).toBe(true);
    expect(deliveryJobHistoryReadAllowed(gmA, "B")).toBe(false);
    expect([deliveryStatusReadAllowed(gmA, "B"), deliveryDetailReadAllowed(gmA, "B"), deliveryCostReadAllowed(gmA, "B"), deliveryWriteAllowed(gmA, "B")]).toEqual(Array(4).fill(false));
  });
});

describe("deliveryReadPossible: the coarse check before any I/O", () => {
  it.each(ALL)("%s", (role) => {
    const possible = !["social_media_mgr", "employee", "trainee", "hired_not_yet_worked", "prospect"].includes(role);
    expect(deliveryReadPossible(actor(role))).toBe(possible);
    // Nobody who is refused here could pass a real gate anywhere.
    if (!possible) for (const shop of [OWN, OTHER, null]) {
      expect([deliveryStatusReadAllowed(actor(role), shop), deliveryDetailReadAllowed(actor(role), shop), deliveryJobHistoryReadAllowed(actor(role), shop)]).toEqual([false, false, false]);
    }
  });
});

describe("deliveryActorOf: the trusted role, the active flag and the live memberships of the session", () => {
  it("reads role, user.active and locations", () => {
    expect(deliveryActorOf({ role: "gm", locations: [OWN], user: { active: true } })).toEqual({ role: "gm", active: true, locations: [OWN] });
    expect(deliveryActorOf({ role: "gm", locations: [OWN], user: { active: false } }).active).toBe(false);
  });
});
