// @vitest-environment jsdom
/**
 * Item 4 PR 5, review r1 P2: the source verification form is BOUND TO THE DEFINITION IT WAS OPENED ON.
 * The page refreshes every row after any save. A row is keyed by its source id, so an open form survives the
 * refresh; if the refresh brings a REPLACEMENT definition for that source, the form (its "I read the terms" tick
 * and its note) must not be re-pointed at details the person never read. The form says so, Save is off, and no
 * request carries the replacement's hash.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ refresh: vi.fn(), stepUp: vi.fn(async () => "ok") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.stepUp }) }));

import { SourcesClient, type SourceView, type SourcesView } from "@/components/admin/demand-signals/SourcesClient";
import en from "@/lib/i18n/en.json";
import { TranslationProvider } from "@/lib/i18n/provider";

const HASH_A = "a".repeat(64), HASH_A2 = "c".repeat(64), HASH_B = "b".repeat(64);
const source = (over: Partial<SourceView>): SourceView => ({ sourceId: "nws", definitionHash: HASH_A, name: "National Weather Service", category: "weather", gate: "allow_with_conditions",
  adapter: "nws@1", status: "unverified", termsStatus: "verified", termsUrl: "https://www.weather.gov/disclaimer", markedAt: null, markedByName: null,
  definition: { homepageUrl: null, endpoints: ["https://api.weather.gov/points"], format: null, gives: "Hourly forecast for a point", auth: null, rateLimit: null,
    termsQuote: "The information is in the public domain", termsCheckedOn: "2026-11-18", conditions: ["Send a User-Agent"], caveats: null }, ...over });
const view = (a: Partial<SourceView> = {}): SourcesView => ({ sources: [source(a), source({ sourceId: "wmata", name: "WMATA", definitionHash: HASH_B })] });
const tree = (v: SourcesView) => createElement(TranslationProvider, { initialLanguage: "en" } as Parameters<typeof TranslationProvider>[0], createElement(SourcesClient, { view: v }));

function mount(v: SourcesView) {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    posts.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
    return { ok: true, status: 200, redirected: false, json: async () => ({ event_seq: 1, status: "verified" }) };
  }));
  const utils = render(tree(v));
  return { posts, rerender: (next: SourcesView) => utils.rerender(tree(next)) };
}
const saveButton = () => screen.getByRole("button", { name: en["signals.sources.form.verify_save"] }) as HTMLButtonElement;
function openVerifyForm(name: string) {
  fireEvent.click(screen.getByRole("button", { name: en["signals.sources.aria.row"].replace("{name}", name) }));
  fireEvent.click(screen.getByRole("button", { name: en["signals.sources.verify"] }));
  fireEvent.click(screen.getByRole("checkbox", { name: en["signals.sources.aria.read"].replace("{name}", name) }));
  fireEvent.change(screen.getByRole("textbox", { name: en["signals.sources.aria.note"].replace("{name}", name) }), { target: { value: "Read the terms today" } });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); h.refresh.mockClear(); h.stepUp.mockClear(); });

describe("the verification form is bound to the definition it was opened on", () => {
  it("unchanged details: Save sends the hash the form was opened on, after the password", async () => {
    const { posts } = mount(view());
    openVerifyForm("National Weather Service");
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ sourceId: "nws", definitionHash: HASH_A, status: "verified", note: "Read the terms today" });
    expect(h.stepUp).toHaveBeenCalledWith("B");
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });
  it("a refresh that brings a replacement definition: the open form says so, Save is off, nothing is sent", async () => {
    const { posts, rerender } = mount(view());
    openVerifyForm("National Weather Service");
    rerender(view({ definitionHash: HASH_A2 }));   // what router.refresh() delivers after another operator re-registered the source
    expect(screen.getByRole("alert").textContent).toBe(en["signals.sources.form.moved"]);
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toEqual([]);
    expect(h.stepUp).not.toHaveBeenCalled();
    // The tick and the note are still the old form's: they are not carried to the new details. Closing clears them.
    fireEvent.click(screen.getByRole("button", { name: en["signals.event.cancel"] }));
    fireEvent.click(screen.getByRole("button", { name: en["signals.sources.verify"] }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("textbox", { name: en["signals.sources.aria.note"].replace("{name}", "National Weather Service") }) as HTMLTextAreaElement).value).toBe("");
    expect(saveButton().disabled).toBe(true);   // the new details need their own tick and note
  });
  it("a verify needs the tick and a note; a source that cannot be ingested offers no verify", () => {
    mount({ sources: [source({}), source({ sourceId: "mlb", name: "MLB schedule", gate: "refuse", definitionHash: HASH_B })] });
    fireEvent.click(screen.getByRole("button", { name: en["signals.sources.aria.row"].replace("{name}", "National Weather Service") }));
    fireEvent.click(screen.getByRole("button", { name: en["signals.sources.verify"] }));
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(saveButton().disabled).toBe(true);   // no note yet
    fireEvent.click(screen.getByRole("button", { name: en["signals.event.cancel"] }));
    fireEvent.click(screen.getByRole("button", { name: en["signals.sources.aria.row"].replace("{name}", "MLB schedule") }));
    expect(screen.queryAllByRole("button", { name: en["signals.sources.verify"] })).toHaveLength(1);   // the NWS row's only
    expect(screen.getByText(en["signals.sources.cannot_verify"])).toBeTruthy();
  });
});
