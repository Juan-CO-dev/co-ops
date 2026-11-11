import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { client, sign, download } = vi.hoisted(() => ({ client: vi.fn(), sign: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: client }));
import { listVendorMail, getVendorMailMessage } from "@/lib/vendor-mail";
import { signVendorMailAsset } from "@/lib/vendor-mail-assets";
import { canReadVendorMail, vendorMailFailureCode, vendorMailStale } from "@/lib/vendor-mail-shared";
import { ROLES, type RoleCode } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const id = "11111111-1111-4111-8111-111111111111";
const shop = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
function message(extra: Row = {}): Row {
  return { id, reference_code: "VM-1", revision: 0, received_at: "2026-11-09T10:00:00Z", from_address: "supplier@example.com", subject: "Invoice 123", effective_location_id: shop, effective_vendor_id: null,
    content_state: "pending", display_status: "received", search_text: "Invoice 123", last_error: null, email_receipt_id: null, handled_by: null, handled_at: null, handled_reason: null, archive_state: "pending", archive_error: null, attachment_manifest: [], receipt: null, ...extra };
}
function setup(rows: Row[] = [], role: RoleCode = "gm", freshRole: RoleCode = role, memberships = [shop]) {
  const tables: Record<string, Row[]> = { users: [{ id, active: true, role: freshRole }], user_locations: memberships.map(location_id => ({ user_id: id, location_id, active: true })), vendor_mail_read: rows, vendor_mail_events: [{ id, inbound_message_id: id, event_type: "transport", actor_id: null, revision: 0, data: {}, created_at: "2026-11-09T10:00:00Z" }] };
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  client.mockReturnValue({ storage: { from: vi.fn(() => ({ createSignedUrl: sign, download })) }, from: (table: string) => {
    const filters: Array<(row: Row) => boolean> = []; let first = 0; let last = Infinity; let single = false;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    for (const method of ["eq", "is", "in", "gte", "lte"]) q[method] = (key: string, value: unknown) => {
      calls.push({ table, method, args: [key, value] });
      filters.push(row => method === "in" ? (value as unknown[]).includes(row[key]) : method === "gte" ? String(row[key]) >= String(value) : method === "lte" ? String(row[key]) <= String(value) : row[key] === value); return q;
    };
    q.order = () => q; q.range = (from: number, to: number) => { first = from; last = to; return q; };
    q.ilike = (key: string, pattern: string) => { filters.push(row => String(row[key]).toLowerCase().includes(pattern.slice(1, -1).toLowerCase())); return q; };
    q.maybeSingle = () => { single = true; return q; };
    q.then = (resolve: (value: unknown) => unknown) => { const selected = (tables[table] ?? []).filter(row => filters.every(f => f(row))).slice(first, last + 1); return Promise.resolve({ data: single ? selected[0] ?? null : selected, error: null }).then(resolve); };
    return q;
  } });
  sign.mockResolvedValue({ data: { signedUrl: "https://private.example/asset" }, error: null });
  download.mockResolvedValue({ data: new Blob(["<p>Invoice</p><blockquote>Quoted order</blockquote><script>bad()</script>"], { type: "text/html" }), error: null });
  return { ctx: { user: { id, role, active: true }, session: { id } } as unknown as AuthContext, calls, tables };
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
describe("vendor mail authorization", () => {
  it("covers every role and fresh null/foreign/inactive scope", () => {
    for (const role of Object.keys(ROLES) as RoleCode[]) {
      const actor = { role, active: true, locations: [shop] }; const global = ["moo", "owner", "cgs"].includes(role);
      expect(canReadVendorMail(actor, shop), role).toBe(global || role === "gm");
      expect(canReadVendorMail(actor, null), role).toBe(global);
      expect(canReadVendorMail(actor, other), role).toBe(global);
      expect(canReadVendorMail({ ...actor, active: false }, shop)).toBe(false);
    }
  });
  it.each(["agm", "prep_mgr", "social_media_mgr", "catering_mgr", "shift_lead", "employee"] as RoleCode[])("refuses %s before service-client I/O on list, detail and signing", async role => {
    const { ctx } = setup([], role);
    for (const operation of [() => listVendorMail(ctx), () => getVendorMailMessage(ctx, id), () => signVendorMailAsset(ctx, id, "raw")]) await expect(operation()).rejects.toMatchObject({ status: 403 });
    expect(client).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
  });
  it("refuses fresh role downgrade and membership removal", async () => {
    let configured = setup([message()], "gm", "agm");
    await expect(listVendorMail(configured.ctx)).rejects.toMatchObject({ status: 403 });
    configured = setup([message()], "gm", "gm", []);
    expect((await listVendorMail(configured.ctx)).messages).toEqual([]);
    await expect(signVendorMailAsset(configured.ctx, id, "raw")).rejects.toMatchObject({ status: 404 });
    expect(sign).not.toHaveBeenCalled();
  });
  it("uses effective canonical shop in server query, excludes null and foreign rows", async () => {
    const { ctx, calls } = setup([message(), message({ id: other, effective_location_id: other }), message({ id: "null", effective_location_id: null })]);
    expect((await listVendorMail(ctx)).messages.map(row => row.id)).toEqual([id]);
    expect(calls).toContainEqual({ table: "vendor_mail_read", method: "in", args: ["effective_location_id", [shop]] });
  });
});
describe("vendor mail projections", () => {
  it("does not turn an unrecorded fetched archive into zero attachments", async () => {
    const { ctx } = setup([message({ content_state: "fetched", archive_state: "pending", receipt: null })]);
    expect((await listVendorMail(ctx)).messages[0]?.attachment_count).toBeNull();
  });
  it("counts supplier attachments including omissions, excluding synthetic body/header assets", async () => {
    const { ctx } = setup([message({ receipt: { attachment_paths: [
      { filename: "legacy.pdf", path: "legacy" }, { filename: "bill.xls", path: "bill", kind: "attachment" },
      { filename: "huge.zip", path: null, omitted: true, kind: "attachment" },
      { filename: "message.html", path: "html", kind: "body" }, { filename: "headers.json", path: "headers", kind: "headers" },
    ] } })]);
    expect((await listVendorMail(ctx)).messages[0]?.attachment_count).toBe(3);
  });
  it("keeps independent matches, stale-first ordering and local counts honest", async () => {
    const { ctx } = setup([message(), message({ id: "new", received_at: "2026-11-11T11:00:00Z" }), message({ id: "handled", handled_at: "2026-11-10T00:00:00Z" }), message({ id: "matched", receipt: { linked_po_id: other, linked_delivery_id: null, attachment_paths: [], parsed_json: { reason: "api_error:secret provider text" }, parse_state: "failed" } })], "moo");
    const result = await listVendorMail(ctx);
    expect(result.messages[0]?.id).toBe(id); expect(result.reconciliation.stale_count).toBe(1);
    expect(result.reconciliation.kind).toBe("local_breakdown"); expect(result.reconciliation.total).toBe(4);
    expect(result.messages.find(row => row.id === "matched")).toMatchObject({ stale: false, linked_po_id: other, linked_delivery_id: null, failure_code: "api_error" });
  });
  it("combines database filters and server search without interpolating search into PostgREST", async () => {
    const { ctx, calls } = setup([message({ effective_vendor_id: other, content_state: "failed", display_status: "failed" }), message({ id: "pending" })]);
    const filtered = await listVendorMail(ctx, { locationId: shop, vendorId: other, status: "failed", search: "123" });
    expect(filtered.messages).toHaveLength(1); expect(filtered.reconciliation.total).toBe(2);
    expect(calls).toContainEqual({ table: "vendor_mail_read", method: "eq", args: ["effective_vendor_id", other] });
    await expect(listVendorMail(ctx, { receivedFrom: "invalid" })).rejects.toMatchObject({ status: 400 });
  });
  it("uses exact elapsed 24 hours across Eastern DST and does not mark matched/handled stale", () => {
    const received = "2026-11-01T01:30:00-04:00"; const boundary = Date.parse(received) + 86400000;
    expect(vendorMailStale(received, null, null, null, boundary)).toBe(false);
    expect(vendorMailStale(received, null, null, null, boundary + 1)).toBe(true);
    expect(vendorMailStale(received, null, null, id, boundary + 1)).toBe(false);
    expect(vendorMailStale(received, received, null, null, boundary + 1)).toBe(false);
  });
  it("returns closed failure prefixes only", () => {
    for (const reason of ["no_content", "no_api_key", "api_error", "empty_response", "unparseable_json"]) expect(vendorMailFailureCode({ reason: `${reason}: details` })).toBe(reason);
    expect(vendorMailFailureCode({ reason: "api_error_fake" })).toBeNull(); expect(vendorMailFailureCode(null)).toBeNull();
  });
});
describe("private asset signing", () => {
  it("removes nested event storage paths and raw parse failures from detail", async () => {
    const { ctx, tables } = setup([message({ receipt: { parsed_json: { reason: "api_error: private provider detail", extraction: { docKind: "invoice" } }, attachment_paths: [] } })]);
    tables.vendor_mail_events![0]!.data = { attachments: [{ path: "private/key", filename: "invoice.pdf" }], before: { raw_storage_path: "secret", storagePath: "secret", attachment_paths: ["secret"], content_state: "pending" } };
    const detail = await getVendorMailMessage(ctx, id);
    expect(detail.failure_code).toBe("api_error");
    expect(detail.parsed_json).toEqual({ extraction: { docKind: "invoice" } });
    expect(detail.events[0]!.data).toEqual({ attachments: [{ filename: "invoice.pdf" }], before: { content_state: "pending" } });
    expect(JSON.stringify(detail)).not.toContain("private provider detail");
  });
  it("uses only bound stored asset IDs, signs for 60s and downloads HTML", async () => {
    const { ctx } = setup([message({ receipt: { raw_storage_path: "shop/raw/message.txt", attachment_paths: [{ filename: "message.html", contentType: "text/html", path: "shop/html/message.html" }, { filename: "large.zip", contentType: "application/zip", path: null, omitted: true }] } })]);
    expect((await signVendorMailAsset(ctx, id, "attachment-0")).expires_in).toBe(60);
    expect(sign).toHaveBeenCalledWith("shop/html/message.html", 60, { download: "message.html" });
    await expect(signVendorMailAsset(ctx, id, "shop/html/message.html")).rejects.toMatchObject({ status: 404 });
    await expect(signVendorMailAsset(ctx, id, "attachment-1")).rejects.toMatchObject({ status: 404 });
    const detail = await getVendorMailMessage(ctx, id);
    expect(detail.assets[0]).not.toHaveProperty("path"); expect(detail.events).toHaveLength(1);
    expect(detail.body_state).toBe("available"); expect(detail.body_text).toContain("Quoted order"); expect(detail.body_text).not.toContain("bad()");
  });
  it("does not sign foreign/null-shop data for GM", async () => {
    for (const location of [null, other]) {
      const { ctx } = setup([message({ effective_location_id: location, receipt: { raw_storage_path: "secret" } })]);
      await expect(signVendorMailAsset(ctx, id, "raw")).rejects.toMatchObject({ status: 404 });
    }
    expect(sign).not.toHaveBeenCalled();
  });
});
