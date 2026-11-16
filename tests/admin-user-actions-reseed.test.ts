// @vitest-environment jsdom
/**
 * W27 / B142: the user editors seeded role / shops / name / email ONCE from props, and a save closed the dialog
 * (resetting to the OLD props) before router.refresh() delivered the new ones — so reopening showed the value from
 * before the save, and Confirm posted it back (undoing the promotion, shop change or rename). Opening an editor now
 * re-seeds from the CURRENT props.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { UserActions } from "@/components/admin/users/UserActions";
import type { AdminUserListItem } from "@/lib/admin/users";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn(async () => "ok") }) }));

const A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Capitol Hill", code: "MEP" };
const B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "P Street", code: "EM" };

const baseUser: AdminUserListItem = {
  id: "11111111-1111-4111-8111-111111111111", name: "Ana Ruiz", email: null, emailVerified: false, role: "employee",
  level: 3, active: true, lastLoginAt: null, dormantAt: null, dormancy: { dormant: false } as AdminUserListItem["dormancy"],
  locationIds: [A.id],
};

let calls: { url: string; method: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const el = (user: AdminUserListItem) => createElement(TranslationProvider, { initialLanguage: "en", children: createElement(UserActions, {
  user, assignableRoles: ["employee", "trainer"], accessibleLocations: [A, B],
  actor: { userId: "gm", role: "gm", locations: [A.id, B.id] }, employmentAvailable: false, today: "2026-11-16",
}) });
const confirm = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })); }); };

describe("reopening a user editor after a save (B142)", () => {
  it("reopening Change role after a refresh shows the saved role", async () => {
    const r = render(el(baseUser));
    fireEvent.click(screen.getByRole("button", { name: "Change role" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "trainer" } });
    await confirm();
    expect(calls.at(-1)!.body).toEqual({ role: "trainer" });
    r.rerender(el({ ...baseUser, role: "trainer" }));
    fireEvent.click(screen.getByRole("button", { name: "Change role" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("trainer");
    await confirm();
    expect(calls.at(-1)!.body).toEqual({ role: "trainer" });
  });

  it("reopening Change locations after a refresh shows the saved shops", async () => {
    const r = render(el(baseUser));
    fireEvent.click(screen.getByRole("button", { name: "Change locations" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /P Street/ }));
    await confirm();
    expect(calls.at(-1)!.body).toEqual({ locationIds: [A.id, B.id] });
    r.rerender(el({ ...baseUser, locationIds: [A.id, B.id] }));
    fireEvent.click(screen.getByRole("button", { name: "Change locations" }));
    expect((screen.getByRole("checkbox", { name: /P Street/ }) as HTMLInputElement).checked).toBe(true);
    await confirm();
    expect(calls.at(-1)!.body).toEqual({ locationIds: [A.id, B.id] });
  });

  it("reopening Edit profile after a refresh shows the saved name", async () => {
    const r = render(el(baseUser));
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Full name" }), { target: { value: "Ana María Ruiz" } });
    await confirm();
    expect(calls.at(-1)!.body).toEqual({ name: "Ana María Ruiz" });
    r.rerender(el({ ...baseUser, name: "Ana María Ruiz" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect((screen.getByRole("textbox", { name: "Full name" }) as HTMLInputElement).value).toBe("Ana María Ruiz");
    await confirm();
    expect(calls.at(-1)!.body).toEqual({ name: "Ana María Ruiz" });
  });
});
