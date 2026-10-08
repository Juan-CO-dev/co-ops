import { describe, expect, it } from "vitest";
import type { ReportListItem } from "@/lib/reports-hub";
import {
  awaitingAutoComplete,
  cateringDisplayName,
  composeCateringSections,
  composeShopSections,
  renderShopDigest,
  renderUnifiedDigest,
  type CateringFacts,
  type CateringLeadFact,
  type ShopDayFacts,
} from "@/lib/report-digests-compose";
import { plural, translator } from "@/lib/report-digests-v2-compose";
import { failed, ok, unavailable } from "@/lib/report-digests-v2-shared";
import { po, v2Fixture } from "./fixtures/digest-v2";

const BASE = "https://ops.example.com";
const LOC = "11111111-1111-4111-8111-111111111111";
const DAY = "2026-10-07";
const clean: NonNullable<ReportListItem["signalSummary"]> = { underPar: 0, overPar: 0, skipped: 0, tempFlags: 0, cashOverShortCents: null };
const report = (type: ReportListItem["type"], status: string, signals = clean, submitterName: string | null = "Maria"): ReportListItem =>
  ({ type, id: `${type}-1`, date: DAY, locationId: LOC, submitterName, status, signalSummary: { ...signals } });

function facts(over: Partial<ShopDayFacts> = {}): ShopDayFacts {
  return {
    location: { id: LOC, name: "Shop A" }, day: DAY,
    reports: [
      report("opening", "phase2_complete", clean, "Ana"), report("am_prep", "submitted"), report("mid_day", "phase2_complete"),
      report("closing", "confirmed", clean, "Luis"), report("cash", "ok"), report("pm", "submitted"), report("maintenance", "ok"),
    ],
    receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: { evaluations: 3, needsWork: 0 },
    v2: v2Fixture(),
    ...over,
  };
}
const flat = (f: ShopDayFacts, language: "en" | "es" = "en") => composeShopSections(f, language, BASE, false);
const lineIn = (f: ShopDayFacts, section: string, label: string) => flat(f).find((s) => s.title.startsWith(section))!.lines.find((l) => l.label === label);

describe("digest v2 layout", () => {
  it("the GM digest is the eight management sections, tomorrow named by date", () => {
    expect(flat(facts()).map((s) => s.title)).toEqual([
      "Headline", "Ordering", "Receiving", "Inventory", "Operations", "Sales detail", "People", "Tomorrow · Thu, Oct 8",
    ]);
    expect(flat(facts(), "es").map((s) => s.title)[0]).toBe("Lo principal");
  });

  it("every line deep-links into the app", () => {
    for (const s of flat(facts())) for (const l of s.lines) expect(l.href.startsWith(`${BASE}/`), `${s.title} / ${l.label}`).toBe(true);
  });

  it("headline: net pre-tax, vs the same weekday last week, checks, average, 3rd-party share; catering kept apart", () => {
    expect(lineIn(facts(), "Headline", "Net sales (pre-tax)")).toMatchObject({
      text: "$100.00 · +25% vs last Wed · 1 check · avg $100.00 · 3rd-party 0%", href: `${BASE}/mid-shift?location=${LOC}`,
    });
    expect(lineIn(facts(), "Headline", "Catering (pipeline)")!.text).toBe("1 order · completed $50.00 · confirmed, not completed $0.00 · separate from register sales");
  });

  it("silence never means all good: an empty day says so on every line", () => {
    const empty = facts({
      v2: v2Fixture({
        sales: unavailable("no_capture"),
        catering: ok({ day: { orders: 0, completedCents: 0, confirmedCents: 0 }, tomorrow: [] }),
        ordering: ok({ day: { placed: [], unsent: [], missed: [], unverified: [], late: [] }, deliveries: { due: [], overdue: [], undated: [] }, cutoffsTomorrow: [], vendorNames: {} }),
      }),
    });
    const texts = flat(empty).flatMap((s) => s.lines.map((l) => l.text));
    for (const expected of [
      "No completed sales capture for this day yet", "No catering events this day", "No POs placed", "No missed cutoffs",
      "No deliveries", "No credits opened", "No invoices waiting for review", "No walk recorded", "No tosses", "No store runs",
      "None assigned or open", "No deliveries due tomorrow", "No order cutoffs tomorrow", "No catering tomorrow",
    ]) expect(texts).toContain(expected);
    expect(texts.some((x) => x.trim() === "")).toBe(false);
    expect(texts.some((x) => /\$0\.00 · 0 checks/.test(x))).toBe(false);
  });

  it("a failed read is said, as an issue, and the rest of the digest still renders", () => {
    const f = facts({ v2: v2Fixture({ receiving: failed(), sales: failed() }) });
    expect(lineIn(f, "Receiving", "Receiving")).toMatchObject({ text: "Could not load — check the app", tone: "issue" });
    expect(lineIn(f, "Sales detail", "Sales detail")).toMatchObject({ text: "Could not load — check the app", tone: "issue" });
    expect(lineIn(f, "Ordering", "POs placed")!.text).toBe("1 PO placed · $25.00");
  });

  it("ordering: POs placed with $ and who, drafts never sent, missed cutoffs with the walk's suggestion", () => {
    const f = facts({
      v2: v2Fixture({
        ordering: ok({
          day: {
            placed: [po("a", "v", { placedAt: "2026-10-07T13:00:00Z", placedByName: "Alex", totalCents: 12345 }), po("b", "w", { placedAt: "2026-10-07T14:00:00Z", totalCents: null, unpricedLines: 2 })],
            unsent: [po("d", "w", { status: "draft", totalCents: null })],
            missed: [{ vendorId: "x", vendorName: "Trimark", cutoffTime: "10:00:00", suggestedLines: 2 }],
            unverified: [{ vendorId: "y", vendorName: "Cardinal", cutoffTime: "14:30:00" }], late: [],
          },
          deliveries: { due: [], overdue: [], undated: [] }, cutoffsTomorrow: [], vendorNames: { v: "Boar's Head", w: "Leonard Paper" },
        }),
      }),
    });
    const lines = flat(f).find((s) => s.title === "Ordering")!.lines;
    expect(lines.map((l) => `${l.tone}|${l.label}|${l.text}`)).toEqual([
      "ok|POs placed|2 POs placed · $123.45 (some not priced)",
      "ok|Boar's Head|MEP-a · $123.45 · placed by Alex",
      "ok|Leonard Paper|MEP-b · $ not priced yet",
      "issue|Leonard Paper|MEP-d · draft generated, never sent",
      "issue|Trimark|Missed the 10:00 AM cutoff · the walk suggested 2 items",
      "info|Cardinal|2:30 PM cutoff passed with no order and no walk to check against",
    ]);
    expect(lines[1]!.href).toBe(`${BASE}/ordering?location=${LOC}&po=a`);
  });

  it("operations: AM prep under/over par is a neutral line, only SKIPPED is an issue (Juan 10-08); who confirmed; late = system-finalized", () => {
    const neutral = facts({ reports: [report("am_prep", "submitted", { ...clean, underPar: 22, overPar: 9 })] });
    expect(lineIn(neutral, "Operations", "AM Prep")).toMatchObject({ text: "All good · 22 under par, 9 over par · by Maria", tone: "info" });
    const skipped = facts({ reports: [report("am_prep", "submitted", { ...clean, underPar: 22, skipped: 1 })] });
    expect(lineIn(skipped, "Operations", "AM Prep")).toMatchObject({ text: "1 issue: 1 skipped · 22 under par · by Maria", tone: "issue" });
    const late = facts({ reports: [report("closing", "auto_finalized", clean, null)] });
    expect(lineIn(late, "Operations", "Closing")).toMatchObject({ text: "Late: finalized by the system, no one confirmed · All good", tone: "issue" });
    const cash = facts({ reports: [report("cash", "ok", { ...clean, cashOverShortCents: 8 })] });
    expect(lineIn(cash, "Operations", "Cash")).toMatchObject({ text: "1 issue: cash over $0.08 · by Maria", tone: "issue" });
    // v2 moves receiving / tosses / store runs / PM out of Operations.
    const labels = flat(facts()).find((s) => s.title === "Operations")!.lines.map((l) => l.label);
    expect(labels).toEqual(["Opening", "AM Prep", "Mid-Day Prep", "Closing", "Cash", "Maintenance", "Assigned tasks"]);
  });

  it("people: who opened and closed, the PM flags, retrains", () => {
    const lines = flat(facts({ v2: v2Fixture({ people: ok({ retrains: { assignedToday: 1, open: 2 } }) }) })).find((s) => s.title === "People")!.lines;
    expect(lines.map((l) => `${l.tone}|${l.label}|${l.text}`)).toEqual([
      "info|Opened by|Ana", "info|Closed by|Luis", "ok|PM Report|All good (3 evaluations)", "issue|Retrains|1 assigned today · 2 still open",
    ]);
  });

  it("tomorrow: deliveries due (vendor, date, PO, $), order cutoffs with draft state, catering count / guests / times", () => {
    const f = facts({
      v2: v2Fixture({
        ordering: ok({
          day: { placed: [], unsent: [], missed: [], unverified: [], late: [] },
          deliveries: {
            due: [{ po: po("a", "v", { totalCents: 45600 }), vendorName: "Boar's Head", orderDay: DAY, deliveryDay: "2026-10-08" }],
            overdue: [{ po: po("b", "w"), vendorName: "Trimark", orderDay: "2026-10-05", deliveryDay: "2026-10-06" }],
            undated: [{ po: po("c", "z"), vendorName: "Sysco" }],
          },
          cutoffsTomorrow: [
            { vendorId: "v", vendorName: "Boar's Head", cutoffTime: "10:00:00", hasDraft: true, ordered: false },
            { vendorId: "w", vendorName: "Trimark", cutoffTime: "11:00:00", hasDraft: false, ordered: false },
          ],
          vendorNames: {},
        }),
        catering: ok({ day: { orders: 0, completedCents: 0, confirmedCents: 0 }, tomorrow: [
          { id: "1", name: "B", timeWindow: "16:00", headcount: 30, isDelivery: false },
          { id: "2", name: "A", timeWindow: "10:45", headcount: 12, isDelivery: true },
        ] }),
      }),
    });
    const lines = flat(f).find((s) => s.title.startsWith("Tomorrow"))!.lines;
    expect(lines.map((l) => `${l.tone}|${l.label}|${l.text}`)).toEqual([
      "info|Boar's Head|due Thu, Oct 8 · MEP-a · $456.00",
      "issue|Trimark|MEP-b · was due Tue, Oct 6, not received",
      "info|Deliveries due tomorrow|1 open order has no delivery day on file (Sysco)",
      "info|Boar's Head|cutoff 10:00 AM · draft ready",
      "issue|Trimark|cutoff 11:00 AM · no draft yet",
      "info|Catering tomorrow|2 orders · 42 guests · 10:45 AM, 4:00 PM",
    ]);
  });

  it("plurals in en and es (polish item 2)", () => {
    const en = translator("en"); const es = translator("es");
    expect(plural(en, 1, "digest.v2.ordering.placed_one", "digest.v2.ordering.placed_other")).toBe("1 PO placed");
    expect(plural(en, 2, "digest.v2.ordering.placed_one", "digest.v2.ordering.placed_other")).toBe("2 POs placed");
    expect(plural(en, 0, "digest.v2.ordering.placed_one", "digest.v2.ordering.placed_other")).toBe("0 POs placed");
    expect(plural(es, 1, "digest.v2.ordering.placed_one", "digest.v2.ordering.placed_other")).toBe("1 pedido enviado");
    expect(plural(es, 3, "digest.v2.ordering.placed_one", "digest.v2.ordering.placed_other")).toBe("3 pedidos enviados");
    expect(plural(en, 1, "digest.line.issues_one", "digest.line.issues_other", { detail: "x" })).toBe("1 issue: x");
    expect(plural(es, 2, "digest.line.issues_one", "digest.line.issues_other", { detail: "x" })).toBe("2 problemas: x");
  });
});

describe("unified (level 8+): all-shop totals first, then each shop, label said once", () => {
  it("adds the totals section and prefixes each shop's sections", () => {
    const b = { ...facts(), location: { id: "22222222-2222-4222-8222-222222222222", name: "Shop B" } };
    const mail = renderUnifiedDigest({ day: DAY, shops: [facts(), b], notFinalized: [{ id: "x", name: "Shop B" }] }, { language: "en", baseUrl: BASE });
    expect(mail.text).toContain("\nAll shops\n");
    expect(mail.text).toContain("$200.00 · +25% vs last week · 2 checks");
    expect(mail.text).toContain("Shop A · Headline");
    expect(mail.text).toContain("Shop B · Tomorrow · Thu, Oct 8");
    expect(mail.text).toContain("! Closing not finalized: Shop B");
    expect(mail.text).not.toContain("Closing: Closing");
  });

  it("the GM email renders the v2 sections and counts issues with a plural preheader", () => {
    const mail = renderShopDigest(facts({ reports: [] }), { language: "en", baseUrl: BASE });
    expect(mail.html).toContain(">Headline</h2>");
    expect(mail.html).toMatch(/\d+ lines need a look\./);
  });
});

// ── Catering polish (items 3, 4, 5, 6, 9) ────────────────────────────────────────────────────

const A = LOC;
const lead = (over: Partial<CateringLeadFact>): CateringLeadFact => ({
  id: Math.random().toString(36).slice(2), contactName: "X", company: null, eventDate: null, timeWindow: null, headcount: null,
  stage: "inquiry", leadSource: "phone", locationId: A, createdDay: "2026-09-01", followUpDate: null, externalRef: null,
  isDelivery: false, valueCents: 0, dueCents: 0, prep: null, ...over,
});
const cf = (leads: CateringLeadFact[]): CateringFacts => ({ today: "2026-10-08", leads, lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [] });

describe("catering digest polish", () => {
  it("item 6: placeholder names become the platform code; a real name stays", () => {
    expect(cateringDisplayName({ contactName: "EZCater order VPCTM5", company: null, leadSource: "ezcater" })).toBe("ezCater #VPCTM5");
    expect(cateringDisplayName({ contactName: "Toast order 0a1b2c3d-1111-2222-3333-444455556666", company: null, leadSource: "toast_catering" })).toBe("Toast order");
    expect(cateringDisplayName({ contactName: "Dana Ruiz", company: "Acme", leadSource: "ezcater" })).toBe("Dana Ruiz (Acme)");
  });

  it("items 3 + 4 + 9: one clock format; scan lines carry code + customer, never a UUID, and never repeat a ran order; elapsed platform orders are not red", () => {
    const ez = lead({ contactName: "EZCater order VPCTM5", leadSource: "ezcater", eventDate: "2026-10-07", stage: "confirmed", timeWindow: "10:45", headcount: 25, valueCents: 40000, createdDay: "2026-10-07", externalRef: "0a1b2c3d-1111-2222-3333-444455556666" });
    const toast = lead({ contactName: "Toast order 9f9f9f9f-1111-2222-3333-444455556666", leadSource: "toast_catering", createdDay: "2026-10-07", eventDate: "2026-10-09", stage: "confirmed", externalRef: "toast:9f9f9f9f-1111-2222-3333-444455556666" });
    const y = composeCateringSections(cf([ez, toast]), { locations: [{ id: A, name: "Shop A" }], includeUnassigned: false }, "en", BASE)[0]!.lines;
    const all = y.map((l) => `${l.tone}|${l.label}|${l.text}`);
    expect(all[0]).toBe("ok|Yesterday|1 order ran · 25 guests · completed $0.00 · confirmed, not completed $400.00");
    expect(all[1]).toBe("info|ezCater #VPCTM5|10:45 AM · 25 guests · $400.00 · Platform order · completes overnight automatically");
    expect(all.join("\n")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(all.filter((x) => x.includes("VPCTM5"))).toHaveLength(1);
    expect(all).toContain("info|Toast catering|Order: Toast order");
  });

  it("item 9: a phone order left confirmed past its date is still an issue; the read rule is platform-only", () => {
    expect(awaitingAutoComplete({ leadSource: "ezcater", stage: "confirmed" })).toBe(true);
    expect(awaitingAutoComplete({ leadSource: "toast_catering", stage: "out" })).toBe(true);
    expect(awaitingAutoComplete({ leadSource: "ezcater", stage: "completed" })).toBe(false);
    expect(awaitingAutoComplete({ leadSource: "phone", stage: "confirmed" })).toBe(false);
    const y = composeCateringSections(cf([lead({ contactName: "Pat", leadSource: "phone", eventDate: "2026-10-07", stage: "confirmed" })]), { locations: [{ id: A, name: "Shop A" }], includeUnassigned: false }, "en", BASE)[0]!.lines;
    expect(y[0]!.tone).toBe("issue");
    expect(y[1]).toMatchObject({ tone: "issue", text: "time not set · size not set · $0.00 · Not marked completed" });
  });
});

describe("unified totals never turn a failed read into zero (Astra r2 P2)", () => {
  const b = (v2: ReturnType<typeof v2Fixture>) => ({ ...facts({ v2 }), location: { id: "22222222-2222-4222-8222-222222222222", name: "Shop B" } });
  const allShops = (shops: ShopDayFacts[], language: "en" | "es") =>
    renderUnifiedDigest({ day: DAY, shops, notFinalized: [] }, { language, baseUrl: BASE }).text.split("\nShop A · Headline")[0]!;

  it("every area failed in every shop: each total says not available (en + es)", () => {
    const dead = v2Fixture({ sales: failed(), catering: failed(), ordering: failed(), receiving: failed() });
    const en = allShops([facts({ v2: dead }), b(dead)], "en");
    expect(en).not.toMatch(/\$0\.00|0 POs placed|0 missed|0 deliveries/);
    expect(en.match(/Not yet available/g)).toHaveLength(5);
    const es = allShops([facts({ v2: dead }), b(dead)], "es");
    expect(es).not.toMatch(/0,00|\$0\.00|0 pedidos enviados/);
    expect(es.match(/Aún no disponible/g)).toHaveLength(5);
  });

  it("mixed coverage: the totals say partial (1 of 2 shops), en + es", () => {
    const half = v2Fixture({ ordering: failed(), receiving: failed(), sales: failed() });
    const en = allShops([facts(), b(half)], "en");
    expect(en).toContain("POs placed: 1 PO placed · $25.00 · 0 missed cutoffs · partial (1 of 2 shops)");
    expect(en).toContain("Net sales (pre-tax): $100.00 · last week not available · 1 check · avg $100.00 · 3rd-party 0% · partial (1 of 2 shops)");
    expect(allShops([facts(), b(half)], "es")).toContain("parcial (1 de 2 tiendas)");
  });

  it("an unknown credit amount is never $0", () => {
    const f = facts({ v2: v2Fixture({ receiving: ok({ deliveries: [], credits: [{ vendorName: "T", reason: "short", amountCents: null }, { vendorName: "T", reason: "short", amountCents: 500 }], invoicesPendingReview: 0 }) }) });
    expect(lineIn(f, "Receiving", "Shorts and credits")!.text).toBe("2 credits opened · $5.00 · + 1 amount not recorded");
    const all = facts({ v2: v2Fixture({ receiving: ok({ deliveries: [], credits: [{ vendorName: "T", reason: "short", amountCents: null }], invoicesPendingReview: 0 }) }) });
    expect(lineIn(all, "Receiving", "Shorts and credits")!.text).toBe("1 credit opened · amount not recorded");
  });
});
