/**
 * W23/B210 — the customer portal had no sign-out: a 30-day session could not be ended by the
 * customer. POST /api/portal/logout revokes the session row (only for a cookie that verifies AND
 * matches the stored hash), always clears the cookie and 303s to /order/start; a cross-site POST
 * is refused before anything is read.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signCustomerJwt, hashToken, PORTAL_COOKIE_NAME } from "@/lib/portal/auth";

const state = vi.hoisted(() => ({
  row: null as null | { id: string; token_hash: string }, revoked: [] as string[], reads: 0,
  lookupError: null as null | { message: string }, revokeThrows: false,
}));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({
    from: () => {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => { state.reads++; return { data: state.lookupError ? null : state.row, error: state.lookupError }; },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/portal/session", async (orig) => {
  const real = await orig<typeof import("@/lib/portal/session")>();
  return { ...real, revokeCustomerSession: vi.fn(async (id: string) => {
    if (state.revokeThrows) throw new Error("revokeCustomerSession: connection reset");
    state.revoked.push(id); return { rowsAffected: 1 };
  }) };
});

import { POST } from "@/app/api/portal/logout/route";

const ORIGIN = "https://catering.example.test";
const post = (cookie: string | null, origin: string | null = ORIGIN) => {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `${PORTAL_COOKIE_NAME}=${cookie}`;
  if (origin) headers.origin = origin;
  return POST(new NextRequest(`${ORIGIN}/api/portal/logout`, { method: "POST", headers }));
};
const claims = { customer_id: "cust-1", email: "c@example.test", session_id: "sess-1" };

beforeEach(() => { state.row = null; state.revoked = []; state.reads = 0; state.lookupError = null; state.revokeThrows = false; });

it("a valid session is revoked, the cookie cleared, and the browser sent to /order/start", async () => {
  const jwt = await signCustomerJwt(claims);
  state.row = { id: "sess-1", token_hash: await hashToken(jwt) };
  const res = await post(jwt);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`${ORIGIN}/order/start`);
  expect(state.revoked).toEqual(["sess-1"]);
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(`${PORTAL_COOKIE_NAME}=;`);
  expect(cookie).toMatch(/Max-Age=0/i);
});

it("a cookie whose hash does not match the stored row revokes nothing but is still cleared", async () => {
  const jwt = await signCustomerJwt(claims);
  state.row = { id: "sess-1", token_hash: "not-this-token" };
  const res = await post(jwt);
  expect(res.status).toBe(303);
  expect(state.revoked).toEqual([]);
  expect(res.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/i);
});

it("no cookie or a garbage cookie gets the same answer", async () => {
  for (const c of [null, "garbage"]) {
    const res = await post(c);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/order/start`);
  }
  expect(state.revoked).toEqual([]);
});

it("a cross-origin POST is refused with 403 before any read or revoke", async () => {
  const jwt = await signCustomerJwt(claims);
  state.row = { id: "sess-1", token_hash: await hashToken(jwt) };
  const res = await post(jwt, "https://evil.example.test");
  expect(res.status).toBe(403);
  expect(state.reads).toBe(0);
  expect(state.revoked).toEqual([]);
});

// Review r1 P2 (BC-032/BC-033): a database failure must not look like a sign-out. The cookie is KEPT
// (it is the only handle a retry has on the session), and the browser goes back to the account page,
// which says the sign-out did not go through and offers it again.
it("a session lookup error keeps the cookie and reports a retryable failure", async () => {
  const jwt = await signCustomerJwt(claims);
  state.row = { id: "sess-1", token_hash: await hashToken(jwt) };
  state.lookupError = { message: "upstream timeout" };
  const res = await post(jwt);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`${ORIGIN}/order/account?signout=failed`);
  expect(res.headers.get("set-cookie") ?? "").not.toContain(`${PORTAL_COOKIE_NAME}=`);
  expect(state.revoked).toEqual([]);
});

it("a revoke error keeps the cookie and reports a retryable failure; the retry revokes", async () => {
  const jwt = await signCustomerJwt(claims);
  state.row = { id: "sess-1", token_hash: await hashToken(jwt) };
  state.revokeThrows = true;
  const res = await post(jwt);
  expect(res.headers.get("location")).toBe(`${ORIGIN}/order/account?signout=failed`);
  expect(res.headers.get("set-cookie") ?? "").not.toContain(`${PORTAL_COOKIE_NAME}=`);
  state.revokeThrows = false;
  const retry = await post(jwt);
  expect(retry.headers.get("location")).toBe(`${ORIGIN}/order/start`);
  expect(state.revoked).toEqual(["sess-1"]);
  expect(retry.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/i);
});

it("the account page tells the customer the sign-out failed, in en + es", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync("app/order/account/page.tsx", "utf8");
  expect(page).toMatch(/signout === "failed"/);
  expect(page).toContain("PortalSignOutFailed");
  for (const lang of ["en", "es"]) {
    const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
    expect(dict["order.portal.sign_out_failed"], lang).toBeTruthy();
  }
});
