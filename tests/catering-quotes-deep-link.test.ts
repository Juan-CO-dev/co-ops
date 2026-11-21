// @vitest-environment jsdom
/**
 * The catering inbox's "Quote" button opens /catering/quotes?quote=<id>. Quote detail is a client view of the
 * quotes page (there is no /catering/quotes/<id> route), so the page hands the id to QuotesClient, which opens the
 * detail panel first; with no id it shows the list as before.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { TranslationProvider } from "@/lib/i18n/provider";
import { QuotesClient } from "@/components/catering/quotes/QuotesClient";
import en from "@/lib/i18n/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/auth/PasswordModal", () => ({ PasswordModal: () => null }));

const ID = "11111111-1111-4111-8111-111111111111";
const base = { quotes: [], locations: [], defaultLocationId: null, customers: [], leads: [], pricingByLocation: {}, menuItems: [], packagesByLocation: {}, actorLevel: 7 };
const mount = (extra: { initialQuoteId?: string | null } = {}) =>
  render(createElement(TranslationProvider, { initialLanguage: "en" } as Parameters<typeof TranslationProvider>[0], createElement(QuotesClient, { ...base, ...extra })));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QuotesClient deep link (?quote=<id>)", () => {
  it("opens that quote's detail panel first", async () => {
    mount({ initialQuoteId: ID });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/catering/quotes/${ID}`, { redirect: "manual" }));
    // The list's empty-state line belongs to the list view, which is not what a deep link opens.
    expect(screen.queryByText(en["catering.quotes.empty"])).toBeNull();
  });
  it("shows the list when no id is given", () => {
    mount();
    expect(screen.getByText(en["catering.quotes.empty"])).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
