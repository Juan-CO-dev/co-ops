/**
 * Nav PR 5, group 13 (plan r4, 6.4): the social media manager. Decided by the REAL role first; for this viewer the engine
 * reads ONLY SmmFacts (own checklist tasks, own station). Failures are explicit ("unavailable" + a parameterless note),
 * never an empty list. Given shop facts by mistake, the output carries nothing from them, and a proxy records zero reads
 * of any shop field (a read of the `kind` discriminator is allowed).
 */
import { describe, expect, it } from "vitest";
import { lensFor } from "@/lib/day-plan-shared";
import { ROLES, type RoleCode } from "@/lib/roles";

describe("the lens is decided by the real role", () => {
  it("lensFor: smm for the social media manager, shop for every other role", () => {
    for (const role of Object.keys(ROLES) as RoleCode[]) expect(lensFor(role), role).toBe(role === "social_media_mgr" ? "smm" : "shop");
  });
});
