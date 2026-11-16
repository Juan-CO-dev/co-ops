/**
 * Audit W14 / B078 — the server half of the Phase 1 draft ordering.
 *
 * saveOpeningPhase1Draft used to be a plain upsert on instance_id: whichever request committed
 * last won, so a slow older autosave (or a beacon) from the SAME tab overwrote a newer draft.
 * It now calls save_opening_phase1_draft (migration 0315), which compares the tab's revision
 * and re-checks `status = 'open'` inside the write. Until 0315 is applied the function is
 * missing and the lib falls back to the 0203 upsert, so the app keeps saving drafts.
 *
 * No DB — the service client is a stub.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { OpeningDraftRefusedError, saveOpeningPhase1Draft } from "@/lib/opening";
import { emptyOpeningPhase1Draft, parseOpeningDraftRev } from "@/lib/opening-draft-shared";

vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn(async () => {}) }));

const INSTANCE = "99999999-8888-4777-8666-555555555555";
const SHOP = "33333333-3333-4333-8333-333333333333";
const TAB = "0b7e5d2c-1111-4222-8333-444455556666";
const ACTOR = { userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", role: "employee" as const, level: 3 };

type RpcAnswer = { data: unknown; error: null } | { data: null; error: { code: string; message: string } };
function service(answer: RpcAnswer) {
  const upserts: unknown[] = [];
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => answer);
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      // The instance carries its opening template so W13/B073's same-read type guard passes.
      maybeSingle: async () => ({
        data: table === "checklist_instances"
          ? { location_id: SHOP, date: "2026-11-15", template: { type: "opening" } }
          : { location_id: SHOP, date: "2026-11-15" },
        error: null,
      }),
      upsert: (row: unknown) => { upserts.push({ table, row }); return builder; },
      single: async () => ({ data: { saved_at: "2026-11-15T11:00:00.000Z" }, error: null }),
    };
    return builder;
  });
  return { client: { rpc, from } as never, rpc, upserts };
}
const args = (rev: { tab: string; seq: number } | null = { tab: TAB, seq: 4 }) => ({
  instanceId: INSTANCE, locationId: SHOP, draft: emptyOpeningPhase1Draft(), savedBy: ACTOR.userId, actor: ACTOR, rev,
});

describe("parseOpeningDraftRev", () => {
  it("absent is null (an older client): still accepted, last write wins", () => {
    expect(parseOpeningDraftRev(undefined)).toEqual({ ok: true, rev: null });
    expect(parseOpeningDraftRev(null)).toEqual({ ok: true, rev: null });
  });
  it("a uuid tab and a whole sequence ≥ 1 parse; the tab is lower-cased", () => {
    expect(parseOpeningDraftRev({ tab: TAB.toUpperCase(), seq: 12 })).toEqual({ ok: true, rev: { tab: TAB, seq: 12 } });
  });
  it.each([
    ["not an object", "x"], ["an array", []], ["no tab", { seq: 1 }], ["no seq", { tab: TAB }],
    ["a tab that is not a uuid", { tab: "tab-1", seq: 1 }], ["seq 0", { tab: TAB, seq: 0 }],
    ["a fractional seq", { tab: TAB, seq: 1.5 }], ["a string seq", { tab: TAB, seq: "2" }],
    ["a seq past the safe range", { tab: TAB, seq: Number.MAX_SAFE_INTEGER + 2 }],
  ])("%s is refused, never coerced", (_label, raw) => {
    expect(parseOpeningDraftRev(raw)).toEqual({ ok: false });
  });
});

describe("saveOpeningPhase1Draft — the ordered writer (B078)", () => {
  it("calls save_opening_phase1_draft with the tab's revision and returns what the server decided", async () => {
    const s = service({ data: { applied: true, savedAt: "2026-11-15T11:00:01.000Z" }, error: null });
    await expect(saveOpeningPhase1Draft(s.client, args())).resolves.toEqual({ savedAt: "2026-11-15T11:00:01.000Z", applied: true });
    expect(s.rpc).toHaveBeenCalledWith("save_opening_phase1_draft", {
      p_instance_id: INSTANCE, p_location_id: SHOP, p_draft: emptyOpeningPhase1Draft(),
      p_saved_by: ACTOR.userId, p_client_tab: TAB, p_client_seq: 4,
    });
    expect(s.upserts).toEqual([]);
  });

  it("an older request from the same tab comes back applied:false — a success, not an error", async () => {
    const s = service({ data: { applied: false, savedAt: "2026-11-15T11:00:05.000Z" }, error: null });
    await expect(saveOpeningPhase1Draft(s.client, args())).resolves.toEqual({ savedAt: "2026-11-15T11:00:05.000Z", applied: false });
  });

  it("no revision (an older client, a hand-made request) sends NULLs: last write wins", async () => {
    const s = service({ data: { applied: true, savedAt: "t" }, error: null });
    await saveOpeningPhase1Draft(s.client, args(null));
    expect(s.rpc.mock.calls[0]?.[1]).toMatchObject({ p_client_tab: null, p_client_seq: null });
  });

  it.each([
    ["opening_draft:phase1_not_open", "phase1_not_open"],
    ["opening_draft:instance_not_found", "instance_not_found"],
    ["opening_draft:location_mismatch", "location_mismatch"],
    ["opening_draft:invalid_payload", "invalid_payload"],
  ])("the RPC's %s is a named refusal", async (message, code) => {
    const s = service({ data: null, error: { code: "P0001", message } });
    const err = await saveOpeningPhase1Draft(s.client, args()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpeningDraftRefusedError);
    expect((err as OpeningDraftRefusedError).code).toBe(code);
  });

  it.each([["PGRST202", "Could not find the function public.save_opening_phase1_draft in the schema cache"], ["42883", "function does not exist"]])(
    "before 0315 is applied (%s) it falls back to the 0203 upsert, so drafts keep saving", async (code, message) => {
      const s = service({ data: null, error: { code, message } });
      await expect(saveOpeningPhase1Draft(s.client, args())).resolves.toEqual({ savedAt: "2026-11-15T11:00:00.000Z", applied: true });
      expect(s.upserts.length).toBe(1);
      const row = (s.upserts[0] as { table: string; row: Record<string, unknown> });
      expect(row.table).toBe("opening_phase1_drafts");
      // The fallback writes only 0203's columns: client_tab / client_seq do not exist yet.
      expect(Object.keys(row.row).sort()).toEqual(["draft", "instance_id", "location_id", "saved_at", "saved_by"]);
    });

  it("any other failure throws (a 500), never a silent fallback", async () => {
    const s = service({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(saveOpeningPhase1Draft(s.client, args())).rejects.toThrow(/saveOpeningPhase1Draft: boom/);
    expect(s.upserts).toEqual([]);
  });
});

describe("POST /api/opening/phase1/draft", () => {
  const route = readFileSync("app/api/opening/phase1/draft/route.ts", "utf8");
  it("reads the optional revision with the shared parser and passes it to the lib", () => {
    expect(route).toContain("parseOpeningDraftRev(raw.rev)");
    expect(route).toMatch(/saveOpeningPhase1Draft\(service, \{[\s\S]*?\brev: rev\.rev,/);
    expect(route).toContain("return jsonOk({ savedAt, applied });");
  });
  it("maps the write-time refusals to the answers it already gave", () => {
    expect(route).toContain("err instanceof OpeningDraftRefusedError");
    expect(route).toMatch(/phase1_not_open[\s\S]{0,200}jsonError\(409, "phase1_not_open"/);
    expect(route).toMatch(/instance_not_found[\s\S]{0,200}jsonError\(404, "instance_not_found"/);
  });
  it("still never gates on Content-Type (the beacon is text/plain)", () => {
    expect(route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")).not.toMatch(/content-type/i);
  });
});
