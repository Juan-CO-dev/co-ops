/**
 * tests/receiving-routes-same-origin.test.ts — LRA-237.
 *
 * The two ORIGINAL receiving routes (`/api/operations/receiving` and `…/continue`) never called
 * `assertSameOrigin`, while every newer money/order mutation route (order-guide, scan/*) does —
 * the asymmetry class the house bug-catalog names (BC: law obeyed in one file, missed in a sibling).
 *
 * What this file pins: the belt is on, and it is FIRST. A cross-site POST is refused with 403
 * before the session is even looked up (asserted as "requireSession not called", not merely a
 * status), and a same-origin POST reaches the session exactly as before. The REAL
 * `assertSameOrigin` runs here — a stubbed guard would test the stub, not the door.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as receivePOST } from "@/app/api/operations/receiving/route";
import { POST as continuePOST } from "@/app/api/operations/receiving/continue/route";
import { requireSession } from "@/lib/session";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/receiving", async () => {
  const actual = await vi.importActual<typeof import("@/lib/receiving")>("@/lib/receiving");
  return {
    ...actual,
    recordDelivery: vi.fn(),
    addDeliveryLines: vi.fn(),
    completeDelivery: vi.fn(),
  };
});

const HOST = "https://example.com";
const body = { vendorId: "v", locationId: "l", deliveryDate: "2026-09-19", deliveryId: "d", lines: [] };

const post = (path: string, headers: Record<string, string>) =>
  new NextRequest(`${HOST}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const ROUTES = [
  { name: "receiving", path: "/api/operations/receiving", handler: receivePOST },
  { name: "receiving/continue", path: "/api/operations/receiving/continue", handler: continuePOST },
];

beforeEach(() => {
  vi.clearAllMocks();
  // The session gate answers 401 so a same-origin request stops right after the guard we are testing.
  vi.mocked(requireSession).mockResolvedValue(new Response(null, { status: 401 }) as never);
});

describe("LRA-237 — the receiving door wears the same-origin belt, first", () => {
  it.each(ROUTES)("$name refuses a cross-site POST before the session is consulted", async ({ path, handler }) => {
    const res = await handler(post(path, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
    expect(requireSession).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("$name refuses a POST with no Origin at all", async ({ path, handler }) => {
    const res = await handler(post(path, {}));
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("$name lets a same-origin POST through to the session gate", async ({ path, handler }) => {
    const res = await handler(post(path, { origin: HOST, "sec-fetch-site": "same-origin" }));
    expect(requireSession).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401); // the mocked session's answer — the guard did not intervene
  });
});
