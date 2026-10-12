import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { audit } from "@/lib/audit";
import { exportCustomers, loadCateringAccounts, loadProfileDetail, revokeProbableLink } from "@/lib/customers/customers";
import { parseListParams } from "@/lib/customers/list-params-shared";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SHOP = id(1), OTHER = id(2), ROOT = id(3), GUEST = id(4), MERGED = id(5), ERASED = id(6), LINK = id(7);
const viewer = (level: number) => ({ userId: id(9), role: "owner" as const, level, locations: [SHOP] });
const meta = { ipAddress: null, userAgent: null };
const now = new Date("2026-10-12T02:00:00Z");
type Row = Record<string, unknown>;
const person = (key: string, extra: Row = {}) => ({ id: key, full_name: `Person ${key}`, merged_into: null, erased_at: null, masked_channels: [], email: "private@example.com", phone: "+12025550199", ...extra });
const order = (customer: string, shop = SHOP, extra: Row = {}) => ({ id: id(20), customer_id: customer, location_id: shop, business_date: "2026-10-01", channel: "catering", source_kind: "toast", total_cents: 1200, items: [], contact_masked: false, ...extra });

// Filter before projection, like PostgREST; never let a no-op scope mock hide a leak.
function database(tables: Record<string, Row[]>) {
  const reads: { table: string; columns: string }[] = [];
  const from = vi.fn((table: string) => {
    let rows = [...(tables[table] ?? [])], columns = "*", single = false, head = false;
    let start = 0, end = Infinity;
    const q = {
      select: (value: string, options?: { head?: boolean }) => { columns = value; head = options?.head ?? false; reads.push({ table, columns }); return q; },
      eq: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return q; },
      in: (key: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[key])); return q; },
      is: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return q; },
      or: (expression: string) => {
        rows = rows.filter((r) => expression.split(",").some((part) => {
          const [key, operator, ...rest] = part.split(".");
          return operator === "neq" ? r[key!] !== rest.join(".") : r[key!] === rest.join(".");
        })); return q;
      },
      order: (key: string, options?: { ascending?: boolean }) => { rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options?.ascending === false ? -1 : 1)); return q; },
      range: (a: number, b: number) => { start = a; end = b; return q; },
      limit: (n: number) => { end = n - 1; return q; },
      maybeSingle: () => { single = true; return q; },
      then: (resolve: (v: unknown) => unknown) => {
        const selected = rows.slice(start, end + 1).map((r) => columns === "*" ? r : Object.fromEntries(columns.split(",").map((key) => [key, r[key]])));
        return Promise.resolve({ data: head ? null : single ? selected[0] ?? null : selected, count: rows.length, error: null }).then(resolve);
      },
    };
    return q;
  });
  return { from, rpc: vi.fn(), reads };
}
beforeEach(() => { vi.stubEnv("CUSTOMER_PROFILES", "1"); vi.mocked(audit).mockClear(); });

describe("profile and catering privacy boundary", () => {
  it.each(["customers", "customer_orders"])("scope failures on %s hide database customer values", async (failedTable) => {
    const db = database({ customers: [person(ROOT)], customer_orders: [order(ROOT)] });
    const from = (table: string) => {
      if (table !== failedTable) return db.from(table);
      const q = { select: () => q, or: () => q, in: () => q, limit: () => q,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "private@example.com" } }).then(resolve) };
      return q;
    };
    await expect(loadProfileDetail(viewer(7), ROOT, {}, { client: { from } as never })).rejects.toMatchObject({ status: 503, message: "customer_list_unavailable" });
  });
  it("gates role and feature before I/O and scope before detail reads", async () => {
    const db = database({ customers: [person(ROOT)], customer_orders: [order(ROOT, OTHER)] });
    await expect(loadProfileDetail(viewer(6), ROOT, {}, { client: db as never })).rejects.toMatchObject({ status: 403 });
    await expect(loadCateringAccounts(viewer(6), {}, { client: db as never })).rejects.toMatchObject({ status: 403 });
    expect(db.from).not.toHaveBeenCalled();
    await expect(loadProfileDetail(viewer(7), ROOT, {}, { client: db as never })).rejects.toMatchObject({ status: 403 });
    expect(db.reads).toEqual([{ table: "customers", columns: "id" }, { table: "customer_orders", columns: "id" }]);
    db.from.mockClear(); vi.stubEnv("CUSTOMER_PROFILES", "0");
    await expect(loadProfileDetail(viewer(9), ROOT, {}, { client: db as never })).rejects.toMatchObject({ status: 404 });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("outgoing out-of-shop target has neither name nor ID; incoming out-of-shop guest is omitted", async () => {
    const tables = { customers: [person(ROOT), person(GUEST)], customer_orders: [order(ROOT, OTHER), order(GUEST)],
      customer_probable_links: [{ id: LINK, guest_id: GUEST, customer_id: ROOT, confidence: 0.9, reasons: [], revoked_at: null }] };
    const guest = await loadProfileDetail(viewer(7), GUEST, {}, { client: database(tables) as never, now });
    expect(guest.links.outgoing).toEqual([{ id: LINK, confidence: 0.9, reasons: [], person: null }]);
    expect(JSON.stringify(guest)).not.toContain(ROOT);
    const root = await loadProfileDetail({ ...viewer(7), locations: [OTHER] }, ROOT, {}, { client: database(tables) as never, now });
    expect(root.links.incoming).toEqual([]);
    const all = await loadProfileDetail(viewer(8), GUEST, {}, { client: database(tables) as never, now });
    expect(all.links.outgoing[0]?.person?.id).toBe(ROOT);
    expect(JSON.stringify(all)).not.toMatch(/private@example|12025550199/);
  });
  it("resolves merged link targets, drops erased/revoked links and rejects non-live profile roots", async () => {
    const tables = { customers: [person(ROOT), person(GUEST), person(MERGED, { merged_into: ROOT }), person(ERASED, { erased_at: "2026-10-01" })],
      customer_orders: [order(ROOT), order(GUEST)], customer_probable_links: [
        { id: LINK, guest_id: GUEST, customer_id: MERGED, confidence: 0.8, reasons: [], revoked_at: null },
        { id: id(30), guest_id: GUEST, customer_id: ERASED, confidence: 0.8, reasons: [], revoked_at: null },
        { id: id(31), guest_id: GUEST, customer_id: ROOT, confidence: 0.8, reasons: [], revoked_at: "2026-10-01" },
      ] };
    const db = database(tables);
    const result = await loadProfileDetail(viewer(9), GUEST, {}, { client: db as never, now });
    expect(result.links.outgoing).toHaveLength(1);
    expect(result.links.outgoing[0]?.person?.id).toBe(ROOT);
    const incoming = await loadProfileDetail(viewer(9), ROOT, {}, { client: db as never, now });
    expect(incoming.links.incoming).toHaveLength(1);
    expect(incoming.profile.visits).toBe(1);
    expect(incoming.links.incoming[0]?.stats?.visits).toBe(1);
    for (const key of [MERGED, ERASED]) await expect(loadProfileDetail(viewer(9), key, {}, { client: db as never })).rejects.toMatchObject({ status: 404 });
    expect(db.reads.filter((r) => r.table === "customer_identifiers").every((r) => r.columns === "kind")).toBe(true);
  });
  it("catering scopes both catering and all visits, drops merged/erased roots and never projects contact", async () => {
    const tables = { customers: [person(ROOT), person(GUEST), person(MERGED, { merged_into: ROOT }), person(ERASED, { erased_at: "2026-10-01" })], customer_orders: [
      order(ROOT), order(ROOT, SHOP, { channel: "online", total_cents: 500 }), order(ROOT, OTHER),
      order(GUEST, OTHER), order(MERGED), order(ERASED),
    ] };
    const result = await loadCateringAccounts(viewer(7), { location: OTHER }, { client: database(tables) as never, now });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: ROOT, orders: 1, allVisits: 2, shops: [SHOP], spendCents: 1200 });
    expect(JSON.stringify(result)).not.toMatch(/private@example|12025550199/);
    const all = await loadCateringAccounts(viewer(8), {}, { client: database(tables) as never, now });
    expect(all.rows.map((r) => r.id)).toEqual([ROOT, GUEST]);
    const one = await loadCateringAccounts(viewer(8), { location: OTHER }, { client: database(tables) as never, now });
    expect(one.rows.every((r) => r.allVisits === 1 && r.shops.join() === OTHER)).toBe(true);
  });
});

describe("segment export consent boundary", () => {
  const source = (key: string, status = "opted_in") => ({ customer_id: key, value: `${key}@example.com`, first_name: "Private", last_name: "Name", status, source: "toast_csv_import", opted_in_at: "2026-10-01" });
  function exporter(rows: ReturnType<typeof source>[], ids: string[] = []) {
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => name === "customer_marketing_export"
      ? { range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }) }
      : Promise.resolve({ data: ids.slice(Number(args.p_offset), Number(args.p_offset) + Number(args.p_limit)).map((customer_id) => ({ customer_id })), error: null }));
    return { rpc, from: vi.fn() };
  }
  it("refuses below 9 with a refusal audit before I/O", async () => {
    const db = exporter([]);
    await expect(exportCustomers(viewer(8), "marketing_segment", meta, { client: db as never }, parseListParams({}, 9))).rejects.toMatchObject({ status: 403 });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({ action: "customer.export_refused", metadata: { kind: "marketing_segment", code: "role_insufficient" } });
  });
  it("empty consent returns only the header without a list call", async () => {
    const db = exporter([]);
    const result = await exportCustomers(viewer(9), "marketing_segment", meta, { client: db as never, now }, parseListParams({}, 9));
    expect(result.count).toBe(0);
    expect(result.csv.trim().split("\n")).toHaveLength(1);
    expect(db.rpc.mock.calls.map((c) => c[0])).toEqual(["customer_marketing_export"]);
    expect(result.filename).toBe("marketing-opted-in-view-2026-10-11.csv");
  });
  it("pages 200, forces opt-in without guests, intersects and audits no search or contacts", async () => {
    const ids = Array.from({ length: 201 }, (_, n) => id(n + 100));
    const db = exporter([source(ids[0]!), source(ids[200]!), source(ROOT), source(ids[1]!, "opted_out")], ids);
    const params = parseListParams({ q: "private search", guests: "1", location: SHOP }, 9);
    const result = await exportCustomers(viewer(9), "marketing_segment", meta, { client: db as never, now }, params);
    expect(result.count).toBe(2);
    expect(result.csv).toContain(`${ids[200]}@example.com`);
    expect(result.csv).not.toContain(`${ROOT}@example.com`);
    expect(result.csv).not.toContain(`${ids[1]}@example.com`);
    const calls = db.rpc.mock.calls.filter((c) => c[0] === "customer_list_page");
    expect(calls.map((c) => c[1].p_offset)).toEqual([0, 200]);
    for (const call of calls) expect(call[1]).toMatchObject({ p_limit: 200, p_location_ids: [SHOP], p_filters: { opted_in: true, guests: false, only_guests: false } });
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({ action: "customer.export_marketing_segment", metadata: { rows: 2, searchLength: 14 } });
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toMatch(/private search|@example|Private|Name/);
  });
  it.each([{ opted_in: "0" }, { only_guests: "1" }])("conflicting view stays empty: %j", async (raw) => {
    const db = exporter([source(ROOT)], [ROOT]);
    const result = await exportCustomers(viewer(9), "marketing_segment", meta, { client: db as never }, parseListParams(raw, 9));
    expect(result.count).toBe(0);
    expect(db.rpc.mock.calls.map((c) => c[0])).toEqual(["customer_marketing_export"]);
  });
});

describe("advisory revoke", () => {
  it("authorizes and validates before I/O; audits changed IDs only and not an idempotent replay", async () => {
    const db = { rpc: vi.fn().mockResolvedValueOnce({ data: { revoked: true, guest_id: GUEST, customer_id: ROOT, name: "Private" }, error: null })
      .mockResolvedValueOnce({ data: { revoked: false }, error: null }) };
    await expect(revokeProbableLink(viewer(8), LINK, meta, { client: db as never })).rejects.toMatchObject({ status: 403 });
    await expect(revokeProbableLink(viewer(9), "invalid", meta, { client: db as never })).rejects.toMatchObject({ status: 400 });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(await revokeProbableLink(viewer(9), LINK, meta, { client: db as never })).toEqual({ revoked: true });
    expect(await revokeProbableLink(viewer(9), LINK, meta, { client: db as never })).toEqual({ revoked: false });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toEqual({ actorId: id(9), actorRole: "owner", action: "customer.probable_link_revoke", resourceTable: "customer_probable_links", resourceId: LINK, metadata: { guest_id: GUEST, customer_id: ROOT }, ...meta });
  });
  it("maps missing links to 404 without an audit", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "customer_probable_link_not_found" } });
    await expect(revokeProbableLink(viewer(9), LINK, meta, { client: { rpc } as never })).rejects.toMatchObject({ status: 404, code: "customer_probable_link_not_found" });
    expect(audit).not.toHaveBeenCalled();
  });
  it("migration preserves the exact gate, privileged grants, lock order and narrow mutation", () => {
    const sql = readFileSync("supabase/migrations/0250_customer_link_revoke.sql", "utf8");
    expect(sql.split(/\r?\n/)[1]).toBe("-- AUTHORED 2026-10-12, NOT YET APPLIED -- GATE CC: sim first, then prod.");
    expect(sql).toMatch(/security definer set search_path = pg_catalog, public/);
    expect(sql.indexOf("perform public.customer_identity_lock()")).toBeLessThan(sql.indexOf("for update"));
    expect(sql).toContain("revoke all on function public.customer_probable_link_revoke(uuid,uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.customer_probable_link_revoke(uuid,uuid) to service_role;");
    expect(sql).toContain("if not found then raise exception 'customer_probable_link_not_found'");
    expect(sql).toContain("if v_link.revoked_at is not null then return jsonb_build_object('revoked', false)");
    expect(sql.match(/update public\.\w+ set/g)).toEqual(["update public.customer_probable_links set"]);
    expect(sql).not.toMatch(/delete from|insert into/i);
    // A revoked pair can never be re-inserted (the linking script's apply would otherwise revive it).
    expect(sql).toContain("create trigger customer_probable_links_not_revoked before insert on public.customer_probable_links");
    expect(sql).toContain("raise exception 'customer_probable_link_revoked'");
    expect(sql).toContain("revoke all on function public.customer_probable_link_not_revoked() from public, anon, authenticated, service_role;");
  });
});
