/**
 * Audit W20/B114: attestMatch and overrideMatch read the delivery, awaited authorization, then
 * UPDATEd by id with no guard. An attestation that READ counted_only could WRITE after a
 * manager's override committed, replacing the terminal `override` and dropping its note.
 *
 * With migration 0327 the write is delivery_match_verdict (the check and the note append under
 * the row lock; proven on real SQL in scripts/sql-harness-0327.mjs). Until it is applied, the
 * write is a compare-and-set on the state the request read. Both are pinned here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const mocks = vi.hoisted(() => ({ client: vi.fn(), audit: vi.fn(), allowed: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: mocks.allowed, auditOperationalTaskOverride: vi.fn(), canTriageUnattributedReceipt: vi.fn() }));
vi.mock("@/lib/purchase-orders", () => ({ autoPlaceOnEmailEvidence: vi.fn() }));

import { attestMatch, overrideMatch } from "@/lib/email-receipts";

type Row = Record<string, unknown>;
const keyHolder = { user: { id: "kh", role: "key_holder" }, locations: ["shop"] } as unknown as AuthContext;
const agm = { user: { id: "agm", role: "agm" }, locations: ["shop"] } as unknown as AuthContext;
const MISSING = { code: "PGRST202", message: "Could not find the function public.delivery_match_verdict" };

let delivery: Row;
let rpcCalls: Array<{ fn: string; args: Row }>;
let updates: Array<{ patch: Row; filters: Row; count: number }>;
/** What the "database" does when the verdict function is called. Default: applies it. */
let verdictRpc: (args: Row) => { data: unknown; error: { code?: string; message: string } | null };
/** Runs between this request's READ and its WRITE: the other person's request committing. */
let betweenReadAndWrite: (() => void) | undefined;

function client() {
  return {
    from() {
      const filters: Row = {};
      let patch: Row | undefined;
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (k: string, v: unknown) => { filters[k] = v; return q; };
      q.update = (v: Row) => { patch = v; return q; };
      q.maybeSingle = async () => ({ data: { ...delivery }, error: null });
      q.then = (resolve: (v: unknown) => unknown) => {
        const matches = Object.entries(filters).every(([k, v]) => delivery[k] === v);
        if (patch) { updates.push({ patch, filters, count: matches ? 1 : 0 }); if (matches) Object.assign(delivery, patch); }
        return Promise.resolve({ error: null, count: matches ? 1 : 0 }).then(resolve);
      };
      return q;
    },
    rpc: async (fn: string, args: Row) => { rpcCalls.push({ fn, args }); return verdictRpc(args); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delivery = { id: "d1", location_id: "shop", match_state: "counted_only", note: "N0", email_receipt_id: "r1" };
  rpcCalls = []; updates = []; betweenReadAndWrite = undefined;
  verdictRpc = () => ({ data: { prior_state: delivery.match_state, match_state: "matched", location_id: "shop", receipt_id: "r1" }, error: null });
  mocks.client.mockReturnValue(client());
  // The authorization await is where the other request gets in.
  mocks.allowed.mockImplementation(async () => { betweenReadAndWrite?.(); return true; });
});

describe("with migration 0327: the locked writer decides", () => {
  it("attest sends kind, verdict and the trimmed discrepancy note, and issues no UPDATE of its own", async () => {
    await attestMatch(keyHolder, "d1", "discrepant", "  short 2 cases ");
    expect(rpcCalls).toEqual([{ fn: "delivery_match_verdict", args: { p_delivery: "d1", p_kind: "attest", p_verdict: "discrepant", p_note: "short 2 cases" } }]);
    expect(updates).toEqual([]);
  });
  it("a note typed on a 'matched' verdict is not sent", async () => {
    await attestMatch(keyHolder, "d1", "matched", "ignored");
    expect(rpcCalls[0]!.args).toMatchObject({ p_verdict: "matched", p_note: null });
  });
  it("override sends its required note", async () => {
    await overrideMatch(agm, "d1", " accepted per vendor call ");
    expect(rpcCalls).toEqual([{ fn: "delivery_match_verdict", args: { p_delivery: "d1", p_kind: "override", p_verdict: null, p_note: "accepted per vendor call" } }]);
  });
  it("the B114 race: the attestation that read counted_only is refused, the override and its note stand", async () => {
    // The manager's override commits while the key holder's request is being authorized.
    betweenReadAndWrite = () => { delivery.match_state = "override"; delivery.note = "N0\naccepted per vendor call"; };
    verdictRpc = () => delivery.match_state === "override"
      ? { data: null, error: { code: "P0001", message: "already_overridden" } }
      : { data: { prior_state: delivery.match_state }, error: null };
    await expect(attestMatch(keyHolder, "d1", "discrepant", "short 2 cases")).rejects.toMatchObject({ status: 409, code: "already_overridden" });
    expect(delivery).toMatchObject({ match_state: "override", note: "N0\naccepted per vendor call" });
    expect(updates).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("the audit row records the state the writer actually replaced, not the one read earlier", async () => {
    betweenReadAndWrite = () => { delivery.match_state = "discrepant"; };
    verdictRpc = () => ({ data: { prior_state: "discrepant" }, error: null });
    await attestMatch(keyHolder, "d1", "matched");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delivery.match_attested", metadata: expect.objectContaining({ verdict: "matched", prior_state: "discrepant" }) }));
    betweenReadAndWrite = undefined;
    verdictRpc = () => ({ data: { prior_state: "matched" }, error: null });
    await overrideMatch(agm, "d1", "accepted");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delivery.match_overridden", metadata: expect.objectContaining({ prior_state: "matched" }) }));
  });
  it.each([
    ["not_found", 404, "not_found"], ["no_receipt", 409, "no_receipt"], ["already_overridden", 409, "already_overridden"],
    ["invalid_verdict", 400, "invalid_verdict"], ["note_required", 400, "note_required"], ["invalid_input", 400, "invalid_payload"],
  ])("maps the writer's %s to %s %s", async (message, status, code) => {
    verdictRpc = () => ({ data: null, error: { code: "P0001", message } });
    await expect(attestMatch(keyHolder, "d1", "matched")).rejects.toMatchObject({ status, code });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("an unknown database error is a failure, never a silent fallback to the unguarded write", async () => {
    verdictRpc = () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await expect(overrideMatch(agm, "d1", "accepted")).rejects.toThrow(/overrideMatch write/);
    expect(updates).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("before 0327 is applied: a compare-and-set on the state the request read", () => {
  beforeEach(() => { verdictRpc = () => ({ data: null, error: MISSING }); });
  it("an uncontended attest and override write as before", async () => {
    await attestMatch(keyHolder, "d1", "discrepant", "short 2 cases");
    expect(updates).toEqual([{ patch: { match_state: "discrepant", note: "N0\nshort 2 cases" }, filters: { id: "d1", match_state: "counted_only" }, count: 1 }]);
    await overrideMatch(agm, "d1", "accepted per vendor call");
    expect(delivery).toMatchObject({ match_state: "override", note: "N0\nshort 2 cases\naccepted per vendor call" });
    expect(updates[1]!.filters).toEqual({ id: "d1", match_state: "discrepant" });
  });
  it("matched leaves the note alone", async () => {
    await attestMatch(keyHolder, "d1", "matched", "ignored");
    expect(updates[0]!.patch).toEqual({ match_state: "matched" });
  });
  it("the B114 race: the attestation that lost matches no row and is refused, never overwrites", async () => {
    betweenReadAndWrite = () => { delivery.match_state = "override"; delivery.note = "N0\naccepted per vendor call"; };
    await expect(attestMatch(keyHolder, "d1", "discrepant", "short 2 cases")).rejects.toMatchObject({ status: 409, code: "match_changed" });
    expect(delivery).toMatchObject({ match_state: "override", note: "N0\naccepted per vendor call" });
    expect(updates).toEqual([{ patch: { match_state: "discrepant", note: "N0\nshort 2 cases" }, filters: { id: "d1", match_state: "counted_only" }, count: 0 }]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("an override that lost the race is refused too (the manager re-reads what was attested)", async () => {
    betweenReadAndWrite = () => { delivery.match_state = "discrepant"; delivery.note = "N0\nshort 2 cases"; };
    await expect(overrideMatch(agm, "d1", "accepted")).rejects.toMatchObject({ status: 409, code: "match_changed" });
    expect(delivery.note).toBe("N0\nshort 2 cases");
  });
});

describe("the early refusals are unchanged", () => {
  it("an already overridden delivery, a missing receipt and a missing note stop before any write", async () => {
    delivery.match_state = "override";
    await expect(attestMatch(keyHolder, "d1", "matched")).rejects.toMatchObject({ status: 409, code: "already_overridden" });
    delivery.match_state = "counted_only"; delivery.email_receipt_id = null;
    await expect(attestMatch(keyHolder, "d1", "matched")).rejects.toMatchObject({ status: 409, code: "no_receipt" });
    await expect(overrideMatch(agm, "d1", "   ")).rejects.toMatchObject({ status: 400, code: "note_required" });
    await expect(overrideMatch(keyHolder, "d1", "x")).rejects.toMatchObject({ status: 403 });
    expect(rpcCalls).toEqual([]); expect(updates).toEqual([]);
  });
});
