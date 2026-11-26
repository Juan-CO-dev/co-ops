/**
 * Catering delivery D3 — the chip inside the REAL pipeline page (`app/(authed)/catering/pipeline/page.tsx`), rendered
 * through the real `PipelineClient` and the real `loadPipelineDeliveryStates` → `loadDeliveryStates` on a recording
 * client. Only the session, the board's own loaders and the navigation hooks are stubbed.
 *
 *  - On: each card whose lead has a state carries ONE chip with that state; a pickup order and a lead at a shop the
 *    viewer may not read carry none.
 *  - Off (the switch): no chip, no failure line, and not one delivery query.
 *  - A failed read: no chip, never "to book"; the page says once that delivery could not load. A read that never
 *    settles does the same after its own bound — the board still renders.
 *  - The social media manager (level 6: the board opens for them): no chip and ZERO delivery queries.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const st = vi.hoisted(() => ({ role: "gm", locations: [] as string[], client: null as unknown, leads: [] as unknown[] }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); }, useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({
  user: { id: "u-viewer", name: "Vi Ewer", language: "en", active: true, role: st.role }, role: st.role, level: 0, locations: st.locations,
  session: { id: "s", stepUpUnlocked: false, stepUpUnlockedAt: null },
}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => st.client }));
vi.mock("@/lib/catering/pipeline", async (orig) => ({
  ...(await orig<typeof import("@/lib/catering/pipeline")>()),
  loadPipelineBoard: async () => st.leads, loadPipelineBoardView: async () => ({ leads: st.leads, filter: null }), loadFollowUps: async () => [], loadAssignableStaff: async () => [], searchPipeline: async () => [],
}));
vi.mock("@/lib/catering/not-in-toast", () => ({ loadNotInToast: async () => [] }));
vi.mock("@/lib/shop-context", () => ({ resolveShop: async (list: Array<{ id: string }>) => list[0] ?? null }));
vi.mock("@/components/nav/BackLink", () => ({ BackLink: () => null }));

import CateringPipelinePage from "@/app/(authed)/catering/pipeline/page";
import en from "@/lib/i18n/en.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { job, lead as leadRow, on, quote, SENTINELS, worldResponder, type World } from "./fixtures/delivery/day-world";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

const EN = en as Record<string, string>;
const boardLead = (id: string, over: Record<string, unknown> = {}) => ({
  id, customerId: null, contactName: `Contact ${id}`, company: null, eventDate: "2026-11-18", headcount: 10, contactPhone: null, deliveryAddress: null, timeWindow: null,
  eventType: null, dietaryNotes: null, eventName: null, dropoffDoor: null, stage: "confirmed", leadSource: "website", locationId: A, locationName: "Shop A", notes: null,
  followUpDate: null, estimatedRevenueCents: null, assignedTo: null, createdBy: null, createdAt: "2026-11-10T10:00:00.000Z", updatedAt: null, quoteStatus: "accepted", ...over });
const world = (over: Partial<World> = {}): World => ({
  settings: [on(A), on(B)],
  leads: [leadRow("l-book"), leadRow("l-booked"), leadRow("l-pickup"), leadRow("l-cancel", { stage: "lost" }), leadRow("l-other", { location_id: B })],
  jobs: [job("l-booked", 1, "accepted", { pickup_at: "2026-11-18T15:40:00.000Z" }), job("l-cancel", 1, "accepted"), job("l-other", 1, "accepted", { location_id: B })],
  decisions: [], ezcater: [],
  quotes: [quote("l-book", "accepted"), quote("l-booked", "accepted"), quote("l-pickup", "accepted", { is_delivery: false }), quote("l-cancel", "accepted"), quote("l-other", "accepted")],
  ...over });
const LEADS = [boardLead("l-book"), boardLead("l-booked"), boardLead("l-pickup"), boardLead("l-cancel", { stage: "lost" }), boardLead("l-other", { locationId: B, locationName: "Shop B" })];
const DELIVERY_TABLES = ["delivery_settings", "delivery_job_current", "delivery_pickup_decisions", "catering_quotes", "ezcater_orders", "catering_pipeline"];

async function page(w: World | "hang") {
  const locations = (c: FakeCall) => (c.table === "locations" ? { data: [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }] } : { data: [] });
  const f = fakeSupabase(w === "hang" ? locations : worldResponder(w, locations));
  if (w === "hang") {
    // The delivery relations never answer.
    const from = f.client.from.bind(f.client);
    (f.client as { from: (t: string) => unknown }).from = (table: string) => {
      const q = from(table) as Record<string, unknown>;
      if (DELIVERY_TABLES.includes(table)) q.then = () => undefined;
      return q;
    };
  }
  st.client = f.client;
  st.leads = LEADS;
  const tree = await CateringPipelinePage({ searchParams: Promise.resolve({}) });
  // eslint-disable-next-line react/no-children-prop
  const html = renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: tree as ReactNode }));
  const cards = Object.fromEntries([...html.matchAll(/<div id="lead-([\w-]+)" class="co-card p-3">([\s\S]*?)(?=<div id="lead-|$)/g)].map((m) => [m[1]!, m[2]!]));
  const chipOf = (id: string) => cards[id]?.match(/data-testid="delivery-state-chip" data-delivery-state="(\w+)"[^>]*>([^<]*)</)?.slice(1, 3) ?? null;
  return { html, cards, chipOf, delivery: f.calls.filter((c) => DELIVERY_TABLES.includes(c.table)) };
}
const as = (role: string, locations: string[]) => { st.role = role; st.locations = locations; };

beforeEach(() => { vi.stubEnv("DELIVERY_TRACKING", "1"); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("the pipeline page renders the delivery chip on its cards", () => {
  it("a GM of shop A: one chip per lead with a state, from the one rule; none on a pickup order or on another shop's lead", async () => {
    as("gm", [A]);
    const p = await page(world());
    expect(Object.keys(p.cards).sort()).toEqual(["l-book", "l-booked", "l-cancel", "l-other", "l-pickup"]);
    expect(p.chipOf("l-book")).toEqual(["to_book", EN["catering.delivery_state.to_book"]]);
    expect(p.chipOf("l-booked")).toEqual(["booked", "Courier booked · pick-up 10:40 AM"]);
    expect(p.chipOf("l-cancel")).toEqual(["cancel_needed", EN["catering.delivery_state.cancel_needed"]]);
    expect(p.chipOf("l-pickup")).toBeNull();
    // Scope follows the lead: shop B's lead is not this GM's to read.
    expect(p.chipOf("l-other")).toBeNull();
    expect(p.html.match(/data-testid="delivery-state-chip"/g)).toHaveLength(3);
    expect(p.html).not.toContain('data-delivery-states="failed"');
    // Status only: nothing of the courier, the reference, the note or the money reaches the page.
    for (const s of SENTINELS.slice(3)) expect(p.html).not.toContain(String(s));
  });

  it("the MoO: every shop's leads, shop B's included", async () => {
    as("moo", []);
    const p = await page(world());
    expect(p.chipOf("l-other")).toEqual(["booked", EN["catering.delivery_state.booked"]]);
    expect(p.html.match(/data-testid="delivery-state-chip"/g)).toHaveLength(4);
  });

  it("off (the switch unset): the board renders, no chip, no failure line, and not one delivery query", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    as("gm", [A]);
    const p = await page(world());
    expect(Object.keys(p.cards)).toHaveLength(5);
    expect(p.html).not.toContain("delivery-state-chip");
    expect(p.html).not.toContain("data-delivery-states");
    expect(p.delivery).toEqual([]);
  });

  it("a shop that is off: no chip for its leads, no failure line", async () => {
    as("gm", [A]);
    const p = await page(world({ settings: [] }));
    expect(p.html).not.toContain("delivery-state-chip");
    expect(p.html).not.toContain("data-delivery-states");
  });

  it("a failed delivery read: the board renders, no chip (never 'to book'), and the page says once that delivery could not load", async () => {
    as("gm", [A]);
    const p = await page(world({ fail: { table: "delivery_job_current", error: { code: "08006", message: "down" } } }));
    expect(Object.keys(p.cards)).toHaveLength(5);
    expect(p.html).not.toContain("delivery-state-chip");
    expect(p.html.match(/data-delivery-states="failed"/g)).toHaveLength(1);
    expect(p.html).toContain(EN["catering.delivery_state.unknown"]!.replace("'", "&#x27;"));
    expect(p.html).not.toContain(EN["catering.delivery_state.to_book"]);
  });

  it("a delivery read that NEVER SETTLES: bounded on its own — the board still renders, with the failure line", async () => {
    as("gm", [A]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = page("hang");
    // Two delivery reads sit on this page and BOTH hang here: D2's moved-deliveries list, then D3's chip states. Each is
    // bounded on its own (3 s), one after the other.
    await vi.advanceTimersByTimeAsync(3_001);
    await vi.advanceTimersByTimeAsync(3_001);
    const p = await pending;
    expect(Object.keys(p.cards)).toHaveLength(5);
    expect(p.html).not.toContain("delivery-state-chip");
    expect(p.html).toContain('data-delivery-states="failed"');
    // D2's list says its own "couldn't load" (it never silently disappears), and the board is still there.
    expect(p.html).toContain('role="alert"');
  });

  it("the social media manager (the board opens at level 6): no chip, no failure line, ZERO delivery queries", async () => {
    as("social_media_mgr", [A]);
    const p = await page(world());
    expect(Object.keys(p.cards)).toHaveLength(5);
    expect(p.html).not.toContain("delivery-state-chip");
    expect(p.html).not.toContain("data-delivery-states");
    expect(p.delivery).toEqual([]);
  });
});
