import { describe, expect, it } from "vitest";
import { composeCateringSections, renderCateringDigest, type CateringFacts } from "@/lib/report-digests-compose";
import type { ToastCrossCheckOrder } from "@/lib/report-digests-catering-shared";

const order = (status: ToastCrossCheckOrder["status"], over: Partial<ToastCrossCheckOrder> = {}): ToastCrossCheckOrder => ({
  order_id: status, location_id: "a", event_date: "2026-10-07", order_number: status === "not_rung_in_toast" ? "ABC123" : "XYZ789",
  status, rule: status === "not_rung_in_toast" ? null : "daily_batch", ...over,
});
const facts = (orders: ToastCrossCheckOrder[] = []): CateringFacts => ({
  today: "2026-10-08", leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [],
  toastCrossCheck: { orders, orphans: [] },
});
const scope = { locations: [{ id: "a", name: "Shop A" }], includeUnassigned: false };
const baseUrl = "https://ops.example.com";

describe("catering Toast cross-check", () => {
  it.each(["en", "es"] as const)("omits an empty cross-check in %s", (language) => {
    expect(composeCateringSections(facts([order("matched")]), scope, language, baseUrl)).toHaveLength(4);
  });
  it.each(["en", "es"] as const)("shows yesterday's missing orders, mismatches and orphan checks in %s", (language) => {
    const f = facts([order("not_rung_in_toast"), order("amount_mismatch"), order("matched"),
      order("not_rung_in_toast", { location_id: "b", order_number: "SECRET-SHOP" }),
      order("not_rung_in_toast", { event_date: "2026-10-08", order_number: "TODAY" })]);
    f.toastCrossCheck!.orphans = [
      { location_id: "a", business_date: "2026-10-07", order_guid: "toast", check_guid: "check", amount_cents: 12000 },
      { location_id: "b", business_date: "2026-10-07", order_guid: "other", check_guid: "check", amount_cents: 99999 },
    ];
    const sections = composeCateringSections(f, scope, language, baseUrl);
    expect(sections).toHaveLength(5);
    const section = sections[4]!;
    expect(section.title).toContain(language === "en" ? "Toast cross-check" : "Verificación con Toast");
    expect(section.lines).toHaveLength(3);
    const text = section.lines.map((line) => line.text).join(" ");
    expect(text).toContain("ABC123");
    expect(text).toContain("XYZ789");
    expect(text).toContain("120");
    expect(text).not.toMatch(/SECRET-SHOP|TODAY|999/);
    expect(text).toContain(language === "en" ? "not rung in Toast" : "sin registrar en Toast");
    expect(text).toContain(language === "en" ? "amount mismatches" : "diferencias de monto");
    expect(text).toContain(language === "en" ? "without an ezCater order" : "sin pedido en ezCater");
    expect(section.lines.every((line) => line.label === "Shop A" && line.tone === "issue")).toBe(true);
  });
  it("escapes provider order codes in rendered email", () => {
    const rendered = renderCateringDigest(facts([order("not_rung_in_toast", { order_number: "<script>bad</script>" })]), scope,
      { language: "en", baseUrl });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });
});
