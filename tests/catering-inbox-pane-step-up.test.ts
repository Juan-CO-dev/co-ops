// @vitest-environment jsdom
// The REAL StepUpProvider + PasswordModal inside an open native <dialog>: the detail must step aside for the password
// prompt (the dialog top layer would otherwise hide it), then come back with focus, and the send must follow.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { InboxPane } from "@/app/(authed)/catering/inbox/InboxPane";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { InboxDetail, InboxList } from "@/lib/catering/inbox";
import en from "@/lib/i18n/en.json";

const list: InboxList = { mode: "live", assignees: [], settings: { mode: "live", revision: 3, live_since: "2026-11-11T12:00:00Z" }, canChangeMode: false,
  messages: [{ id: "m", inbound_message_id: "i", location_id: null, sender_address: "guest@example.test", subject: "Need catering", received_at: "2026-11-11T12:00:00Z",
    disposition: "drafted", classification: "intake", identity_status: "new_sender", reason: null, assigned_to: null, revision: 1, group: "drafted", transport_only: false, stale: false, delivery_state: "draft" }] };
const detail: InboxDetail = { ...list.messages[0]!, body_text: "We need catering", body_from_html: false, body_truncated: false, catering_customer_id: null, lead_id: null, quote_id: null,
  preview_text: "Hi there,", events: [], assignees: [], delivery: { state: "draft", attempt: 0, attempted_at: null, sent_at: null, error_code: null }, sendable: true };
const dialogState = () => document.querySelector("dialog[aria-label]") as HTMLDialogElement;
beforeEach(() => {
  // jsdom has no top layer; model the native contract: showModal/close toggle `open` and fire `close`.
  HTMLDialogElement.prototype.showModal = function () { if (this.open) throw new Error("InvalidStateError"); this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(stepUpStatus = 200) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(options.body)) });
      if (url === "/api/auth/step-up") return { ok: stepUpStatus === 200, status: stepUpStatus, json: async () => ({ code: stepUpStatus === 401 ? "invalid_credentials" : "ok" }) };
      return { ok: true, status: 200, json: async () => ({ result: { state: "sent" } }) };
    }
    return { ok: true, status: 200, json: async () => url === "/api/catering/inbox" ? { inbox: list } : { message: detail } };
  }));
  render(createElement(TranslationProvider, { initialLanguage: "en" } as Parameters<typeof TranslationProvider>[0],
    createElement(StepUpProvider, { unlocked: false, unlockedAt: null, children: createElement(InboxPane, { initial: list }) })));
  return posts;
}
async function openDetail() {
  fireEvent.click(screen.getByRole("button", { name: /Open message:/ }));
  await waitFor(() => expect(dialogState().open).toBe(true));
  return dialogState();
}
describe("Send draft with the real step-up modal inside an open detail", () => {
  it("closes the detail for the password prompt, sends after the password, reopens the detail with focus restored", async () => {
    const posts = mount();
    const dialog = await openDetail();
    const send = within(dialog).getByRole("button", { name: en["catering.inbox.action.send"] });
    send.focus();
    fireEvent.click(send);
    // The prompt is reachable: the native dialog stepped aside and the modal is in the tree with a focusable password field.
    await waitFor(() => expect(screen.getByRole("dialog", { name: en["auth.step_up.title"] })).toBeTruthy());
    expect(dialog.open).toBe(false);
    expect(screen.getByRole("button", { name: /Open message:/ })).toBeTruthy(); // the pane kept the detail state, nothing navigated away
    const password = document.getElementById("step-up-password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "correct horse" } });
    fireEvent.submit(password.closest("form")!);
    await waitFor(() => expect(posts.map(p => p.url)).toEqual(["/api/auth/step-up", "/api/catering/inbox/m/send"]));
    expect(posts[0]!.body).toEqual({ password: "correct horse" });
    expect(posts[1]!.body).toEqual({ expectedRevision: 1, requestId: expect.any(String) });
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(screen.queryByRole("dialog", { name: en["auth.step_up.title"] })).toBeNull();
    await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe(en["catering.inbox.send_sent"]));
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: en["catering.inbox.action.send"] }));
  });
  it("Escape on the prompt sends nothing and brings the detail back", async () => {
    const posts = mount();
    const dialog = await openDetail();
    fireEvent.click(within(dialog).getByRole("button", { name: en["catering.inbox.action.send"] }));
    const prompt = await screen.findByRole("dialog", { name: en["auth.step_up.title"] });
    expect(dialog.open).toBe(false);
    fireEvent.keyDown(prompt, { key: "Escape" });
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(posts).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: en["auth.step_up.title"] })).toBeNull();
  });
  it("a wrong password keeps the prompt up and never posts the send", async () => {
    const posts = mount(401);
    const dialog = await openDetail();
    fireEvent.click(within(dialog).getByRole("button", { name: en["catering.inbox.action.send"] }));
    const password = (await screen.findByRole("dialog", { name: en["auth.step_up.title"] })).querySelector("#step-up-password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "nope" } });
    fireEvent.submit(password.closest("form")!);
    await waitFor(() => expect(posts.map(p => p.url)).toEqual(["/api/auth/step-up"]));
    expect(screen.getByRole("dialog", { name: en["auth.step_up.title"] })).toBeTruthy();
    expect(dialog.open).toBe(false);
  });
});
