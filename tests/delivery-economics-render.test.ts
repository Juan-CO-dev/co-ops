/**
 * Catering delivery D4 — what people see, en + es (static render):
 *
 *  THE REPORT SECTION (components/reports-hub/DeliveryEconomicsSection.tsx, fifth on /reports/sales/catering)
 *   - off renders NOTHING; a failed read renders its own "couldn't load" and never a number;
 *   - coverage FIRST, then the totals over the covered orders only, then the orders left out per reason, then the
 *     per-order list (collapsed by default) where a missing side is NAMED in place, never a 0;
 *   - the gratuity block is recorded only, with the "not verified" sentence word for word.
 *  THE PANEL'S MONEY LINE (components/catering/pipeline/DeliveryPanel.tsx) and its view-model (`panelMoney`)
 *   - only when the response carries `cost`; fee vs cost vs net with the named gaps; the recorded split or the EXPECTED
 *     one; ONE correction: "Recalculate from the current quote" when the computed split differs, else "Remove".
 *  THE PAGE: the delivery read is its own, beside the sales read, and cannot take the four sales blocks down.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { DeliveryPanel } from "@/components/catering/pipeline/DeliveryPanel";
import { DeliveryEconomicsSection } from "@/components/reports-hub/DeliveryEconomicsSection";
import type { DeliveryEconomicsResult } from "@/lib/delivery/economics";
import { deliveryEconomics, type EconomicsJob, type OrderEconomicsInput } from "@/lib/delivery/economics-shared";
import type { CostFoldRow } from "@/lib/delivery/cost-shared";
import type { SplitFoldRow } from "@/lib/delivery/gratuity-shared";
import { panelMoney } from "@/lib/delivery/panel-shared";
import type { LeadDeliveryView } from "@/lib/delivery/jobs";
import type { DeliveryCostRow, DeliveryGratuitySplit, QuoteCandidate } from "@/lib/delivery/types-shared";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { PipelineStage } from "@/lib/catering/pipeline-shared";
import { B, LEAD, jobOf, viewOf } from "./helpers/delivery-views";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
/**
 * The per-order lists are collapsed by default (the primitive is uncontrolled, and a static render never clicks). To
 * read the rows, `opened()` renders with every CollapsibleSection starting open; every other render is the real default.
 */
const openAll = vi.hoisted(() => ({ on: false }));
vi.mock("@/components/ui/CollapsibleSection", async (original) => {
  const real = await original<typeof import("@/components/ui/CollapsibleSection")>();
  return { CollapsibleSection: (props: Parameters<typeof real.CollapsibleSection>[0]) => real.CollapsibleSection({ ...props, defaultOpen: openAll.on }) };
});

type Lang = "en" | "es";
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const UNVERIFIED_EN = "Recorded only. The payroll and legal treatment of the driver's share is not verified — the driver works for the courier, not for us. Confirm with payroll before paying anything from this figure.";
const UNVERIFIED_ES = "Solo se registra. El tratamiento legal y de nómina de la parte del conductor no está verificado — el conductor trabaja para el mensajero, no para nosotros. Confirma con nómina antes de pagar algo con esta cifra.";

// ── The report section ──────────────────────────────────────────────────────
const quote = (o: Partial<QuoteCandidate> = {}): QuoteCandidate => ({ id: "q1", status: "accepted", isDelivery: true, gratuityCents: 10_000, deliveryFeeCents: 4_500, createdAt: "2026-11-20T10:00:00Z", ...o });
const ejob = (attemptNo: number, status: EconomicsJob["status"], o: Partial<EconomicsJob> = {}): EconomicsJob => ({ id: `job-${attemptNo}`, attemptNo, status, bookedVia: "manual", providerLabel: "Courier A", ...o });
const ecost = (jobId: string, amountCents: number): CostFoldRow => ({ id: `${jobId}-c`, jobId, component: "base", semantics: "snapshot", amountCents, moneyIdentity: `${jobId}:base`, observedAt: "2026-11-22T10:00:00Z", correctsId: null });
const esplit = (id: string, o: Partial<SplitFoldRow> = {}): SplitFoldRow => ({ id, jobId: "job-1", kind: "split", gratuityCents: 10_000, driverBps: 1000, driverCents: 1_000, crewCents: 9_000, supersedesId: null, ...o });
const order = (leadId: string, o: Partial<OrderEconomicsInput> = {}): OrderEconomicsInput =>
  ({ leadId, eventDate: "2026-11-20", stage: "completed", isEzcater: false, candidates: [quote()], jobs: [], costs: [], splits: [], driverBps: 1000, ...o });
const PERIOD = [
  order("a", { jobs: [ejob(1, "delivered")], costs: [ecost("job-1", 3_000)], splits: [esplit("s1")] }), // fee $45, cost $30, net $15, split $100
  order("b", { eventDate: "2026-11-21", jobs: [ejob(1, "cancelled"), ejob(2, "delivered")], costs: [ecost("job-2", 3_100)], candidates: [quote({ gratuityCents: 0 })] }), // partial "at least $31"
  order("c", { eventDate: "2026-11-22", isEzcater: true, candidates: [], jobs: [ejob(1, "delivered", { bookedVia: "provider_native", providerLabel: "Courier Z" })], costs: [ecost("job-1", 2_200)] }),
  order("d", { eventDate: "2026-11-23", candidates: [], jobs: [ejob(1, "delivered")] }), // no fee, no cost
];
const ok = (inputs: OrderEconomicsInput[] = PERIOD): DeliveryEconomicsResult => ({ kind: "ok", locationId: B, from: "2026-11-01", to: "2026-11-30", report: deliveryEconomics(inputs) });
const section = (result: DeliveryEconomicsResult, language: Lang = "en") => renderToStaticMarkup(createElement(DeliveryEconomicsSection, { result, language, idBase: "d" }));
const opened = (inputs: OrderEconomicsInput[], language: Lang = "en") => {
  openAll.on = true;
  try { return text(section(ok(inputs), language)); } finally { openAll.on = false; }
};

describe("the Delivery section: nothing when off, its own line when the read failed", () => {
  it.each(["switch", "shop", "not_installed", "forbidden"] as const)("off (%s) renders nothing at all", (reason) => {
    expect(section({ kind: "off", reason })).toBe("");
    expect(section({ kind: "off", reason }, "es")).toBe("");
  });
  it("a failed read: the section's own 'couldn't load', and not one number", () => {
    const en = section({ kind: "failed" });
    expect(text(en)).toContain("Delivery");
    expect(text(en)).toContain("Couldn't load the delivery numbers. Reload to try again. The other sections on this page are not affected.");
    expect(en).toContain('role="status"');
    expect(text(en)).not.toMatch(/\$|\d/);
    const es = text(section({ kind: "failed" }, "es"));
    expect(es).toContain("No se pudieron cargar los números de entrega.");
    expect(es).not.toMatch(/\$|\d/);
  });
});

describe("the Delivery section: coverage first, named gaps, never a zero for a missing side", () => {
  const en = text(section(ok()));
  it("the coverage line comes before any money", () => {
    expect(en).toContain("1 of 4 delivery orders have both a fee and a full cost.");
    expect(en.indexOf("1 of 4 delivery orders")).toBeGreaterThan(en.indexOf("Delivery"));
    expect(en.indexOf("1 of 4 delivery orders")).toBeLessThan(en.indexOf("$"));
  });
  it("the totals cover only the orders with both sides, and say so", () => {
    expect(en).toContain("Totals over those 1 orders only:");
    expect(en).toContain("Delivery fees charged $45.00");
    expect(en).toContain("Courier cost $30.00");
    expect(en).toContain("Net (fees minus courier cost) $15.00");
    // The partial order's $31 and the ezCater order's $22 are known costs of orders with no net: never in a total.
    expect(en).not.toContain("$61.00");
    expect(en).not.toContain("$83.00");
  });
  it("the orders left out are counted per reason, right after the totals", () => {
    expect(en).toContain("Left out of the totals, and why");
    for (const line of ["ezCater order, fee not known: 1", "No accepted quote, fee not known: 1", "Courier cost not recorded: 1", "Courier cost only partly recorded: 1"]) expect(en).toContain(line);
    expect(en).toContain("An order missing both the fee and the cost is counted under both.");
    expect(en.indexOf("Left out of the totals")).toBeGreaterThan(en.indexOf("Net (fees minus courier cost)"));
  });
  it("states which orders are in the period, and that nothing is added to sales, pipeline value or labor", () => {
    expect(en).toContain("Orders are counted by their event date, at this shop.");
    expect(en).toContain("Neither is added to sales, to pipeline value or to labor.");
  });
  it("the per-order list is collapsed by default (its header shows the count); the summary stays visible", () => {
    const markup = section(ok());
    expect(markup).toContain('aria-expanded="false"');
    expect(en).toContain("Orders 4 orders");
    expect(en).not.toContain("Cost at least");
    expect(markup).toContain("min-h-[44px]");
  });
  it("an empty period says so, with no totals and no zero", () => {
    const empty = text(section(ok([])));
    expect(empty).toContain("No delivery orders in this period.");
    expect(empty).not.toMatch(/\$|\d/);
  });
  it("orders with no net at all: the coverage line, the reasons, and NO totals block", () => {
    const none = text(section(ok([PERIOD[1]!, PERIOD[3]!])));
    expect(none).toContain("0 of 2 delivery orders have both a fee and a full cost.");
    expect(none).not.toContain("Totals over those");
    expect(none).not.toContain("Delivery fees charged");
    expect(none).not.toContain("$0.00");
  });
  it("Spanish", () => {
    const es = text(section(ok(), "es"));
    for (const line of ["Entrega", "1 de 4 pedidos con entrega tienen tarifa y costo completo.", "Tarifas de entrega cobradas $45.00", "Fuera de los totales, y por qué",
      "Pedido de ezCater, tarifa desconocida: 1", "Los pedidos se cuentan por su fecha de evento, en esta tienda."]) expect(es).toContain(line);
  });
});

describe("the per-order rows (the pure row, rendered): every missing side is named in its place", () => {
  const open = opened;
  it("a complete order: fee, cost, net", () => {
    const row = open([PERIOD[0]!]);
    expect(row).toContain("Fee $45.00");
    expect(row).toContain("Cost $30.00");
    expect(row).toContain("Net $15.00");
    expect(row).toContain("Courier A · Deliveries recorded: 1");
  });
  it("a partial order reads 'at least', with how many deliveries have no cost, and no net", () => {
    const row = open([PERIOD[1]!]);
    expect(row).toContain("Cost at least $31.00 · Deliveries with no cost recorded: 1");
    expect(row).toContain("No net");
    expect(row).not.toContain("Net $");
  });
  it("an ezCater order: fee 'not known', its courier named, no net", () => {
    const row = open([PERIOD[2]!]);
    expect(row).toContain("ezCater");
    expect(row).toContain("Fee not known (ezCater)");
    expect(row).toContain("Cost $22.00");
    expect(row).toContain("No net");
  });
  it("no accepted quote and no cost: both named; never $0.00", () => {
    const row = open([PERIOD[3]!]);
    expect(row).toContain("Fee not known (no accepted quote)");
    expect(row).toContain("Cost not recorded");
    expect(row).not.toContain("$0.00");
  });
  it("two accepted quotes, a lost order, a delivery order nobody recorded", () => {
    expect(open([order("x", { candidates: [quote(), quote({ id: "q2" })], jobs: [ejob(1, "delivered")] })])).toContain("Fee not known (two accepted quotes)");
    expect(open([order("x", { stage: "lost", jobs: [ejob(1, "cancelled")], costs: [ecost("job-1", 1_500)] })])).toContain("No fee counted (order lost or declined)");
    expect(open([order("x")])).toContain("No delivery recorded");
  });
  it("Spanish rows", () => {
    const row = open([PERIOD[1]!, PERIOD[2]!], "es");
    for (const line of ["Costo al menos $31.00 · Entregas sin costo registrado: 1", "Sin neto", "Tarifa desconocida (ezCater)"]) expect(row).toContain(line);
  });
});

describe("the gratuity block: recorded only", () => {
  it("totals over heads only, with the 'not verified' sentence word for word (en + es)", () => {
    const en = text(section(ok()));
    expect(en).toContain("Gratuity split (recorded)");
    expect(en).toContain("Orders with a recorded split: 1");
    expect(en).toContain("Gratuity split $100.00");
    expect(en).toContain("Driver's share $10.00");
    expect(en).toContain("Crew's share $90.00");
    expect(en).toContain("Delivered with no gratuity on the quote: 2"); // orders b and d; the ezCater order takes no split
    expect(en).toContain(UNVERIFIED_EN);
    const es = text(section(ok(), "es"));
    expect(es).toContain("Reparto de la propina (registrado)");
    expect(es).toContain("Parte del conductor $10.00");
    expect(es).toContain(UNVERIFIED_ES);
  });
  it("a mistaken delivery then a replacement: the $100 is shown once, credited to delivery 2", () => {
    const moved = order("m", { jobs: [ejob(1, "delivered"), ejob(2, "delivered")], costs: [ecost("job-1", 0), ecost("job-2", 3_000)],
      splits: [esplit("s1"), esplit("s2", { jobId: "job-2", supersedesId: "s1" })] });
    const en = opened([moved]);
    expect(en).toContain("Gratuity split $100.00");
    expect(en).not.toContain("$200.00");
    expect(en).toContain("$100.00: driver $10.00 (10%), crew $90.00");
    expect(en).toContain("delivery 2");
  });
  it("a void and a 0-cent head allocate nothing: the totals drop and each is counted by name", () => {
    const voided = order("v", { jobs: [ejob(1, "delivered")], splits: [esplit("s1"), esplit("s2", { kind: "void", jobId: null, gratuityCents: 0, driverCents: 0, crewCents: 0, supersedesId: "s1" })] });
    const zeroed = order("z", { jobs: [ejob(1, "delivered")], candidates: [quote({ gratuityCents: 0 })],
      splits: [esplit("s1"), esplit("s2", { gratuityCents: 0, driverCents: 0, crewCents: 0, supersedesId: "s1" })] });
    const en = text(section(ok([voided, zeroed])));
    expect(en).toContain("Orders with a recorded split: 0");
    expect(en).toContain("Removed (the delivery did not happen): 1");
    expect(en).toContain("Delivered with no gratuity on the quote: 1");
    expect(en).not.toContain("$100.00");
    expect(en).not.toContain("Driver's share");
  });
  it("a split that no longer matches the quote is flagged; an expected split is counted apart and never summed", () => {
    const stale = order("s", { jobs: [ejob(1, "delivered")], candidates: [quote({ gratuityCents: 8_000 })], splits: [esplit("s1")] });
    const expected = order("e", { stage: "confirmed", jobs: [ejob(1, "accepted")] });
    const en = text(section(ok([stale, expected])));
    expect(en).toContain("Recorded split no longer matches the quote: 1. Recalculate it on the order.");
    expect(en).toContain("Not delivered yet (an expected split, not counted): 1");
    expect(en).toContain("Gratuity split $100.00"); // the recorded head, not the expected $100 on top of it
  });
  it("no split anywhere (only ezCater couriers): the block is not shown", () => {
    expect(text(section(ok([PERIOD[2]!])))).not.toContain("Gratuity split");
  });
});

// ── The panel's money line ──────────────────────────────────────────────────
const SHOPS = [{ id: B, name: "Shop B" }];
/* eslint-disable react/no-children-prop -- both providers require children in their props type. */
const html = (node: ReactElement, language: Lang) => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language,
  children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null, children: node }) }));
/* eslint-enable react/no-children-prop */
const panel = (view: LeadDeliveryView | null, language: Lang = "en", stage: PipelineStage = "completed") =>
  text(html(createElement(DeliveryPanel, { leadId: LEAD, stage, eventDate: "2026-11-25", locations: SHOPS, startOpen: true, initial: view }), language));
const JOB = "00000000-0000-4000-8000-0000000000e1", JOB2 = "00000000-0000-4000-8000-0000000000e2";
const cost = (id: string, jobId: string, amountCents: number): DeliveryCostRow =>
  ({ id, jobId, component: "base", semantics: "snapshot", amountCents, moneyIdentity: `${jobId}:base`, source: "manual", providerRef: null, observedAt: "2026-11-22T15:00:00Z", correctsId: null, actorId: "u", note: null });
const split = (id: string, o: Partial<DeliveryGratuitySplit> = {}): DeliveryGratuitySplit =>
  ({ id, pipelineId: LEAD, jobId: JOB, quoteId: "q1", kind: "split", gratuityCents: 10_000, driverBps: 1000, driverCents: 1_000, crewCents: 9_000, recordedAt: "2026-11-25T17:00:00Z",
    recordedBy: "u", reason: null, supersedesId: null, ...o });
const delivered = (id = JOB, attemptNo = 1) => jobOf({ id, attemptNo, status: "delivered", closedAt: "2026-11-25T17:00:00Z", statusSeq: 3 });
type Money = { candidates?: QuoteCandidate[]; splits?: DeliveryGratuitySplit[]; bps?: number | null };
function withMoney(view: ReturnType<typeof viewOf>, m: Money = {}): ReturnType<typeof viewOf> {
  view.cost = { ...view.cost!, candidates: m.candidates ?? [quote()], splits: m.splits ?? [], splitHead: null, gratuityDriverBps: m.bps === undefined ? 1000 : m.bps };
  return view;
}

describe("panelMoney: the view-model of the money line", () => {
  it("null without `cost` (a status-only viewer, or a writer response with no money): nothing is computed", () => {
    expect(panelMoney(viewOf({ state: "delivered", write: false, jobs: [delivered()] }), "completed")).toBeNull();
    expect(panelMoney(viewOf({ state: "delivered", money: false, jobs: [delivered()] }), "completed")).toBeNull();
  });
  it("null on a lead that is not a delivery order (a pickup with nothing recorded)", () => {
    expect(panelMoney(withMoney(viewOf({ state: "none" }), { candidates: [quote({ isDelivery: false })] }), "confirmed")).toBeNull();
    expect(panelMoney(withMoney(viewOf({ state: "none" }), { candidates: [] }), "confirmed")).toBeNull();
  });
  it("fee, complete cost, net; the recorded head; 'Remove' offered while the head matches the quote", () => {
    const m = panelMoney(withMoney(viewOf({ state: "delivered", jobs: [delivered()], costs: [cost("c1", JOB, 3_000)] }), { splits: [split("s1")] }), "completed")!;
    expect([m.order.fee, m.order.cost, m.order.netCents, m.order.gaps]).toEqual([{ kind: "known", cents: 4_500 }, { kind: "complete", cents: 3_000 }, 1_500, []]);
    expect(m.order.gratuity).toMatchObject({ kind: "allocated", headId: "s1", jobId: JOB, attemptNo: 1, needsRecalc: false });
    expect([m.headId, m.offer]).toEqual(["s1", "void"]);
  });
  it("'Recalculate' when the computed allocation differs from the head: another amount, another job, another share, or no head yet", () => {
    const base = () => viewOf({ state: "delivered", jobs: [delivered()], costs: [] });
    expect(panelMoney(withMoney(base(), { splits: [split("s1")], candidates: [quote({ gratuityCents: 8_000 })] }), "completed")!.offer).toBe("recompute");
    expect(panelMoney(withMoney(base(), { splits: [split("s1")], candidates: [quote({ gratuityCents: 0 })] }), "completed")!.offer).toBe("recompute");
    expect(panelMoney(withMoney(base(), { splits: [split("s1")], bps: 2_000 }), "completed")!.offer).toBe("recompute");
    expect(panelMoney(withMoney(viewOf({ state: "delivered", jobs: [delivered(), delivered(JOB2, 2)] }), { splits: [split("s1")] }), "completed")!.offer).toBe("recompute");
    expect(panelMoney(withMoney(base()), "completed")).toMatchObject({ headId: null, offer: "recompute" });
  });
  it("no correction: before delivery, with no gratuity and no head, or after a void with nothing delivered", () => {
    const booked = panelMoney(withMoney(viewOf({ state: "booked", jobs: [jobOf()] })), "confirmed")!;
    expect([booked.offer, booked.order.gratuity.kind]).toEqual([null, "expected"]);
    expect(panelMoney(withMoney(viewOf({ state: "delivered", jobs: [delivered()] }), { candidates: [quote({ gratuityCents: 0 })] }), "completed")!.offer).toBeNull();
  });
  it("a lost order counts no fee; an ezCater order's fee is not known and it takes no split", () => {
    expect(panelMoney(withMoney(viewOf({ state: "none", jobs: [jobOf({ status: "cancelled", closedAt: "2026-11-25T17:00:00Z" })] })), "lost")!.order.fee).toEqual({ kind: "gap", reason: "order_rejected" });
    const ez = panelMoney(withMoney(viewOf({ state: "delivered", isEzcater: true, orderQuote: { kind: "none", isDelivery: null }, jobs: [{ ...delivered(), bookedVia: "provider_native" }] }), { candidates: [] }), "completed")!;
    expect([ez.order.fee, ez.order.gratuity, ez.offer]).toEqual([{ kind: "gap", reason: "ezcater_fee_unknown" }, { kind: "none" }, null]);
  });
});

describe("the panel's money line, as people see it", () => {
  it("is absent for a person who may not read money", () => {
    const en = panel(viewOf({ state: "delivered", write: false, jobs: [delivered()] }));
    for (const never of ["Fee and courier cost", "Delivery fee charged", "Gratuity split", "Net (fee"]) expect(en).not.toContain(never);
  });
  it("fee vs cost vs net, the recorded split with the job credited, the 'not verified' sentence, and 'Remove'", () => {
    const en = panel(withMoney(viewOf({ state: "delivered", jobs: [delivered()], costs: [cost("c1", JOB, 3_000)] }), { splits: [split("s1")] }));
    for (const line of ["Fee and courier cost", "Delivery fee charged: $45.00", "Courier cost: $30.00", "Net (fee minus courier cost): $15.00", "Neither figure is added to sales or to the order's value.",
      "Gratuity split", "Recorded: $100.00 gratuity. Driver $10.00 (10%), crew $90.00. Credited to delivery 1.", UNVERIFIED_EN, "Remove — this delivery didn't happen"]) expect(en).toContain(line);
    expect(en).not.toContain("Recalculate from the current quote");
    const es = panel(withMoney(viewOf({ state: "delivered", jobs: [delivered()], costs: [cost("c1", JOB, 3_000)] }), { splits: [split("s1")] }), "es");
    for (const line of ["Tarifa de entrega cobrada: $45.00", "Neto (tarifa menos costo del mensajero): $15.00", "Registrado: $100.00 de propina. Conductor $10.00 (10%), equipo $90.00. Acreditado a la entrega 1.",
      UNVERIFIED_ES, "Quitar — esta entrega no ocurrió"]) expect(es).toContain(line);
  });
  it("GOLDEN: a cancelled delivery with no cost + a replacement at $30 reads 'at least $30', no net", () => {
    const jobs = [jobOf({ status: "cancelled", closedAt: "2026-11-24T17:00:00Z" }), delivered(JOB2, 2)];
    const en = panel(withMoney(viewOf({ state: "delivered", jobs, costs: [cost("c2", JOB2, 3_000)] }), { splits: [split("s1", { jobId: JOB2 })] }));
    expect(en).toContain("Courier cost: at least $30.00. Deliveries with no cost recorded: 1.");
    expect(en).toContain("No net yet: it needs both the fee and the full courier cost.");
    expect(en).not.toContain("Net (fee minus courier cost)");
    expect(en).toContain("Credited to delivery 2.");
  });
  it("the quote was revised after delivery: flagged, and 'Recalculate from the current quote' is the one button", () => {
    const en = panel(withMoney(viewOf({ state: "delivered", jobs: [delivered()] }), { splits: [split("s1")], candidates: [quote({ gratuityCents: 0 })] }));
    expect(en).toContain("The quote, the delivered job or the driver's share changed after this was recorded.");
    expect(en).toContain("Recalculate from the current quote");
    expect(en).not.toContain("Remove — this delivery didn't happen");
    expect(panel(withMoney(viewOf({ state: "delivered", jobs: [delivered()] }), { splits: [split("s1")], candidates: [quote({ gratuityCents: 0 })] }), "es")).toContain("Recalcular con la cotización actual");
  });
  it("before delivery: the EXPECTED split, labelled expected, and no correction", () => {
    const en = panel(withMoney(viewOf({ state: "booked", jobs: [jobOf()] })), "en", "confirmed");
    expect(en).toContain("Expected: $100.00 gratuity would split driver $10.00 (10%), crew $90.00. It is recorded when the delivery is marked delivered.");
    expect(en).toContain("Courier cost: not recorded yet.");
    for (const never of ["Recalculate from the current quote", "Remove — this delivery didn't happen", "Recorded: $"]) expect(en).not.toContain(never);
    expect(panel(withMoney(viewOf({ state: "booked", jobs: [jobOf()] })), "es", "confirmed")).toContain("Esperado: $100.00 de propina se repartiría conductor $10.00 (10%), equipo $90.00.");
  });
  it("a void and a 0-cent head say what they are", () => {
    const voided = split("s2", { kind: "void", jobId: null, gratuityCents: 0, driverCents: 0, crewCents: 0, supersedesId: "s1" });
    expect(panel(withMoney(viewOf({ state: "none", jobs: [jobOf({ status: "cancelled", closedAt: "2026-11-25T17:00:00Z" })] }), { splits: [split("s1"), voided] })))
      .toContain("Removed: the delivery marked delivered did not happen. Nothing is split.");
    const zero = split("s2", { gratuityCents: 0, driverCents: 0, crewCents: 0, supersedesId: "s1" });
    const en = panel(withMoney(viewOf({ state: "delivered", jobs: [delivered()] }), { splits: [split("s1"), zero], candidates: [quote({ gratuityCents: 0 })] }));
    expect(en).toContain("Delivered. There is no gratuity on the quote, so nothing is split.");
    for (const never of ["Recalculate from the current quote", "Remove — this delivery didn't happen"]) expect(en).not.toContain(never);
  });
  it("the named gaps: two accepted quotes; no accepted quote; an ezCater order", () => {
    const two = panel(withMoney(viewOf({ state: "delivered", orderQuote: { kind: "ambiguous", isDelivery: true }, jobs: [delivered()] }), { candidates: [quote(), quote({ id: "q2" })] }));
    expect(two).toContain("Delivery fee charged: not known. Two quotes are accepted; settle which one stands.");
    expect(two).toContain("No split: two quotes are accepted. Settle which one stands first.");
    expect(panel(withMoney(viewOf({ state: "delivered", jobs: [delivered()] }), { candidates: [] }))).toContain("Delivery fee charged: not known. No quote is accepted.");
    const ez = panel(withMoney(viewOf({ state: "delivered", isEzcater: true, orderQuote: { kind: "none", isDelivery: null }, jobs: [{ ...delivered(), bookedVia: "provider_native" }] }), { candidates: [] }));
    expect(ez).toContain("Delivery fee charged: not known. ezCater sets its own fee and we do not store it.");
    expect(ez).toContain("No split on an ezCater order: the tip is ezCater's.");
    expect(ez).not.toContain("$0.00");
  });
});

describe("the panel's correction: what it posts", () => {
  const src = readFileSync("components/catering/pipeline/DeliveryPanel.tsx", "utf8");
  it("names the mode, the shop and the head the person saw, and the reason; asks Tier A first and once more on a step-up refusal", () => {
    const fn = src.slice(src.indexOf("const correctGratuity ="), src.indexOf("const money = panelMoney(view, stage);"));
    expect(fn).toContain("const body = { mode, expectedShopId: shopId, expectedHeadId: headId, reason: reason.trim() };");
    expect(fn.match(/requestStepUp\("A"\)/g)).toHaveLength(2);
    expect(fn.match(/post\(`\/api\/catering\/pipeline\/\$\{leadId\}\/delivery\/gratuity`, body\)/g)).toHaveLength(2);
    expect(fn).toContain("isStepUpRefusal(result.code)");
    expect(fn.indexOf('requestStepUp("A")')).toBeLessThan(fn.indexOf("post(`"));
  });
  it("a reason is required before the button works; the rules live in the view-model, not the component", () => {
    expect(src).toContain('disabled={busy || reason.trim() === ""} onClick={() => { setCorrecting(false); onCorrect(offer, reason); }}');
    expect(src).toContain("const money = panelMoney(view, stage);");
    for (const rule of ["splitGratuity(", "orderCost(", "orderQuoteOf(", "computedSplit(", "recomputeWouldWrite("]) expect([rule, src.includes(rule)]).toEqual([rule, false]);
  });
});

// ── The page ────────────────────────────────────────────────────────────────
describe("the report page: the delivery read cannot take the four sales blocks down", () => {
  const page = readFileSync("app/(authed)/reports/sales/catering/page.tsx", "utf8");
  it("starts its own bounded read beside the sales read, outside the sales try, and awaits it only when rendering its own section", () => {
    const started = page.indexOf("const deliveryRead = loadDeliveryEconomicsBounded(auth, { locationId: shopId }, range);");
    const tryAt = page.indexOf("    try {"), catchAt = page.indexOf("    } catch (error) {"), awaited = page.indexOf("await deliveryRead");
    expect(started).toBeGreaterThan(0);
    expect(started).toBeLessThan(tryAt);
    expect(awaited).toBeGreaterThan(catchAt);
    expect(page.match(/await deliveryRead/g)).toHaveLength(1);
    expect(page.slice(tryAt, catchAt)).not.toMatch(/deliver/i);
    // The bounded loader never rejects (tests/delivery-economics-loader.test.ts), so no await of it can throw here.
    expect(page).not.toContain("loadDeliveryEconomics(");
  });
  it("renders the section after the sales body, whatever the sales body is (the four blocks or their own 'unavailable')", () => {
    expect(page).toContain("{body}\n      <div className=\"mt-3 min-w-0\"><DeliveryEconomicsSection result={await deliveryRead} language={language} idBase={`delivery-economics-${shopId}`} /></div>");
    expect(page.match(/<section className=\{salesCard\}/g)).toHaveLength(4);
  });
  it("adds no delivery number to a sales figure, and the delivery files read no pipeline-value source", () => {
    const SOURCE = /sales_report_catering_values|catering_insights_v2|completed_value_cents|confirmed_value_cents|estimated_revenue_cents|estimatedRevenueCents|catering_pipeline_reconciliation/;
    for (const file of ["lib/delivery/economics.ts", "lib/delivery/economics-shared.ts", "components/reports-hub/DeliveryEconomicsSection.tsx", "lib/delivery/panel-shared.ts",
      "components/catering/pipeline/DeliveryPanel.tsx", "app/api/catering/pipeline/[id]/delivery/gratuity/route.ts"]) expect([file, SOURCE.test(readFileSync(file, "utf8"))]).toEqual([file, false]);
    // On the page, the delivery result is only ever handed to its own section.
    expect(page.match(/deliveryRead/g)).toHaveLength(2);
    for (const file of ["lib/delivery/economics.ts", "lib/delivery/economics-shared.ts", "components/reports-hub/DeliveryEconomicsSection.tsx"]) {
      expect([file, /toastTotal|toastCatering|pipeline\.c|subtotalCents|laborCents|netSalesCents/.test(readFileSync(file, "utf8"))]).toEqual([file, false]);
    }
  });
});
