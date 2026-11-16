/**
 * Audit W20, owner decision W20-2 (b): a manager can UNLINK a receipt from a delivery. B112 let an
 * order confirmation or a statement take a delivery's only receipt slot, and nothing could remove
 * it. This file pins the lib (gate, reason, the one atomic call, the refusals, the audit row) and
 * that the automatic link never puts back a pair a person undid. The SQL itself is proven in
 * scripts/sql-harness-0327.mjs.
 *
 * Review W20-r4: "never re-link an unlinked pair" is decided in the SAME transaction as the
 * automatic link (delivery_receipt_auto_link, 0327), under the delivery's row lock. The lib makes
 * that one call and writes neither link column itself; a worker that chose its pair before a
 * manager unlinked it is refused when it resumes.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const mocks = vi.hoisted(() => ({ client: vi.fn(), audit: vi.fn(), allowed: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: mocks.allowed, auditOperationalTaskOverride: vi.fn(), canTriageUnattributedReceipt: vi.fn() }));
vi.mock("@/lib/purchase-orders", () => ({ autoPlaceOnEmailEvidence: vi.fn() }));

import { attemptAutoLink, attemptReceivingAutoLink, loadReceivingReceiptCandidates, unlinkReceipt } from "@/lib/email-receipts";
import { isDestructive } from "@/lib/destructive-actions";
import { tableNotInstalled } from "@/lib/receiving-shared";
import { AUTO_LINK_RPC, RPC_NOT_INSTALLED, autoLinkModel, unlinkModel } from "./helpers/receipt-auto-link-model";

type Row = Record<string, unknown>;
const keyHolder = { user: { id: "kh", role: "key_holder" }, locations: ["shop"] } as unknown as AuthContext;
const agm = { user: { id: "agm", role: "agm" }, locations: ["shop"] } as unknown as AuthContext;
const RECEIPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let tables: Record<string, Row[]>;
let rpcCalls: Array<{ fn: string; args: Row }>;
let rpcAnswer: { data: unknown; error: { code?: string; message: string } | null };
let unlinkTable: "installed" | "missing" | "broken";
/** delivery_receipt_auto_link: installed (answers like the function), missing (before 0327), or failing. */
let autoLink: "installed" | "missing" | "broken";
/** Every client-side write to a link column (there must be none on the automatic path). */
let linkColumnWrites: Array<{ table: string; patch: Row }>;
/** When set, the NEXT automatic link write (whichever statement makes it) waits for this before it runs. */
let holdNextLinkWrite: Promise<void> | undefined;
const takeHold = (): Promise<void> | undefined => { const held = holdNextLinkWrite; holdNextLinkWrite = undefined; return held; };

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | undefined;
  let single = false;
  const q = {
    select: () => q, order: () => q, range: () => q, returns: () => q,
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
    gte: (k: string, v: string) => { filters.push(r => String(r[k]) >= v); return q; },
    lte: (k: string, v: string) => { filters.push(r => String(r[k]) <= v); return q; },
    lt: (k: string, v: string) => { filters.push(r => String(r[k]) < v); return q; },
    update: (v: Row) => { patch = v; return q; },
    maybeSingle: () => { single = true; return q; },
    then: (resolve: (v: unknown) => void) => {
      if (table === "delivery_receipt_unlinks" && unlinkTable !== "installed") {
        resolve({ data: null, error: unlinkTable === "missing" ? { code: "PGRST205", message: "Could not find the table 'public.delivery_receipt_unlinks' in the schema cache" } : { code: "57014", message: "timeout" } });
        return;
      }
      const run = () => {
        const matched = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
        if (patch) matched.forEach(r => Object.assign(r, patch));
        resolve({ data: single ? (matched[0] ? { ...matched[0] } : null) : matched.map(r => ({ ...r })), error: null, count: matched.length });
      };
      const linkWrite = patch && ("linked_delivery_id" in patch || "email_receipt_id" in patch);
      if (linkWrite) linkColumnWrites.push({ table, patch: patch! });
      const held = linkWrite && patch!.linked_delivery_id ? takeHold() : undefined;
      if (held) void held.then(run); else run();
    },
  };
  return q;
}
const receipt = (extra: Row = {}): Row => ({ id: RECEIPT, location_id: "shop", vendor_guess_id: "vendor", received_at: "2026-11-11T12:00:00.000Z",
  linked_delivery_id: null, inbound_message_id: "m1", parse_state: "parsed", attribution_conflict: false, doc_kind: "invoice", subject: "Invoice", from_address: null, parsed_json: null, ...extra });
const delivery = (extra: Row = {}): Row => ({ id: "d1", location_id: "shop", vendor_id: "vendor", delivery_date: "2026-11-11", email_receipt_id: null, match_state: "counted_only", note: null, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed.mockResolvedValue(true);
  tables = { vendor_deliveries: [delivery({ email_receipt_id: RECEIPT, match_state: "override", note: "accepted" })], email_receipts: [receipt({ linked_delivery_id: "d1" })], delivery_receipt_unlinks: [] };
  rpcCalls = []; unlinkTable = "installed"; autoLink = "installed"; linkColumnWrites = []; holdNextLinkWrite = undefined;
  rpcAnswer = { data: { unlink_id: "u1", receipt_id: RECEIPT, prior_state: "override", location_id: "shop", receipt_released: true }, error: null };
  mocks.client.mockReturnValue({ from: query, rpc: async (fn: string, args: Row) => {
    rpcCalls.push({ fn, args });
    if (fn !== AUTO_LINK_RPC) return rpcAnswer;
    if (autoLink === "missing") return { data: null, error: RPC_NOT_INSTALLED };
    if (autoLink === "broken") return { data: null, error: { code: "57014", message: "timeout" } };
    await takeHold(); // The function reads the unlink history when it RUNS (after any wait), never before.
    return { data: autoLinkModel(tables, args), error: null };
  } });
});

describe("unlinkReceipt (manager unlink, W20-2)", () => {
  it("is a manager action: a key holder is refused before anything is read", async () => {
    await expect(unlinkReceipt(keyHolder, "d1", "wrong document")).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["", "   "])("needs a reason (%j)", async note => {
    await expect(unlinkReceipt(agm, "d1", note)).rejects.toMatchObject({ status: 400, code: "unlink_note_required" });
    expect(rpcCalls).toEqual([]);
  });
  it("refuses a reason longer than the record can hold", async () => {
    await expect(unlinkReceipt(agm, "d1", "x".repeat(2001))).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    expect(rpcCalls).toEqual([]);
  });
  it("another shop's delivery and an unknown delivery are the same 404", async () => {
    tables.vendor_deliveries![0]!.location_id = "elsewhere";
    await expect(unlinkReceipt(agm, "d1", "wrong document")).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(unlinkReceipt(agm, "nope", "wrong document")).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(rpcCalls).toEqual([]);
  });
  it("a delivery with no receipt is refused before the write", async () => {
    tables.vendor_deliveries![0]!.email_receipt_id = null;
    await expect(unlinkReceipt(agm, "d1", "wrong document")).rejects.toMatchObject({ status: 409, code: "no_receipt" });
    expect(rpcCalls).toEqual([]);
  });
  it("makes ONE atomic call, naming the receipt it read, the trimmed reason and the actor", async () => {
    await unlinkReceipt(agm, "d1", "  this is the order confirmation  ");
    expect(rpcCalls).toEqual([{ fn: "delivery_receipt_unlink", args: { p_delivery: "d1", p_receipt: RECEIPT, p_note: "this is the order confirmation", p_actor: "agm" } }]);
    // No client-side write to either side of the link.
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBe(RECEIPT);
  });
  it("passes the receipt the person was looking at, so a changed receipt is refused by the database", async () => {
    rpcAnswer = { data: null, error: { code: "P0001", message: "receipt_changed" } };
    await expect(unlinkReceipt(agm, "d1", "wrong document", OTHER)).rejects.toMatchObject({ status: 409, code: "receipt_changed" });
    expect(rpcCalls[0]!.args.p_receipt).toBe(OTHER);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([
    ["not_found", 404, "not_found"], ["no_receipt", 409, "no_receipt"], ["note_required", 400, "unlink_note_required"],
    ["forbidden", 403, "forbidden"], ["invalid_input", 400, "invalid_payload"],
  ])("maps the database's %s to %s %s", async (message, status, code) => {
    rpcAnswer = { data: null, error: { code: "P0001", message } };
    await expect(unlinkReceipt(agm, "d1", "wrong document")).rejects.toMatchObject({ status, code });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("before migration 0327 it says it is not available, and changes nothing", async () => {
    rpcAnswer = { data: null, error: { code: "PGRST202", message: "Could not find the function public.delivery_receipt_unlink" } };
    await expect(unlinkReceipt(agm, "d1", "wrong document")).rejects.toMatchObject({ status: 503, code: "unlink_unavailable" });
    expect(tables.vendor_deliveries![0]).toMatchObject({ email_receipt_id: RECEIPT, match_state: "override" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("any other database error is a failure", async () => {
    rpcAnswer = { data: null, error: { code: "57014", message: "timeout" } };
    await expect(unlinkReceipt(agm, "d1", "wrong document")).rejects.toThrow(/unlinkReceipt/);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("audits who unlinked what and the verdict it cleared, without the reason text", async () => {
    await unlinkReceipt(agm, "d1", "this is the order confirmation");
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      actorId: "agm", action: "delivery.receipt_unlinked", resourceTable: "vendor_deliveries", resourceId: "d1",
      metadata: { receipt_id: RECEIPT, location_id: "shop", prior_state: "override", unlink_id: "u1", receipt_released: true },
    }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("order confirmation");
    expect(isDestructive("delivery.receipt_unlinked")).toBe(true);
  });
});

describe("a pair a manager unlinked is never put back automatically", () => {
  beforeEach(() => {
    tables.vendor_deliveries = [delivery()];
    tables.email_receipts = [receipt()];
    tables.delivery_receipt_unlinks = [{ delivery_id: "d1", receipt_id: RECEIPT }];
  });
  it("saving the delivery again does not re-link it, and the prompt does not offer it", async () => {
    await attemptReceivingAutoLink("d1");
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBeNull();
    expect(await loadReceivingReceiptCandidates(agm, "d1")).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("the receipt side does not re-link it either", async () => {
    await attemptAutoLink(RECEIPT);
    expect(tables.email_receipts![0]!.linked_delivery_id).toBeNull();
  });
  it("the receipt can still link to a DIFFERENT delivery it was never unlinked from", async () => {
    tables.vendor_deliveries!.push(delivery({ id: "d2", delivery_date: "2026-11-12" }));
    await attemptAutoLink(RECEIPT);
    expect(tables.email_receipts![0]!.linked_delivery_id).toBe("d2");
    expect(tables.vendor_deliveries!.find(d => d.id === "d1")!.email_receipt_id).toBeNull();
  });
  it("and saving that other delivery links it (the undone delivery is not a rival)", async () => {
    tables.vendor_deliveries!.push(delivery({ id: "d2", delivery_date: "2026-11-12" }));
    await attemptReceivingAutoLink("d2");
    expect(tables.vendor_deliveries!.find(d => d.id === "d2")!.email_receipt_id).toBe(RECEIPT);
  });
  it("another receipt for the same delivery is unaffected", async () => {
    tables.email_receipts = [receipt({ id: OTHER })];
    await attemptReceivingAutoLink("d1");
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBe(OTHER);
  });
  it("before 0327 there is no unlink table: the candidate read treats that as nothing unlinked", async () => {
    unlinkTable = "missing";
    expect((await loadReceivingReceiptCandidates(agm, "d1")).map(r => r.id)).toEqual([RECEIPT]);
    expect(tableNotInstalled({ code: "PGRST205" })).toBe(true);
    expect(tableNotInstalled({ code: "42P01" })).toBe(true);
    expect(tableNotInstalled({ code: "57014", message: "timeout" })).toBe(false);
  });
  it("if the unlink history cannot be read, nothing is linked (a person decides)", async () => {
    unlinkTable = "broken";
    tables.delivery_receipt_unlinks = [];
    await attemptReceivingAutoLink("d1");
    await attemptAutoLink(RECEIPT);
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBeNull();
    expect(tables.email_receipts![0]!.linked_delivery_id).toBeNull();
  });
});

describe("review W20-r4: the unlink history is checked in the SAME transaction as the automatic link", () => {
  const args = (deliveryId = "d1") => ({ p_delivery: deliveryId, p_receipt: RECEIPT, p_location: "shop", p_vendor: "vendor",
    p_delivery_date: "2026-11-11", p_parse_state: "parsed", p_received_at: "2026-11-11T12:00:00.000Z" });
  beforeEach(() => {
    tables.vendor_deliveries = [delivery()];
    tables.email_receipts = [receipt()];
    tables.delivery_receipt_unlinks = [];
  });

  it("the reviewer's interleaving: A links, a manager unlinks, B resumes with the pair it chose earlier -> B is refused", async () => {
    // Worker B (the receipt side) reads its candidates while nothing is unlinked, then stalls just before its write.
    let release!: () => void;
    holdNextLinkWrite = new Promise<void>(resolve => { release = resolve; });
    const workerB = attemptAutoLink(RECEIPT);
    await vi.waitFor(() => expect(holdNextLinkWrite).toBeUndefined()); // B is parked on its write.
    // Worker A (the delivery side) chose the same pair and links it.
    await attemptReceivingAutoLink("d1");
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBe(RECEIPT);
    expect(tables.email_receipts![0]!.linked_delivery_id).toBe("d1");
    // A manager unlinks it: both sides are empty again and the pair is on record.
    unlinkModel(tables, "d1");
    expect(tables.delivery_receipt_unlinks).toEqual([{ delivery_id: "d1", receipt_id: RECEIPT }]);
    // B resumes. Both link columns are NULL, exactly as B read them; the rejected pair must not come back.
    release();
    await workerB;
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBeNull();
    expect(tables.email_receipts![0]!.linked_delivery_id).toBeNull();
    expect(mocks.audit).toHaveBeenCalledTimes(1); // A's link only; B recorded nothing.
  });

  it("the same interleaving with the two directions swapped", async () => {
    let release!: () => void;
    holdNextLinkWrite = new Promise<void>(resolve => { release = resolve; });
    const workerB = attemptReceivingAutoLink("d1");
    await vi.waitFor(() => expect(holdNextLinkWrite).toBeUndefined());
    await attemptAutoLink(RECEIPT);
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBe(RECEIPT);
    unlinkModel(tables, "d1");
    release();
    await workerB;
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBeNull();
    expect(tables.email_receipts![0]!.linked_delivery_id).toBeNull();
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the receipt side", () => attemptAutoLink(RECEIPT), "receipt"],
    ["the delivery side", () => attemptReceivingAutoLink("d1"), "receiving"],
  ] as const)("%s makes ONE call that names the pair and the snapshot it chose on, and writes no link column itself", async (_, run, direction) => {
    await run();
    expect(rpcCalls).toEqual([{ fn: AUTO_LINK_RPC, args: args() }]);
    expect(linkColumnWrites).toEqual([]);
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBe(RECEIPT);
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorId: null, action: "delivery.receipt_linked", resourceId: "d1",
      metadata: expect.objectContaining({ receipt_id: RECEIPT, source: "auto", direction }) }));
  });

  it("a refusal from the function links nothing and records nothing (the pair was unlinked after the candidates were read)", async () => {
    // The candidate read saw no history; the function, later, does.
    mocks.client.mockReturnValue({ from: query, rpc: async (fn: string, a: Row) => {
      rpcCalls.push({ fn, args: a });
      tables.delivery_receipt_unlinks = [{ delivery_id: "d1", receipt_id: RECEIPT }];
      return { data: autoLinkModel(tables, a), error: null };
    } });
    await attemptAutoLink(RECEIPT);
    await attemptReceivingAutoLink("d1");
    expect(rpcCalls.map(c => c.fn)).toEqual([AUTO_LINK_RPC]); // the second run's candidate read already excludes the pair
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBeNull();
    expect(tables.email_receipts![0]!.linked_delivery_id).toBeNull();
    expect(linkColumnWrites).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("before 0327 (no function) automation links NOTHING: there is no unguarded second writer to fall back to", async () => {
    autoLink = "missing"; unlinkTable = "missing";
    await attemptAutoLink(RECEIPT);
    await attemptReceivingAutoLink("d1");
    expect(rpcCalls.map(c => c.fn)).toEqual([AUTO_LINK_RPC, AUTO_LINK_RPC]);
    expect(linkColumnWrites).toEqual([]);
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBeNull();
    expect(tables.email_receipts![0]!.linked_delivery_id).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
    // The receipt is still offered to a person, who links it by hand.
    expect((await loadReceivingReceiptCandidates(agm, "d1")).map(r => r.id)).toEqual([RECEIPT]);
  });

  it("any other failure of the call links nothing either, and never throws to the caller", async () => {
    autoLink = "broken";
    await expect(attemptAutoLink(RECEIPT)).resolves.toBeUndefined();
    await expect(attemptReceivingAutoLink("d1")).resolves.toBeUndefined();
    expect(linkColumnWrites).toEqual([]);
    expect(tables.vendor_deliveries![0]!.email_receipt_id).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("the automatic path has no writer of a link column left in the lib (one writer: the function)", () => {
    const lib = readFileSync("lib/email-receipts.ts", "utf8").replace(/\r\n/g, "\n");
    const at = lib.indexOf("async function claimAutomaticDeliveryLink(");
    const body = lib.slice(at, lib.indexOf("\n}\n", at));
    expect(body).toContain('sb.rpc("delivery_receipt_auto_link"');
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toContain("compensateReceiptClaim");
    // Both directions go through it, and nothing else calls the function.
    expect(lib.match(/await claimAutomaticDeliveryLink\(/g)).toHaveLength(2);
    expect(lib.match(/delivery_receipt_auto_link"/g)).toHaveLength(1);
  });
});

describe("the unlink control on the delivery page", () => {
  const panel = readFileSync("components/receiving/VendorClaimPanel.tsx", "utf8").replace(/\r\n/g, "\n");
  it("is offered to managers only, in every match state, and names the receipt on screen", () => {
    const at = panel.indexOf('t("receiving.claim.unlink_open")');
    expect(at).toBeGreaterThan(-1);
    const block = panel.slice(panel.lastIndexOf("{canOverride ? (", at), at);
    expect(block).toContain("unlinkOpen");
    // Outside the "overridden" branch: an overridden match can still be unlinked.
    expect(panel.indexOf("{overridden ? (")).toBeLessThan(panel.lastIndexOf("{canOverride ? (", at));
    expect(panel).toContain('body: JSON.stringify({ deliveryId, action: "unlink", receiptId: receipt.id, note: unlinkNote.trim() })');
    expect(panel).toContain('<ActionButton variant="danger" disabled={busy} onClick={() => void unlink()}>');
  });
  it("its open control is 44 px and centred, and its reason field is labelled", () => {
    const at = panel.indexOf('t("receiving.claim.unlink_open")');
    const button = panel.slice(panel.lastIndexOf("<button", at), at);
    expect(button).toContain("min-h-[44px]"); expect(button).toContain("items-center");
    expect(panel).toContain('aria-label={t("receiving.claim.unlink_note_label")}');
  });
  it("every string is in English and Spanish", () => {
    for (const key of ["receiving.claim.unlink_open", "receiving.claim.unlink_hint", "receiving.claim.unlink_note_label", "receiving.claim.unlink_note_placeholder",
      "receiving.claim.unlink_confirm", "receiving.claim.error.unlink_note_required", "receiving.claim.error.unlink_unavailable", "receiving.claim.error.receipt_changed",
      "receiving.claim.error.match_changed"]) {
      const a = (en as Record<string, string>)[key], b = (es as Record<string, string>)[key];
      expect(a, key).toBeTruthy(); expect(b, key).toBeTruthy(); expect(b, key).not.toBe(a);
    }
  });
});
