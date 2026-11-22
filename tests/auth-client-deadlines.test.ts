// @vitest-environment jsdom
/**
 * Audit W06 fix round 8 — CC's deadline inventory of the idle / sign-out client code: every network call has a deadline.
 *
 * The round-8 review found the heartbeat had none (tests/idle-timeout-warning.test.ts "round 8"). The inventory found
 * three more calls in the same components with no deadline, each holding a guard while in flight:
 *   - PasswordModal POST /api/auth/step-up (the dead-session path's own request): `submitting` disables Confirm AND
 *     Cancel (and Esc), so one stalled request locked the person inside the modal for good;
 *   - MeControls (nav PR 9; was the UserMenu) PATCH /api/users/me/language: `updating` disables both language buttons;
 *   - MeControls (nav PR 9; was the UserMenu) PATCH /api/users/me/profile-blurb: `blurbSaving` disables Save.
 * Each now runs under one deadline (lib/bounded-fetch.ts withDeadline) covering the request AND the body it reads: at
 * the deadline the request is aborted, the guard is released and the existing network-error message shows. What
 * happens AFTER the request (the step-up's onConfirm) is not under the deadline.
 */
import { act } from "react";
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordModal } from "@/components/auth/PasswordModal";
import { MeControls } from "@/components/nav/MeControls";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";

const h = vi.hoisted(() => ({ fetch: vi.fn(), push: vi.fn(), refresh: vi.fn(), cancel: vi.fn(), confirm: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
  usePathname: () => "/operations/counts",
}));

const T = en as Record<string, string>;
/** The components' own deadlines (components/auth/PasswordModal.tsx, components/nav/MeControls.tsx). */
const STEP_UP_TIMEOUT_MS = 15_000;
const USER_MENU_SAVE_TIMEOUT_MS = 10_000;

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const wrap = (child: unknown) => render(jsx(TranslationProvider, { initialLanguage: "en", children: child }));
const res = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, type: "basic", json: async () => body }) as unknown as Response;
/** Headers never arrive; the request rejects only when its signal aborts (a real fetch). */
const pendingUntilAbort = (init: RequestInit | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });
/** Headers arrived; the body never finishes. */
const stalledBody = (status: number) =>
  ({ ok: status >= 200 && status < 300, status, type: "basic", json: () => new Promise<never>(() => {}) }) as unknown as Response;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PasswordModal — the step-up request has a deadline", () => {
  const mountModal = () => wrap(jsx(PasswordModal, { open: true, onConfirm: h.confirm, onCancel: h.cancel }));
  const submit = async () => {
    await advance(1);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  };
  const cancelButton = () => screen.getByRole("button", { name: T["auth.step_up.cancel"] ?? "Cancel" }) as HTMLButtonElement;

  for (const variant of ["headers never arrive", "a 401 whose body never finishes"] as const) {
    it(`${variant}: at the deadline the request is aborted, the network error shows and Cancel works again`, async () => {
      const signals: AbortSignal[] = [];
      h.fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        signals.push(init!.signal!);
        return variant === "headers never arrive" ? pendingUntilAbort(init) : stalledBody(401);
      });
      mountModal();
      await submit();
      await advance(STEP_UP_TIMEOUT_MS - 1);
      expect(cancelButton().disabled).toBe(true); // still in flight
      await advance(1);
      expect(signals[0]!.aborted).toBe(true);
      expect(screen.getByText(T["auth.step_up.error_network"]!)).toBeTruthy();
      expect(cancelButton().disabled).toBe(false);
      fireEvent.click(cancelButton());
      expect(h.cancel).toHaveBeenCalledTimes(1);
      expect(h.confirm).not.toHaveBeenCalled();
    });
  }

  it("the deadline covers the request only: a slow onConfirm after a 200 is not cut off", async () => {
    let finish: () => void = () => {};
    h.confirm.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    h.fetch.mockResolvedValue(res(200, { ok: true }));
    mountModal();
    await submit();
    await advance(STEP_UP_TIMEOUT_MS * 2);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(T["auth.step_up.error_network"]!)).toBeNull();
    await act(async () => finish());
  });
});

describe("MeControls (Go to's Me; was the UserMenu) — the language and blurb saves have a deadline", () => {
  const mountMenu = () =>
    wrap(jsx(MeControls, { userName: "GM", userEmail: null, actorLevel: 7, initialBlurb: null, sessionId: "session-1" }));
  const esButton = () =>
    screen.getByRole("radio", {
      name: T["user_menu.language.aria_select"]!.replace("{language}", T["user_menu.language.es"]!),
    }) as HTMLButtonElement;

  for (const variant of ["headers never arrive", "a 500 whose body never finishes"] as const) {
    it(`language save (${variant}): released at the deadline with the network error, buttons usable again`, async () => {
      const signals: AbortSignal[] = [];
      h.fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        signals.push(init!.signal!);
        return variant === "headers never arrive" ? pendingUntilAbort(init) : stalledBody(500);
      });
      mountMenu();
      fireEvent.click(esButton());
      expect(h.fetch.mock.calls[0]![0]).toBe("/api/users/me/language");
      await advance(USER_MENU_SAVE_TIMEOUT_MS - 1);
      expect(esButton().disabled).toBe(true);
      await advance(1);
      expect(signals[0]!.aborted).toBe(true);
      expect(screen.getByText(T["user_menu.language.network_error"]!)).toBeTruthy(); // was a hard-coded English "Network error."
      expect(esButton().disabled).toBe(false);
      expect(h.refresh).not.toHaveBeenCalled();
    });
  }

  it("a language save that answers in time still switches", async () => {
    h.fetch.mockResolvedValue(res(200, { ok: true }));
    mountMenu();
    fireEvent.click(esButton());
    await advance(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  for (const variant of ["headers never arrive", "a 200 whose body never finishes"] as const) {
    it(`blurb save (${variant}): released at the deadline with the blurb error, Save usable again`, async () => {
      const signals: AbortSignal[] = [];
      h.fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        signals.push(init!.signal!);
        return variant === "headers never arrive" ? pendingUntilAbort(init) : stalledBody(200);
      });
      mountMenu();
      fireEvent.change(screen.getByPlaceholderText(T["user_menu.blurb.placeholder"]!), { target: { value: "Hi" } });
      fireEvent.click(screen.getByRole("button", { name: T["user_menu.blurb.save"]! }));
      expect(h.fetch.mock.calls[0]![0]).toBe("/api/users/me/profile-blurb");
      await advance(USER_MENU_SAVE_TIMEOUT_MS - 1);
      expect(screen.getByRole("button", { name: T["user_menu.blurb.saving"]! })).toBeTruthy();
      await advance(1);
      expect(signals[0]!.aborted).toBe(true);
      expect(screen.getByText(T["user_menu.blurb.error"]!)).toBeTruthy();
      expect((screen.getByRole("button", { name: T["user_menu.blurb.save"]! }) as HTMLButtonElement).disabled).toBe(false);
    });
  }
});
