// @vitest-environment jsdom
/**
 * Owner decision W06-2 (HYBRID), on the real login page: after a sign-out, the SAME person signing back in returns to
 * the page they were on; a DIFFERENT person goes to the dashboard. The return link names its owner (`&for=<user id>`);
 * a link with no `for` (opened while signed out) keeps its old meaning.
 */
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => h.params,
}));

import LoginPage from "@/app/page";

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, type: "basic", json: async () => body }) as unknown as Response;

async function managerSignIn(signedInUserId: string) {
  h.fetch.mockImplementation(async (url: string) => {
    if (url === "/api/locations") return json({ locations: [] });
    if (url === "/api/auth/password") return json({ ok: true, user_id: signedInUserId });
    return json({}, 404);
  });
  render(jsx(LoginPage, {}));
  fireEvent.click(screen.getByRole("button", { name: "Manager login →" }));
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "gm@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(h.push).toHaveBeenCalledTimes(1));
  return h.push.mock.calls[0]![0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the login page's return link (W06-2 hybrid)", () => {
  it("the same person returns to the page they were on", async () => {
    h.params = new URLSearchParams("reason=idle&next=%2Fcatering%2Finbox%2Fabc&for=user-a");
    expect(await managerSignIn("user-a")).toBe("/catering/inbox/abc");
  });

  it("a different person goes to the dashboard", async () => {
    h.params = new URLSearchParams("reason=idle&next=%2Fcatering%2Finbox%2Fabc&for=user-a");
    expect(await managerSignIn("user-b")).toBe("/dashboard");
  });

  it("a link opened while signed out (no for) keeps its old meaning", async () => {
    h.params = new URLSearchParams("next=%2Fadmin%2Fvendors%2Fv1");
    expect(await managerSignIn("user-b")).toBe("/admin/vendors/v1");
  });

  it("a hostile next is still refused", async () => {
    h.params = new URLSearchParams("next=%2F%2Fevil.com&for=user-a");
    expect(await managerSignIn("user-a")).toBe("/dashboard");
  });
});
