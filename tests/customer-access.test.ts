/** 0234 access matrix: raw contact 9+ only (audited), managers stats-only and shop-bound, guards before I/O. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { audit } from "@/lib/audit";
import { STATS_DTO_KEYS, canSeeRawContact, customerShopScope, toStatsDto } from "@/lib/customers/access-shared";
import {
  confirmMerge, eraseCustomer, importConsentCsv, loadConsentOverview, loadProfilePage, lookupByContact, revealContact, runRetention, retentionCutoff,
} from "@/lib/customers/customers";

const meta = { ipAddress: "203.0.113.9", userAgent: "vitest" };
const SHOP = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const gm = { userId: "u7", role: "gm" as const, level: 7, locations: [SHOP] };
const moo = { userId: "u8", role: "moo" as const, level: 8, locations: [] };
const owner = { userId: "u9", role: "owner" as const, level: 9, locations: [] };
const agm = { userId: "u6", role: "agm" as const, level: 6, locations: [SHOP] };
const noClient = () => ({ rpc: vi.fn(() => { throw new Error("I/O reached"); }), from: vi.fn(() => { throw new Error("I/O reached"); }) });

/** A tiny PostgREST stand-in: every chain resolves to the given rows. */
function chain(rows: unknown, extra: Record<string, unknown> = {}) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "range"]) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null }));
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null, ...extra }).then(res);
  return q;
}

beforeEach(() => { vi.mocked(audit).mockClear(); process.env.CUSTOMER_PROFILES = "1"; });

describe("the matrix", () => {
  it("raw contact is level 9+ only", () => {
    expect([6, 7, 8].map((level) => canSeeRawContact({ userId: "x", level, locations: [] }))).toEqual([false, false, false]);
    expect([9, 10].map((level) => canSeeRawContact({ userId: "x", level, locations: [] }))).toEqual([true, true]);
  });
  it("a GM is bound to their shops; level 8+ sees every shop", () => {
    expect(customerShopScope(gm)).toEqual([SHOP]);
    expect(customerShopScope(moo)).toBeNull();
  });
  it("the stats DTO is whitelisted: an email on the source row never reaches it", () => {
    const dto = toStatsDto({ id: ID, name: "Ana", visits: 1, spendCents: 100, firstOrder: null, lastOrder: null, avgDaysBetween: null, channels: [],
      favourites: [], maskedChannels: [], emailMarketing: "unknown", cards: 0, email: "ana@example.com", phone: "+12025550101" } as never);
    expect(Object.keys(dto).sort()).toEqual([...STATS_DTO_KEYS].sort());
    expect(JSON.stringify(dto)).not.toMatch(/example\.com|\+1202/);
  });
});

describe("refusals happen before any I/O", () => {
  it.each([
    ["stats below GM", () => loadProfilePage(agm, {}, { client: noClient() as never })],
    ["reveal for a GM", () => revealContact(gm, ID, meta, { client: noClient() as never })],
    ["reveal for MoO", () => revealContact(moo, ID, meta, { client: noClient() as never })],
    ["lookup for MoO", () => lookupByContact(moo, "ana@example.com", meta, { client: noClient() as never })],
    ["erase for MoO", () => eraseCustomer(moo, ID, meta, { client: noClient() as never })],
    ["retention for MoO", () => runRetention(moo, meta, { client: noClient() as never })],
    ["consent desk for MoO", () => loadConsentOverview(moo, { client: noClient() as never })],
    ["import for MoO", () => importConsentCsv(moo, { files: [{ name: "a.csv", text: "email\na@example.com\n" }], exportDate: "2026-10-08", allowLargeOptOut: false }, meta, { client: noClient() as never })],
  ])("%s → 403", async (_label, call) => {
    await expect(call()).rejects.toMatchObject({ status: 403, code: "role_insufficient" });
    expect(audit).not.toHaveBeenCalled();
  });
  it("everything is off until CUSTOMER_PROFILES=1", async () => {
    delete process.env.CUSTOMER_PROFILES;
    await expect(loadProfilePage(owner, {}, { client: noClient() as never })).rejects.toMatchObject({ status: 404, code: "not_enabled" });
  });
  it("a malformed id is refused before I/O", async () => {
    await expect(revealContact(owner, "not-a-uuid", meta, { client: noClient() as never })).rejects.toMatchObject({ status: 400 });
  });
});

describe("shop binding and audit", () => {
  it("a GM's list is read with their shops; MoO with every shop", async () => {
    for (const [viewer, expected] of [[gm, [SHOP]], [moo, null]] as const) {
      const rpc = vi.fn(async () => ({ data: [], error: null }));
      await loadProfilePage(viewer, { search: "  ana ", page: 2 }, { client: { rpc, from: vi.fn() } as never });
      expect(rpc).toHaveBeenCalledWith("customer_profile_page", { p_location_ids: expected, p_search: "ana", p_limit: 50, p_offset: 50 });
    }
  });
  it("a GM cannot merge a pair outside their shop", async () => {
    const from = vi.fn((table: string) => table === "customer_merge_suggestions" ? chain([{ customer_a: ID, customer_b: ID }])
      : table === "customers" ? chain([{ id: ID }]) : chain([]));
    const rpc = vi.fn();
    await expect(confirmMerge(gm, { suggestionId: ID, keep: ID }, meta, { client: { rpc, from } as never })).rejects.toMatchObject({ status: 403, code: "location_forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("every raw-contact read is audited with counts, never the values", async () => {
    const from = vi.fn((table: string) => table === "customers" ? chain([{ id: ID }])
      : chain([{ kind: "email", value: "ana@example.com" }, { kind: "phone", value: "+12025550101" }]));
    const contact = await revealContact(owner, ID, meta, { client: { rpc: vi.fn(), from } as never });
    expect(contact).toEqual({ emails: ["ana@example.com"], phones: ["+12025550101"] });
    const call = vi.mocked(audit).mock.calls[0]![0];
    expect(call).toMatchObject({ action: "customer.contact_read", resourceId: ID, metadata: { emails: 1, phones: 1 }, ipAddress: "203.0.113.9" });
    expect(JSON.stringify(call)).not.toContain("ana@example.com");
  });
  it("a contact lookup is audited whether or not it finds someone", async () => {
    const from = vi.fn(() => chain([]));
    await lookupByContact(owner, "Nobody@Example.com", meta, { client: { rpc: vi.fn(), from } as never });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "customer.contact_lookup", metadata: { kind: "email", found: false } });
  });
});

describe("delete-on-request and retention", () => {
  it("erase calls the RPC with delete_request and audits it as destructive work", async () => {
    const rpc = vi.fn(async () => ({ data: { customer_id: ID, changed: true, identifiers_deleted: 2 }, error: null }));
    await eraseCustomer(owner, ID, meta, { client: { rpc, from: vi.fn() } as never });
    expect(rpc).toHaveBeenCalledWith("customer_erase", { p_actor_id: "u9", p_customer_id: ID, p_reason: "delete_request" });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "customer.erase", metadata: { reason: "delete_request", identifiers_deleted: 2 } });
  });
  it("retention reaches back 36 months and loops in bounded batches", async () => {
    expect(retentionCutoff(new Date("2026-10-08T00:00:00Z")).toISOString()).toBe("2023-10-08T00:00:00.000Z");
    const rpc = vi.fn().mockResolvedValueOnce({ data: { erased: 200 }, error: null }).mockResolvedValueOnce({ data: { erased: 3 }, error: null });
    const r = await runRetention(owner, meta, { client: { rpc, from: vi.fn() } as never, now: new Date("2026-10-08T00:00:00Z") });
    expect(r.erased).toBe(203);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "customer.retention_sweep", metadata: { erased: 203, months: 36 } });
  });
});

describe("consent import: idempotent and chunked", () => {
  it("the same list in a different order replays (no chunk writes, no audit)", async () => {
    const shas: string[] = [];
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "customer_consent_import_begin") { shas.push(args.p_rows_sha256 as string); return { data: { import_id: ID, state: shas.length > 1 ? "completed" : "started" }, error: null }; }
      if (fn === "customer_consent_import_chunk") return { data: {}, error: null };
      return { data: { import_id: ID, replay: shas.length > 1, rows_total: 2, new_opt_ins: 2, opt_outs: 0, baseline: true }, error: null };
    });
    const client = { rpc, from: vi.fn() } as never;
    const first = await importConsentCsv(owner, { files: [{ name: "a.csv", text: "email\nbo@example.com\nana@example.com\n" }], exportDate: "2026-10-08", allowLargeOptOut: false }, meta, { client });
    expect(first).toMatchObject({ newOptIns: 2, optOuts: 0, baseline: true });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "customer.consent_import", metadata: { new_opt_ins: 2, opt_outs: 0 } });
    vi.mocked(audit).mockClear();
    rpc.mockClear();
    const again = await importConsentCsv(owner, { files: [{ name: "b.csv", text: "email\nana@example.com\n" }, { name: "c.csv", text: "email\nbo@example.com\n" }], exportDate: "2026-10-08", allowLargeOptOut: false }, meta, { client });
    expect(shas[0]).toBe(shas[1]);
    expect(again.replay).toBe(true);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["customer_consent_import_begin", "customer_consent_import_finish"]);
    expect(audit).not.toHaveBeenCalled();
  });
  it("a large opt-out wave surfaces as its own code for the confirm checkbox", async () => {
    const rpc = vi.fn(async (fn: string) => fn === "customer_consent_import_finish"
      ? { data: null, error: { code: "P0001", message: "consent_import_large_opt_out" } }
      : { data: { import_id: ID, state: "started" }, error: null });
    await expect(importConsentCsv(owner, { files: [{ name: "a.csv", text: "email\na@example.com\n" }], exportDate: "2026-10-08", allowLargeOptOut: false }, meta, { client: { rpc, from: vi.fn() } as never }))
      .rejects.toMatchObject({ status: 409, code: "consent_import_large_opt_out" });
  });
  it("a bad file is a 400 with the parser's code", async () => {
    await expect(importConsentCsv(owner, { files: [{ name: "a.csv", text: "name\nAna\n" }], exportDate: "2026-10-08", allowLargeOptOut: false }, meta, { client: noClient() as never }))
      .rejects.toMatchObject({ status: 400, code: "csv_no_email_column" });
  });
});
