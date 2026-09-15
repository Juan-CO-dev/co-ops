/**
 * Unit spine — LRA-203: the Phase 2 per-item save's concurrent-write LOSER gets a
 * named 409, never a raw 500.
 *
 * Two saves for the same item at the same instant both supersede the same prior live
 * row and both INSERT; 0196's partial unique index
 * (`checklist_completions_one_live_head_per_phase`) refuses the second — sqlstate
 * 23505. The data is correct either way (exactly one live phase-2 head), so the only
 * defect was the ANSWER: 23505 fell past the P0001/23503 branches to a generic
 * `throw new Error(...)`, which mapOpeningError turned into `500 internal_error`.
 *
 * Three halves are pinned here, and each can regress independently: the lib must NAME
 * the 23505 (and audit it as its own outcome, so a race is countable in the audit log
 * rather than hiding inside `rpc_failed`), it must READ THE WINNER BACK and hang it on
 * the error (that row is what makes the client's "showing the latest" notice true
 * rather than hopeful) — while never letting a failed read-back turn the clean 409 back
 * into the 500 this fix removes — and the route mapper must answer 409 with the code
 * AND the row. No DB, no RPC — the service client is a stub, which is exactly the
 * boundary the vitest spine is allowed to reach.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mapOpeningError } from "@/app/api/opening/_helpers";
import { audit } from "@/lib/audit";
import {
  OPENING_BASE_LEVEL,
  OpeningPhase2SaveConflictError,
  savePhase2Item,
} from "@/lib/opening";
import { rowToCompletion } from "@/lib/checklist-rows";
import type { OpeningEntryPhase2 } from "@/lib/types";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const auditMock = vi.mocked(audit);

const TEMPLATE_ITEM_ID = "11111111-2222-4333-8444-555555555555";
const INSTANCE_ID = "99999999-8888-4777-8666-555555555555";
const ACTOR_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** The exact Postgres error a lost race produces against 0196's index. */
const DUPLICATE_KEY = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "checklist_completions_one_live_head_per_phase"',
};

const ENTRY: OpeningEntryPhase2 = {
  templateItemId: TEMPLATE_ITEM_ID,
  phase: "phase2",
  openerPrepped: 11,
  deltaVsPrepNeed: null,
  overPar: null,
  underPar: null,
};

/** The winner's row as Postgres hands it back — snake_case CompletionRow columns. */
const WINNER_ROW = {
  id: "77777777-6666-4555-8444-333333333333",
  instance_id: INSTANCE_ID,
  template_item_id: TEMPLATE_ITEM_ID,
  completed_by: "cccccccc-dddd-4eee-8fff-000000000000",
  completed_at: "2026-09-15T11:04:09.000Z",
  count_value: null,
  photo_id: null,
  notes: null,
  superseded_at: null,
  superseded_by: null,
  revoked_at: null,
  revoked_by: null,
  revocation_reason: null,
  revocation_note: null,
  actual_completer_id: null,
  actual_completer_tagged_at: null,
  actual_completer_tagged_by: null,
  prep_data: {
    phase2: {
      phase: 2,
      opener_prepped: 12,
      over_under_status: "at_par",
      saved_by: "cccccccc-dddd-4eee-8fff-000000000000",
      saved_at: "2026-09-15T11:04:09.000Z",
    },
  },
  auto_complete_meta: null,
  original_completion_id: null,
  edit_count: 0,
};

/**
 * The item's OTHER live row. Dual membership is the whole reason the read-back picks
 * the phase-2 row in JS: a live openingPhase2 item holds its Phase 1 verification row
 * too, so anything that assumes one live row per key finds an error instead of a row.
 */
const SIBLING_PHASE1_ROW = {
  ...WINNER_ROW,
  id: "77777777-6666-4555-8444-222222222222",
  prep_data: { phase1: { ground_truth_count: 2, prep_need: 9 } },
};

type ReadBack =
  | { rows: readonly Record<string, unknown>[] }
  | { error: { message: string } }
  | { throws: true };

/**
 * Minimal service double. `rpc` is the RPC savePhase2Item calls; `from(...)` is the
 * chainable query builder the 23505 read-back walks (select → eq → eq → is → is,
 * awaited at the end), modelled as a self-returning thenable.
 */
function serviceWithRpcError(
  error: { code: string; message: string },
  readBack: ReadBack = { rows: [SIBLING_PHASE1_ROW, WINNER_ROW] },
) {
  const rpc = vi.fn(async () => ({ data: null, error }));
  const from = vi.fn(() => {
    if ("throws" in readBack) throw new Error("transport exploded");
    const settled =
      "error" in readBack
        ? { data: null, error: readBack.error }
        : { data: readBack.rows, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(settled).then(resolve),
    };
    return builder;
  });
  // The lib's parameter is a full SupabaseClient; this path touches `rpc` + `from` alone.
  return { client: { rpc, from } as never, rpc, from };
}

function callSave(service: { client: never }) {
  return savePhase2Item(service.client, {
    instanceId: INSTANCE_ID,
    locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
    actor: { userId: ACTOR_ID, role: "key_holder", level: OPENING_BASE_LEVEL },
    entry: ENTRY,
    confirmedConsumption: null,
  });
}

beforeEach(() => {
  auditMock.mockClear();
});

describe("mapOpeningError — LRA-203 409", () => {
  it("answers 409 phase2_save_conflict and carries the item id", async () => {
    const response = mapOpeningError(new OpeningPhase2SaveConflictError(TEMPLATE_ITEM_ID));

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; template_item_id: string };
    expect(body.code).toBe("phase2_save_conflict");
    expect(body.template_item_id).toBe(TEMPLATE_ITEM_ID);
  });

  it("puts the winning completion in the body as `completion`", async () => {
    const winner = rowToCompletion(WINNER_ROW as never);
    const response = mapOpeningError(
      new OpeningPhase2SaveConflictError(TEMPLATE_ITEM_ID, winner),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { completion: typeof winner };
    // The client adopts this row through readPhase2SaveState → saveStateToFormValue,
    // so the camelCase `prepData` and the id must both survive the wire.
    expect(body.completion.id).toBe(WINNER_ROW.id);
    expect(body.completion.prepData).toEqual(WINNER_ROW.prep_data);
  });

  it("carries completion: null when the winner could not be named", async () => {
    const response = mapOpeningError(new OpeningPhase2SaveConflictError(TEMPLATE_ITEM_ID));
    const body = (await response.json()) as { completion: unknown };
    // Explicitly null, not absent — the client branches on presence.
    expect(body.completion).toBeNull();
  });

  it("no longer falls through to the defensive 500", async () => {
    const response = mapOpeningError(new OpeningPhase2SaveConflictError(TEMPLATE_ITEM_ID));
    const body = (await response.json()) as { code: string };
    expect(response.status).not.toBe(500);
    expect(body.code).not.toBe("internal_error");
  });
});

describe("savePhase2Item — LRA-203 23505 translation", () => {
  it("throws OpeningPhase2SaveConflictError when the RPC reports 23505", async () => {
    const service = serviceWithRpcError(DUPLICATE_KEY);

    await expect(callSave(service)).rejects.toBeInstanceOf(OpeningPhase2SaveConflictError);
    expect(service.rpc).toHaveBeenCalledTimes(1);
  });

  it("carries the winning row back on the error, picked past the live phase-1 sibling", async () => {
    const service = serviceWithRpcError(DUPLICATE_KEY);

    const err = await callSave(service).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpeningPhase2SaveConflictError);
    const conflict = err as OpeningPhase2SaveConflictError;

    expect(service.from).toHaveBeenCalledWith("checklist_completions");
    expect(conflict.liveCompletion?.id).toBe(WINNER_ROW.id);
    // The phase-1 row is live for the same key and must never be adopted as the winner.
    expect(conflict.liveCompletion?.id).not.toBe(SIBLING_PHASE1_ROW.id);
    // Mapped shape, not the raw row — the same thing the 200 body carries.
    expect(conflict.liveCompletion?.templateItemId).toBe(TEMPLATE_ITEM_ID);
    expect(conflict.liveCompletion?.prepData).toEqual(WINNER_ROW.prep_data);
  });

  it.each([
    ["the read-back errors", { error: { message: "PostgREST said no" } } as const],
    ["the read-back throws", { throws: true } as const],
    ["no live phase-2 row is found", { rows: [SIBLING_PHASE1_ROW] } as const],
  ])("still throws the conflict with liveCompletion null when %s", async (_label, readBack) => {
    const service = serviceWithRpcError(DUPLICATE_KEY, readBack);

    const err = await callSave(service).catch((e: unknown) => e);
    // The whole point: a failed read-back may cost the winner's identity, never the
    // 409. Regressing this puts the raw 500 straight back.
    expect(err).toBeInstanceOf(OpeningPhase2SaveConflictError);
    expect((err as OpeningPhase2SaveConflictError).liveCompletion).toBeNull();
  });

  it("audits outcome save_conflict on opening.phase2.item_saved, not rpc_failed", async () => {
    const service = serviceWithRpcError(DUPLICATE_KEY);

    await expect(callSave(service)).rejects.toBeInstanceOf(OpeningPhase2SaveConflictError);

    // Exactly one audit row: the conflict. The generic rpc_failed row must NOT also
    // fire — an OpeningError short-circuits the catch, and a double row would make the
    // race look like two separate failures in the log.
    expect(auditMock).toHaveBeenCalledTimes(1);
    const row = auditMock.mock.calls[0]![0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(row.action).toBe("opening.phase2.item_saved");
    expect(row.metadata.outcome).toBe("save_conflict");
    expect(row.metadata.template_item_id).toBe(TEMPLATE_ITEM_ID);
    expect(row.metadata.rpc_error).toBe(DUPLICATE_KEY.message);
    // The winner is named in the log too — a race with no winner id is un-forensic.
    expect(row.metadata.live_completion_id).toBe(WINNER_ROW.id);
  });

  it("leaves every other sqlstate on the generic re-throw + rpc_failed path", async () => {
    const service = serviceWithRpcError({ code: "42P01", message: 'relation "nope" does not exist' });

    await expect(callSave(service)).rejects.not.toBeInstanceOf(OpeningPhase2SaveConflictError);
    const row = auditMock.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(row.metadata.outcome).toBe("rpc_failed");
  });
});
