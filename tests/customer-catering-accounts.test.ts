import { describe, expect, it } from "vitest";
import { cateringAccounts, parseCateringParams, sortCateringAccounts, type CateringOrder, type CateringPerson } from "@/lib/customers/catering-accounts-shared";

const person = (id: string, extra: Partial<CateringPerson> = {}): CateringPerson => ({ id, full_name: id, merged_into: null, erased_at: null, ...extra });
const order = (customer_id: string, business_date: string, extra: Partial<CateringOrder> = {}): CateringOrder =>
  ({ customer_id, business_date, total_cents: 1000, location_id: "shop", source_kind: "toast", ...extra });
const ago = (days: number) => new Date(Date.parse("2026-10-12T00:00:00Z") - days * 86_400_000).toISOString().slice(0, 10);

describe("catering accounts", () => {
  it("drops erased and merged people and totals only live accounts with null-honest averages", () => {
    const result = cateringAccounts([order("a", ago(2)), order("a", ago(1), { total_cents: null, source_kind: "ezcater", location_id: "other" }),
      order("merged", ago(1)), order("erased", ago(1)), order("missing", ago(1))],
    [person("a"), person("merged", { merged_into: "a" }), person("erased", { erased_at: "2026-10-12" })], new Map([["a", 8]]), "2026-10-12");
    expect(result.rows).toEqual([{ id: "a", name: "a", orders: 2, spendCents: null, avgOrderCents: null, firstOrder: ago(2), lastOrder: ago(1),
      sources: ["ezcater", "toast"], shops: ["other", "shop"], allVisits: 8, quiet: false }]);
    expect(result.summary).toEqual({ accounts: 1, repeat: 1, quiet: 0, spendCents: null });
  });
  it("quiet requires a repeat account strictly beyond 90 ET calendar days", () => {
    const orders = [89, 90, 91].flatMap((days) => [order(String(days), ago(120)), order(String(days), ago(days))]);
    const result = cateringAccounts([...orders, order("single", ago(200))], [person("89"), person("90"), person("91"), person("single")], {}, "2026-10-12");
    expect(result.rows.map((r) => [r.id, r.quiet])).toEqual([["89", false], ["90", false], ["91", true], ["single", false]]);
    expect(result.summary).toEqual({ accounts: 4, repeat: 3, quiet: 1, spendCents: 7000 });
  });
  it("365-day spend includes today and day 364, excluding day 365 and future orders", () => {
    const result = cateringAccounts([order("a", ago(0)), order("a", ago(364)), order("a", ago(365), { total_cents: null }),
      order("a", ago(-1), { total_cents: null })], [person("a")], {}, "2026-10-12");
    expect(result.summary.spendCents).toBe(2000);
    expect(result.rows[0]!.spendCents).toBeNull();
    expect(cateringAccounts([], [], {}, "2026-10-12").summary.spendCents).toBe(0);
  });
  it("sorts deterministically, puts unknown spend last and filters quiet sort", () => {
    const rows = cateringAccounts([order("b", ago(91)), order("b", ago(100)), order("a", ago(91)), order("a", ago(100)),
      order("c", ago(0), { total_cents: null })], [person("b"), person("a"), person("c")], {}, "2026-10-12").rows;
    expect(sortCateringAccounts(rows, "spend").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sortCateringAccounts(rows, "orders").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sortCateringAccounts(rows, "recent").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortCateringAccounts(rows, "quiet").map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0]!.id).toBe("b");
  });
  it("parses only known scalar parameters and gates shop selection at level eight", () => {
    const location = "11111111-1111-4111-8111-111111111111";
    expect(parseCateringParams({ sort: "bad", quiet: ["1"], page: "2oops", location: "bad" }, 9))
      .toEqual({ sort: "spend", quiet: false, locationId: null, page: 1 });
    expect(parseCateringParams({ sort: "quiet", quiet: "1", page: "99999999", location }, 7))
      .toEqual({ sort: "quiet", quiet: true, locationId: null, page: 1_000_000 });
    expect(parseCateringParams({ sort: "recent", location, page: "-9" }, 8)).toEqual({ sort: "recent", quiet: false, locationId: location, page: 1 });
    expect(parseCateringParams({ page: "Infinity" }, 9).page).toBe(1);
  });
});
