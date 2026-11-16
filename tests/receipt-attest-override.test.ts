/**
 * Audit W20/B114: attestMatch and overrideMatch read the delivery, awaited authorization, then
 * UPDATEd by id with no guard. An attestation that READ counted_only could WRITE after a
 * manager's override committed, replacing the terminal `override` and dropping its note.
 *
 * With migration 0327 the write is delivery_match_verdict (the check and the note append under
 * the row lock; proven on real SQL in scripts/sql-harness-0327.mjs). Until it is applied, the
 * write is a compare-and-set on the state the request read. Both are pinned here.
 *
 * Fix round 1 (review W20-r1):
 *   - a verdict names the receipt the person compared. If a manager unlinked it and another one
 *     was linked before the write, the verdict is refused `receipt_changed` (it used to mark the
 *     replacement matched on the first receipt's comparison);
 *   - the pre-0327 compare-and-set also compares the note it appends to, so two notes written
 *     from the SAME state no longer drop one.
 *
 * Fix round 2 (review W20-r2): naming the receipt is REQUIRED (attest and override). A request
 * that did not name one was judged on the receipt it READ, so when the replacement had already
 * been linked before that read, an old page's verdict landed on a receipt nobody compared. A
 * missing or null receipt is now 400 `receipt_required`, before anything is read or written.
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
/** How many times this request read the delivery. */
let reads: number;
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
      q.is = (k: string, v: unknown) => { filters[k] = v; return q; };
      q.update = (v: Row) => { patch = v; return q; };
      q.maybeSingle = async () => { reads += 1; return { data: { ...delivery }, error: null }; };
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
  rpcCalls = []; updates = []; reads = 0; betweenReadAndWrite = undefined;
  verdictRpc = () => ({ data: { prior_state: delivery.match_state, match_state: "matched", location_id: "shop", receipt_id: "r1" }, error: null });
  mocks.client.mockReturnValue(client());
  // The authorization await is where the other request gets in.
  mocks.allowed.mockImplementation(async () => { betweenReadAndWrite?.(); return true; });
});

describe("with migration 0327: the locked writer decides", () => {
  it("attest sends kind, verdict and the trimmed discrepancy note, and issues no UPDATE of its own", async () => {
    await attestMatch(keyHolder, "d1", "discrepant", "  short 2 cases ", "r1");
    expect(rpcCalls).toEqual([{ fn: "delivery_match_verdict", args: { p_delivery: "d1", p_kind: "attest", p_verdict: "discrepant", p_note: "short 2 cases", p_receipt: "r1" } }]);
    expect(updates).toEqual([]);
  });
  it("a note typed on a 'matched' verdict is not sent", async () => {
    await attestMatch(keyHolder, "d1", "matched", "ignored", "r1");
    expect(rpcCalls[0]!.args).toMatchObject({ p_verdict: "matched", p_note: null });
  });
  it("override sends its required note", async () => {
    await overrideMatch(agm, "d1", " accepted per vendor call ", "r1");
    expect(rpcCalls).toEqual([{ fn: "delivery_match_verdict", args: { p_delivery: "d1", p_kind: "override", p_verdict: null, p_note: "accepted per vendor call", p_receipt: "r1" } }]);
  });
  it("the B114 race: the attestation that read counted_only is refused, the override and its note stand", async () => {
    // The manager's override commits while the key holder's request is being authorized.
    betweenReadAndWrite = () => { delivery.match_state = "override"; delivery.note = "N0\naccepted per vendor call"; };
    verdictRpc = () => delivery.match_state === "override"
      ? { data: null, error: { code: "P0001", message: "already_overridden" } }
      : { data: { prior_state: delivery.match_state }, error: null };
    await expect(attestMatch(keyHolder, "d1", "discrepant", "short 2 cases", "r1")).rejects.toMatchObject({ status: 409, code: "already_overridden" });
    expect(delivery).toMatchObject({ match_state: "override", note: "N0\naccepted per vendor call" });
    expect(updates).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("the audit row records the state the writer actually replaced, not the one read earlier", async () => {
    betweenReadAndWrite = () => { delivery.match_state = "discrepant"; };
    verdictRpc = () => ({ data: { prior_state: "discrepant" }, error: null });
    await attestMatch(keyHolder, "d1", "matched", undefined, "r1");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delivery.match_attested", metadata: expect.objectContaining({ verdict: "matched", prior_state: "discrepant" }) }));
    betweenReadAndWrite = undefined;
    verdictRpc = () => ({ data: { prior_state: "matched" }, error: null });
    await overrideMatch(agm, "d1", "accepted", "r1");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delivery.match_overridden", metadata: expect.objectContaining({ prior_state: "matched" }) }));
  });
  it.each([
    ["not_found", 404, "not_found"], ["no_receipt", 409, "no_receipt"], ["already_overridden", 409, "already_overridden"],
    ["invalid_verdict", 400, "invalid_verdict"], ["note_required", 400, "note_required"], ["invalid_input", 400, "invalid_payload"],
    ["receipt_changed", 409, "receipt_changed"], ["receipt_required", 400, "receipt_required"],
  ])("maps the writer's %s to %s %s", async (message, status, code) => {
    verdictRpc = () => ({ data: null, error: { code: "P0001", message } });
    await expect(attestMatch(keyHolder, "d1", "matched", undefined, "r1")).rejects.toMatchObject({ status, code });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("the receipt the person compared is what the writer is given (attest and override)", async () => {
    await attestMatch(keyHolder, "d1", "matched", undefined, "r1");
    expect(rpcCalls[0]!.args).toMatchObject({ p_receipt: "r1" });
    await overrideMatch(agm, "d1", "accepted", "r1");
    expect(rpcCalls[1]!.args).toMatchObject({ p_kind: "override", p_receipt: "r1" });
  });
  it("review W20-r1: unlink, a replacement receipt, then the stale attestation is refused receipt_changed", async () => {
    // The key holder compared r1. A manager unlinks r1 and links r2 while the request is being authorized.
    betweenReadAndWrite = () => { delivery.email_receipt_id = "r2"; delivery.match_state = "counted_only"; };
    verdictRpc = (args) => args.p_receipt !== delivery.email_receipt_id
      ? { data: null, error: { code: "P0001", message: "receipt_changed" } }
      : { data: { prior_state: delivery.match_state }, error: null };
    await expect(attestMatch(keyHolder, "d1", "matched", undefined, "r1")).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
    expect(rpcCalls[0]!.args).toMatchObject({ p_receipt: "r1" });
    expect(delivery).toMatchObject({ match_state: "counted_only", email_receipt_id: "r2" });
    expect(updates).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("a replacement that already happened is refused before the writer is called (attest and override)", async () => {
    betweenReadAndWrite = undefined;
    delivery.email_receipt_id = "r2";
    await expect(attestMatch(keyHolder, "d1", "matched", undefined, "r1")).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
    await expect(overrideMatch(agm, "d1", "accepted", "r1")).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
    // The receipt was unlinked and nothing replaced it: an attestation has nothing to compare, an override saw one that is gone.
    delivery.email_receipt_id = null;
    await expect(attestMatch(keyHolder, "d1", "matched", undefined, "r1")).rejects.toMatchObject({ status: 409, code: "no_receipt" });
    await expect(overrideMatch(agm, "d1", "accepted", "r1")).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
    expect(rpcCalls).toEqual([]); expect(updates).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("an unknown database error is a failure, never a silent fallback to the unguarded write", async () => {
    verdictRpc = () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await expect(overrideMatch(agm, "d1", "accepted", "r1")).rejects.toThrow(/overrideMatch write/);
    expect(updates).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("before 0327 is applied: a compare-and-set on the state the request read", () => {
  beforeEach(() => { verdictRpc = () => ({ data: null, error: MISSING }); });
  it("an uncontended attest and override write as before", async () => {
    await attestMatch(keyHolder, "d1", "discrepant", "short 2 cases", "r1");
    expect(updates).toEqual([{ patch: { match_state: "discrepant", note: "N0\nshort 2 cases" }, filters: { id: "d1", match_state: "counted_only", email_receipt_id: "r1", note: "N0" }, count: 1 }]);
    await overrideMatch(agm, "d1", "accepted per vendor call", "r1");
    expect(delivery).toMatchObject({ match_state: "override", note: "N0\nshort 2 cases\naccepted per vendor call" });
    expect(updates[1]!.filters).toEqual({ id: "d1", match_state: "discrepant", email_receipt_id: "r1", note: "N0\nshort 2 cases" });
  });
  it("matched leaves the note alone, and does not compare it (it writes none)", async () => {
    await attestMatch(keyHolder, "d1", "matched", "ignored", "r1");
    expect(updates[0]!.patch).toEqual({ match_state: "matched" });
    expect(updates[0]!.filters).toEqual({ id: "d1", match_state: "counted_only", email_receipt_id: "r1" });
  });
  it("review W20-r1: two discrepancy notes from the SAME state: the second is refused, the first note is kept", async () => {
    delivery.match_state = "discrepant";
    // Another key holder's discrepancy note commits while this request is being authorized. The state does not change.
    betweenReadAndWrite = () => { delivery.note = "N0\nfirst person's note"; };
    await expect(attestMatch(keyHolder, "d1", "discrepant", "second person's note", "r1")).rejects.toMatchObject({ status: 409, code: "match_changed" });
    expect(delivery).toMatchObject({ match_state: "discrepant", note: "N0\nfirst person's note" });
    expect(updates).toEqual([{ patch: { match_state: "discrepant", note: "N0\nsecond person's note" },
      filters: { id: "d1", match_state: "discrepant", email_receipt_id: "r1", note: "N0" }, count: 0 }]);
    expect(mocks.audit).not.toHaveBeenCalled();
    // Refresh and try again: the retry appends after the first person's note.
    betweenReadAndWrite = undefined;
    await attestMatch(keyHolder, "d1", "discrepant", "second person's note", "r1");
    expect(delivery.note).toBe("N0\nfirst person's note\nsecond person's note");
  });
  it("review W20-r1: two overrides from `override`: the second is refused, the first manager's note is kept", async () => {
    delivery.match_state = "override"; delivery.note = "N0\naccepted";
    betweenReadAndWrite = () => { delivery.note = "N0\naccepted\nfirst manager: vendor credited it"; };
    await expect(overrideMatch(agm, "d1", "second manager: closing this out", "r1")).rejects.toMatchObject({ status: 409, code: "match_changed" });
    expect(delivery.note).toBe("N0\naccepted\nfirst manager: vendor credited it");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("a first note on a delivery with no note compares against null (null-safe)", async () => {
    delivery.note = null;
    await attestMatch(keyHolder, "d1", "discrepant", "short 2 cases", "r1");
    expect(updates[0]).toEqual({ patch: { match_state: "discrepant", note: "short 2 cases" }, filters: { id: "d1", match_state: "counted_only", email_receipt_id: "r1", note: null }, count: 1 });
    delivery = { id: "d1", location_id: "shop", match_state: "discrepant", note: null, email_receipt_id: "r1" };
    betweenReadAndWrite = () => { delivery.note = "someone else's first note"; };
    await expect(attestMatch(keyHolder, "d1", "discrepant", "mine", "r1")).rejects.toMatchObject({ status: 409, code: "match_changed" });
    expect(delivery.note).toBe("someone else's first note");
  });
  it("a replaced receipt is refused receipt_changed by the compare-and-set too", async () => {
    betweenReadAndWrite = () => { delivery.email_receipt_id = "r2"; };
    await expect(attestMatch(keyHolder, "d1", "matched", undefined, "r1")).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
    expect(delivery).toMatchObject({ match_state: "counted_only", email_receipt_id: "r2" });
    // An override decided on r1 is refused once r1 is unlinked (nothing linked) or replaced.
    for (const now of [null, "r9"]) {
      delivery = { id: "d1", location_id: "shop", match_state: "counted_only", note: "N0", email_receipt_id: "r1" };
      betweenReadAndWrite = () => { delivery.email_receipt_id = now; };
      await expect(overrideMatch(agm, "d1", "accepted", "r1")).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
      expect(updates.at(-1)).toEqual({ patch: { match_state: "override", note: "N0\naccepted" }, filters: { id: "d1", match_state: "counted_only", email_receipt_id: "r1", note: "N0" }, count: 0 });
      expect(delivery).toMatchObject({ match_state: "counted_only", note: "N0", email_receipt_id: now });
    }
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("a note too long to compare in one request is refused by name, never written unguarded", async () => {
    delivery.note = "x".repeat(5000);
    await expect(attestMatch(keyHolder, "d1", "discrepant", "one more", "r1")).rejects.toMatchObject({ status: 503, code: "verdict_note_unavailable" });
    await expect(overrideMatch(agm, "d1", "accepted", "r1")).rejects.toMatchObject({ status: 503, code: "verdict_note_unavailable" });
    expect(updates).toEqual([]);
    // A verdict that writes no note is not affected.
    await attestMatch(keyHolder, "d1", "matched", undefined, "r1");
    expect(delivery.match_state).toBe("matched");
  });
  it("the B114 race: the attestation that lost matches no row and is refused, never overwrites", async () => {
    betweenReadAndWrite = () => { delivery.match_state = "override"; delivery.note = "N0\naccepted per vendor call"; };
    await expect(attestMatch(keyHolder, "d1", "discrepant", "short 2 cases", "r1")).rejects.toMatchObject({ status: 409, code: "match_changed" });
    expect(delivery).toMatchObject({ match_state: "override", note: "N0\naccepted per vendor call" });
    expect(updates).toEqual([{ patch: { match_state: "discrepant", note: "N0\nshort 2 cases" }, filters: { id: "d1", match_state: "counted_only", email_receipt_id: "r1", note: "N0" }, count: 0 }]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("an override that lost the race is refused too (the manager re-reads what was attested)", async () => {
    betweenReadAndWrite = () => { delivery.match_state = "discrepant"; delivery.note = "N0\nshort 2 cases"; };
    await expect(overrideMatch(agm, "d1", "accepted", "r1")).rejects.toMatchObject({ status: 409, code: "match_changed" });
    expect(delivery.note).toBe("N0\nshort 2 cases");
  });
});

describe.each([["with migration 0327", false], ["before 0327 is applied", true]])("review W20-r2: a verdict must name the receipt it is about (%s)", (_label, fallback) => {
  // Call the lib the way an older page's request reaches it: with no receipt, or an explicit null.
  const attestRaw = attestMatch as unknown as (...a: unknown[]) => Promise<void>;
  const overrideRaw = overrideMatch as unknown as (...a: unknown[]) => Promise<void>;
  const nothingHappened = (before: Row) => {
    expect(delivery).toEqual(before);
    expect(reads).toBe(0); expect(rpcCalls).toEqual([]); expect(updates).toEqual([]);
    expect(mocks.allowed).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  };
  beforeEach(() => {
    // The locked writer, as 0327 writes it: no receipt named is refused; a different one is receipt_changed.
    verdictRpc = fallback ? () => ({ data: null, error: MISSING }) : (args) => {
      if (args.p_receipt == null) return { data: null, error: { code: "P0001", message: "receipt_required" } };
      if (args.p_receipt !== delivery.email_receipt_id) return { data: null, error: { code: "P0001", message: "receipt_changed" } };
      const prior = delivery.match_state;
      delivery.match_state = args.p_kind === "override" ? "override" : args.p_verdict;
      return { data: { prior_state: prior }, error: null };
    };
  });

  it.each([["missing", [] as unknown[]], ["undefined", [undefined]], ["null", [null]], ["empty", [""]]])(
    "the replacement was linked BEFORE this request read anything: an attestation with a %s receipt is refused, r2 is not marked", async (_l, tail) => {
      // The old page compared r1. A manager has ALREADY unlinked r1 and linked r2: the first read sees r2.
      delivery.email_receipt_id = "r2";
      const before = { ...delivery };
      await expect(attestRaw(keyHolder, "d1", "matched", undefined, ...tail)).rejects.toMatchObject({ status: 400, code: "receipt_required", message: "This page is out of date. Reload and try again." });
      await expect(attestRaw(keyHolder, "d1", "discrepant", "short 2 cases", ...tail)).rejects.toMatchObject({ status: 400, code: "receipt_required" });
      nothingHappened(before);
    });
  it.each([["missing", [] as unknown[]], ["undefined", [undefined]], ["null", [null]], ["empty", [""]]])(
    "a receipt arrived BEFORE this request read anything: an override decided without it (%s receipt) is refused", async (_l, tail) => {
      // The manager's page showed no paperwork; a receipt was linked before the request's first read.
      delivery.email_receipt_id = "r9";
      const before = { ...delivery };
      await expect(overrideRaw(agm, "d1", "no paperwork came", ...tail)).rejects.toMatchObject({ status: 400, code: "receipt_required", message: "This page is out of date. Reload and try again." });
      nothingHappened(before);
      // With no receipt linked either: an override names the receipt on screen, and the page only offers it with one.
      delivery.email_receipt_id = null;
      await expect(overrideRaw(agm, "d1", "no paperwork came", ...tail)).rejects.toMatchObject({ status: 400, code: "receipt_required" });
      nothingHappened({ ...before, email_receipt_id: null });
    });
  it("a stale receipt id (the one that was replaced before the read) is refused receipt_changed, r2 is not marked", async () => {
    delivery.email_receipt_id = "r2";
    await expect(attestMatch(keyHolder, "d1", "matched", undefined, "r1")).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
    await expect(overrideMatch(agm, "d1", "accepted", "r1")).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
    expect(delivery).toMatchObject({ match_state: "counted_only", note: "N0", email_receipt_id: "r2" });
    expect(rpcCalls).toEqual([]); expect(updates).toEqual([]); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("the receipt now linked, named by the page that shows it, is written (attest, then override)", async () => {
    delivery.email_receipt_id = "r2";
    await attestMatch(keyHolder, "d1", "matched", undefined, "r2");
    expect(delivery.match_state).toBe("matched");
    expect(rpcCalls[0]!.args).toMatchObject({ p_kind: "attest", p_receipt: "r2" });
    await overrideMatch(agm, "d1", "accepted per vendor call", "r2");
    expect(delivery.match_state).toBe("override");
    expect(rpcCalls[1]!.args).toMatchObject({ p_kind: "override", p_receipt: "r2" });
    if (fallback) expect(updates.map(u => u.filters.email_receipt_id)).toEqual(["r2", "r2"]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delivery.match_attested", metadata: expect.objectContaining({ receipt_id: "r2" }) }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delivery.match_overridden", metadata: expect.objectContaining({ receipt_id: "r2" }) }));
  });
  it("the writer is always given the receipt the PERSON named, never the one this request read", async () => {
    // r1 is replaced by r2 while the request is being authorized: the writer still hears r1 and refuses.
    betweenReadAndWrite = () => { delivery.email_receipt_id = "r2"; };
    await expect(overrideMatch(agm, "d1", "accepted", "r1")).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
    expect(rpcCalls[0]!.args).toMatchObject({ p_kind: "override", p_receipt: "r1" });
    if (fallback) expect(updates[0]!.filters).toMatchObject({ email_receipt_id: "r1" });
    expect(delivery).toMatchObject({ match_state: "counted_only", email_receipt_id: "r2" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("the early refusals are unchanged", () => {
  it("an already overridden delivery, a missing receipt and a missing note stop before any write", async () => {
    delivery.match_state = "override";
    await expect(attestMatch(keyHolder, "d1", "matched", undefined, "r1")).rejects.toMatchObject({ status: 409, code: "already_overridden" });
    delivery.match_state = "counted_only"; delivery.email_receipt_id = null;
    await expect(attestMatch(keyHolder, "d1", "matched", undefined, "r1")).rejects.toMatchObject({ status: 409, code: "no_receipt" });
    await expect(overrideMatch(agm, "d1", "   ", "r1")).rejects.toMatchObject({ status: 400, code: "note_required" });
    await expect(overrideMatch(keyHolder, "d1", "x", "r1")).rejects.toMatchObject({ status: 403 });
    expect(rpcCalls).toEqual([]); expect(updates).toEqual([]);
  });
});
