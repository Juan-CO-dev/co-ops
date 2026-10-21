// @vitest-environment jsdom
/**
 * The Add user Toast picker, MOUNTED (jsdom + React Testing Library; Astra's review of b3213674, BC-060): the roster
 * fetch used to depend on the roster state it wrote, so its own state update re-ran the effect, the cleanup cancelled
 * the request and a delayed response was dropped — the picker stayed "Loading…" forever. These tests mount the real
 * component and answer the fetch LATE.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { CreateUserForm } from "@/components/admin/users/CreateUserForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));

const A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Capitol Hill", code: "MEP" };
const B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "P Street", code: "EM" };

interface Pending { url: string; signal: AbortSignal | undefined; resolve: (body: unknown) => void }
let pending: Pending[];
beforeEach(() => {
  pending = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => new Promise((resolve, reject) => {
    const p: Pending = { url, signal: init?.signal ?? undefined, resolve: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })) };
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    pending.push(p);
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = (locationIds: string[]) => render(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(CreateUserForm, {
  assignableRoles: ["employee"], accessibleLocations: [A, B], toastPickerEnabled: true, onClose: () => {}, initial: { role: "employee", locationIds },
}) }));
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the Toast picker (mounted)", () => {
  it("a DELAYED roster response is shown, not dropped (one request, never aborted by its own state update)", async () => {
    mount([A.id]);
    expect(await screen.findByText("Loading the Toast list…")).toBeTruthy();
    await act(async () => { await later(50); });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.signal?.aborted).toBe(false);
    await act(async () => { pending[0]!.resolve({ employees: [{ guid: "g1", name: "Miguel Lopez" }, { guid: "g2", name: "Ana Ruiz" }] }); });
    await waitFor(() => expect(screen.getByRole("option", { name: "Miguel Lopez" })).toBeTruthy());
    expect(screen.queryByText("Loading the Toast list…")).toBeNull();
    expect(pending).toHaveLength(1);
  });

  it("changing the shop aborts the old request; a late answer for the old shop is never shown", async () => {
    mount([A.id]);
    await act(async () => { await later(10); });
    expect(pending).toHaveLength(1);
    // Untick Capitol Hill, tick P Street: the picker follows the first chosen shop.
    await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: /Capitol Hill/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: /P Street/ })); });
    await act(async () => { await later(10); });
    expect(pending[0]!.signal?.aborted).toBe(true);
    const forB = pending.find((p) => p.url.includes(B.id))!;
    expect(forB.signal?.aborted).toBe(false);
    await act(async () => { pending[0]!.resolve({ employees: [{ guid: "old", name: "Old Shop Person" }] }); });
    await act(async () => { forB.resolve({ employees: [{ guid: "b1", name: "Bo Lee" }] }); });
    await waitFor(() => expect(screen.getByRole("option", { name: "Bo Lee" })).toBeTruthy());
    expect(screen.queryByRole("option", { name: "Old Shop Person" })).toBeNull();
    expect(screen.getByText("Toast employee at P Street (optional)")).toBeTruthy();
  });

  it("a failed roster read says so (no endless loading)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "toast_employees_failed" }), { status: 502 })));
    mount([A.id]);
    expect(await screen.findByText("The Toast list isn't available right now.")).toBeTruthy();
  });
});
