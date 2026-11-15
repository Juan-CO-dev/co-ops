// @vitest-environment jsdom
/**
 * Audit W14 / B180, fix round 1 — the amount is cleared WHILE a save of that row is in flight.
 *
 * Clearing a saved amount is an Undo (owner decision W14-2 b). The first fix handled a row whose
 * save had settled. While a save was still on its way the box stayed enabled, the blank blur was
 * ignored, and the save's late answer marked the row Saved: an empty box, a row that counted as
 * done, and a Finalize that submitted the amount the prepper had deleted.
 *
 * The rule now: the clear is QUEUED behind the save. When the save lands, the newest thing the
 * prepper did decides — a box that is still blank runs the ordinary Undo on the entry the save
 * just wrote (the server still decides silent vs reason-required); an amount typed meanwhile
 * drops the queued clear. A late success never marks a blank row Saved.
 *
 * These render the real OpeningClient with a fetch whose answers the test releases by hand.
 */
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpeningClient } from "@/app/(authed)/operations/opening/opening-client";

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ language: "en", t: i18n.t }) }));

type Props = Parameters<typeof OpeningClient>[0];

const ITEM = "item-ranch";
const SAVE_URL = "/api/opening/prep/item";
const REVOKE_URL = "/api/opening/prep/item/revoke";

const props = {
  instance: { id: "inst-1", status: "phase1_complete", date: "2026-11-15", openerNoPriorDataReason: null },
  templateItems: [
    {
      id: ITEM,
      templateId: "tpl",
      station: "Sauces",
      displayOrder: 1,
      label: "Ranch",
      description: null,
      minRoleLevel: 0,
      required: true,
      expectsCount: true,
      expectsPhoto: false,
      vendorItemId: null,
      active: true,
      translations: null,
      prepMeta: { openingPhase2: true, section: "sauces" },
      reportReferenceType: null,
    },
  ],
  // No par: every amount is savable without an over/under reason, so the row's only moving part
  // here is the amount box.
  closerSnapshots: {
    [ITEM]: { templateItemId: ITEM, closingInstanceId: null, closerCount: 5, parValue: null, parUnit: null, snapshotTakenAt: "2026-11-15T10:00:00Z", lineCount: null, backUpCount: null },
  },
  derived: {},
  batchContext: {},
  batchDerived: {},
  batchState: {},
  verifiedSections: ["sauces"],
  initialDraft: null,
  completions: [
    {
      id: "phase1-row",
      instanceId: "inst-1",
      templateItemId: ITEM,
      completedBy: "u1",
      completedAt: "2026-11-15T10:05:00Z",
      countValue: null,
      photoId: null,
      notes: null,
      prepData: { phase1: { ground_truth_count: 5, prep_need: null } },
    },
  ],
  managers: [],
  saverNames: { u1: "Ana" },
  language: "en",
  canSubmit: true,
  canEditConsumption: false,
} as unknown as Props;

interface Call {
  url: string;
  body: Record<string, unknown> & { entry?: { openerPrepped?: number | null }; completionId?: string };
  /** Release this request's answer and let React settle everything that follows from it. */
  respond: (status: number, json: unknown) => Promise<void>;
  /** Fail this request at the network. */
  fail: () => Promise<void>;
}

let calls: Call[] = [];
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({
          url,
          body: JSON.parse(String(init?.body ?? "{}")),
          respond: (status, json) =>
            act(async () => {
              resolve(new Response(JSON.stringify(json), { status }));
              await settle();
              await settle();
            }),
          fail: () =>
            act(async () => {
              reject(new Error("offline"));
              await settle();
              await settle();
            }),
        });
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const box = () => screen.getByLabelText(/opening\.phase2\.input_prepped_aria/) as HTMLInputElement;
/** Type into the amount box and leave it (the row saves on blur). */
async function enter(text: string) {
  await act(async () => {
    fireEvent.change(box(), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.blur(box());
    await settle();
  });
}
/** How many rows the Finalize counter counts as done. */
function countedDone(): number {
  const counter = screen.getByText(/opening\.submit\.counter_phase2_entries/).textContent ?? "";
  return (JSON.parse(counter.slice(counter.indexOf("{"))) as { filled: number }).filled;
}
const saves = () => calls.filter((c) => c.url === SAVE_URL);
const revokes = () => calls.filter((c) => c.url === REVOKE_URL);
const saved = (completionId: string) => ({
  completion: { completedBy: "u1", completedAt: "2026-11-15T10:10:00Z" },
  completionId,
});
const text = () => document.body.textContent ?? "";

describe("Phase 2 — the amount is cleared while its save is in flight (B180)", () => {
  it("saved, edited (save in flight), cleared: the late success never marks the blank row Saved, and its entry is undone", async () => {
    render(createElement(OpeningClient, props));
    await enter("5");
    expect(saves()).toHaveLength(1);
    await saves()[0]!.respond(200, saved("c1"));
    expect(countedDone()).toBe(1);

    await enter("6"); // the second save is now in flight
    expect(saves()).toHaveLength(2);
    expect(saves()[1]!.body.entry?.openerPrepped).toBe(6);
    await enter(""); // cleared before that request finished
    expect(saves()).toHaveLength(2);
    expect(revokes()).toHaveLength(0); // queued: c1 is being superseded, there is nothing to undo yet
    expect(countedDone()).toBe(0);

    await saves()[1]!.respond(200, saved("c2"));
    // The row never reads Saved behind an empty box …
    expect(box().value).toBe("");
    expect(countedDone()).toBe(0);
    expect(text()).not.toContain("opening.phase2.save.saved_by_at");
    // … and the queued clear runs the ordinary Undo on the entry the save just wrote.
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0]!.body).toMatchObject({ instanceId: "inst-1", completionId: "c2", reason: null, note: null });

    await revokes()[0]!.respond(200, { path: "silent" });
    expect(text()).toContain("opening.phase2.save.unsaved");
    expect(box().value).toBe("");
    expect(countedDone()).toBe(0);
    expect(revokes()).toHaveLength(1);
  });

  it("the very first save in flight, cleared: same rule (nothing was on file when the box was cleared)", async () => {
    render(createElement(OpeningClient, props));
    await enter("5");
    await enter("");
    expect(saves()).toHaveLength(1);
    await saves()[0]!.respond(200, saved("c1"));
    expect(countedDone()).toBe(0);
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0]!.body.completionId).toBe("c1");
    await revokes()[0]!.respond(200, { path: "silent" });
    expect(text()).toContain("opening.phase2.save.unsaved");
  });

  it("the server wants a reason: the ordinary reason prompt opens and the row keeps not counting", async () => {
    render(createElement(OpeningClient, props));
    await enter("5");
    await enter("");
    await saves()[0]!.respond(200, saved("c1"));
    await revokes()[0]!.respond(422, { code: "reason_required" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(text()).toContain("opening.phase2.save.incomplete_cleared");
    expect(countedDone()).toBe(0);
    expect(box().value).toBe("");
  });

  it("cleared, then an amount typed again before the save landed: the amount wins, nothing is undone", async () => {
    render(createElement(OpeningClient, props));
    await enter("5");
    await enter("");
    await enter("7"); // the newest word is an amount: its own save goes out
    expect(saves()).toHaveLength(2);
    await saves()[0]!.respond(200, saved("c1"));
    await saves()[1]!.respond(200, saved("c2"));
    expect(revokes()).toHaveLength(0);
    expect(box().value).toBe("7");
    expect(countedDone()).toBe(1);
  });

  it("the in-flight save FAILS: the entry still on file is the one the clear undoes", async () => {
    render(createElement(OpeningClient, props));
    await enter("5");
    await saves()[0]!.respond(200, saved("c1"));
    await enter("6");
    await enter("");
    await saves()[1]!.fail();
    expect(countedDone()).toBe(0);
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0]!.body.completionId).toBe("c1");
    await revokes()[0]!.respond(200, { path: "silent" });
    expect(text()).toContain("opening.phase2.save.unsaved");
    expect(box().value).toBe("");
  });

  it("the first save FAILS with nothing on file: no Undo, and the row is not counted", async () => {
    render(createElement(OpeningClient, props));
    await enter("5");
    await enter("");
    await saves()[0]!.respond(500, {});
    expect(revokes()).toHaveLength(0);
    expect(countedDone()).toBe(0);
  });

  it("two saves in flight, then cleared: the first answer leaves the row waiting, the last one runs the Undo", async () => {
    render(createElement(OpeningClient, props));
    await enter("5");
    await enter("6"); // a different amount: its save overlaps the first (unchanged behaviour)
    expect(saves()).toHaveLength(2);
    await enter("");
    await saves()[0]!.respond(200, saved("c1"));
    expect(countedDone()).toBe(0); // still "saving": the other save's answer decides
    expect(revokes()).toHaveLength(0);
    await saves()[1]!.respond(200, saved("c2"));
    expect(countedDone()).toBe(0);
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0]!.body.completionId).toBe("c2");
  });

  it("a STALE success that arrives after the row was cleared and undone never marks it Saved", async () => {
    render(createElement(OpeningClient, props));
    await enter("5"); // save A, slow
    await enter("6"); // save B
    await saves()[1]!.respond(200, saved("c2")); // B answers first: the row reads Saved
    expect(countedDone()).toBe(1);
    await enter(""); // cleared: the ordinary Undo of c2 runs
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0]!.body.completionId).toBe("c2");
    await revokes()[0]!.respond(200, { path: "silent" });
    expect(countedDone()).toBe(0);
    await saves()[0]!.respond(200, saved("c1")); // A's late answer, behind an empty box
    expect(box().value).toBe("");
    expect(countedDone()).toBe(0);
    expect(text()).not.toContain("opening.phase2.save.saved_by_at");
    // An Undo already ran on this row: this entry is offered for Undo, not undone on its own.
    expect(revokes()).toHaveLength(1);
    expect(text()).toContain("opening.phase2.save.incomplete_cleared");
  });

  it("a save that lands with nothing cleared still reads Saved (unchanged)", async () => {
    render(createElement(OpeningClient, props));
    await enter("5");
    await saves()[0]!.respond(200, saved("c1"));
    expect(countedDone()).toBe(1);
    expect(text()).toContain("opening.phase2.save.saved_by_at");
    expect(revokes()).toHaveLength(0);
  });
});
