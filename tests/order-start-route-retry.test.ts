// @vitest-environment jsdom
/**
 * Audit W22/B203, fix round 2 (review r2 P2, BC-036/BC-057) — a failed automatic re-route must not leave the
 * order form waiting forever. Route a pin, change the date, lose the connection during the re-route: the
 * failure clears the pending request, shows a retryable error with a Retry button, and Continue stays
 * disabled until a fresh result for the current inputs arrives. Nothing is sent anywhere: the server actions,
 * the map and the geocoder are all mocked.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const routeDeliveryAction = vi.fn();
vi.mock("@/app/order/start/actions", () => ({
  routeDeliveryAction: (...a: unknown[]) => routeDeliveryAction(...a),
  checkPickupDateAction: vi.fn(async () => ({ bookable: true })),
}));
vi.mock("next/dynamic", () => ({ default: () => () => jsx("div", { "data-testid": "map" }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => jsx("a", { href, ...rest, children }) }));

import { OrderStartClient } from "@/app/order/start/start-client";
import { TranslationProvider } from "@/lib/i18n/provider";

const routed = { status: "routed", locationId: "A", locationName: "Capitol Hill", distanceMeters: 100 };

function mount() {
  return render(jsx(TranslationProvider, {
    initialLanguage: "en",
    children: jsx(OrderStartClient, { locations: [{ id: "A", name: "Capitol Hill", code: "MEP" }], deliveryNodesExist: true, pickupNodes: [] }),
  }));
}
const input = (label: string) => screen.getByText(label).parentElement!.querySelector("input")!;
const continueBtn = () => screen.getByRole("button", { name: "Continue →" }) as HTMLButtonElement;

beforeEach(() => {
  routeDeliveryAction.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => [{ lat: "38.89", lon: "-77.0" }] })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function routedForm() {
  mount();
  fireEvent.change(input("Your name"), { target: { value: "Dana" } });
  fireEvent.change(input("Email"), { target: { value: "dana@example.com" } });
  fireEvent.change(input("Event date"), { target: { value: "2030-01-10" } });
  fireEvent.change(input("Delivery address"), { target: { value: "1 Main St" } });
  routeDeliveryAction.mockResolvedValueOnce(routed);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en["order.route.locate"] })); });
  await waitFor(() => expect(continueBtn().disabled).toBe(false));
}

it("a failed automatic re-route shows a retryable error instead of waiting forever; Retry recovers", async () => {
  await routedForm();
  // The connection drops during the automatic re-route after a date change.
  routeDeliveryAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  fireEvent.change(input("Event date"), { target: { value: "2030-01-11" } });
  const retry = await screen.findByRole("button", { name: en["order.route.retry"] }, { timeout: 2000 });
  expect(screen.getByText(en["order.route.failed"])).toBeTruthy();
  expect(screen.queryByText(en["order.route.rerouting"])).toBeNull();
  expect(continueBtn().disabled).toBe(true);
  // No silent retry loop while the error is showing.
  await new Promise((r) => setTimeout(r, 600));
  expect(routeDeliveryAction).toHaveBeenCalledTimes(2);
  // The connection is back: Retry routes the CURRENT inputs, and only then can the customer continue.
  routeDeliveryAction.mockResolvedValueOnce(routed);
  await act(async () => { fireEvent.click(retry); });
  await waitFor(() => expect(continueBtn().disabled).toBe(false));
  expect(routeDeliveryAction).toHaveBeenCalledTimes(3);
  expect(routeDeliveryAction.mock.calls[2]![0]).toMatchObject({ eventDate: "2030-01-11", headcount: 20 });
  expect(screen.queryByText(en["order.route.failed"])).toBeNull();
});

it("a failed route on Locate gets the same retryable error (not a silent dead end)", async () => {
  mount();
  fireEvent.change(input("Event date"), { target: { value: "2030-01-10" } });
  fireEvent.change(input("Delivery address"), { target: { value: "1 Main St" } });
  routeDeliveryAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en["order.route.locate"] })); });
  expect(await screen.findByRole("button", { name: en["order.route.retry"] })).toBeTruthy();
  expect(continueBtn().disabled).toBe(true);
});

it("a later input change after a failure routes again on its own (the failure is per request)", async () => {
  await routedForm();
  routeDeliveryAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  fireEvent.change(input("Event date"), { target: { value: "2030-01-11" } });
  await screen.findByRole("button", { name: en["order.route.retry"] }, { timeout: 2000 });
  routeDeliveryAction.mockResolvedValueOnce(routed);
  fireEvent.change(input("Guests"), { target: { value: "30" } });
  await waitFor(() => expect(continueBtn().disabled).toBe(false), { timeout: 2000 });
  expect(screen.queryByRole("button", { name: en["order.route.retry"] })).toBeNull();
});

it("the new copy exists in en and es", () => {
  for (const k of ["order.route.failed", "order.route.retry"] as const) {
    expect(typeof (en as Record<string, string>)[k]).toBe("string");
    expect(typeof (es as Record<string, string>)[k]).toBe("string");
  }
});
