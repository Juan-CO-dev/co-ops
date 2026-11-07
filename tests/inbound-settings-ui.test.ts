// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { InboundAliasesPanel, VendorAccountsPanel } from "@/components/admin/InboundSettings";
import type { InboundShop } from "@/lib/admin/inbound-settings-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const h = vi.hoisted(() => ({ post: vi.fn(), step: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => h.post }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.step }) }));
const shops: InboundShop[] = [{ id: "shop-a", name: "North shop", receipt_email_address: "receiving@example.test" }];
const mount = (children: React.ReactNode, language: "en" | "es" = "en") => render(jsx(TranslationProvider, { initialLanguage: language, children }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); h.step.mockResolvedValue("ok"); h.post.mockResolvedValue({ ok: true }); });

it.each(["en", "es"] as const)("keeps identity and counts visible with forms default-collapsed (%s)", language => {
  const dictionary = language === "en" ? en : es;
  mount(jsx(InboundAliasesPanel, { shops, aliases: [] }), language);
  expect(screen.getByText(dictionary["admin.inbound.receiving"].replace("{address}", "receiving@example.test"))).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  for (const toggle of screen.getAllByRole("button")) {
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.className).toContain("min-h-[44px]");
    expect(toggle.className).toContain("items-center");
  }
});
it("uses unique disclosure ids even when shop display names collide", () => {
  mount(jsx(InboundAliasesPanel, { shops: [...shops, { ...shops[0]!, id: "shop-b" }], aliases: [] }));
  const ids = screen.getAllByRole("button").map(button => button.getAttribute("aria-controls"));
  expect(new Set(ids).size).toBe(ids.length);
});
it("triggers account form, preserves dirty drawer and uses 44px responsive controls", () => {
  const { container } = mount(jsx(VendorAccountsPanel, { vendorId: "vendor", shops, accounts: [] }));
  const toggle = screen.getByRole("button", { name: /North shop/ });
  fireEvent.click(toggle);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Set account number" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "new-account" } });
  fireEvent.click(toggle);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("new-account");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  for (const control of container.querySelectorAll("button,input")) {
    expect(control.className).toContain("min-h-[44px]");
    expect(control.className).toContain("items-center");
  }
  expect(screen.getByRole("textbox").className).toContain("min-w-0");
  expect(container.querySelector("form > div")?.className).toContain("flex-wrap");
});
it("failed writes keep edits and show the error outside the drawer", async () => {
  h.post.mockRejectedValue(new Error("fixture network failure"));
  const { container } = mount(jsx(VendorAccountsPanel, { vendorId: "vendor", shops, accounts: [] }));
  fireEvent.click(screen.getByRole("button", { name: /North shop/ }));
  fireEvent.click(screen.getByRole("button", { name: "Set account number" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "account-fixture" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(en["admin.inbound.error"]));
  expect(screen.getByRole("status").closest(".co-card")).toBeNull();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("account-fixture");
});
it("removal posts a soft-deactivation request, without sending email", async () => {
  mount(jsx(InboundAliasesPanel, { shops, aliases: [{ id: "alias", address: "original@example.test", location_id: "shop-a", lane: "vendor_receipt" }] }));
  fireEvent.click(screen.getByRole("button", { name: /North shop/ }));
  fireEvent.click(screen.getByRole("button", { name: "Remove address" }));
  await waitFor(() => expect(h.post).toHaveBeenCalledWith("/api/admin/inbound/aliases", { id: "alias", remove: true }));
  expect(h.post).toHaveBeenCalledTimes(1);
});
