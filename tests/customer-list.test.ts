import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_LIST_CHANNELS, CUSTOMER_LIST_SEGMENTS, CUSTOMER_LIST_SORTS, listParamsQuery, parseListParams } from "@/lib/customers/list-params-shared";
import { loadCustomerList, loadCustomerShops, loadCustomerSummary } from "@/lib/customers/customers";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const viewer = (level: number) => ({ userId: "test", level, locations: [SHOP] });
beforeEach(() => { vi.stubEnv("CUSTOMER_PROFILES", "1"); });

describe("customer list URL contract", () => {
  it("defaults malformed and duplicate parameters without throwing", () => {
    expect(parseListParams({ sort: "drop", page: "2oops", segment: "all", channel: "bad", guests: ["1", "0"], location: "bad", min_visits: "3.5" }, 9))
      .toEqual({ search: "", page: 1, sort: "recent", locationId: null, filters: { guests: false } });
  });
  it("accepts every closed choice", () => {
    for (const sort of CUSTOMER_LIST_SORTS) expect(parseListParams({ sort }, 9).sort).toBe(sort);
    for (const segment of CUSTOMER_LIST_SEGMENTS) expect(parseListParams({ segment }, 9).filters.segment).toBe(segment);
    for (const channel of CUSTOMER_LIST_CHANNELS) expect(parseListParams({ channel }, 9).filters.channel).toBe(channel);
  });
  it("clamps numeric bounds and search length", () => {
    expect(parseListParams({ q: `  ${"a".repeat(90)} `, page: "9999999999", min_visits: "1001", min_spend_cents: "-1" }, 9))
      .toMatchObject({ search: "a".repeat(80), page: 1_000_000, filters: { min_visits: 1000, min_spend_cents: 0 } });
    expect(parseListParams({ page: "-7", min_visits: "0", min_spend_cents: "Infinity" }, 9))
      .toMatchObject({ page: 1, filters: { min_visits: 1 } });
  });
  it("strips contact filters below 9 and shop selection below 8", () => {
    for (const level of [6, 7, 8]) {
      const p = parseListParams({ reachable: "1", opted_in: "0", location: OTHER }, level);
      expect(p.filters).toEqual({ guests: false });
      expect(p.locationId).toBe(level === 8 ? OTHER : null);
    }
    expect(parseListParams({ reachable: "0", opted_in: "true" }, 9).filters).toEqual({ guests: false, reachable: false, opted_in: true });
  });
  it("preserves authorized filters through pagination and back navigation", () => {
    const p = parseListParams({ q: "Ana", page: "2", sort: "spend", segment: "regulars", channel: "online", min_visits: "8",
      min_spend_cents: "20000", guests: "1", opted_in: "0", reachable: "1", location: SHOP, rogue: "ignored" }, 9);
    expect(parseListParams(Object.fromEntries(listParamsQuery(p)), 9)).toEqual(p);
    expect(listParamsQuery(p).has("rogue")).toBe(false);
  });
});

const row = { customer_id: OTHER, full_name: "Fixture Guest", visits: "5", spend_cents: null, avg_order_cents: null,
  first_order: "2026-01-01", last_order: "2026-10-01", shops: [SHOP], catering_orders: "2", cards: "3",
  channels: ["online"], is_guest: false, has_email: true, has_phone: false, opted_in: true, total_rows: "70",
  email: "fixture@example.com", phone: "+12025550101", future_sensitive_column: "secret" };

describe("customer list authorized loaders", () => {
  it("role and feature gates refuse before I/O", async () => {
    const client = { rpc: vi.fn(), from: vi.fn() };
    for (const call of [() => loadCustomerList(viewer(6), {}, { client: client as never }),
      () => loadCustomerSummary(viewer(6), {}, { client: client as never }), () => loadCustomerShops(viewer(6), { client: client as never })]) {
      await expect(call()).rejects.toMatchObject({ status: 403 });
    }
    vi.stubEnv("CUSTOMER_PROFILES", "0");
    await expect(loadCustomerList(viewer(9), {}, { client: client as never })).rejects.toMatchObject({ status: 404 });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });
  it.each([7, 8, 9])("binds level %i and whitelists every returned field", async (level) => {
    const rpc = vi.fn(async () => ({ data: [row], error: null }));
    const result = await loadCustomerList(viewer(level), { location: OTHER, reachable: "1", opted_in: "1", page: "2" }, { client: { rpc } as never });
    expect(rpc).toHaveBeenCalledWith("customer_list_page", {
      p_location_ids: level === 7 ? [SHOP] : [OTHER], p_search: null, p_sort: "recent", p_limit: 50, p_offset: 50,
      p_filters: level >= 9 ? { guests: false, reachable: true, opted_in: true } : { guests: false },
    });
    expect(result).toMatchObject({ total: 70, page: 2, pageSize: 50 });
    const dto = result.profiles[0]!;
    expect(dto).toMatchObject({ id: OTHER, name: "Fixture Guest", visits: 5, spendCents: null, avgOrderCents: null, cateringOrders: 2, cards: 3 });
    expect("hasEmail" in dto).toBe(level >= 9);
    expect("hasPhone" in dto).toBe(level >= 9);
    expect("optedIn" in dto).toBe(level >= 9);
    expect(JSON.stringify(result)).not.toMatch(/fixture@example|1202555|secret|future_sensitive/);
  });
  it("8 defaults to all shops; an empty membership list never means all", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await loadCustomerList(viewer(8), {}, { client: { rpc } as never });
    expect(rpc.mock.calls[0]).toEqual(["customer_list_page", expect.objectContaining({ p_location_ids: null })]);
    await loadCustomerList({ ...viewer(7), locations: [] }, {}, { client: { rpc } as never });
    expect(rpc.mock.calls[1]).toEqual(["customer_list_page", expect.objectContaining({ p_location_ids: [] })]);
  });
  it("recovers an out-of-range page without losing filters", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [row], error: null });
    const result = await loadCustomerList(viewer(9), { page: "9999", segment: "regulars" }, { client: { rpc } as never });
    expect(result.page).toBe(1);
    expect(result.total).toBe(70);
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_offset: 0, p_filters: { guests: false, segment: "regulars" } });
  });
  it.each([7, 8, 9])("summary scopes and contact count at level %i", async (level) => {
    const rpc = vi.fn(async () => ({ data: { people: "12", reachable: "10", regulars: 5, lapsed: 2, both_shops: 3,
      catering: 4, guests: 8, guests_linked: 1, email: "fixture@example.com" }, error: null }));
    const query = { select: vi.fn(), eq: vi.fn(), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 4, error: null }).then(resolve) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    const from = vi.fn(() => query);
    const result = await loadCustomerSummary(viewer(level), { location: OTHER }, { client: { rpc, from } as never });
    expect(rpc).toHaveBeenCalledWith("customer_list_summary", { p_location_ids: level === 7 ? [SHOP] : [OTHER] });
    expect(result).toEqual({ people: 12, regulars: 5, lapsed: 2, bothShops: 3, catering: 4, guests: 8, guestsLinked: 1,
      ...(level >= 9 ? { reachable: 10, optedIn: 4 } : {}) });
    expect(from).toHaveBeenCalledTimes(level >= 9 ? 1 : 0);
    if (level >= 9) {
      expect(from).toHaveBeenCalledWith("customer_consent_current");
      expect(query.eq.mock.calls).toEqual([["channel", "email"], ["status", "opted_in"]]);
    }
  });
  it("never surfaces a database error message containing customer values", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "XX000", message: "fixture@example.com" } }));
    await expect(loadCustomerList(viewer(9), {}, { client: { rpc } as never })).rejects.toMatchObject({ message: "customer_list_unavailable" });
    await expect(loadCustomerSummary(viewer(9), {}, { client: { rpc } as never })).rejects.toMatchObject({ message: "customer_list_unavailable" });
  });
  it("shop labels are scoped for managers and projected without extra columns", async () => {
    const query = { select: vi.fn(), order: vi.fn(), in: vi.fn(), then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: SHOP, name: "Fixture shop", ignored: "secret" }], error: null }).then(resolve) };
    for (const method of [query.select, query.order, query.in]) method.mockReturnValue(query);
    const from = vi.fn(() => query);
    expect(await loadCustomerShops(viewer(7), { client: { from } as never })).toEqual([{ id: SHOP, name: "Fixture shop" }]);
    expect(query.in).toHaveBeenCalledWith("id", [SHOP]);
    expect(query.select).toHaveBeenCalledWith("id,name");
  });
});
