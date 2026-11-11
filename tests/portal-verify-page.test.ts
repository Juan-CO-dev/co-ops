// @vitest-environment jsdom
// /order/verify — the four token outcomes (review P3-4): absent, EMPTY, valid, rejected — plus the es/72h copy.
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import OrderVerify from "@/app/order/verify/page";

const fetchMock = vi.fn();
beforeEach(() => { push.mockReset(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/order/verify"); });
const at = (url: string) => window.history.replaceState(null, "", url);
const mount = () => render(createElement(OrderVerify));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

it("absent token → the expired/recovery UI, no POST", async () => {
  at("/order/verify"); mount(); await flush();
  expect(screen.getByText("Link expired")).toBeTruthy();
  expect(screen.getByText("Request a new link →").closest("a")?.getAttribute("href")).toBe("/order/start");
  expect(fetchMock).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
});
it("EMPTY token= → the expired/recovery UI, no POST (never an endless spinner)", async () => {
  at("/order/verify?token="); mount(); await flush();
  expect(screen.getByText("Link expired")).toBeTruthy(); expect(screen.queryByText("Signing you in…")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("valid token → scrubbed from the URL, POSTed once, then the server's next path", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, next: "/order/build?draft=q1" }) });
  at("/order/verify?token=abc123"); mount();
  expect(screen.getByText("Signing you in…")).toBeTruthy();
  await flush();
  expect(window.location.search).toBe("");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/portal/magic-link/verify", expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "abc123" }) }));
  expect(push).toHaveBeenCalledWith("/order/build?draft=q1");
});
it("rejected token (constant-shape 400) → the expired/recovery UI", async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ ok: false }) });
  at("/order/verify?token=stale"); mount(); await flush();
  expect(screen.getByText("Link expired")).toBeTruthy(); expect(push).not.toHaveBeenCalled();
});
it("a Spanish 72 h continuation link renders Spanish copy with its lifetime on the expired state", async () => {
  fetchMock.mockRejectedValue(new Error("network"));
  at("/order/verify?token=stale&lang=es&ttl=72h"); mount(); await flush();
  expect(screen.getByText("Enlace caducado")).toBeTruthy();
  expect(screen.getByText(/caducan a las 72 horas/)).toBeTruthy();
  expect(document.querySelector("[lang='es']")).toBeTruthy();
});
