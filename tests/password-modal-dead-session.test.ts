// @vitest-environment jsdom
/**
 * Audit W06/B154 — the password box must not say "Wrong password" when the SESSION has ended.
 *
 * requireSession's 401 used to carry no `code`, so the modal's `body.code === "unauthorized"` branch never matched and a
 * correct password read as wrong. An opaque redirect (the proxy's 307 for an expired JWT under redirect: "manual") fell
 * to the generic error. Both are now a dead session: the parent is reset (onCancel) and the page goes to sign in, with
 * the return link bound to this tab's user (W06-2 hybrid). A real wrong password (401 invalid_credentials) still says so.
 */
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordModal } from "@/components/auth/PasswordModal";
import { TranslationProvider } from "@/lib/i18n/provider";
import { rememberSignedInUser } from "@/lib/nav-sign-in-return";
import en from "@/lib/i18n/en.json";

const h = vi.hoisted(() => ({ fetch: vi.fn(), assign: vi.fn(), cancel: vi.fn(), confirm: vi.fn() }));
const WRONG = (en as Record<string, string>)["auth.step_up.error_wrong_password"]!;

const tree = () => jsx(TranslationProvider, {
  initialLanguage: "en",
  children: jsx(PasswordModal, { open: true, onConfirm: h.confirm, onCancel: h.cancel }),
});
const submit = () => {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
};
const res = (status: number, body: unknown, type: ResponseType = "basic") =>
  ({ ok: status >= 200 && status < 300, status, type, json: async () => body }) as unknown as Response;

let originalLocation: Location;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", h.fetch);
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, pathname: "/operations/counts", search: "?loc=a", assign: h.assign },
  });
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("PasswordModal on a dead session (B154)", () => {
  it("a 401 without invalid_credentials is a dead session, not a wrong password", async () => {
    rememberSignedInUser("user-1");
    h.fetch.mockResolvedValue(res(401, { error: "unauthorized" })); // the OLD body, no code
    render(tree());
    submit();
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.assign).toHaveBeenCalledWith("/?next=%2Foperations%2Fcounts%3Floc%3Da&for=user-1");
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(WRONG)).toBeNull();
  });

  it("an opaque redirect is a dead session", async () => {
    h.fetch.mockResolvedValue(res(0, {}, "opaqueredirect"));
    render(tree());
    submit();
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    // No signed-in user known in this tab: the return link is dropped rather than handed to whoever signs in.
    expect(h.assign).toHaveBeenCalledWith("/");
    expect(screen.queryByText(WRONG)).toBeNull();
  });

  it("a real wrong password still says so", async () => {
    h.fetch.mockResolvedValue(res(401, { code: "invalid_credentials" }));
    render(tree());
    submit();
    await waitFor(() => expect(screen.getByText(WRONG)).toBeTruthy());
    expect(h.assign).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
  });
});
