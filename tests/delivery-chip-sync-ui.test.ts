// @vitest-environment jsdom
/**
 * Catering delivery D3, review round 5 — the click-through: the REAL `DeliveryPanel` and the REAL `DeliveryStateChip`
 * under one `DeliveryStatesProvider`, in a DOM, with only `fetch` and the router stubbed.
 *
 *  - Opening the panel: its GET says "booked" while the board's map still says "to book" (a courier was recorded since
 *    the board rendered) → the chip reads Booked.
 *  - A rejected order with a courier booked: tap "I cancelled it with the courier" → the write succeeds, the panel
 *    reloads, the chip no longer reads "Cancel the courier".
 *  - A courier booked at another shop: tap "<shop> still sends it" → the chip reads Booked.
 *  - A FAILED write: the panel reloads and finds the same state → the chip is unchanged.
 *  - Round 6: a courier is recorded, the write succeeds, the RELOAD FAILS → the chip reads "Couldn't load delivery",
 *    never the old "to book". The GET answers off / not installed / 404 → no chip (the stale one is gone). A later
 *    successful load shows the real state again. A failed WRITE whose reload finds the same state changes nothing.
 *  - A new server map (the board re-rendered by the server) supersedes what the panel published before it.
 *  - No board refresh for a tap: `router.refresh` is never called on a successful write.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { DeliveryPanel } from "@/components/catering/pipeline/DeliveryPanel";
import { DeliveryStateChip, DeliveryStatesProvider } from "@/components/catering/pipeline/DeliveryStateChip";
import type { DeliveryRowState } from "@/lib/delivery/day-shared";
import type { LeadDeliveryView } from "@/lib/delivery/jobs";
import en from "@/lib/i18n/en.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { A, B, LEAD, jobOf, viewOf } from "./helpers/delivery-views";

const EN = en as Record<string, string>;
const SHOPS = [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }];
const row = (state: DeliveryRowState["state"], over: Partial<DeliveryRowState> = {}): DeliveryRowState => ({ state, at: null, status: null, ...over });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** `gets` = what the panel's GET answers, in order (the last one repeats); `post` = what every write answers. */
function stubFetch(gets: Array<LeadDeliveryView | "fail">, post: () => Response = () => json({ ok: true })) {
  const calls: Array<{ method: string; url: string }> = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: String(url) });
    if (method !== "GET") return post();
    const answer = gets[Math.min(n, gets.length - 1)]!;
    n += 1;
    return answer === "fail" ? json({ code: "generic" }, 500) : json(answer);
  }));
  return calls;
}
function board(server: Record<string, DeliveryRowState> | null, stage: "confirmed" | "lost" = "confirmed"): ReactNode {
  return jsx(TranslationProvider, { initialLanguage: "en", children: jsx(StepUpProvider, { unlocked: false, unlockedAt: null, children:
    jsx(DeliveryStatesProvider, { states: server, children: [
      jsx(DeliveryStateChip, { leadId: LEAD }, "chip"), jsx(DeliveryStateChip, { leadId: "other-lead" }, "other"),
      jsx(DeliveryPanel, { leadId: LEAD, stage, eventDate: "2026-11-25", locations: SHOPS, startOpen: true }, "panel"),
    ] }) }) });
}
const chipState = (lead = 0) => screen.queryAllByTestId("delivery-state-chip")[lead]?.getAttribute("data-delivery-state") ?? null;
const chips = () => screen.queryAllByTestId("delivery-state-chip").map((c) => `${c.getAttribute("data-delivery-state")}: ${c.textContent}`);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockClear(); });

describe("the card's chip follows the panel", () => {
  it("opening the panel: its GET says booked while the board's map says to book → the chip reads Booked; another lead's chip is untouched", async () => {
    stubFetch([viewOf({ state: "booked", jobs: [jobOf({ locationId: B })] })]);
    render(board({ [LEAD]: row("to_book"), "other-lead": row("to_book") }));
    expect(chips()).toEqual([`to_book: ${EN["catering.delivery_state.to_book"]}`, `to_book: ${EN["catering.delivery_state.to_book"]}`]);
    await waitFor(() => expect(chipState()).toBe("booked"));
    expect(chips()[0]).toMatch(/^booked: Courier booked · pick-up /);
    expect(chips()[1]).toBe(`to_book: ${EN["catering.delivery_state.to_book"]}`);
  });

  it("a rejected order: 'I cancelled it with the courier' succeeds → the chip no longer reads Cancel the courier", async () => {
    const open = jobOf({ locationId: B });
    const calls = stubFetch([viewOf({ state: "cancel_needed", jobs: [open] }), viewOf({ state: "none", jobs: [jobOf({ locationId: B, status: "cancelled", closedAt: "2026-11-22T16:00:00.000Z" })] })]);
    render(board({ [LEAD]: row("cancel_needed", { status: "accepted" }) }, "lost"));
    const action = await screen.findByRole("button", { name: EN["catering.delivery.alert.cancel_needed.action"] });
    expect(chipState()).toBe("cancel_needed");
    fireEvent.click(action);
    await waitFor(() => expect(screen.queryAllByTestId("delivery-state-chip")).toHaveLength(0));
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual([`/api/catering/pipeline/${LEAD}/delivery/${open.id}/status`]);
    // The state came from the server's reload, and the board was not refreshed for the tap.
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a courier booked at another shop: '<shop> still sends it' succeeds → the chip reads Booked", async () => {
    const open = jobOf({ locationId: A });
    stubFetch([viewOf({ state: "pickup_mismatch", shopId: B, jobs: [open] }), viewOf({ state: "booked", shopId: B, jobs: [open] })]);
    render(board({ [LEAD]: row("pickup_mismatch", { status: "accepted" }) }));
    const keep = await screen.findByRole("button", { name: EN["catering.delivery.alert.pickup_mismatch.keep"]!.replace("{from}", "Shop A") });
    expect(chipState()).toBe("pickup_mismatch");
    fireEvent.click(keep);
    await waitFor(() => expect(chipState()).toBe("booked"));
  });

  it("a FAILED write: the panel reloads, finds the same state, and the chip is unchanged", async () => {
    const open = jobOf({ locationId: B });
    const calls = stubFetch([viewOf({ state: "cancel_needed", jobs: [open] })], () => json({ code: "status_moved" }, 409));
    render(board({ [LEAD]: row("cancel_needed", { status: "accepted" }) }, "lost"));
    fireEvent.click(await screen.findByRole("button", { name: EN["catering.delivery.alert.cancel_needed.action"] }));
    await waitFor(() => expect(calls.filter((c) => c.method === "GET")).toHaveLength(2));
    await screen.findByRole("button", { name: EN["catering.delivery.alert.cancel_needed.action"] });
    expect(chips()).toEqual([`cancel_needed: ${EN["catering.delivery_state.cancel_needed"]}`]);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("round 6: the write SUCCEEDS and the reload FAILS → the chip reads Couldn't load delivery, never the old state; Try again brings the real state back", async () => {
    // A rejected order whose courier is cancelled in one tap: the POST is accepted, the GET after it fails.
    const open = jobOf({ locationId: B });
    const cancelled = jobOf({ locationId: B, status: "cancelled", closedAt: "2026-11-22T16:00:00.000Z" });
    const calls = stubFetch([viewOf({ state: "cancel_needed", jobs: [open] }), "fail", viewOf({ state: "to_book", jobs: [cancelled] })]);
    render(board({ [LEAD]: row("cancel_needed", { status: "accepted" }), "other-lead": row("to_book") }));
    fireEvent.click(await screen.findByRole("button", { name: EN["catering.delivery.alert.cancel_needed.action"] }));
    await screen.findByText(EN["catering.delivery.unavailable"]!);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    // The card no longer tells anyone to cancel (or to book): it says it could not load. Another lead's chip is untouched.
    expect(chips()).toEqual([`unknown: ${EN["catering.delivery_state.unknown"]}`, `to_book: ${EN["catering.delivery_state.to_book"]}`]);
    fireEvent.click(screen.getByRole("button", { name: EN["catering.delivery.try_again"] }));
    await waitFor(() => expect(chipState()).toBe("to_book"));
  });

  it("round 6: the panel's FIRST load fails → the server's actionable chip is replaced by Couldn't load delivery", async () => {
    stubFetch(["fail"]);
    render(board({ [LEAD]: row("to_book") }));
    await screen.findByText(EN["catering.delivery.unavailable"]!);
    expect(chips()).toEqual([`unknown: ${EN["catering.delivery_state.unknown"]}`]);
  });

  it.each([
    ["off (the shop was turned off)", () => json({ view: "off" })],
    ["not installed", () => json({ view: "not_installed" })],
    ["404 (nothing this person may see)", () => json({ code: "lead_not_found" }, 404)],
    ["403 (a role no gate admits)", () => json({ code: "forbidden" }, 403)],
    ["the pickup shop's history-only view", () => json({ view: "history", leadId: LEAD, movedToShopId: B, jobs: [] })],
  ])("round 6: a visible chip, then the GET answers %s → no chip (the stale server value does not show through)", async (_n, answer) => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(String(url)); return answer(); }));
    render(board({ [LEAD]: row("to_book"), "other-lead": row("booked", { status: "accepted" }) }));
    expect(chips()).toHaveLength(2);
    await waitFor(() => expect(chips()).toEqual([`booked: ${EN["catering.delivery_state.booked"]}`]));
    expect(calls).toHaveLength(1);
  });

  it("round 6: a fresh server map supersedes a tombstone and an unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ view: "off" })));
    const view = render(board({ [LEAD]: row("to_book") }));
    await waitFor(() => expect(chips()).toEqual([]));
    view.rerender(board({ [LEAD]: row("booked", { status: "accepted" }) }));
    expect(chipState()).toBe("booked");
  });

  it("round 6: closing the panel mid-load (an ABORTED load) is not an outcome: the chip keeps what it showed", async () => {
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      release = resolve;
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const chipOnly = (server: Record<string, DeliveryRowState>, withPanel: boolean): ReactNode => jsx(TranslationProvider, { initialLanguage: "en", children: jsx(StepUpProvider, { unlocked: false, unlockedAt: null,
      children: jsx(DeliveryStatesProvider, { states: server, children: [jsx(DeliveryStateChip, { leadId: LEAD }, "chip"),
        ...(withPanel ? [jsx(DeliveryPanel, { leadId: LEAD, stage: "confirmed", eventDate: "2026-11-25", locations: SHOPS, startOpen: true }, "panel")] : [])] }) }) });
    const server = { [LEAD]: row("to_book") };
    const view = render(chipOnly(server, true));
    view.rerender(chipOnly(server, false)); // the lead detail closes: the panel unmounts and aborts its load
    release(json({ view: "off" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(chipState()).toBe("to_book");
  });

  it("a fresh server map (the board re-rendered by the server) supersedes what the panel published before it", async () => {
    stubFetch([viewOf({ state: "booked", jobs: [jobOf({ locationId: B })] })]);
    const first = { [LEAD]: row("to_book") };
    const view = render(board(first));
    await waitFor(() => expect(chipState()).toBe("booked"));
    // The same map again (an unrelated re-render) keeps the published state ...
    view.rerender(board(first));
    expect(chipState()).toBe("booked");
    // ... a NEW map from the server wins.
    view.rerender(board({ [LEAD]: row("delivered", { status: "delivered" }) }));
    expect(chipState()).toBe("delivered");
  });
});
