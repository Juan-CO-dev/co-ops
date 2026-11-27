/**
 * Digests round 3, PR 3: the Sales report's own figures in the shop digest's Sales section.
 *
 * Every new line needs `sales_detail` (the Sales page's gate). The laws pinned here:
 *   - a recipient the Sales page refuses (a flagged AGM, a prep manager, a GM of another shop, no access) gets the
 *     Sales section — and the whole email, subject and preheader included — byte for byte as before PR 3;
 *   - every figure is the Sales page's on the same raws (summarizeSales, mergeBreakdown), never recomputed;
 *   - partial coverage, a missing amount, a failed or stalled read: "not available" or a counted gap, never $0;
 *   - exactly four Sales RPCs per shop/day, for day D only, each with an abort signal, read ONCE per shop/day for
 *     every recipient and the unified digest.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { serverLabel } from "@/components/reports-hub/SalesParts";
import { formatCents, formatHourRange } from "@/lib/i18n/format";
import { digestAccessFor } from "@/lib/report-digests-access-shared";
import { composeShopSections, renderShopDigest, renderUnifiedDigest, type DigestSection, type Envelope, type ShopDayFacts } from "@/lib/report-digests-compose";
import { runClosingDigestsWith, type ClaimRow, type DigestIO } from "@/lib/report-digests-engine";
import { canOpen, digestLink, NO_ACCESS_VIEWER, targetPath, type LinkViewer } from "@/lib/report-digests-links";
import { DEFAULT_DIGEST_SETTINGS } from "@/lib/report-digests-shared";
import { DIGEST_SALES_DETAIL_DIMENSIONS, loadSalesDetail, loadShopV2Facts } from "@/lib/report-digests-v2";
import { salesDetailLines, salesServerLabel, translator } from "@/lib/report-digests-v2-compose";
import {
  busiestHours, failed, ok, salesDetailTotals, topServers, unavailable, type SalesDetailFacts,
} from "@/lib/report-digests-v2-shared";
import { loadSalesBreakdown, mergeBreakdown, resolveSalesRange, summarizeSales, type BreakdownRaw, type DailyRaw } from "@/lib/sales-reports";
import { v2Fixture } from "./fixtures/digest-v2";

vi.mock("@/lib/toast/captured-day", () => ({ loadCapturedToastDay: vi.fn(async () => null) }));
vi.mock("@/lib/catering/booked-events", () => ({ loadBookedCateringEvents: vi.fn(async () => []) }));
vi.mock("@/lib/catering/not-in-toast", () => ({ readNotInToast: vi.fn(async () => []) }));
vi.mock("@/lib/toast/labor", () => ({ laborPullEnabled: () => false, runToastLaborPull: vi.fn() }));

const BASE = "https://ops.example.com";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const D = "2026-10-07";

const GM_A: LinkViewer = { role: "gm", level: 7, locations: [A] };
const GM_B: LinkViewer = { role: "gm", level: 7, locations: [B] };
const AGM_A: LinkViewer = { role: "agm", level: 6, locations: [A] };
const PREP_A: LinkViewer = { role: "prep_mgr", level: 6, locations: [A] };
const MOO: LinkViewer = { role: "moo", level: 8, locations: [] };
const OWNER: LinkViewer = { role: "owner", level: 9, locations: [] };
const env = (viewer: LinkViewer | null, language: "en" | "es" = "en"): Envelope => ({ language, baseUrl: BASE, viewer, access: digestAccessFor(viewer) });

// ── Raws exactly as 0232 / 0239 / 0247 / 0248 return them for one day ────────────────────────

function dailyRaw(over: Partial<DailyRaw> = {}): DailyRaw {
  return {
    classes: [
      { business_date: D, sale_class: "sale", checks: 40, amount_cents: 600000, tax_cents: 64200, amount_missing: 0, tax_missing: 0,
        gross_cents: 665500, discounts_comps_cents: 31000, voids_cents: 4500, service_charges_cents: 0, accounting_missing: 0 },
      { business_date: D, sale_class: "gift_card", checks: 1, amount_cents: 5000, tax_cents: 0, amount_missing: 0 },
      { business_date: D, sale_class: "ezcater_linked", checks: 2, amount_cents: 94000, tax_cents: 0, amount_missing: 0 },
      { business_date: D, sale_class: "void", checks: 1, amount_cents: 0, tax_cents: 0, amount_missing: 0 },
    ],
    tips: [{ business_date: D, tip_cents: 61200, tip_missing: 0 }],
    discounts: [{ business_date: D, count: 5, cents: 31000, amount_missing: 0 }],
    refunds: [{ business_date: D, count: 3, refund_cents: 12000, refund_tip_cents: 0, sales_refund_cents: 12000, sales_refund_missing: 0 }],
    captured_days: [D],
    ezcater: [{ business_date: D, orders: 2, subtotal_cents: 94000, amount_missing: 0 }],
    ...over,
  };
}
const channelRaw: BreakdownRaw[] = [
  { key: "dine_in|", channel: "dine_in", provider: null, sale_class: "sale", checks: 20, cents: 289000, amount_missing: 0 },
  { key: "takeout|", channel: "takeout", provider: null, sale_class: "sale", checks: 10, cents: 150000, amount_missing: 0 },
  { key: "third_party|DoorDash", channel: "third_party", provider: "DoorDash", sale_class: "sale", checks: 8, cents: 82000, amount_missing: 0 },
  { key: "third_party|Uber Eats", channel: "third_party", provider: "Uber Eats", sale_class: "sale", checks: 6, cents: 59000, amount_missing: 0 },
  { key: "catering|", channel: "catering", provider: null, sale_class: "sale", checks: 1, cents: 20000, amount_missing: 0 },
  { key: "catering|ezCater", channel: "catering", provider: "ezCater", sale_class: "ezcater_source", checks: 2, cents: 94000, amount_missing: 0 },
  { key: "unknown|", channel: "unknown", provider: null, sale_class: "gift_card", checks: 1, cents: 5000, amount_missing: 0 },
];
const hourRaw: BreakdownRaw[] = [
  { key: "3|12", dow: 3, hour: 12, checks: 38, cents: 114000, amount_missing: 0 },
  { key: "3|13", dow: 3, hour: 13, checks: 30, cents: 98000, amount_missing: 0 },
  { key: "3|18", dow: 3, hour: 18, checks: 20, cents: 76000, amount_missing: 0 },
  { key: "3|11", dow: 3, hour: 11, checks: 5, cents: 20000, amount_missing: 0 },
  { key: "3|-1", dow: 3, hour: -1, checks: 2, cents: 4500, amount_missing: 0 },
];
const serverRaw: BreakdownRaw[] = [
  { key: "", label: null, checks: 5, cents: 150000, amount_missing: 0 },
  { key: "guid-ana", label: "Ana", checks: 15, cents: 200000, amount_missing: 0 },
  { key: "guid-ben", label: "Ben", checks: 10, cents: 150000, amount_missing: 0 },
  { key: "guid-9f3c", label: null, checks: 3, cents: 50000, amount_missing: 0 },
  { key: "guid-web", label: null, server_online: true, checks: 9, cents: 40000, amount_missing: 0 },
];

function detail(over: Partial<SalesDetailFacts> = {}): SalesDetailFacts {
  return {
    totals: ok(salesDetailTotals(dailyRaw(), D)),
    channels: ok(mergeBreakdown("channel", [channelRaw])),
    hours: ok(mergeBreakdown("hour_weekday", [hourRaw])),
    servers: ok(mergeBreakdown("server", [serverRaw])),
    ...over,
  };
}

function facts(location: string, name: string, salesDetail?: SalesDetailFacts): ShopDayFacts {
  return {
    location: { id: location, name }, day: D, reports: [],
    receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: null,
    v2: v2Fixture(salesDetail ? { salesDetail } : {}),
  };
}
const salesOf = (sections: DigestSection[], prefix = ""): DigestSection | undefined => sections.find((s) => s.title === `${prefix}Sales detail` || s.title === `${prefix}Detalle de ventas`);
const sectionFor = (f: ShopDayFacts, e: Envelope) => salesOf(composeShopSections(f, e.language, BASE, false, e.viewer, e.access));
const money = (cents: number) => formatCents(cents, "en");

// ── 1. The access matrix: refused recipients get exactly the pre-PR 3 output ─────────────────

describe("a recipient the Sales page refuses gets the Sales section and the email exactly as before PR 3", () => {
  const before = facts(A, "Shop A");
  const refused: Array<[string, LinkViewer | null]> = [
    ["flagged AGM (level 6)", AGM_A], ["flagged prep manager", PREP_A], ["GM of another shop", GM_B], ["no access", NO_ACCESS_VIEWER], ["null viewer", null],
  ];
  const variants: Array<[string, SalesDetailFacts]> = [
    ["a full day", detail()],
    ["a partial day", detail({ totals: ok(salesDetailTotals(dailyRaw({ captured_days: [] }), D)) })],
    ["failed reads", detail({ totals: failed(), channels: failed(), hours: failed(), servers: failed() })],
    ["missing amounts", detail({ totals: ok(salesDetailTotals(dailyRaw({ tips: [{ business_date: D, tip_cents: 100, tip_missing: 2 }] }), D)), servers: failed() })],
  ];
  for (const [who, viewer] of refused) {
    for (const [what, d] of variants) {
      it(`${who}, ${what}: section lines, status, overflow and issue count; HTML, text, subject and preheader`, () => {
        for (const language of ["en", "es"] as const) {
          const e = env(viewer, language);
          const after = facts(A, "Shop A", d);
          expect(sectionFor(after, e)).toEqual(sectionFor(before, e));
          expect(composeShopSections(after, language, BASE, false, viewer, e.access)).toEqual(composeShopSections(before, language, BASE, false, viewer, e.access));
          expect(renderShopDigest(after, e)).toEqual(renderShopDigest(before, e));
        }
      });
    }
  }

  it("the same holds when the pulse itself did not load (one unknown line, its status unchanged)", () => {
    const pulseDown = (sd?: SalesDetailFacts): ShopDayFacts => ({ ...facts(A, "Shop A"), v2: v2Fixture({ sales: unavailable("no_capture"), ...(sd ? { salesDetail: sd } : {}) }) });
    for (const viewer of [AGM_A, GM_B]) expect(renderShopDigest(pulseDown(detail()), env(viewer))).toEqual(renderShopDigest(pulseDown(), env(viewer)));
  });

  it("the unified digest for a recipient with no access is unchanged too", () => {
    const e = env(NO_ACCESS_VIEWER);
    expect(renderUnifiedDigest({ day: D, shops: [facts(A, "Shop A", detail()), facts(B, "Shop B", detail())], notFinalized: [] }, e))
      .toEqual(renderUnifiedDigest({ day: D, shops: [facts(A, "Shop A"), facts(B, "Shop B")], notFinalized: [] }, e));
  });
});

describe("a recipient the Sales page admits sees the new lines", () => {
  it("GM own shop, MoO, owner: the ladder, tips, ezCater, delivery platforms … and the overflow names the rest", () => {
    for (const viewer of [GM_A, MOO, OWNER]) {
      const s = sectionFor(facts(A, "Shop A", detail()), env(viewer))!;
      // S5: platform dollars sit before the top items (plan §9.2), so they print under the cap on a healthy day.
      // Digest round 3 polish: the busiest hours right after them (the mock's order), so they print too; the
      // ungated pulse lines keep their order (top items, then the channel mix, which now folds first).
      expect(s.lines.map((l) => l.label)).toEqual([
        "Sales report", "Tips, tax, service charges", "ezCater and total", "Delivery platforms", "Busiest hours", "Top items (units)", "and 6 more",
      ]);
      // S8: a comma-free label keeps the overflow list readable.
      expect(s.lines.at(-1)!.text).toBe("Channel mix, Catering vs walk-in, Discounts, Voids, Voids · refunds · exclusions +1");
      expect(s.status).toMatchObject({ tone: "ok", issues: 0, unknowns: 0 });
      for (const l of s.lines.slice(0, 3)) expect(l.needs).toBe("sales_detail");
    }
  });

  it("the unified digest (level 8+) carries the new lines for every shop", () => {
    const mail = renderUnifiedDigest({ day: D, shops: [facts(A, "Shop A", detail()), facts(B, "Shop B", detail())], notFinalized: [] }, env(MOO));
    expect(mail.text.match(/Toast net \$6,180\.00/g)?.length).toBe(2);
    expect(mail.html).toContain("Toast net $6,180.00");
  });

  it("the GM of Shop A gets Shop A's lines and never Shop B's", () => {
    expect(sectionFor(facts(A, "Shop A", detail()), env(GM_A))!.lines[0]!.label).toBe("Sales report");
    expect(sectionFor(facts(B, "Shop B", detail()), env(GM_A))!.lines.some((l) => l.label === "Sales report")).toBe(false);
  });

  it("every line text in both languages; Spanish is not English", () => {
    const enLines = sectionFor(facts(A, "Shop A", detail()), env(GM_A, "en"))!.lines;
    const esLines = sectionFor(facts(A, "Shop A", detail()), env(GM_A, "es"))!.lines;
    expect(esLines.length).toBe(enLines.length);
    expect(esLines[0]!.text).toContain("neto de Toast");
    expect(esLines[0]!.text).not.toBe(enLines[0]!.text);
  });
});

// ── 2. The figures are the Sales page's ───────────────────────────────────────────────────────

describe("every figure is the Sales page's on the same raws", () => {
  const all = (f: ShopDayFacts) => composeShopSections(f, "en", BASE, false, GM_A, digestAccessFor(GM_A))
    .flatMap((s) => s.lines);
  /** The composer's lines before the cap (the finished section folds some into "and N more"). */
  const line = (d: SalesDetailFacts, label: string) => uncappedSales(d).find((l) => l.label === label);

  it("the ladder equals summarizeSales: gross − discounts and comps − item voids − sales refunds = Toast net", () => {
    const tot = summarizeSales([dailyRaw()], D, D, "day").totals;
    expect(tot.toastNetCents).toBe(665500 - 31000 - 4500 - 12000);
    expect(line(detail(), "Sales report")).toMatchObject({
      tone: "info", needs: "sales_detail",
      text: `gross ${money(tot.grossCents!)} − discounts and comps ${money(tot.discountsCompsCents!)} − item voids ${money(tot.voidsCents!)} − item-sales refunds ${money(tot.salesRefundsCents!)} = Toast net ${money(tot.toastNetCents!)}`,
      href: `${BASE}/reports/sales?location=${A}&range=custom&from=${D}&to=${D}`,
    });
    expect(salesDetailTotals(dailyRaw(), D)).toEqual({ ...tot, ezcaterMissing: 0 });
    expect(all(facts(A, "Shop A", detail())).some((l) => l.text.includes("Toast net $6,180.00"))).toBe(true);
  });

  it("tips · tax · service charges and ezCater + total are the Sales page's totals", () => {
    const tot = summarizeSales([dailyRaw()], D, D, "day").totals;
    expect(line(detail(), "Tips, tax, service charges")!.text).toBe(`tips ${money(tot.tipCents)} · tax ${money(tot.taxCents)} · service charges ${money(tot.serviceChargesCents!)}`);
    expect(line(detail(), "ezCater and total")!.text).toBe(`ezCater ${money(94000)} (2 orders) · sales before refunds ${money(tot.totalCents)}`);
    expect(tot.totalCents).toBe(600000 + 94000);
  });

  it("delivery platforms, catering vs walk-in, voids/refunds/exclusions and servers", () => {
    expect(line(detail(), "Delivery platforms")!.text).toBe("DoorDash $820.00 (8 checks), Uber Eats $590.00 (6 checks)");
    // Catering = the Toast catering ring + ezCater; walk-in = every other counted sale. Gift cards in neither.
    expect(line(detail(), "Catering vs walk-in")!.text).toBe("catering $1,140.00 · walk-in and other channels $5,800.00");
    expect(line(detail(), "Voids · refunds · exclusions")!.text)
      .toBe("item voids $45.00 · 3 refunds captured so far $120.00 · 4 checks not counted as sales (gift cards 1, ezCater rung in Toast 2, voided 1)");
    expect(line(detail(), "Top servers")!.text).toBe("Ana $2,000.00 (15 checks), Ben $1,500.00 (10 checks), No server on the order $1,500.00 (5 checks)");
  });
});

/** The Sales section's lines straight from the composer: before the cut and before the cap. */
function uncappedSales(d: SalesDetailFacts) {
  return salesDetailLines({ t: translator("en"), language: "en", baseUrl: BASE, locationId: A, day: D, viewer: GM_A }, v2Fixture({ salesDetail: d }));
}

// ── 3. Unknown is never $0 ────────────────────────────────────────────────────────────────────

describe("partial coverage, missing amounts and failed reads are said, never $0", () => {
  const gated = (d: SalesDetailFacts) => uncappedSales(d).filter((l) => l.needs === "sales_detail");

  it("a day whose capture is not complete: ONE 'not available' line, no figure, no $0", () => {
    const d = detail({ totals: ok(salesDetailTotals(dailyRaw({ captured_days: [] }), D)) });
    expect(gated(d)).toEqual([expect.objectContaining({ label: "Sales report", text: "Not available: this day's Toast capture is not complete", unknown: true, needs: "sales_detail" })]);
    const s = sectionFor(facts(A, "Shop A", d), env(GM_A))!;
    expect(s.status).toMatchObject({ tone: "unknown", unknowns: 1 });
    expect(s.lines.filter((l) => l.needs).some((l) => /\$0\.00/.test(l.text))).toBe(false);
  });

  it("a day with no capture at all (empty raws) is not available either, never a $0 ladder", () => {
    const empty: DailyRaw = { classes: [], tips: [], discounts: [], refunds: [], captured_days: [], ezcater: [] };
    const d = detail({ totals: ok(salesDetailTotals(empty, D)), channels: ok([]), hours: ok([]), servers: ok([]) });
    expect(gated(d).map((l) => l.text)).toEqual(["Not available: this day's Toast capture is not complete"]);
  });

  it("missing accounting: Toast net not available, the gap counted, no $0 ladder", () => {
    const raw = dailyRaw();
    raw.classes[0] = { ...raw.classes[0]!, accounting_missing: 2 };
    const l = gated(detail({ totals: ok(salesDetailTotals(raw, D)) }))[0]!;
    expect(l).toMatchObject({ label: "Sales report", unknown: true, text: "Toast net not available · 2 checks without accounting" });
  });

  it("an unknown tip / check amount is counted and marks the line unknown", () => {
    const raw = dailyRaw({ tips: [{ business_date: D, tip_cents: 61200, tip_missing: 1 }] });
    raw.classes[0] = { ...raw.classes[0]!, amount_missing: 2 };
    const lines = gated(detail({ totals: ok(salesDetailTotals(raw, D)) }));
    expect(lines.find((l) => l.label === "Tips, tax, service charges")).toMatchObject({ unknown: true, text: "tips $612.00 + 1 amount not recorded · tax $642.00 · service charges $0.00" });
    expect(lines.find((l) => l.label === "ezCater and total")).toMatchObject({ unknown: true, text: "ezCater $940.00 (2 orders) · sales before refunds $6,940.00 · + 2 amounts not recorded" });
  });

  it("a failed totals read: one 'could not load' line; a failed breakdown: that line only", () => {
    expect(gated(detail({ totals: failed() })).map((l) => [l.label, l.text, l.unknown])).toEqual([["Sales report", "Could not load — check the app", true]]);
    const lines = gated(detail({ servers: failed(), hours: unavailable("sales_reads_not_installed") }));
    expect(lines.find((l) => l.label === "Top servers")).toMatchObject({ text: "Could not load — check the app", unknown: true });
    expect(lines.find((l) => l.label === "Busiest hours")).toMatchObject({ text: "Not yet available", unknown: true });
    expect(lines.find((l) => l.label === "Sales report")!.text).toContain("Toast net $6,180.00");
  });
});

// ── 4. Busiest hours ──────────────────────────────────────────────────────────────────────────

describe("busiest hours: top 3 by $, ties broken by checks then the earlier hour; the unknown hour apart", () => {
  it("ties", () => {
    const rows = mergeBreakdown("hour_weekday", [[
      { key: "3|12", dow: 3, hour: 12, checks: 5, cents: 10000 },
      { key: "3|13", dow: 3, hour: 13, checks: 7, cents: 10000 },
      { key: "3|11", dow: 3, hour: 11, checks: 7, cents: 10000 },
      { key: "3|18", dow: 3, hour: 18, checks: 50, cents: 9000 },
      { key: "3|-1", dow: 3, hour: -1, checks: 9, cents: 99999 },
    ]]);
    const h = busiestHours(rows);
    expect(h.top.map((x) => x.hour)).toEqual([11, 13, 12]);
    expect(h.unknown).toEqual({ cents: 99999, checks: 9, amountMissing: 0 });
  });

  it("the line: each hour with $ and checks; checks with no opened time said apart, never ranked", () => {
    const l = uncappedSales(detail()).find((x) => x.label === "Busiest hours")!;
    expect(l.text).toBe(`${formatHourRange(12, "en")} $1,140.00 (38 checks), ${formatHourRange(13, "en")} $980.00 (30 checks), ${formatHourRange(18, "en")} $760.00 (20 checks) · no opened time: 2 checks $45.00`);
    expect(l.href).toBe(`${BASE}/reports/sales?location=${A}&range=custom&from=${D}&to=${D}&view=heatmap`);
  });

  it("only unknown-hour checks: no ranking, the unknown said; an hour with a missing amount is counted", () => {
    const only = uncappedSales(detail({ hours: ok(mergeBreakdown("hour_weekday", [[{ key: "3|-1", dow: 3, hour: -1, checks: 2, cents: 500 }]])) }))
      .find((x) => x.label === "Busiest hours")!;
    expect(only.text).toBe("no opened time: 2 checks $5.00");
    const lost = uncappedSales(detail({ hours: ok(mergeBreakdown("hour_weekday", [[{ key: "3|12", dow: 3, hour: 12, checks: 2, cents: 500, amount_missing: 1 }]])) }))
      .find((x) => x.label === "Busiest hours")!;
    expect(lost).toMatchObject({ unknown: true });
    expect(lost.text).toContain("+ 1 amount not recorded");
  });
});

// ── 5. Servers: parity with the Sales page's ranking ──────────────────────────────────────────

type RpcCall = { fn: string; args: Record<string, unknown>; signal: AbortSignal | null };
function rpcClient(opts: { stall?: (fn: string, args: Record<string, unknown>) => "honour" | "ignore" | null; data?: (fn: string, args: Record<string, unknown>) => unknown } = {}) {
  const calls: RpcCall[] = [];
  const answer = (fn: string, args: Record<string, unknown>) => opts.data ? opts.data(fn, args)
    : fn === "sales_report_daily" ? dailyRaw()
      : args.p_dimension === "channel" ? channelRaw : args.p_dimension === "hour_weekday" ? hourRaw : serverRaw;
  const rpc = (fn: string, args: Record<string, unknown>) => {
    const call: RpcCall = { fn, args, signal: null };
    calls.push(call);
    const run = (signal: AbortSignal | null) => new Promise((resolve, reject) => {
      const stall = opts.stall?.(fn, args) ?? null;
      if (stall === "ignore") return; // never settles, whatever the signal says
      if (stall === "honour") { signal?.addEventListener("abort", () => reject(new Error("AbortError"))); return; }
      resolve({ data: answer(fn, args), error: null });
    });
    return {
      abortSignal(signal: AbortSignal) { call.signal = signal; return run(signal); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return run(null).then(res, rej); },
    };
  };
  return { sb: { rpc } as unknown as SupabaseClient, calls };
}

describe("servers: the top 3 are the Sales page's servers view, in its order and with its labels", () => {
  it("the digest reads the same rows the Sales page shows for the day (loadSalesBreakdown, dimension server)", async () => {
    const page = rpcClient();
    const viewer = { userId: "u", level: 7, locations: [A] };
    const range = resolveSalesRange({ range: "custom", from: D, to: D }, "2026-10-10");
    expect([range.from, range.to]).toEqual([D, D]);
    const pageRows = await loadSalesBreakdown(viewer, { locationId: A, range, dimension: "server" }, { client: page.sb });
    const digest = await loadSalesDetail(rpcClient().sb, A, D);
    expect(digest.servers).toEqual(ok(pageRows));
    expect(topServers(pageRows)).toEqual(pageRows.slice(0, 3));
    // Ties: Ben and the no-server row both $1,500 → more checks first (the page's sortBreakdown).
    expect(topServers(pageRows).map((r) => r.key)).toEqual(["guid-ana", "guid-ben", ""]);
  });

  it("the label rule is SalesParts.serverLabel's, in both languages", () => {
    for (const language of ["en", "es"] as const) {
      for (const [key, name, online] of [["guid-ana", "Ana", false], ["", null, false], ["guid-9f3c", null, false], ["guid-web", null, true], ["guid-x", "  ", false], ["", null, true]] as const) {
        expect(salesServerLabel(translator(language), key, name, online)).toBe(serverLabel(language, key, name, online));
      }
    }
  });
});

// ── 6. Reads: four RPCs, day D only, one deadline, once per shop/day ──────────────────────────

describe("reads", () => {
  it("exactly four Sales RPCs for D only (never D-7), every one with the area's abort signal", async () => {
    const { sb, calls } = rpcClient();
    const d = await loadSalesDetail(sb, A, D);
    expect(calls.map((c) => [c.fn, c.args])).toEqual([
      ["sales_report_daily", { p_location_id: A, p_from: D, p_to: D }],
      ...DIGEST_SALES_DETAIL_DIMENSIONS.map((dimension) => ["sales_report_breakdown", { p_location_id: A, p_from: D, p_to: D, p_dimension: dimension }]),
    ]);
    expect(DIGEST_SALES_DETAIL_DIMENSIONS).toEqual(["channel", "hour_weekday", "server"]);
    const signals = new Set(calls.map((c) => c.signal));
    expect(signals.size).toBe(1);
    expect([...signals][0]).toBeInstanceOf(AbortSignal);
    expect(d.totals).toEqual(ok({ ...summarizeSales([dailyRaw()], D, D, "day").totals, ezcaterMissing: 0 }));
  });

  it("loadShopV2Facts makes exactly those four RPCs per shop/day", async () => {
    const { sb, calls } = rpcClient();
    const fromSb = Object.assign(sb, { from: () => emptyQuery() });
    const v = await loadShopV2Facts(fromSb as unknown as SupabaseClient, A, D, new Date("2026-10-08T02:00:00Z"));
    expect(calls.length).toBe(4);
    expect(calls.every((c) => c.args.p_from === D && c.args.p_to === D && c.signal !== null)).toBe(true);
    expect(v.salesDetail?.totals.kind).toBe("ok");
  });

  it("a stalled read ends at its deadline as 'not available'; the other reads and the digest stand", async () => {
    for (const mode of ["honour", "ignore"] as const) {
      const { sb, calls } = rpcClient({ stall: (_fn, args) => args.p_dimension === "server" ? mode : null });
      const started = Date.now();
      const d = await loadSalesDetail(sb, A, D, 40);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(d.servers).toEqual(failed());
      expect(d.totals.kind).toBe("ok");
      expect(d.hours.kind).toBe("ok");
      expect(calls.find((c) => c.args.p_dimension === "server")!.signal!.aborted).toBe(true);
      const mail = renderShopDigest(facts(A, "Shop A", d), env(GM_A));
      expect(mail.text).toContain("Toast net $6,180.00");
      const s = sectionFor(facts(A, "Shop A", d), env(GM_A))!;
      expect(s.lines.find((l) => l.label === "Top servers")).toMatchObject({ text: "Could not load — check the app", unknown: true });
      // Every other section is intact.
      expect(composeShopSections(facts(A, "Shop A", d), "en", BASE, false, GM_A, digestAccessFor(GM_A)).map((x) => x.title))
        .toEqual(composeShopSections(facts(A, "Shop A"), "en", BASE, false, GM_A, digestAccessFor(GM_A)).map((x) => x.title));
    }
  });

  it("every read stalled: one 'could not load' line, the rest of the digest intact", async () => {
    const { sb } = rpcClient({ stall: () => "ignore" });
    const d = await loadSalesDetail(sb, A, D, 30);
    expect(d).toEqual({ totals: failed(), channels: failed(), hours: failed(), servers: failed() });
    const s = sectionFor(facts(A, "Shop A", d), env(GM_A))!;
    expect(s.lines[0]).toMatchObject({ label: "Sales report", text: "Could not load — check the app", unknown: true });
    expect(s.lines.slice(1)).toEqual(sectionFor(facts(A, "Shop A"), env(GM_A))!.lines);
  });

  it("a missing RPC (0232 not applied) is 'not available', a returned error is 'could not load'", async () => {
    const missing = { rpc: () => ({ abortSignal: async () => ({ data: null, error: { code: "PGRST202", message: "x" } }) }) } as unknown as SupabaseClient;
    expect((await loadSalesDetail(missing, A, D)).totals).toEqual(unavailable("sales_reads_not_installed"));
    const broken = { rpc: () => ({ abortSignal: async () => ({ data: null, error: { code: "57014", message: "x" } }) }) } as unknown as SupabaseClient;
    expect((await loadSalesDetail(broken, A, D)).servers).toEqual(failed());
  });

  it("several recipients of one shop plus the unified digest read each shop/day ONCE: 4 RPCs per shop/day", async () => {
    const { sb, calls } = rpcClient();
    const reads: string[] = [];
    const sent: Array<{ to: string; text: string }> = [];
    let seq = 0;
    const store = {
      claim: async (row: ClaimRow) => ({ id: `row-${++seq}-${row.kind}` }),
      reclaim: async () => false, markAttempt: async () => true, recordAccepted: async () => true, finish: async () => true, skip: async () => {},
    };
    const SHOP_A = { id: A, name: "Shop A" };
    const SHOP_B = { id: B, name: "Shop B" };
    const io: DigestIO = {
      now: new Date("2026-10-08T02:30:00Z"), baseUrl: BASE,
      previewRecipient: async () => null,
      settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live" }),
      directory: async () => ({
        dir: {
          users: [
            { id: "gm-b", name: "John", email: "john@example.com", role: "gm", language: "en", active: true },
            { id: "gm-b2", name: "Jo", email: "jo@example.com", role: "gm", language: "es", active: true },
            { id: "agm-b", name: "Kim", email: "kim@example.com", role: "agm", language: "en", active: true },
            { id: "moo", name: "Cristian", email: "cristian@example.com", role: "moo", language: "es", active: true },
            { id: "own", name: "Pete", email: "pete@example.com", role: "owner", language: "en", active: true },
          ],
          memberships: [{ userId: "gm-b", locationId: B }, { userId: "gm-b2", locationId: B }, { userId: "agm-b", locationId: B }],
          overrides: [{ id: "o1", kind: "internal", userId: "agm-b", email: null, displayName: "Kim", active: true, cateringDigest: false, shopDigest: true, locationIds: null }],
          locationIds: [A, B],
        },
        locations: [SHOP_A, SHOP_B],
      }),
      sendLog: async () => [],
      finalizedClosings: async (days) => new Map(days.map((d) => [d, new Set([A, B])])),
      shopFacts: async (l, day) => {
        reads.push(`${l.id}|${day}`);
        return { ...facts(l.id, l.name), v2: v2Fixture({ salesDetail: await loadSalesDetail(sb, l.id, day) }) };
      },
      cateringFacts: async (today) => ({ today, leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [] }),
      store,
      sendEmail: async (m) => { sent.push({ to: m.to, text: m.text }); return { id: `mail-${sent.length}` }; },
      sha: (c) => String(c.length),
      alert: async () => false,
      recordRun: async () => {},
    };
    await runClosingDigestsWith(io, B, D);
    const to = sent.map((m) => m.to).sort();
    expect(to).toEqual(["cristian@example.com", "jo@example.com", "john@example.com", "kim@example.com", "pete@example.com"]);
    expect(reads.sort()).toEqual([`${A}|${D}`, `${B}|${D}`]);
    expect(calls.length).toBe(4 * 2);
    expect(calls.every((c) => c.args.p_from === D && c.args.p_to === D)).toBe(true);
    // The flagged AGM's copy carries none of it; the GMs' and the unified copies do.
    expect(sent.find((m) => m.to === "kim@example.com")!.text).not.toContain("Toast net");
    expect(sent.find((m) => m.to === "john@example.com")!.text).toContain("Toast net $6,180.00");
    expect(sent.find((m) => m.to === "pete@example.com")!.text.match(/Toast net \$6,180\.00/g)?.length).toBe(2);
  });
});

/** A PostgREST query stand-in that answers every select with no rows (and a 0 count). */
function emptyQuery(): unknown {
  const result = { data: [], error: null, count: 0 };
  const q: unknown = new Proxy(() => q, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      if (prop === "range") return async () => result;
      if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
      return () => q;
    },
  });
  return q;
}

// ── 7. The sales_checks link target ───────────────────────────────────────────────────────────

describe("the sales_checks target: the checks page's own params, enum- and id-shaped only, gated like Sales", () => {
  it("path", () => {
    expect(targetPath({ to: "sales_checks", location: A, day: D })).toBe(`/reports/sales/checks?location=${A}&range=custom&from=${D}&to=${D}`);
    expect(targetPath({ to: "sales_checks", location: A, day: D, channel: "third_party", provider: "DoorDash", hour: -1 }))
      .toBe(`/reports/sales/checks?location=${A}&range=custom&from=${D}&to=${D}&channel=third_party&provider=DoorDash&hour=-1`);
  });

  it("gate = the sales gate, for every viewer", () => {
    for (const viewer of [GM_A, GM_B, AGM_A, PREP_A, MOO, OWNER, NO_ACCESS_VIEWER, { role: "social_media_mgr", level: 6, locations: [A] }]) {
      expect(canOpen(viewer, { to: "sales_checks", location: A, day: D })).toBe(canOpen(viewer, { to: "sales", location: A, day: D }));
    }
    expect(canOpen(GM_A, { to: "sales_checks", location: A, day: D })).toBe(true);
    expect(canOpen(GM_B, { to: "sales_checks", location: A, day: D })).toBe(false);
    expect(canOpen(AGM_A, { to: "sales_checks", location: A, day: D })).toBe(false);
  });

  it("free text, a bad channel or a bad hour is no link; the empty-key sentinel is allowed", () => {
    const ctx = { baseUrl: BASE, viewer: GM_A };
    const base = { to: "sales_checks" as const, location: A, day: D };
    expect(digestLink(ctx, { ...base, provider: "Uber Eats" })).toBeNull();
    expect(digestLink(ctx, { ...base, provider: "a&b=c" })).toBeNull();
    expect(digestLink(ctx, { ...base, channel: "bogus" as never })).toBeNull();
    for (const hour of [24, -2, 1.5]) expect(digestLink(ctx, { ...base, hour })).toBeNull();
    expect(digestLink(ctx, { ...base, provider: "~" })).toBe(`${BASE}/reports/sales/checks?location=${A}&range=custom&from=${D}&to=${D}&provider=%7E`);
    expect(digestLink(ctx, { ...base, channel: "catering", hour: 0 })).toContain("&channel=catering&hour=0");
  });

  it("the delivery-platform line links to its checks (one id-shaped provider), else to the channel's checks", () => {
    const one = uncappedSales(detail({ channels: ok(mergeBreakdown("channel", [channelRaw.filter((r) => r.provider !== "Uber Eats")])) })).find((l) => l.label === "Delivery platforms")!;
    expect(one.href).toBe(`${BASE}/reports/sales/checks?location=${A}&range=custom&from=${D}&to=${D}&channel=third_party&provider=DoorDash`);
    const uber = uncappedSales(detail({ channels: ok(mergeBreakdown("channel", [channelRaw.filter((r) => r.provider !== "DoorDash")])) })).find((l) => l.label === "Delivery platforms")!;
    expect(uber.href).toBe(`${BASE}/reports/sales/checks?location=${A}&range=custom&from=${D}&to=${D}&channel=third_party`);
    const two = uncappedSales(detail()).find((l) => l.label === "Delivery platforms")!;
    expect(two.href).toBe(`${BASE}/reports/sales/checks?location=${A}&range=custom&from=${D}&to=${D}&channel=third_party`);
  });
});

// ── 8. i18n ───────────────────────────────────────────────────────────────────────────────────

describe("i18n: every new key ships in en and es with the same params", () => {
  it("parity", () => {
    const e = en as Record<string, string>;
    const s = es as Record<string, string>;
    const keys = Object.keys(e).filter((k) => k.startsWith("digest.v2.sales."));
    expect(keys.length).toBeGreaterThan(50);
    const params = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort();
    for (const k of keys) {
      expect(s[k], k).toBeTruthy();
      expect(params(s[k]!), k).toEqual(params(e[k]!));
    }
    for (const k of ["digest.v2.sales.report_label", "digest.v2.sales.ladder", "digest.v2.sales.hours_label", "digest.v2.sales.servers_label", "digest.v2.sales.catering_vs"]) {
      expect(s[k], k).not.toBe(e[k]);
    }
  });
});

// ── 9. Fix round 1 (CC rulings S1–S8, RULINGS-digest3-fixround.md "PR 3") ─────────────────────

describe("fix round 1: unknown is never zero, the names are the Sales page's, platforms print", () => {
  const lineOf = (d: SalesDetailFacts, label: string, language: "en" | "es" = "en") =>
    salesDetailLines({ t: translator(language), language, baseUrl: BASE, locationId: A, day: D, viewer: GM_A }, v2Fixture({ salesDetail: d }))
      .find((l) => l.label === label);
  const totalsOf = (over: Partial<DailyRaw>) => detail({ totals: ok(salesDetailTotals(dailyRaw(over), D)) });

  // S1 ──────────────────────────────────────────────────────────────────────────────────────────
  it("S1: 0247's uncertainty-only refund row (count 0, sales_refund_missing 2) never reads 'no refunds' and is unknown", () => {
    const d = totalsOf({ refunds: [{ business_date: D, count: 0, refund_cents: 0, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: 2 }] });
    const adj = lineOf(d, "Voids · refunds · exclusions")!;
    expect(adj).toMatchObject({ unknown: true, needs: "sales_detail" });
    expect(adj.text).toBe("item voids $45.00 · 2 refunds cannot be allocated to item sales · 4 checks not counted as sales (gift cards 1, ezCater rung in Toast 2, voided 1)");
    expect(adj.text).not.toMatch(/no refunds/);
    expect(lineOf(d, "Sales report")).toMatchObject({ unknown: true, text: "Toast net not available · 2 refunds cannot be allocated to item sales" });
    const esLine = lineOf(d, "Anulaciones · reembolsos · exclusiones", "es")!;
    expect(esLine.text).toContain("2 reembolsos no se pueden asignar a ventas de artículos");
    expect(esLine.text).not.toMatch(/sin reembolsos/);
    // The section is never "All good" while that refund is unaccounted for.
    expect(sectionFor(facts(A, "Shop A", d), env(GM_A))!.status?.tone).toBe("unknown");
    expect(renderShopDigest(facts(A, "Shop A", d), env(GM_A)).text).not.toMatch(/no refunds/);
  });

  it("S1: a dated refund count AND an unallocatable one: both said, the line unknown", () => {
    const d = totalsOf({ refunds: [
      { business_date: D, count: 3, refund_cents: 12000, refund_tip_cents: 0, sales_refund_cents: 12000, sales_refund_missing: 0 },
      { business_date: D, count: 0, refund_cents: 0, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: 1 },
    ] });
    expect(lineOf(d, "Voids · refunds · exclusions")).toMatchObject({
      unknown: true, text: expect.stringContaining("3 refunds captured so far $120.00 · 1 refund cannot be allocated to item sales"),
    });
  });

  it("S1: no refund at all and none missing still reads 'no refunds captured so far', not unknown", () => {
    const l = lineOf(totalsOf({ refunds: [] }), "Voids · refunds · exclusions")!;
    expect(l.text).toContain("no refunds captured so far");
    expect(l.unknown).toBeUndefined();
  });

  // S2 ──────────────────────────────────────────────────────────────────────────────────────────
  it("S2 ezCater: an unpriced order is 'amount unknown (1 order)', never $0.00; a genuine $0 order stays $0.00 and known", () => {
    const unpriced = totalsOf({ classes: [], tips: [], discounts: [], refunds: [], ezcater: [{ business_date: D, orders: 1, subtotal_cents: null, amount_missing: 1 }] });
    const l = lineOf(unpriced, "ezCater and total")!;
    expect(l).toMatchObject({ unknown: true, text: "ezCater amount unknown (1 order) · sales before refunds amount unknown (1 order)" });
    expect(l.text).not.toContain("$0.00");
    expect(lineOf(unpriced, "ezCater y total", "es")!.text).toBe("ezCater: monto desconocido (1 pedido) · ventas antes de reembolsos monto desconocido (1 pedido)");
    const free = lineOf(totalsOf({ ezcater: [{ business_date: D, orders: 1, subtotal_cents: 0, amount_missing: 0 }] }), "ezCater and total")!;
    expect(free.text).toBe("ezCater $0.00 (1 order) · sales before refunds $6,000.00");
    expect(free.unknown).toBeUndefined();
  });

  it("S2 ezCater: one of two orders unpriced names the ezCater gap on the ezCater figure", () => {
    const d = totalsOf({ ezcater: [{ business_date: D, orders: 2, subtotal_cents: 94000, amount_missing: 1 }] });
    expect(d.totals.kind === "ok" && d.totals.value.ezcaterMissing).toBe(1);
    expect(lineOf(d, "ezCater and total")).toMatchObject({
      unknown: true, text: "ezCater $940.00 (2 orders, 1 without an amount) · sales before refunds $6,940.00 · + 1 amount not recorded",
    });
  });

  it("S2 catering vs walk-in: a side whose every order has no amount is 'amount unknown (N orders)'; a partial side says its gap", () => {
    const raw = channelRaw.map((r) => r.channel === "catering" ? { ...r, cents: 0, amount_missing: r.checks } : r);
    expect(lineOf(detail({ channels: ok(mergeBreakdown("channel", [raw])) }), "Catering vs walk-in"))
      .toMatchObject({ unknown: true, text: "catering amount unknown (3 orders) · walk-in and other channels $5,800.00" });
    const partial = channelRaw.map((r) => r.channel === "dine_in" ? { ...r, amount_missing: 1 } : r);
    expect(lineOf(detail({ channels: ok(mergeBreakdown("channel", [partial])) }), "Catering vs walk-in"))
      .toMatchObject({ unknown: true, text: "catering $1,140.00 · walk-in and other channels $5,800.00 + 1 amount not recorded" });
    expect(lineOf(detail({ channels: ok(mergeBreakdown("channel", [raw])) }), "Catering vs. en tienda", "es")!.text)
      .toBe("catering monto desconocido (3 pedidos) · en tienda y otros canales $5,800.00");
  });

  it("S2 delivery platforms: a provider whose every check has no amount is 'amount unknown (N checks)'; a partial one says its gap", () => {
    const raw = channelRaw.map((r) => r.provider === "DoorDash" ? { ...r, cents: 0, amount_missing: 8 } : r.provider === "Uber Eats" ? { ...r, amount_missing: 1 } : r);
    const l = lineOf(detail({ channels: ok(mergeBreakdown("channel", [raw])) }), "Delivery platforms")!;
    expect(l).toMatchObject({ unknown: true, text: "Uber Eats $590.00 (6 checks, 1 without an amount), DoorDash amount unknown (8 checks)" });
    expect(l.text).not.toContain("$0.00");
  });

  // S3 ──────────────────────────────────────────────────────────────────────────────────────────
  it("S3: a 4th-place server whose only check has no amount marks the top-3 line unknown; the page's order is kept", () => {
    const raw: BreakdownRaw[] = [
      { key: "guid-ana", label: "Ana", checks: 15, cents: 200000, amount_missing: 0 },
      { key: "guid-ben", label: "Ben", checks: 10, cents: 150000, amount_missing: 0 },
      { key: "guid-cy", label: "Cy", checks: 5, cents: 90000, amount_missing: 0 },
      { key: "guid-dee", label: "Dee", checks: 1, cents: 0, amount_missing: 1 },
    ];
    const rows = mergeBreakdown("server", [raw]);
    expect(rows.map((r) => r.label)).toEqual(["Ana", "Ben", "Cy", "Dee"]);
    expect(lineOf(detail({ servers: ok(rows) }), "Top servers")).toMatchObject({
      unknown: true, text: "Ana $2,000.00 (15 checks), Ben $1,500.00 (10 checks), Cy $900.00 (5 checks) · + 1 amount not recorded",
    });
    expect(sectionFor(facts(A, "Shop A", detail({ servers: ok(rows) })), env(GM_A))!.status?.tone).toBe("unknown");
  });

  // S4 ──────────────────────────────────────────────────────────────────────────────────────────
  /** An RPC stand-in that counts the reads in flight. A `stall` read never settles (whatever the signal says). */
  function countingClient(stall: (args: Record<string, unknown>) => boolean = () => false) {
    let inFlight = 0;
    let peak = 0;
    const calls: string[] = [];
    const rpc = (fn: string, args: Record<string, unknown>) => ({
      abortSignal() {
        calls.push(fn === "sales_report_daily" ? "daily" : String(args.p_dimension));
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        if (stall(args)) return new Promise(() => {});
        return new Promise((resolve) => setTimeout(() => {
          inFlight -= 1;
          resolve({ data: fn === "sales_report_daily" ? dailyRaw() : args.p_dimension === "channel" ? channelRaw : args.p_dimension === "hour_weekday" ? hourRaw : serverRaw, error: null });
        }, 5));
      },
    });
    return { sb: { rpc } as unknown as SupabaseClient, calls, peak: () => peak };
  }

  it("S4: never more than 2 Sales reads in flight; all four still run, in order, and load", async () => {
    const c = countingClient();
    const d = await loadSalesDetail(c.sb, A, D);
    expect(c.peak()).toBe(2);
    expect(c.calls).toEqual(["daily", "channel", "hour_weekday", "server"]);
    expect([d.totals.kind, d.channels.kind, d.hours.kind, d.servers.kind]).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("S4: the deadline expires with work queued: the queued read never starts, and every line on an unfinished read is unknown, never zero", async () => {
    // The daily read answers; channel and hour_weekday stall in the two slots; server is still queued at the deadline.
    const c = countingClient((args) => args.p_dimension === "channel" || args.p_dimension === "hour_weekday");
    const started = Date.now();
    const d = await loadSalesDetail(c.sb, A, D, 40);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(c.peak()).toBe(2);
    expect(c.calls).toEqual(["daily", "channel", "hour_weekday"]);
    expect(d).toEqual({ totals: expect.objectContaining({ kind: "ok" }), channels: failed(), hours: failed(), servers: failed() });
    const lines = uncappedSales(d).filter((l) => l.needs === "sales_detail");
    for (const label of ["Delivery platforms", "Busiest hours", "Catering vs walk-in", "Top servers"]) {
      expect(lines.find((l) => l.label === label), label).toMatchObject({ text: "Could not load — check the app", unknown: true });
    }
    expect(lines.filter((l) => l.unknown).some((l) => /\$0\.00/.test(l.text))).toBe(false);
  });

  it("S4: every read stalled: only 2 ever start, and every part is failed", async () => {
    const c = countingClient(() => true);
    const d = await loadSalesDetail(c.sb, A, D, 30);
    expect(c.peak()).toBe(2);
    expect(c.calls).toEqual(["daily", "channel"]);
    expect(d).toEqual({ totals: failed(), channels: failed(), hours: failed(), servers: failed() });
  });

  // S5 ──────────────────────────────────────────────────────────────────────────────────────────
  it("S5: on a healthy day the platform dollars print before the top items, in the rendered text AND HTML", () => {
    for (const viewer of [GM_A, MOO]) {
      const mail = renderShopDigest(facts(A, "Shop A", detail()), env(viewer));
      for (const body of [mail.text, mail.html]) {
        const platforms = body.indexOf("DoorDash $820.00 (8 checks), Uber Eats $590.00 (6 checks)");
        expect(platforms).toBeGreaterThan(-1);
        expect(platforms).toBeLessThan(body.indexOf("Top items (units)"));
      }
      expect(sectionFor(facts(A, "Shop A", detail()), env(viewer))!.lines.at(-1)!.text).not.toContain("Delivery platforms");
    }
  });

  // S6 ──────────────────────────────────────────────────────────────────────────────────────────
  it("S6: the ladder's 'item-sales refunds' and the adjustments' 'refunds captured so far' are named apart (en + es)", () => {
    expect(lineOf(detail(), "Sales report")!.text).toContain("− item-sales refunds $120.00");
    expect(lineOf(detail(), "Voids · refunds · exclusions")!.text).toContain("3 refunds captured so far $120.00");
    expect(lineOf(detail(), "Reporte de ventas", "es")!.text).toContain("− reembolsos de ventas de artículos $120.00");
    expect(lineOf(detail(), "Anulaciones · reembolsos · exclusiones", "es")!.text).toContain("3 reembolsos capturados hasta ahora $120.00");
  });

  // S7 ──────────────────────────────────────────────────────────────────────────────────────────
  it("S7: a null service-charges figure uses the inline unknown wording, lowercase, mid-sentence", () => {
    const raw = dailyRaw();
    raw.classes[0] = { ...raw.classes[0]!, service_charges_cents: null, accounting_missing: 1 };
    const d = detail({ totals: ok(salesDetailTotals(raw, D)) });
    const enLine = lineOf(d, "Tips, tax, service charges")!;
    expect(enLine).toMatchObject({ unknown: true, text: "tips $612.00 · tax $642.00 · service charges amount unknown" });
    const esLine = lineOf(d, "Propinas, impuesto, cargos de servicio", "es")!;
    expect(esLine.text).toBe("propinas $612.00 · impuesto $642.00 · cargos de servicio monto desconocido");
    for (const l of [enLine, esLine]) expect(l.text).not.toMatch(/Not yet available|Aún no disponible/);
  });

  // S8 ──────────────────────────────────────────────────────────────────────────────────────────
  it("S8: the adjustments label has no comma in either language", () => {
    expect((en as Record<string, string>)["digest.v2.sales.adjustments_label"]).toBe("Voids · refunds · exclusions");
    expect((es as Record<string, string>)["digest.v2.sales.adjustments_label"]).not.toContain(",");
  });

  it("refused recipients stay byte-identical with every fix-round shape (unknown refunds, unknown amounts, unfinished reads), en + es", () => {
    const shapes: SalesDetailFacts[] = [
      totalsOf({ refunds: [{ business_date: D, count: 0, refund_cents: 0, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: 2 }] }),
      totalsOf({ classes: [], tips: [], discounts: [], refunds: [], ezcater: [{ business_date: D, orders: 1, subtotal_cents: null, amount_missing: 1 }] }),
      detail({ channels: ok(mergeBreakdown("channel", [channelRaw.map((r) => ({ ...r, cents: 0, amount_missing: r.checks }))])) }),
      detail({ channels: failed(), hours: failed(), servers: failed() }),
    ];
    for (const viewer of [AGM_A, PREP_A, GM_B, NO_ACCESS_VIEWER, null]) {
      for (const language of ["en", "es"] as const) {
        for (const d of shapes) expect(renderShopDigest(facts(A, "Shop A", d), env(viewer, language))).toEqual(renderShopDigest(facts(A, "Shop A"), env(viewer, language)));
      }
    }
  });
});

// ── Digest round 3 polish ─────────────────────────────────────────────────────────────────────

describe("digest round 3 polish: busiest hours print; an all-unknown hour or server is never $0.00", () => {
  const lineOf = (d: SalesDetailFacts, label: string, language: "en" | "es" = "en") =>
    salesDetailLines({ t: translator(language), language, baseUrl: BASE, locationId: A, day: D, viewer: GM_A }, v2Fixture({ salesDetail: d }))
      .find((l) => l.label === label);
  const hoursOf = (raw: BreakdownRaw[]) => detail({ hours: ok(mergeBreakdown("hour_weekday", [raw])) });
  const serversOf = (raw: BreakdownRaw[]) => detail({ servers: ok(mergeBreakdown("server", [raw])) });
  const threeHours = `${formatHourRange(12, "en")} $1,140.00 (38 checks), ${formatHourRange(13, "en")} $980.00 (30 checks), ${formatHourRange(18, "en")} $760.00 (20 checks)`;

  // Item 2 ─────────────────────────────────────────────────────────────────────────────────────
  it("a healthy day: the busiest hours print in full (the plan's top 3, $ and checks) after the platforms and before the top items, in text AND HTML", () => {
    for (const viewer of [GM_A, MOO, OWNER]) {
      const s = sectionFor(facts(A, "Shop A", detail()), env(viewer))!;
      const hours = s.lines.find((l) => l.label === "Busiest hours")!;
      expect(hours.text).toBe(`${threeHours} · no opened time: 2 checks $45.00`);
      expect(s.lines.at(-1)!.text).not.toContain("Busiest hours");
      const mail = renderShopDigest(facts(A, "Shop A", detail()), env(viewer));
      for (const body of [mail.text, mail.html]) {
        const at = body.indexOf(threeHours);
        expect(at, viewer.role).toBeGreaterThan(body.indexOf("Uber Eats $590.00 (6 checks)"));
        expect(at).toBeLessThan(body.indexOf("Top items (units)"));
      }
    }
  });

  it("the cap rule is unchanged (F3: only issues are exempt): with six higher-priority unknown lines a routine hours line can still fold", () => {
    const raw = dailyRaw({
      tips: [{ business_date: D, tip_cents: 61200, tip_missing: 1 }],
      refunds: [{ business_date: D, count: 0, refund_cents: 0, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: 1 }],
      ezcater: [{ business_date: D, orders: 2, subtotal_cents: 94000, amount_missing: 1 }],
    });
    const channels = channelRaw.map((r) => r.provider === "DoorDash" ? { ...r, amount_missing: 1 } : r);
    const d = detail({ totals: ok(salesDetailTotals(raw, D)), channels: ok(mergeBreakdown("channel", [channels])), servers: failed() });
    const s = sectionFor(facts(A, "Shop A", d), env(GM_A))!;
    expect(lineOf(d, "Busiest hours")!.unknown).toBeUndefined(); // routine: every hour has its amount
    expect(s.status!.unknowns).toBeGreaterThanOrEqual(6);
    expect(s.lines.filter((l) => l.unknown)).toHaveLength(6); // the cap's six slots go to the unknown lines first
    expect(s.lines.some((l) => l.label === "Busiest hours")).toBe(false);
    expect(s.lines.at(-1)!.text).toContain("Busiest hours");
  });

  // Item 3 ─────────────────────────────────────────────────────────────────────────────────────
  it("an hour whose every check has no amount: 'amount unknown (N checks)', never $0.00; the line unknown and the gap counted (en + es)", () => {
    const d = hoursOf([
      { key: "3|12", dow: 3, hour: 12, checks: 38, cents: 114000, amount_missing: 0 },
      { key: "3|15", dow: 3, hour: 15, checks: 1, cents: 0, amount_missing: 1 },
    ]);
    const l = lineOf(d, "Busiest hours")!;
    expect(l).toMatchObject({ unknown: true, needs: "sales_detail" });
    expect(l.text).toBe(`${formatHourRange(12, "en")} $1,140.00 (38 checks), ${formatHourRange(15, "en")} amount unknown (1 check) · + 1 amount not recorded`);
    expect(l.text).not.toContain("$0.00");
    const esLine = lineOf(d, "Horas con más ventas", "es")!;
    expect(esLine.text).toContain(`${formatHourRange(15, "es")} monto desconocido (1 cuenta)`);
    expect(esLine.text).not.toContain("$0.00");
  });

  it("checks with no opened time whose every amount is missing: 'amount unknown', never $0.00", () => {
    const l = lineOf(hoursOf([{ key: "3|-1", dow: 3, hour: -1, checks: 2, cents: 0, amount_missing: 2 }]), "Busiest hours")!;
    expect(l).toMatchObject({ unknown: true, text: "no opened time: 2 checks amount unknown · + 2 amounts not recorded" });
    expect(lineOf(hoursOf([{ key: "3|-1", dow: 3, hour: -1, checks: 2, cents: 0, amount_missing: 2 }]), "Horas con más ventas", "es")!.text)
      .toBe("sin hora de apertura: 2 cuentas monto desconocido · + 2 montos sin registrar");
  });

  it("a partly unknown hour keeps its known $ (the gap is counted at the end); a genuine $0 hour stays $0.00 and known", () => {
    const partial = lineOf(hoursOf([{ key: "3|12", dow: 3, hour: 12, checks: 3, cents: 1500, amount_missing: 1 }]), "Busiest hours")!;
    expect(partial).toMatchObject({ unknown: true, text: `${formatHourRange(12, "en")} $15.00 (3 checks) · + 1 amount not recorded` });
    const zero = lineOf(hoursOf([{ key: "3|12", dow: 3, hour: 12, checks: 1, cents: 0, amount_missing: 0 }]), "Busiest hours")!;
    expect(zero.text).toBe(`${formatHourRange(12, "en")} $0.00 (1 check)`);
    expect(zero.unknown).toBeUndefined();
  });

  it("a top-3 server whose every check has no amount: 'amount unknown (N checks)', never $0.00 (en + es); a genuine $0 server stays $0.00", () => {
    const d = serversOf([
      { key: "guid-ana", label: "Ana", checks: 15, cents: 200000, amount_missing: 0 },
      { key: "guid-dee", label: "Dee", checks: 2, cents: 0, amount_missing: 2 },
    ]);
    const l = lineOf(d, "Top servers")!;
    expect(l).toMatchObject({ unknown: true, text: "Ana $2,000.00 (15 checks), Dee amount unknown (2 checks) · + 2 amounts not recorded" });
    expect(l.text).not.toContain("$0.00");
    expect(lineOf(d, "Meseros con más ventas", "es")!.text).toBe("Ana $2,000.00 (15 cuentas), Dee monto desconocido (2 cuentas) · + 2 montos sin registrar");
    const zero = lineOf(serversOf([{ key: "guid-dee", label: "Dee", checks: 1, cents: 0, amount_missing: 0 }]), "Top servers")!;
    expect(zero.text).toBe("Dee $0.00 (1 check)");
    expect(zero.unknown).toBeUndefined();
  });

  it("refused recipients stay byte-identical with the new shapes (hours first in the head, unknown hours and servers), en + es", () => {
    const shapes: SalesDetailFacts[] = [
      detail(),
      hoursOf([{ key: "3|15", dow: 3, hour: 15, checks: 1, cents: 0, amount_missing: 1 }, { key: "3|-1", dow: 3, hour: -1, checks: 2, cents: 0, amount_missing: 2 }]),
      serversOf([{ key: "guid-dee", label: "Dee", checks: 2, cents: 0, amount_missing: 2 }]),
      detail({ hours: failed() }),
      detail({ hours: unavailable("sales_reads_not_installed") }),
    ];
    for (const viewer of [AGM_A, PREP_A, GM_B, NO_ACCESS_VIEWER, null]) {
      for (const language of ["en", "es"] as const) {
        for (const d of shapes) expect(renderShopDigest(facts(A, "Shop A", d), env(viewer, language))).toEqual(renderShopDigest(facts(A, "Shop A"), env(viewer, language)));
      }
    }
  });
});
