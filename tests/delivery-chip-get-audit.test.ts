// @vitest-environment jsdom
/**
 * Catering delivery D3, review round 7 — THE AUDIT: every distinct answer the delivery GET can give, mapped to what the
 * card's chip does. One table, run through the REAL `DeliveryPanel` and the REAL `DeliveryStateChip` (only `fetch` and
 * the router are stubbed), twice each: on a card that HAD a chip (the board's map said "to book") and on one that had
 * none (the board's map omitted the lead).
 *
 * THE RULE
 *   - Whatever makes the panel render nothing for an AUTHORITATIVE reason SUPPRESSES the chip: the switch off, 0356 not
 *     installed, the lead's shop turned off (`view: "lead", enabled: false`), the pickup shop's history-only view, 403
 *     (a role no gate admits), 404 (nothing this person may see). A chip that was there disappears; one that was not
 *     stays absent.
 *   - A FAILURE TO KNOW is `unknown` ("Couldn't load delivery"): a network error, 401 (the session ended), a redirect,
 *     409 `delivery_busy` again after its one retry, any 5xx, a body that is not JSON. Never the old state.
 *   - A lead view of a shop that is ON publishes ITS state — `none` included ("on, but nothing to say or do": the
 *     panel hides and no chip is drawn, because that is the lead's real state).
 *   - Only an ABORTED request publishes nothing (the last case).
 *
 * WHERE THE ANSWERS COME FROM (read on the merged tree): `GET app/api/catering/pipeline/[id]/delivery/route.ts` →
 * `requireSession` (401) · the switch (`{ view: "off" }`) · `parseDeliveryId` (404) · `loadLeadDelivery`
 * (lib/delivery/jobs.ts: `off` / `not_installed` / `lead` with `enabled` / `history` / null → 404; throws 403
 * `forbidden`, 409 `delivery_busy`, 500 `generic`) → `deliveryRefusal`. The panel's reader (`fetchDeliveryView`)
 * retries one 409, reads 403 / 404 as "nothing here", and throws on anything else that is not ok.
 * 503 `delivery_off` / `delivery_unavailable` are the WRITE routes' answers; this GET answers the views instead. They
 * are in the table anyway: should a GET ever answer them, the panel shows "unavailable", so the chip says it could not load.
 *
 * And the other half: the board's own map (`loadDeliveryStates`) already omits a shop that is off, and answers "off"
 * (no map at all) for the switch and for a database without 0356.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no default client in this test"); }) }));

import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { DeliveryPanel } from "@/components/catering/pipeline/DeliveryPanel";
import { DeliveryStateChip, DeliveryStatesProvider } from "@/components/catering/pipeline/DeliveryStateChip";
import { loadDeliveryStates } from "@/lib/delivery/day";
import type { DeliveryRowState } from "@/lib/delivery/day-shared";
import en from "@/lib/i18n/en.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { A as SHOP_A, B as SHOP_B, job as jobRow, lead as leadRow, on, quote, worldResponder, type World } from "./fixtures/delivery/day-world";
import { A, B, LEAD, jobOf, viewOf } from "./helpers/delivery-views";
import { fakeSupabase } from "./helpers/fake-supabase";

const EN = en as Record<string, string>;
const SHOPS = [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }];
const row = (state: DeliveryRowState["state"], over: Partial<DeliveryRowState> = {}): DeliveryRowState => ({ state, at: null, status: null, ...over });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const TO_BOOK = `to_book: ${EN["catering.delivery_state.to_book"]}`;
const UNKNOWN = `unknown: ${EN["catering.delivery_state.unknown"]}`;
const BOOKED = `booked: ${EN["catering.delivery_state.booked"]}`;

type Outcome = { chip: string | null };
interface Case {
  /** What the GET answers, call by call (the last repeats). A thrown value is a network failure. */
  answers: Array<() => Response | Promise<Response>>;
  /** How many GETs the panel makes before it settles. */
  gets: number;
  /** The chip afterwards — the same whether the card had a chip before or not. */
  chip: string | null;
  why: "state" | "suppress" | "unknown";
}
const pickupOnly = { kind: "accepted" as const, isDelivery: false };
const CASES: Record<string, Case> = {
  // ── 200: a lead view of a shop that is ON → its state ──
  "200 lead, enabled, to_book": { answers: [() => json(viewOf({ state: "to_book" }))], gets: 1, chip: TO_BOOK, why: "state" },
  "200 lead, enabled, booked": { answers: [() => json(viewOf({ state: "booked", jobs: [jobOf({ pickupAt: null })] }))], gets: 1, chip: BOOKED, why: "state" },
  "200 lead, enabled, cancel_needed": { answers: [() => json(viewOf({ state: "cancel_needed", jobs: [jobOf()] }))], gets: 1, chip: `cancel_needed: ${EN["catering.delivery_state.cancel_needed"]}`, why: "state" },
  "200 lead, enabled, a status-only viewer (no detail, no cost)": { answers: [() => json(viewOf({ state: "booked", write: false, jobs: [jobOf({ pickupAt: null })] }))], gets: 1, chip: BOOKED, why: "state" },
  "200 lead, enabled, on but NOTHING to say or do (a pickup order: state none, the panel hides)": {
    answers: [() => json(viewOf({ state: "none", orderQuote: pickupOnly }))], gets: 1, chip: null, why: "state" },
  "200 lead, enabled, state none with a closed job (a rejected order, nothing open)": {
    answers: [() => json(viewOf({ state: "none", jobs: [jobOf({ status: "cancelled", closedAt: "2026-11-22T16:00:00.000Z" })] }))], gets: 1, chip: null, why: "state" },
  // ── 200: authoritative "nothing here" → suppress ──
  "200 { view: off } (the switch)": { answers: [() => json({ view: "off" })], gets: 1, chip: null, why: "suppress" },
  "200 { view: not_installed } (0356 not on the database)": { answers: [() => json({ view: "not_installed" })], gets: 1, chip: null, why: "suppress" },
  "200 lead, enabled FALSE, to_book (the lead's shop was turned off)": { answers: [() => json(viewOf({ state: "to_book", enabled: false }))], gets: 1, chip: null, why: "suppress" },
  "200 lead, enabled FALSE, booked": { answers: [() => json(viewOf({ state: "booked", enabled: false, jobs: [jobOf()] }))], gets: 1, chip: null, why: "suppress" },
  "200 lead, enabled FALSE, cancel_needed": { answers: [() => json(viewOf({ state: "cancel_needed", enabled: false, jobs: [jobOf()] }))], gets: 1, chip: null, why: "suppress" },
  "200 { view: history } (the pickup shop's manager after the order moved)": { answers: [() => json({ view: "history", leadId: LEAD, movedToShopId: B, jobs: [] })], gets: 1, chip: null, why: "suppress" },
  "403 forbidden (a role no gate admits)": { answers: [() => json({ code: "forbidden" }, 403)], gets: 1, chip: null, why: "suppress" },
  "404 lead_not_found (nothing this person may see, or no such lead)": { answers: [() => json({ code: "lead_not_found" }, 404)], gets: 1, chip: null, why: "suppress" },
  // ── a failure to know → unknown ──
  "401 (the session ended)": { answers: [() => json({ code: "unauthorized" }, 401)], gets: 1, chip: UNKNOWN, why: "unknown" },
  "409 delivery_busy, twice (still busy after its one retry)": { answers: [() => json({ code: "delivery_busy" }, 409)], gets: 2, chip: UNKNOWN, why: "unknown" },
  "500 generic": { answers: [() => json({ code: "generic" }, 500)], gets: 1, chip: UNKNOWN, why: "unknown" },
  "502 (a gateway error, no JSON body)": { answers: [() => new Response("bad gateway", { status: 502 })], gets: 1, chip: UNKNOWN, why: "unknown" },
  "503 delivery_off (a write route's answer; never this GET's)": { answers: [() => json({ code: "delivery_off" }, 503)], gets: 1, chip: UNKNOWN, why: "unknown" },
  "503 delivery_unavailable (likewise)": { answers: [() => json({ code: "delivery_unavailable" }, 503)], gets: 1, chip: UNKNOWN, why: "unknown" },
  "a network error (fetch rejects; a redirect is one too, the reader asks for redirect: error)": { answers: [() => Promise.reject(new TypeError("Failed to fetch"))], gets: 1, chip: UNKNOWN, why: "unknown" },
  "200 with a body that is not JSON": { answers: [() => new Response("<html>", { status: 200 })], gets: 1, chip: UNKNOWN, why: "unknown" },
  // ── the retry ──
  "409 delivery_busy once, then a lead view": { answers: [() => json({ code: "delivery_busy" }, 409), () => json(viewOf({ state: "booked", jobs: [jobOf({ pickupAt: null })] }))], gets: 2, chip: BOOKED, why: "state" },
  "409 delivery_busy once, then off": { answers: [() => json({ code: "delivery_busy" }, 409), () => json({ view: "off" })], gets: 2, chip: null, why: "suppress" },
};

function board(server: Record<string, DeliveryRowState>, withPanel = true): ReactNode {
  return jsx(TranslationProvider, { initialLanguage: "en", children: jsx(StepUpProvider, { unlocked: false, unlockedAt: null, children:
    jsx(DeliveryStatesProvider, { states: server, children: [
      jsx(DeliveryStateChip, { leadId: LEAD }, "chip"), jsx(DeliveryStateChip, { leadId: "other-lead" }, "other"),
      ...(withPanel ? [jsx(DeliveryPanel, { leadId: LEAD, stage: "confirmed", eventDate: "2026-11-25", locations: SHOPS, startOpen: true }, "panel")] : []),
    ] }) }) });
}
const chips = () => screen.queryAllByTestId("delivery-state-chip").map((c) => `${c.getAttribute("data-delivery-state")}: ${c.textContent}`);
const OTHER = `booked: ${EN["catering.delivery_state.booked"]}`;
/** Mount the board with this server map, let the panel's load complete, and read the chips. */
async function settle(c: Case, server: Record<string, DeliveryRowState>): Promise<Outcome> {
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async () => { const a = c.answers[Math.min(n, c.answers.length - 1)]!; n += 1; return a(); }));
  render(board({ ...server, "other-lead": row("booked", { status: "accepted" }) }));
  await waitFor(() => expect(n).toBe(c.gets));
  // Let the load's own continuation and the publish land.
  const want = [...(c.chip ? [c.chip] : []), OTHER];
  await waitFor(() => expect(chips()).toEqual(want));
  await new Promise((r) => setTimeout(r, 10));
  const now = chips();
  expect(n).toBe(c.gets);
  // Another lead's chip is never touched.
  expect(now.at(-1)).toBe(OTHER);
  return { chip: now.length === 2 ? now[0]! : null };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("every answer of the delivery GET → what the card's chip does", () => {
  it("the table covers all three outcomes of a completed load", () => {
    expect(new Set(Object.values(CASES).map((c) => c.why))).toEqual(new Set(["state", "suppress", "unknown"]));
    for (const [name, c] of Object.entries(CASES)) {
      if (c.why === "suppress") expect([name, c.chip]).toEqual([name, null]);
      if (c.why === "unknown") expect([name, c.chip]).toEqual([name, UNKNOWN]);
    }
  });

  it.each(Object.entries(CASES))("%s — a card that HAD a chip (the board said to book)", async (_name, c) => {
    expect(await settle(c, { [LEAD]: row("to_book") })).toEqual({ chip: c.chip });
  });

  it.each(Object.entries(CASES))("%s — a card that had NO chip (the board's map omitted the lead)", async (_name, c) => {
    // A suppression never introduces a chip; a state and an unknown appear (the panel knows more than the map did).
    expect(await settle(c, {})).toEqual({ chip: c.chip });
  });

  it("only an ABORTED request publishes nothing: the panel closes mid-load and the chip keeps what it showed", async () => {
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      release = resolve;
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const server = { [LEAD]: row("to_book") };
    const view = render(board(server));
    view.rerender(board(server, false));
    release(json(viewOf({ state: "to_book", enabled: false })));
    await new Promise((r) => setTimeout(r, 30));
    expect(chips()).toEqual([TO_BOOK]);
  });
});

describe("the other half: the board's own map already omits what is off", () => {
  const world = (over: Partial<World> = {}): World => ({
    settings: [on(SHOP_A), on(SHOP_B, false)], decisions: [], ezcater: [],
    leads: [leadRow("at-a"), leadRow("at-b", { location_id: SHOP_B })], jobs: [jobRow("at-b", 1, "accepted", { location_id: SHOP_B })],
    quotes: [quote("at-a", "accepted"), quote("at-b", "accepted")], ...over });
  const states = async (w: World) => {
    const f = fakeSupabase(worldResponder(w));
    return loadDeliveryStates(f.client as never, { role: "moo", active: true, locations: [] }, ["at-a", "at-b"]);
  };

  it("a lead at a DISABLED shop is not in the map (no chip), beside a lead at a shop that is on", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "1");
    expect(await states(world())).toEqual({ ok: true, states: { "at-a": row("to_book") } });
  });
  it("every shop disabled, 0356 not installed, or the switch off: no map at all", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "1");
    expect(await states(world({ settings: [on(SHOP_A, false), on(SHOP_B, false)] }))).toEqual({ off: true });
    expect(await states(world({ settings: [] }))).toEqual({ off: true });
    expect(await states(world({ fail: { table: "delivery_settings", error: { code: "42P01", message: "missing" } } }))).toEqual({ off: true });
    expect(await states(world({ fail: { table: "catering_pipeline", error: { code: "PGRST205", message: "missing" } } }))).toEqual({ off: true });
    vi.stubEnv("DELIVERY_TRACKING", "");
    expect(await states(world())).toEqual({ off: true });
  });
});
