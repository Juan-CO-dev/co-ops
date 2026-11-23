/**
 * Catering delivery D2 — the screens as people see them, en + es (static render, like the Toast link panel's test):
 * the Delivery panel in the lead detail, the pickup shop's "orders that moved" list, and the settings card.
 *
 *  - The panel renders NOTHING unless delivery is on for the lead's shop.
 *  - A writer gets the record form, the status taps, the cost list with Correct / Add cost / No charge and the history;
 *    a reader gets the status line and no control; money appears only when the response carries it.
 *  - `cancel_needed` and `pickup_mismatch` are named alerts with their one action, visible while the body is collapsed.
 *  - An ezCater order records the courier ezCater sent, and says CO-OPS does not book it.
 *  - The moved list shows the job only. The settings card carries the "recorded only / not verified" sentence.
 * Plus the pins of where each is mounted and what every POST names.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { DeliverySettings } from "@/components/admin/catering/DeliverySettings";
import { DeliveryMovedList } from "@/components/catering/pipeline/DeliveryMovedList";
import { DeliveryPanel } from "@/components/catering/pipeline/DeliveryPanel";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { PipelineStage } from "@/lib/catering/pipeline-shared";
import type { LeadDeliveryView, MovedDeliveryRow } from "@/lib/delivery/jobs";
import type { DeliveryCostRow } from "@/lib/delivery/types-shared";
import { A, B, LEAD, eventOf, jobOf, viewOf } from "./helpers/delivery-views";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

type Lang = "en" | "es";
const SHOPS = [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }];
/* eslint-disable react/no-children-prop -- both providers require children in their props type. */
const html = (node: ReactElement, language: Lang) => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language,
  children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null, children: node }) }));
/* eslint-enable react/no-children-prop */
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const panel = (view: LeadDeliveryView | null, language: Lang = "en", stage: PipelineStage = "confirmed", startOpen = true) =>
  html(createElement(DeliveryPanel, { leadId: LEAD, stage, eventDate: "2026-11-25", locations: SHOPS, startOpen, initial: view }), language);
const count = (s: string, word: string) => s.split(word).length - 1;
const cost = (id: string, jobId: string, amountCents: number, component: DeliveryCostRow["component"] = "base"): DeliveryCostRow =>
  ({ id, jobId, component, semantics: "snapshot", amountCents, moneyIdentity: `${jobId}:${component}`, source: "manual", providerRef: null, observedAt: "2026-11-22T15:00:00Z", correctsId: null, actorId: "u", note: null });

describe("the panel renders nothing unless delivery is on for the lead's shop", () => {
  it.each([
    ["the switch is off", { view: "off" } as LeadDeliveryView],
    ["0356 is not installed", { view: "not_installed" } as LeadDeliveryView],
    ["nothing this viewer may see (404 / 403)", null],
    ["the shop is off", viewOf({ enabled: false, state: "booked", jobs: [jobOf()] })],
    ["a history answer (the moved list's, never the lead detail's)", { view: "history", leadId: LEAD, movedToShopId: B, jobs: [] } as LeadDeliveryView],
    ["an order that is not confirmed yet", viewOf({ state: "none" })],
  ])("%s", (name, view) => {
    expect(panel(view, "en", name.includes("not confirmed") ? "inquiry" : "confirmed")).toBe("");
  });
  it("before the first answer arrives it renders nothing either (no flash)", () => {
    expect(html(createElement(DeliveryPanel, { leadId: LEAD, stage: "confirmed", eventDate: null, locations: SHOPS }), "en")).toBe("");
  });
});

describe("a house delivery order, for a person who may write", () => {
  it("nothing booked: the state, the record form's way in, and the wrong-tap note", () => {
    const en = text(panel(viewOf({ state: "to_book" })));
    expect(en).toContain("Delivery");
    expect(en).toContain("Courier not booked");
    expect(en).toContain("Record a delivery");
    expect(en).toContain("A wrong tap is not undone. If one happens, record a new delivery.");
    expect(en).not.toContain("View only");
    const es = text(panel(viewOf({ state: "to_book" }), "es"));
    expect(es).toContain("Falta reservar mensajero");
    expect(es).toContain("Registrar una entrega");
    expect(es).toContain("Un toque equivocado no se deshace.");
  });

  it("a booked job: summary (courier, pickup time in ET), the taps, the cost list, the history", () => {
    const job = jobOf();
    const view = viewOf({ state: "booked", jobs: [job], costs: [cost("c1", job.id, 3175)], events: [eventOf(job, { note: "driver will call" })] });
    const en = text(panel(view));
    expect(en).toContain("Courier booked");
    expect(en).toContain("Courier A · pickup 10:40 AM"); // 15:40Z is 10:40 in ET
    expect(en).toContain("Delivery 1 · Courier A");
    expect(en).toContain("Confirmation: REF-77");
    expect(en).toContain("Pickup Wed, Nov 25 10:40 AM · Drop-off Wed, Nov 25 11:30 AM");
    for (const tap of ["Picked up", "Delivered", "Cancelled", "Failed"]) expect(en).toContain(tap);
    expect(en).toContain("Courier cost");
    expect(en).toContain("Total $31.75");
    expect(en).toContain("Delivery charge: $31.75");
    expect(count(en, "Correct")).toBe(1);
    expect(en).toContain("Add cost"); // other figures (wait time, a credit...) can still be added
    expect(en).not.toContain("No charge"); // a cost exists: "No charge" is for a job with none
    expect(en).toContain("History");
    expect(en).toContain("Note: driver will call");
    expect(en).not.toContain("Record a delivery"); // one open delivery per order
    const es = text(panel(view, "es"));
    expect(es).toContain("Mensajero reservado");
    expect(es).toContain("Courier A · recogida 10:40");
    for (const tap of ["Recogido", "Entregado", "Cancelado", "Falló"]) expect(es).toContain(tap);
    expect(es).toContain("Costo del mensajero");
    expect(es).toContain("Corregir");
    expect(es).toContain("Historial");
  });

  it("a job with no cost row: UNKNOWN is said (never $0), with Add cost and No charge", () => {
    const en = text(panel(viewOf({ state: "booked", jobs: [jobOf()] })));
    expect(en).toContain("No cost recorded yet.");
    expect(en).toContain("Add cost");
    expect(en).toContain("No charge");
    expect(en).not.toContain("$0");
    expect(en).not.toContain("Correct");
    const es = text(panel(viewOf({ state: "booked", jobs: [jobOf()] }), "es"));
    expect(es).toContain("Aún no hay costo registrado.");
    expect(es).toContain("Sin cargo");
  });

  it("a closed job offers no taps; a new delivery can be recorded; costs can still be entered (the bill arrives later)", () => {
    const done = jobOf({ status: "cancelled", closedAt: "2026-11-22T16:00:00Z", statusAt: "2026-11-22T16:00:00Z" });
    const en = text(panel(viewOf({ state: "to_book", jobs: [done] })));
    expect(en).not.toContain("Record what happened");
    expect(en).toContain("Record a delivery");
    expect(en).toContain("No charge");
  });

  it("the body is collapsed by default (hidden), behind a full-row toggle", () => {
    const closed = panel(viewOf({ state: "booked", jobs: [jobOf()] }), "en", "confirmed", false);
    expect(closed).toMatch(/aria-expanded="false"/);
    expect(closed).toMatch(/<div id="[^"]+" hidden=""/);
    expect(panel(viewOf({ state: "booked", jobs: [jobOf()] }))).toMatch(/aria-expanded="true"/);
  });
});

describe("the named alerts, with their one action, are never collapsed", () => {
  it("cancel_needed: the courier is named, CO-OPS says it cannot cancel, and the one action records the cancellation", () => {
    const view = viewOf({ state: "cancel_needed", jobs: [jobOf()] });
    const closed = panel(view, "en", "lost", false);
    const alert = text(closed.slice(closed.indexOf('role="alert"'), closed.indexOf("<div id=")));
    expect(alert).toContain("This order was rejected and a courier is still booked. Cancel this delivery with Courier A. CO-OPS can't cancel it for you.");
    expect(alert).toContain("I cancelled it with the courier");
    const es = text(panel(view, "es", "lost"));
    expect(es).toContain("Cancela esta entrega con Courier A. CO-OPS no puede cancelarla por ti.");
    expect(es).toContain("Ya la cancelé con el mensajero");
    expect(text(panel(view, "en", "lost"))).not.toContain("Record a delivery"); // nothing new on a rejected order
  });
  it("pickup_mismatch: both shops are named and the one action is 'the old shop still sends it'", () => {
    const view = viewOf({ state: "pickup_mismatch", shopId: B, jobs: [jobOf({ locationId: A })] });
    const closed = panel(view, "en", "confirmed", false);
    const alert = text(closed.slice(closed.indexOf('role="alert"'), closed.indexOf("<div id=")));
    expect(alert).toContain("Booked for pickup at Shop A. The order moved to Shop B.");
    expect(alert).toContain("Shop A still sends it");
    expect(count(alert, "Shop A still sends it")).toBe(1);
    const es = text(panel(view, "es"));
    expect(es).toContain("Reservado para recoger en Shop A. El pedido se movió a Shop B.");
    expect(es).toContain("Shop A todavía lo envía");
  });
  it("a reader sees the alert and no action", () => {
    const en = text(panel(viewOf({ state: "cancel_needed", write: false, jobs: [jobOf()] }), "en", "lost"));
    expect(en).toContain("Cancel this delivery with Courier A.");
    expect(en).not.toContain("I cancelled it with the courier");
  });
});

describe("an ezCater order: CO-OPS never books it, it records the courier ezCater sent", () => {
  const ez = (jobs = [] as ReturnType<typeof jobOf>[]) => viewOf({ state: jobs.length ? "booked" : "provider_managed", isEzcater: true, orderQuote: { kind: "none", isDelivery: null }, jobs });
  it("the way in is titled 'Record the courier's delivery'", () => {
    const en = text(panel(ez()));
    expect(en).toContain("ezCater sends the courier");
    expect(en).toContain("Record the courier's delivery");
    expect(en).not.toContain("Record a delivery");
    expect(text(panel(ez(), "es"))).toContain("Registrar la entrega del mensajero");
  });
  it("a recorded one says who sent it", () => {
    expect(text(panel(ez([jobOf({ bookedVia: "provider_native" })])))).toContain("Sent by ezCater. Not booked by CO-OPS.");
    expect(text(panel(ez([jobOf({ bookedVia: "provider_native" })]), "es"))).toContain("Enviado por ezCater. No lo reservó CO-OPS.");
  });
  it("the form says CO-OPS does not book ezCater deliveries and posts provider_native", () => {
    const src = readFileSync("components/catering/pipeline/DeliveryPanel.tsx", "utf8");
    expect(src).toContain('t(k(native ? "record.ezcater_note" : "record.manual_note"))');
    expect(src).toContain("bookedVia: offer.mode");
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    expect(en["catering.delivery.record.ezcater_note"]).toContain("CO-OPS does not book ezCater deliveries.");
  });
});

describe("a reader (status only): the status line, no control, no money", () => {
  it("a key holder's or the prep manager's payload renders the status and nothing to tap", () => {
    const view = viewOf({ state: "booked", write: false, jobs: [jobOf()] });
    const en = text(panel(view));
    expect(en).toContain("View only. An AGM, a GM or the catering manager records deliveries.");
    expect(en).toContain("Courier A · Booked Sun, Nov 22 10:00 AM · Pickup Wed, Nov 25 10:40 AM · Drop-off Wed, Nov 25 11:30 AM");
    for (const never of ["Picked up", "Record a delivery", "Add cost", "No charge", "Courier cost", "Correct", "REF-77", "A wrong tap", "$"]) expect(en).not.toContain(never);
    expect(text(panel(view, "es"))).toContain("Solo lectura.");
  });
  it("money is shown only when the response carries it", () => {
    const job = jobOf();
    const without = text(panel(viewOf({ state: "booked", money: false, jobs: [job], costs: [cost("c1", job.id, 3175)] })));
    expect(without).toContain("Picked up"); // still a writer
    for (const never of ["Courier cost", "$31.75", "Add cost", "No charge"]) expect(without).not.toContain(never);
  });
});

describe("the pickup shop's list: deliveries booked here for orders that moved", () => {
  const row: MovedDeliveryRow = { leadId: LEAD, jobId: "00000000-0000-4000-8000-0000000000e1", attemptNo: 1, status: "cancelled", statusAt: "2026-11-22T16:00:00Z", providerLabel: "Courier A",
    pickupAt: "2026-11-25T15:40:00.000Z", dropoffAt: null, pickupShopId: A, pickupShopName: "Shop A", movedToShopId: B, movedToShopName: "Shop B" };
  const list = (rows: MovedDeliveryRow[], language: Lang = "en", startOpen = true, detail = false) => html(createElement(DeliveryMovedList, { rows, startOpen,
    initialDetail: detail ? { jobId: row.jobId, jobs: [{ jobId: row.jobId, attemptNo: 1, status: "cancelled", statusAt: row.statusAt, providerLabel: "Courier A", externalRef: "REF-77",
      pickupAt: row.pickupAt, dropoffAt: null, pickupShopId: A, events: [eventOf(jobOf(), { id: "e1" }), eventOf(jobOf(), { id: "e2", seq: 2, status: "cancelled", occurredAt: "2026-11-22T16:00:00Z" })] }] } : undefined }), language);

  it("hidden when there are none", () => {
    expect(list([])).toBe("");
  });
  it("default-collapsed, with the count on the header", () => {
    const closed = list([row], "en", false);
    expect(closed).toMatch(/aria-expanded="false"/);
    expect(text(closed)).toContain("Deliveries booked here for orders that moved 1");
    expect(text(list([row], "es", false))).toContain("Entregas reservadas aquí para pedidos que se movieron");
  });
  it("a row is the JOB only: courier, status, where the order went", () => {
    const en = text(list([row]));
    expect(en).toContain("Courier A · Cancelled");
    expect(en).toContain("Order moved to Shop B");
    expect(text(list([row], "es"))).toContain("El pedido se movió a Shop B");
  });
  it("opened: the history-only read — status, events, the confirmation number; no control", () => {
    const en = text(list([row], "en", true, true));
    expect(en).toContain("This courier was booked for pickup at Shop A. The order is now at Shop B, so you see this delivery only.");
    expect(en).toContain("Confirmation: REF-77");
    expect(en).toContain("Booked · Sun, Nov 22 10:00 AM");
    expect(en).toContain("Cancelled · Sun, Nov 22 11:00 AM");
    expect(list([row], "en", true, true)).not.toMatch(/<(input|select|textarea|form)\b/);
  });
  it("it never carries the moved order: the row type and the component name no customer, state, stage or money field", () => {
    const src = readFileSync("components/catering/pipeline/DeliveryMovedList.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const never of ["contactName", "company", "contactPhone", "deliveryAddress", "estimatedRevenue", "stage", "formatCents", "amountCents", "cost", "view.detail", "view.state", "orderQuote"]) expect(src).not.toContain(never);
    expect(src).toContain('view?.view === "history"'); // only the history-only answer is ever rendered
    const page = readFileSync("app/(authed)/catering/pipeline/page.tsx", "utf8");
    expect(page).toContain("movedDeliveries = await loadMovedDeliveries(auth);");
    expect(page).toContain("<DeliveryMovedList rows={movedDeliveries} />");
  });
});

describe("the settings card", () => {
  const shops = [
    { locationId: A, name: "Shop A", enabled: true, manualProviders: ["Courier A", "Courier B"], gratuityDriverBps: 1000, updatedAt: "2026-11-22T10:00:00.123456+00:00" },
    { locationId: B, name: "Shop B", enabled: false, manualProviders: [], gratuityDriverBps: 1250, updatedAt: null },
  ];
  const card = (language: Lang, open: string | null = A) => html(createElement(DeliverySettings, { shops, initialOpen: open }), language);

  it("identity and state are always visible: the shop, On / Off, the couriers and the driver's share", () => {
    const en = text(card("en", null));
    expect(en).toContain("Shop A On");
    expect(en).toContain("Couriers: 2 · Driver's share: 10%");
    expect(en).toContain("Shop B Off");
    expect(en).toContain("Couriers: 0 · Driver's share: 12.5%");
    expect(text(card("es", null))).toContain("Mensajeros: 2 · Parte del conductor: 10%");
  });
  it("the form: the switch, the shop's own courier list, the share — and the sentence beside it, word for word", () => {
    const en = text(card("en"));
    expect(en).toContain("Record deliveries at this shop");
    for (const courier of ["Courier A", "Courier B"]) expect(en).toContain(courier);
    expect(en).toContain("Add courier");
    expect(en).toContain("Driver's share of the gratuity (%)");
    expect(en).toContain("Recorded only. The payroll and legal treatment of the driver's share is not verified — the driver works for the courier, not for us. Confirm with payroll before paying anything from this figure.");
    expect(en).toContain("Saving asks for your password.");
    const es = text(card("es"));
    expect(es).toContain("Solo se registra. El tratamiento legal y de nómina de la parte del conductor no está verificado — el conductor trabaja para el mensajero, no para nosotros. Confirma con nómina antes de pagar algo con esta cifra.");
    expect(es).toContain("Registrar entregas en esta tienda");
  });
  it("the switch is a labelled 44 px control naming the setting and the shop", () => {
    expect(card("en")).toMatch(/role="switch" aria-checked="true"[^>]*aria-label="Record deliveries at this shop: Shop A"/);
  });
  it("Save asks Tier B and posts the WHOLE row with the updatedAt the person saw", () => {
    const src = readFileSync("components/admin/catering/DeliverySettings.tsx", "utf8");
    expect(src).toContain('if (await requestStepUp("B") !== "ok") return;');
    expect(src).toContain('locationId: shop.locationId, values: { enabled, manualProviders: couriers, gratuityDriverBps: bps }, expectedUpdatedAt: shop.updatedAt,');
    expect(src).toContain('if (r.code === "settings_moved") router.refresh();');
  });
});

describe("where it is mounted, and what every POST names", () => {
  const panelSrc = readFileSync("components/catering/pipeline/DeliveryPanel.tsx", "utf8");
  it("the panel is mounted in the lead detail for every lead; the page and the tile follow the switch", () => {
    expect(readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8"))
      .toContain("<DeliveryPanel leadId={lead.id} stage={lead.stage} eventDate={lead.eventDate} locations={locations} />");
    expect(readFileSync("app/admin/catering/page.tsx", "utf8")).toContain('{deliveryTrackingOn() && canManageDeliverySettings(auth.user.role) && <Link href="/admin/catering/delivery"');
    const page = readFileSync("app/admin/catering/delivery/page.tsx", "utf8");
    expect(page).toContain('if (!canManageDeliverySettings(auth.role)) redirect("/admin/catering");');
    expect(page).toContain('view.state === "off"');
    expect(page).toContain('view.state === "not_installed"');
  });
  it("every POST names the shop the person saw; a status names the status; a correction names the row", () => {
    expect(count(panelSrc, "expectedShopId: shopId")).toBe(5); // record, status, keep-pickup, a first cost, a correction
    expect(panelSrc).toContain("expectedStatus: job.status");
    expect(panelSrc).toContain("correctsId: head.id");
  });
  it("a correction asks Tier A, and once more when the server dropped the unlock; nothing else asks for a password", () => {
    expect(count(panelSrc, 'requestStepUp("A")')).toBe(2);
    expect(panelSrc).toContain("if (!result.ok && isStepUpRefusal(result.code)) {");
    expect(panelSrc).not.toMatch(/requestStepUp\("[BE]"\)/);
  });
  it("after ANY answer the panel reloads; a moved order also refreshes the board", () => {
    expect(panelSrc).toMatch(/finally \{\s*await load\(\);/);
    expect(panelSrc).toContain('if (result.code === "shop_moved") router.refresh();');
  });
  it("phone-first: no truncate / nowrap / horizontal scroll; every button class carries the 44 px floor with items-center", () => {
    for (const file of ["components/catering/pipeline/DeliveryPanel.tsx", "components/catering/pipeline/DeliveryMovedList.tsx", "components/admin/catering/DeliverySettings.tsx"]) {
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, file).not.toMatch(/\btruncate\b|whitespace-nowrap|overflow-x-auto|shrink-0/);
      for (const m of src.matchAll(/<button\b[^>]*className=\{?"([^"]+)"/g)) expect(m[1], file).toMatch(/min-h-\[44px\].*items-center|items-center.*min-h-\[44px\]/);
      expect(src, file).not.toMatch(/toLocale/);
    }
    expect(panelSrc).toMatch(/const BUTTON = "inline-flex min-h-\[44px\] items-center /);
  });
});
