// @vitest-environment jsdom
// W24/B212: a navigating tap during the ad-code lookup switches tracking off (the page may be leaving).
// When the page proves it stayed, the next user input re-runs enable; a withdrawal in between never does.
import { createElement, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lookups: [] as ((ad: string) => void)[],
  transport: undefined as undefined | Record<string, ReturnType<typeof vi.fn>>,
  choose: undefined as undefined | ((choice: "accepted" | "rejected") => void),
}));
vi.mock("@/lib/landing/tracking-client", async (original) => {
  const actual = await original<typeof import("@/lib/landing/tracking-client")>();
  return {
    ...actual,
    lookupAdCode: () => new Promise<string>((resolve) => { h.lookups.push(resolve); }),
    browserTransport: () => {
      let n = 0;
      h.transport = { loadPixel: vi.fn(), revokePixel: vi.fn(), grantPixel: vi.fn(), pixel: vi.fn(), post: vi.fn(), uuid: vi.fn(() => `id-${++n}`), now: vi.fn(() => 1_000) };
      return h.transport as unknown as ReturnType<typeof actual.browserTransport>;
    },
  };
});
vi.mock("@/components/landing/ConsentNotice", () => ({
  ConsentNotice: (props: { onChoose: (c: "accepted" | "rejected") => void }) => { h.choose = props.onChoose; return null; },
}));

import { TrackingProvider, useLandingTracking } from "@/components/landing/TrackingProvider";

let dispatch: ReturnType<typeof useLandingTracking>["dispatch"] = () => {};
function Probe() { const t = useLandingTracking(); useEffect(() => { dispatch = t.dispatch; }); return null; }
const labels = { notice: "", accept: "", reject: "", settings: "", withdraw: "", privacy: "", language: "en" as const };
function mount() {
  return render(createElement(TrackingProvider, {
    serverApproved: true, pixelId: "123", capiEnabled: true, sourceUrl: "https://eat.example/privacy", // off "/" the provider renders the notice itself
    attributionPolicy: { ads: ["unattributed"] }, allowedStores: ["capitol-hill"], allowedPlacements: ["hero"], labels,
    children: createElement(Probe),
  }));
}
const pageViews = () => h.transport!.pixel.mock.calls.filter((c) => c[1] === "PageView").length;
async function resolveLookup(index: number, ad = "unattributed") { await act(async () => { h.lookups[index]!(ad); await Promise.resolve(); }); }
function orderTap() { act(() => dispatch("OrderClick", { mode: "pickup", store: "capitol-hill", placement: "hero" })); }

beforeEach(() => {
  h.lookups = []; h.transport = undefined; h.choose = undefined;
  document.cookie = "landing_consent=accepted; Path=/";
  window.history.replaceState(null, "", "/?ad=campaign-new");
});
afterEach(() => { cleanup(); document.cookie = "landing_consent=; Path=/; Max-Age=0"; });

describe("TrackingProvider revival after a navigating tap during the lookup (W24/B212)", () => {
  it("the page that stayed turns tracking back on at the next user input", async () => {
    mount();
    expect(h.lookups).toHaveLength(1);
    orderTap();
    expect(h.transport!.post).toHaveBeenCalledWith("/api/landing/order-click", expect.anything(), { unload: true });
    await resolveLookup(0);
    expect(h.transport!.loadPixel).not.toHaveBeenCalled(); // the departing-page guard still holds
    act(() => { window.dispatchEvent(new Event("pointerdown")); });
    expect(h.lookups).toHaveLength(2);
    await resolveLookup(1);
    expect(h.transport!.loadPixel).toHaveBeenCalledOnce();
    expect(pageViews()).toBe(1);
    // Fires once: a second input does not start another lookup.
    act(() => { window.dispatchEvent(new Event("keydown")); });
    expect(h.lookups).toHaveLength(2);
  });

  it("a hidden visibilitychange is not proof of life; visible is", async () => {
    mount(); orderTap(); await resolveLookup(0);
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(h.lookups).toHaveLength(1);
    state.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(h.lookups).toHaveLength(2);
    state.mockRestore();
  });

  it("a withdrawal while the revival is armed never re-enables tracking", async () => {
    mount(); orderTap();
    act(() => { h.choose!("rejected"); });
    await resolveLookup(0);
    for (const type of ["pointerdown", "keydown", "wheel", "pageshow"]) act(() => { window.dispatchEvent(new Event(type)); });
    expect(h.lookups).toHaveLength(1);
    expect(h.transport!.loadPixel).not.toHaveBeenCalled();
    expect(pageViews()).toBe(0);
  });

  it("a consent cookie withdrawn in another tab is honoured at revival", async () => {
    mount(); orderTap(); await resolveLookup(0);
    document.cookie = "landing_consent=rejected; Path=/";
    act(() => { window.dispatchEvent(new Event("pointerdown")); });
    expect(h.lookups).toHaveLength(1);
    expect(h.transport!.loadPixel).not.toHaveBeenCalled();
  });

  it("unmount removes the armed listeners", async () => {
    const view = mount(); orderTap(); await resolveLookup(0);
    view.unmount();
    act(() => { window.dispatchEvent(new Event("pointerdown")); });
    expect(h.lookups).toHaveLength(1);
  });
});
