/**
 * Catering delivery D3, review round 5 — the card's chip and the lead's Delivery panel always agree. The pure half
 * (`lib/delivery/chip-shared.ts`) and the static renders; the click-through is tests/delivery-chip-sync-ui.test.ts.
 *
 *  - The panel publishes what its own GET answered; a published state wins over the server's map.
 *  - Nothing is derived on the client: the published row is the server's state reshaped by the SAME function the
 *    server's own row uses (`rowStateFor`), so the two paths give one row for one situation.
 *  - Status only: `{ state, at, status }`, whatever a manager's GET carried.
 *  - Round 6: EVERY completed load has an outcome that overrides the server map for that lead: a state; `unknown` when
 *    the load failed (a failed read is never read as a state); a tombstone (nothing rendered) for off / not installed /
 *    nothing to see. A new server map supersedes everything published before it, tombstones included.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeliveryStateChip, DeliveryStatesProvider } from "@/components/catering/pipeline/DeliveryStateChip";
import { adoptServer, chipStateOf, chipStore, publishedOutcomeOf, publishState, type PanelViewForChip } from "@/lib/delivery/chip-shared";
import { DELIVERY_UNKNOWN, deliveryRowStateOf, rowStateFor, type DeliveryDayLead, type DeliveryRowState } from "@/lib/delivery/day-shared";
import { deliveryStateOf } from "@/lib/delivery/status-shared";
import { DELIVERY_STATES, DELIVERY_STATUSES, type DeliveryStatus } from "@/lib/delivery/types-shared";
import { TranslationProvider } from "@/lib/i18n/provider";
import { A, B, jobOf, viewOf } from "./helpers/delivery-views";
import { readFileSync } from "node:fs";

const row = (state: DeliveryRowState["state"], over: Partial<DeliveryRowState> = {}): DeliveryRowState => ({ state, at: null, status: null, ...over });

describe("the store: published over server; a new server map supersedes", () => {
  const SERVER = { "lead-1": row("to_book"), "lead-2": row("cancel_needed", { status: "accepted" }) };

  it("with nothing published the chip shows the server's state; a lead in neither shows nothing", () => {
    const s = chipStore(SERVER);
    expect(chipStateOf(s, "lead-1")).toEqual(row("to_book"));
    expect(chipStateOf(s, "nobody")).toBeUndefined();
    expect(chipStateOf(chipStore(null), "lead-1")).toBeUndefined();
  });

  it("record → the published 'booked' wins for that lead only", () => {
    const booked = row("booked", { at: "2026-11-25T15:40:00.000Z", status: "accepted" });
    const s = publishState(chipStore(SERVER), "lead-1", booked);
    expect(chipStateOf(s, "lead-1")).toEqual(booked);
    expect(chipStateOf(s, "lead-2")).toEqual(SERVER["lead-2"]);
  });

  it("a cancellation recorded on a rejected order → the lead no longer reads cancel_needed", () => {
    const s = publishState(chipStore(SERVER), "lead-2", row("none"));
    expect(chipStateOf(s, "lead-2")!.state).toBe("none");
  });

  it("publishing the same row again returns the SAME store (a reload that found the same re-renders nothing)", () => {
    const s = publishState(chipStore(SERVER), "lead-1", row("booked", { status: "accepted" }));
    expect(publishState(s, "lead-1", row("booked", { status: "accepted" }))).toBe(s);
    expect(publishState(s, "lead-1", row("on_the_way", { status: "picked_up" }))).not.toBe(s);
  });

  it("a NEW server map (a real reload, a router.refresh) drops what was published before it; the same map changes nothing", () => {
    const s = publishState(chipStore(SERVER), "lead-1", row("booked", { status: "accepted" }));
    expect(adoptServer(s, SERVER)).toBe(s);
    const fresh = { "lead-1": row("delivered", { status: "delivered" }) };
    const next = adoptServer(s, fresh);
    expect(chipStateOf(next, "lead-1")).toEqual(fresh["lead-1"]);
    expect(next.published).toEqual({});
    // Off after a refresh (the map became null): nothing published survives either.
    expect(chipStateOf(adoptServer(s, null), "lead-1")).toBeUndefined();
  });
});

describe("round 6: unknown and suppressed OVERRIDE the server map (tombstones, never deleted entries)", () => {
  const SERVER = { "lead-1": row("to_book"), "lead-2": row("booked", { status: "accepted" }) };

  it("a courier was recorded and the reload FAILED: the chip reads unknown, not the server's stale 'to book'", () => {
    const s = publishState(chipStore(SERVER), "lead-1", publishedOutcomeOf({ failed: true }));
    expect(chipStateOf(s, "lead-1")).toEqual(DELIVERY_UNKNOWN);
    expect(chipStateOf(s, "lead-2")).toEqual(SERVER["lead-2"]);
  });

  it("the shop was turned off and the GET answers off: the chip shows NOTHING — the stale server value does not show through", () => {
    for (const view of [{ view: "off" }, { view: "not_installed" }, { view: "history" }, null] as PanelViewForChip[]) {
      const s = publishState(chipStore(SERVER), "lead-2", publishedOutcomeOf({ loaded: view }));
      expect(chipStateOf(s, "lead-2")).toBeUndefined();
      // It is an ENTRY (a tombstone), not an absence.
      expect(Object.prototype.hasOwnProperty.call(s.published, "lead-2")).toBe(true);
      expect(s.published["lead-2"]).toBeNull();
    }
  });

  it("a later successful load replaces a tombstone or an unknown with the real state", () => {
    let s = publishState(chipStore(SERVER), "lead-1", null);
    s = publishState(s, "lead-1", row("booked", { status: "accepted" }));
    expect(chipStateOf(s, "lead-1")!.state).toBe("booked");
    s = publishState(s, "lead-1", DELIVERY_UNKNOWN);
    expect(chipStateOf(s, "lead-1")!.state).toBe("unknown");
    s = publishState(s, "lead-1", row("delivered", { status: "delivered" }));
    expect(chipStateOf(s, "lead-1")!.state).toBe("delivered");
  });

  it("publishing the same tombstone or the same unknown again returns the SAME store; a first tombstone on a lead the server never listed is still an entry", () => {
    const tomb = publishState(chipStore(SERVER), "lead-1", null);
    expect(publishState(tomb, "lead-1", null)).toBe(tomb);
    const unknown = publishState(chipStore(SERVER), "lead-1", DELIVERY_UNKNOWN);
    expect(publishState(unknown, "lead-1", { ...DELIVERY_UNKNOWN })).toBe(unknown);
    expect(publishState(tomb, "lead-1", DELIVERY_UNKNOWN)).not.toBe(tomb);
    const fresh = publishState(chipStore(SERVER), "never-listed", null);
    expect(fresh).not.toBe(chipStore(SERVER));
    expect(chipStateOf(fresh, "never-listed")).toBeUndefined();
  });

  it("a fresh server map supersedes a tombstone and an unknown", () => {
    let s = publishState(chipStore(SERVER), "lead-1", null);
    s = publishState(s, "lead-2", DELIVERY_UNKNOWN);
    const next = adoptServer(s, { "lead-1": row("booked", { status: "accepted" }), "lead-2": row("delivered", { status: "delivered" }) });
    expect(chipStateOf(next, "lead-1")!.state).toBe("booked");
    expect(chipStateOf(next, "lead-2")!.state).toBe("delivered");
    expect(next.published).toEqual({});
  });
});

describe("what the panel publishes from its GET", () => {
  it("round 6: an authoritative 'nothing to show here' (off, not installed, no access / nothing to see, history-only) is SUPPRESSED, not skipped", () => {
    for (const view of [null, undefined, { view: "off" }, { view: "not_installed" }, { view: "history" }] as PanelViewForChip[]) expect(publishedOutcomeOf({ loaded: view })).toBeNull();
  });

  it("round 7: a lead view of a shop that is OFF (`enabled: false`) is suppressed whatever its state; only `enabled: true` publishes a state", () => {
    for (const state of DELIVERY_STATES) {
      expect(publishedOutcomeOf({ loaded: viewOf({ state, enabled: false, jobs: [jobOf()] }) }), state).toBeNull();
      expect(publishedOutcomeOf({ loaded: viewOf({ state, enabled: true, jobs: [jobOf()] }) })!.state).toBe(state);
    }
    // An answer that does not SAY the shop is on publishes no state either.
    expect(publishedOutcomeOf({ loaded: { view: "lead", state: "to_book", status: null } as unknown as PanelViewForChip })).toBeNull();
  });

  it("round 6: a FAILED load publishes `unknown` — never nothing, never a state", () => {
    expect(publishedOutcomeOf({ failed: true })).toEqual(DELIVERY_UNKNOWN);
  });

  it("STATUS ONLY: a manager's full view (jobs, events, reference, costs, the courier) publishes exactly { state, at, status }", () => {
    const view = viewOf({ state: "booked", write: true, money: true, jobs: [jobOf({ externalRef: "SENTINEL-REF", providerLabel: "Sentinel Courier" })],
      costs: [{ id: "c", jobId: "j", component: "base", semantics: "snapshot", amountCents: 987654321, moneyIdentity: "m", source: "manual", providerRef: null, observedAt: "x", correctsId: null,
        actorId: null, note: "sentinel note" }] });
    const published = publishedOutcomeOf({ loaded: view })!;
    expect(Object.keys(published).sort()).toEqual(["at", "state", "status"]);
    expect(published).toEqual({ state: "booked", at: "2026-11-25T15:40:00.000Z", status: "accepted" });
    for (const s of ["SENTINEL-REF", "Sentinel Courier", "987654321", "sentinel note"]) expect(JSON.stringify(published)).not.toContain(s);
  });

  it("a state about no job carries no instant and no status, even though the GET's `status` names the latest job", () => {
    // After a cancellation the GET says to_book and still describes the cancelled job.
    const cancelled = jobOf({ status: "cancelled", closedAt: "2026-11-22T16:00:00.000Z" });
    expect(publishedOutcomeOf({ loaded: viewOf({ state: "to_book", jobs: [cancelled] }) })).toEqual({ state: "to_book", at: null, status: null });
    expect(publishedOutcomeOf({ loaded: viewOf({ state: "none", jobs: [cancelled] }) })).toEqual({ state: "none", at: null, status: null });
    expect(publishedOutcomeOf({ loaded: viewOf({ state: "provider_managed", jobs: [] }) })).toEqual({ state: "provider_managed", at: null, status: null });
  });

  it("ONE row for one situation: the published row equals the server's own row, for every state the rule can produce", () => {
    // Build leads that reach each state; the server path is deliveryRowStateOf, the panel path is what the GET would carry
    // (state from deliveryStateOf; `status` = the job the state is about, else the latest job: lib/delivery/jobs.ts leadView).
    const j = (attemptNo: number, status: DeliveryStatus, over: Partial<DeliveryDayLead["jobs"][number]> = {}): DeliveryDayLead["jobs"][number] =>
      ({ attemptNo, status, open: !["delivered", "cancelled", "failed", "returned"].includes(status), pickupShopId: A, keptForCurrentShop: false, at: `at-${attemptNo}`, pickupAt: `pickup-${attemptNo}`, ...over });
    const lead = (over: Partial<DeliveryDayLead>): DeliveryDayLead => ({ leadId: "x", stage: "confirmed", currentShopId: A, orderQuote: { kind: "accepted", isDelivery: true }, isEzcater: false, jobs: [], ...over });
    const leads: DeliveryDayLead[] = [
      lead({}), lead({ jobs: [j(1, "accepted")] }), lead({ jobs: [j(1, "picked_up")] }), lead({ jobs: [j(1, "delivered")] }), lead({ jobs: [j(1, "failed")] }),
      lead({ jobs: [j(1, "delivered", { at: "later" }), j(2, "cancelled")] }), lead({ stage: "lost", jobs: [j(1, "accepted")] }), lead({ jobs: [j(1, "accepted", { pickupShopId: B })] }),
      lead({ isEzcater: true, orderQuote: { kind: "none", isDelivery: null } }), lead({ orderQuote: { kind: "accepted", isDelivery: false } }),
      lead({ stage: "lost", jobs: [j(1, "cancelled")] }), lead({ jobs: [j(1, "en_route_pickup", { pickupAt: null })] }),
    ];
    const seen = new Set<string>();
    for (const l of leads) for (const soon of [false, true]) {
      const server = deliveryRowStateOf(l, soon);
      const derived = deliveryStateOf({ ...l, soon });
      const about = l.jobs.find((x) => x.attemptNo === derived.attemptNo) ?? l.jobs.reduce<(typeof l.jobs)[number] | null>((b, x) => (!b || x.attemptNo > b.attemptNo ? x : b), null);
      const get: PanelViewForChip = { view: "lead", enabled: true, state: derived.state, status: about ? { status: about.status, statusAt: about.at, pickupAt: about.pickupAt } : null };
      expect(publishedOutcomeOf({ loaded: get }), JSON.stringify(l)).toEqual(server);
      seen.add(server.state);
    }
    expect([...seen].sort()).toEqual([...DELIVERY_STATES].sort());
  });

  it("rowStateFor derives no state: it returns the state it was given, for every state and status", () => {
    for (const state of DELIVERY_STATES) for (const status of DELIVERY_STATUSES) expect(rowStateFor(state, { status, at: "a", pickupAt: "p" }).state).toBe(state);
  });
});

describe("render: a published state wins over the server map; a fresh server map supersedes", () => {
  const chip = (server: Record<string, DeliveryRowState> | null, leadId = "lead-1"): string => {
    // eslint-disable-next-line react/no-children-prop
    const tree: ReactNode = createElement(DeliveryStatesProvider, { states: server, children: createElement(DeliveryStateChip, { leadId }) });
    // eslint-disable-next-line react/no-children-prop
    return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: tree }));
  };
  it("the server map alone renders as before (the store adds nothing until a panel publishes)", () => {
    expect(chip({ "lead-1": row("to_book") })).toContain('data-delivery-state="to_book"');
    expect(chip({ "lead-1": row("none") })).toBe("");
    expect(chip(null)).toBe("");
  });
});

describe("the wiring", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  it("the panel publishes the outcome of EVERY completed load of its GET — the answer, or the failure — and nothing for an aborted one", () => {
    const panel = src("components/catering/pipeline/DeliveryPanel.tsx");
    expect(panel).toContain(".then((view) => { setState({ leadId, view, failed: false }); publishToChip(leadId, { loaded: view }); })");
    expect(panel).toContain(".catch(() => { if (!signal?.aborted) { setState({ leadId, view: null, failed: true }); publishToChip(leadId, { failed: true }); } })");
    // ONLY the load publishes: the write runner calls it nowhere (a failed write with no load after it publishes nothing).
    expect(panel.match(/publishToChip\(/g)).toHaveLength(2);
    // Every write reloads (the `finally` of the one write runner), so every write republishes.
    expect(panel).toMatch(/finally \{\s*await load\(\);/);
  });
  it("no second state rule and no board refresh: the chip's files derive nothing and call no router", () => {
    for (const f of ["components/catering/pipeline/DeliveryStateChip.tsx", "lib/delivery/chip-shared.ts"]) {
      // Code only: the comments explain the rule by name.
      const code = src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/deliveryStateOf|orderQuoteOf|router\.refresh|useRouter|useEffect|fetch\(/);
    }
    // The provider adopts a new server map during render (prev-compare), never in an effect.
    expect(src("components/catering/pipeline/DeliveryStateChip.tsx")).toContain("const store = adoptServer(held, states);\n  if (store !== held) setHeld(store);");
  });
});
