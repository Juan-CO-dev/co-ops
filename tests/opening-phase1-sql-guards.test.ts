/**
 * W13/B073 + B074 — submitPhase1Atomic names the 0313 SQL refusals, and the route mapper gives
 * each one its status: phase1_incomplete → 422 with the missing count, item_not_in_template → 400,
 * wrong_checklist_type → the role refusal (403). en + es copy exists for both new codes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { audit } from "@/lib/audit";
import { mapOpeningError } from "@/app/api/opening/_helpers";
import {
  OpeningItemNotInTemplateError,
  OpeningPhase1IncompleteError,
  OpeningRoleViolationError,
  submitPhase1Atomic,
} from "@/lib/opening";

const INSTANCE = "33333333-3333-4333-8333-333333333333";
const ITEM = "44444444-4444-4444-8444-444444444444";
const actor = { userId: "kh", role: "key_holder" as const, level: 4 };

function service(rpcError: { code: string; message: string }) {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q;
  q.maybeSingle = async () => ({ data: { location_id: "shop", date: "2026-11-15", status: "open", template: { type: "opening" } }, error: null });
  const rpc = vi.fn(async () => ({ data: null, error: rpcError }));
  return { client: { from: () => q, rpc } as unknown as SupabaseClient, rpc };
}
const submit = (client: SupabaseClient) => submitPhase1Atomic(client, {
  instanceId: INSTANCE, actor, entries: [], sectionVerifications: [], openerNoPriorDataAttestation: null,
});

beforeEach(() => vi.clearAllMocks());

describe("0313 Phase 1 refusals are named", () => {
  it("maps phase1_incomplete to a 422 with the missing count", async () => {
    const { client, rpc } = service({ code: "P0001", message: "submit_phase1_atomic: phase1_incomplete — 3 spot-check item(s) have no Phase 1 entry" });
    const err = await submit(client).catch((e: unknown) => e);
    expect(rpc).toHaveBeenCalledOnce();
    expect(err).toBeInstanceOf(OpeningPhase1IncompleteError);
    expect(err).toMatchObject({ code: "phase1_incomplete", missingCount: 3 });
    const res = mapOpeningError(err as OpeningPhase1IncompleteError);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "phase1_incomplete", missing_count: 3 });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ outcome: "phase1_incomplete", missing_count: 3 }) }));
  });

  it("maps item_not_in_template to a 400 naming the item", async () => {
    const { client } = service({ code: "P0001", message: `submit_phase1_atomic: item_not_in_template for item ${ITEM}` });
    const err = await submit(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpeningItemNotInTemplateError);
    const res = mapOpeningError(err as OpeningItemNotInTemplateError);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "item_not_in_template", template_item_id: ITEM });
  });

  it("maps wrong_checklist_type to the role refusal", async () => {
    const { client } = service({ code: "P0001", message: `submit_phase1_atomic: wrong_checklist_type — instance ${INSTANCE} is not an opening` });
    const err = await submit(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpeningRoleViolationError);
    expect(mapOpeningError(err as OpeningRoleViolationError).status).toBe(403);
  });

  it("ships en + es copy for both new codes", () => {
    for (const key of ["opening.error.phase1_incomplete", "opening.error.item_not_in_template"] as const) {
      expect((en as Record<string, string>)[key]).toBeTruthy();
      expect((es as Record<string, string>)[key]).toBeTruthy();
      expect((es as Record<string, string>)[key]).not.toBe((en as Record<string, string>)[key]);
    }
  });
});
