// @vitest-environment jsdom
/**
 * W21/B119: acknowledging ("Got it") or retracting a handoff note must never wipe the unsent
 * composer draft. Only a successful "create" clears the textarea, and only if the text is
 * still what was sent.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandoffSection } from "@/components/pulse/sections/HandoffSection";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";
import type { HandoffData } from "@/lib/pulse/types";

const data: HandoffData = {
  notes: [{ id: "n1", body: "Walk-in door sticks", audience: "all", authorName: "Ana", at: "2026-11-15T15:00:00.000Z", acks: [], ackedByMe: false }],
  canAuthor: true,
  reports: [],
  done: 0,
  left: 0,
};

const fetchMock = vi.fn();
const onChanged = vi.fn(async () => {});
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  onChanged.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount() {
  const children = createElement(HandoffSection, { data, mode: "detail", locationId: "shop", onChanged });
  return render(createElement(TranslationProvider, { initialLanguage: "en", children }));
}
const textarea = () => screen.getByLabelText(en["pulse.handoff.body_label"]) as HTMLTextAreaElement;
const lastAction = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body).action;

describe("handoff composer draft (B119)", () => {
  it.each([["ack", en["pulse.handoff.ack"]], ["supersede", en["pulse.handoff.retract"]]])(
    "%s on an existing note keeps the unsent draft", async (action, label) => {
      mount();
      fireEvent.change(textarea(), { target: { value: "half-written" } });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })); });
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(lastAction()).toBe(action);
      expect(textarea().value).toBe("half-written");
    });

  it("a successful send clears the draft", async () => {
    mount();
    fireEvent.change(textarea(), { target: { value: "Prep is short on pickles" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: en["pulse.handoff.send"] })); });
    await waitFor(() => expect(textarea().value).toBe(""));
    expect(lastAction()).toBe("create");
  });

  it("a failed send keeps the draft and shows the alert", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    mount();
    fireEvent.change(textarea(), { target: { value: "Prep is short on pickles" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: en["pulse.handoff.send"] })); });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(textarea().value).toBe("Prep is short on pickles");
  });
});
