/**
 * V3-B §6 — what a scan does to the door's line list, and when the wedge is armed.
 *
 * Node environment, no DOM: `lib/scan-field-shared.ts` is the arithmetic half of
 * `ScanField`, extracted precisely so this file can exist (the repo has no component
 * tests). What stays untested here is DOM and network — the camera sheet, the three
 * fetches — and that boundary is deliberate, not an omission.
 *
 * `isEditableTarget` is duck-typed against element-shaped literals for the same reason: it
 * is the one question the wedge listener asks of the live DOM, and Astra finding 1 turns on
 * getting its answer right, so it is pinned here rather than left to a browser.
 */
import { describe, expect, it } from "vitest";

import type { Level } from "@/lib/barcodes-shared";
import {
  applyScanToIntake,
  applyScanToLines,
  forgetScannedCodeAt,
  isEditableTarget,
  levelLabelFor,
  scanQueue,
  type EditableProbe,
  type IntakeScanState,
  type ResolvedScanMatch,
  type ScanQueueOutcome,
  type ScanQueueState,
  type ScanStepLine,
} from "@/lib/scan-field-shared";

type Line = ScanStepLine;

const line = (over: Partial<Line> = {}): Line => ({
  key: "k1",
  skuId: "sku-a",
  level: "",
  qty: "",
  expanded: false,
  confirmed: false,
  ...over,
});

describe("levelLabelFor", () => {
  it("case is the ROOT label and inner the one inside it (root → leaf)", () => {
    expect(levelLabelFor(["Case", "Bag", "Each"], "case")).toBe("Case");
    expect(levelLabelFor(["Case", "Bag", "Each"], "inner")).toBe("Bag");
  });

  it("a one-rung chain answers inner with that same rung, never with nothing", () => {
    expect(levelLabelFor(["Case"], "inner")).toBe("Case");
    expect(levelLabelFor(["Case"], "case")).toBe("Case");
  });

  it("no chain at all answers empty — the caller leaves the line's level alone", () => {
    expect(levelLabelFor([], "case")).toBe("");
    expect(levelLabelFor([], "inner")).toBe("");
  });
});

describe("applyScanToLines", () => {
  it("steps an empty quantity to 1 and opens the row at the scanned level", () => {
    const before = [line()];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Case");
    expect(index).toBe(0);
    expect(lines[0]).toMatchObject({ qty: "1", level: "Case", expanded: true, confirmed: false });
    expect(before[0]?.qty).toBe(""); // the input array is never mutated
  });

  it("steps 2 → 3 and 2.5 → 3.5 — the same arithmetic as the ± stepper", () => {
    expect(applyScanToLines([line({ qty: "2", level: "Case" })], { skuId: "sku-a" }, "Case").lines[0]?.qty).toBe("3");
    expect(applyScanToLines([line({ qty: "2.5", level: "Case" })], { skuId: "sku-a" }, "Case").lines[0]?.qty).toBe("3.5");
  });

  it("a non-numeric box restarts at 1 rather than writing NaN into a quantity", () => {
    expect(applyScanToLines([line({ qty: "abc" })], { skuId: "sku-a" }, "Case").lines[0]?.qty).toBe("1");
  });

  it("drops a ✓ that predates the new count", () => {
    const { lines } = applyScanToLines([line({ qty: "4", level: "Case", confirmed: true })], { skuId: "sku-a" }, "Case");
    expect(lines[0]).toMatchObject({ qty: "5", confirmed: false });
  });

  it("a blank level label leaves a template-seeded level alone", () => {
    const { lines } = applyScanToLines([line({ level: "Case" })], { skuId: "sku-a" }, "");
    expect(lines[0]?.level).toBe("Case");
  });

  it("appends the provided row when the SKU is not on the delivery, and steps THAT row", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "7" })];
    const fresh = line({ key: "k2", skuId: "sku-b" });
    const { lines, index } = applyScanToLines(before, { skuId: "sku-b" }, "Bag", fresh);
    expect(lines).toHaveLength(2);
    expect(index).toBe(1);
    expect(lines[1]).toMatchObject({ key: "k2", skuId: "sku-b", qty: "1", level: "Bag", expanded: true });
    expect(lines[0]).toMatchObject({ key: "k1", qty: "7", expanded: false }); // untouched
  });

  it("an absent SKU with nothing to append leaves every line alone and reports -1", () => {
    const before = [line({ qty: "7", confirmed: true })];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-z" }, "Case");
    expect(index).toBe(-1);
    expect(lines).toEqual(before);
  });

  it("touches ONLY the matched line", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", qty: "1", level: "Case", confirmed: true }),
      line({ key: "k2", skuId: "sku-b", qty: "2", level: "Case" }),
      line({ key: "k3", skuId: "sku-c", qty: "3", level: "Each", expanded: true }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-b" }, "Case");
    expect(index).toBe(1);
    expect(lines[0]).toEqual(before[0]);
    expect(lines[2]).toEqual(before[2]);
    expect(lines[1]).toMatchObject({ qty: "3", level: "Case", expanded: true });
  });

  // ── Astra finding 2 · the level is part of the match key ───────────────────

  it("NEVER relabels a counted line: 2 cases + a scanned inner appends a bag row", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })];
    const fresh = line({ key: "k2", skuId: "sku-a" });
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag", fresh);
    expect(index).toBe(1);
    expect(lines[0]).toEqual(before[0]); // the two cases are still two cases
    expect(lines[1]).toMatchObject({ key: "k2", skuId: "sku-a", qty: "1", level: "Bag" });
  });

  it("steps the row already AT the scanned level rather than the first row of the SKU", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" }),
      line({ key: "k2", skuId: "sku-a", qty: "4", level: "Bag" }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag");
    expect(index).toBe(1);
    expect(lines[0]?.qty).toBe("2");
    expect(lines[1]?.qty).toBe("5");
  });

  it("prefers the row at the scanned level over an empty offered row of the same SKU", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", level: "" }),
      line({ key: "k2", skuId: "sku-a", qty: "2", level: "Case" }),
    ];
    const { index } = applyScanToLines(before, { skuId: "sku-a" }, "Case");
    expect(index).toBe(1);
  });

  it("falls back to a row with NO level — stamping one overwrites nothing", () => {
    const before = [line({ key: "k1", skuId: "sku-a", level: "" })];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag");
    expect(index).toBe(0);
    expect(lines[0]).toMatchObject({ qty: "1", level: "Bag" });
  });

  it("a SKU present only at another level and NO row to append leaves the list alone", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag");
    expect(index).toBe(-1);
    expect(lines).toEqual(before);
  });

  it("a levelless scan still steps the FIRST row carrying the SKU (legacy SKUs, no pack chain)", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", qty: "1" }),
      line({ key: "k2", skuId: "sku-a", qty: "9" }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "");
    expect(index).toBe(0);
    expect(lines[0]?.qty).toBe("2");
    expect(lines[1]?.qty).toBe("9");
  });

  // ── Astra finding 2 · the explicit pick binds to the ROW, not to the SKU ───

  it("an explicit lineKey steps THAT row, even when an earlier row carries the same SKU", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", qty: "1", level: "Case" }),
      line({ key: "k2", skuId: "sku-a", qty: "9", level: "Case" }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Case", null, "k2");
    expect(index).toBe(1);
    expect(lines[0]?.qty).toBe("1");
    expect(lines[1]?.qty).toBe("10");
  });

  it("an explicit pick STAMPS the level on a row that has none", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "3", level: "" })];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag", null, "k1");
    expect(index).toBe(0);
    expect(lines[0]).toMatchObject({ qty: "4", level: "Bag" });
  });

  it("an explicit pick of a row at a DIFFERENT level reports conflict and steps nothing", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })];
    const res = applyScanToLines(before, { skuId: "sku-a" }, "Bag", null, "k1");
    expect(res.conflict).toBe("level");
    expect(res.index).toBe(-1);
    expect(res.lines).toEqual(before);
  });

  it("a levelless scan on an explicit pick never conflicts — there is no level to disagree about", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })];
    const res = applyScanToLines(before, { skuId: "sku-a" }, "", null, "k1");
    expect(res.conflict).toBeUndefined();
    expect(res.lines[0]).toMatchObject({ qty: "3", level: "Case" });
  });

  it("an explicit lineKey naming a row that is gone leaves the list alone", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2" })];
    const res = applyScanToLines(before, { skuId: "sku-a" }, "Case", line({ key: "k9" }), "k-removed");
    expect(res.index).toBe(-1);
    expect(res.lines).toEqual(before);
  });
});

describe("isEditableTarget — when the wedge stands down (Astra finding 1)", () => {
  const el = (over: Partial<EditableProbe> = {}): EditableProbe => ({
    tagName: "DIV",
    getAttribute: () => null,
    parentElement: null,
    ...over,
  });

  it("an input, a textarea and a select are all editable", () => {
    expect(isEditableTarget(el({ tagName: "INPUT" }))).toBe(true);
    expect(isEditableTarget(el({ tagName: "textarea" }))).toBe(true);
    expect(isEditableTarget(el({ tagName: "SELECT" }))).toBe(true);
  });

  it("a contenteditable element is editable, by property or by attribute", () => {
    expect(isEditableTarget(el({ isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(el({ getAttribute: (n) => (n === "contenteditable" ? "" : null) }))).toBe(true);
    expect(isEditableTarget(el({ getAttribute: (n) => (n === "contenteditable" ? "true" : null) }))).toBe(true);
  });

  it("a child of a contenteditable is editable — the caret is inside it", () => {
    const host = el({ getAttribute: (n) => (n === "contenteditable" ? "true" : null) });
    const span = el({ tagName: "SPAN", parentElement: host });
    expect(isEditableTarget(span)).toBe(true);
  });

  it("contenteditable=\"false\" is NOT editable", () => {
    expect(isEditableTarget(el({ getAttribute: (n) => (n === "contenteditable" ? "false" : null) }))).toBe(false);
  });

  it("a button, a plain div and the body are not editable — this is where the wedge arms", () => {
    const body = el({ tagName: "BODY" });
    expect(isEditableTarget(body)).toBe(false);
    expect(isEditableTarget(el({ tagName: "BUTTON", parentElement: body }))).toBe(false);
    expect(isEditableTarget(el({ tagName: "DIV", parentElement: body }))).toBe(false);
  });

  it("null (no focus at all) is not editable", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });

  it("a cyclic parent chain terminates instead of hanging the door", () => {
    const a: EditableProbe = { tagName: "DIV", getAttribute: () => null, parentElement: null };
    a.parentElement = a;
    expect(isEditableTarget(a)).toBe(false);
  });
});

/**
 * The scan event machine (Astra r3). Both P1s of the third pass live or die here:
 * ARRIVAL ORDER (the question asked must be about the box in the receiver's hands) and
 * ONE WORKFLOW AT A TIME (a second scan must never overwrite the first mid-confirmation).
 *
 * The executor below is the parent modelled as a counter — because the thing the arc is
 * ultimately protecting is a quantity on a line, and "each accepted scan increments exactly
 * once" is the only statement of that worth pinning.
 */
describe("scanQueue", () => {
  const TOKEN = 7;

  const match = (skuId: string, kind: "line" | "sku" | "twin" = "line"): ResolvedScanMatch =>
    kind === "twin"
      ? { kind: "twin", skuId, viaSkuId: "via-sku", level: "case", levels: ["case"], ambiguous: false }
      : { kind, skuId, level: "case", levels: ["case"], ambiguous: false };

  /** Two labels read back to back, before either lookup has answered. */
  const twoArrivals = (token = TOKEN) => {
    const a = scanQueue.arrive(scanQueue.empty, { code: "AAA111", token });
    const b = scanQueue.arrive(a.state, { code: "BBB222", token });
    return { a: a.event, b: b.event, state: b.state };
  };

  it("allocates the queue position when the label ARRIVES, not when the lookup answers", () => {
    const { a, b, state } = twoArrivals();
    expect(a.seq).toBeLessThan(b.seq);
    expect(a.state).toBe("looking_up");

    // B's lookup returns FIRST — the reversal that asked about B while A was in hand, and
    // taught B's barcode onto A's SKU.
    let q = scanQueue.resolve(state, b.id, { kind: "unknown", failed: false });
    expect(scanQueue.head(q, TOKEN)).toMatchObject({ id: a.id, code: "AAA111", state: "looking_up" });

    // A answers second and is STILL the question asked first.
    q = scanQueue.resolve(q, a.id, { kind: "unknown", failed: false });
    expect(scanQueue.head(q, TOKEN)).toMatchObject({ id: a.id, code: "AAA111", state: "resolved" });

    q = scanQueue.complete(q, a.id, TOKEN);
    expect(scanQueue.head(q, TOKEN)).toMatchObject({ id: b.id, code: "BBB222" });
  });

  it("a resolved later event is never presented ahead of an unresolved head", () => {
    const { a, b, state } = twoArrivals();
    const q = scanQueue.resolve(state, b.id, { kind: "match", match: match("sku-b") });
    expect(scanQueue.head(q, TOKEN)?.id).toBe(a.id);
    expect(scanQueue.pending(q, TOKEN)).toBe(2);
  });

  it("completing an event twice removes nothing the second time", () => {
    const { a, b, state } = twoArrivals();
    let q = scanQueue.complete(state, a.id, TOKEN);
    q = scanQueue.complete(q, a.id, TOKEN); // a double-tap must not consume B
    expect(scanQueue.pending(q, TOKEN)).toBe(1);
    expect(scanQueue.head(q, TOKEN)?.id).toBe(b.id);
  });

  it("a late answer for a completed scan is inert — resolve never creates an entry", () => {
    const { a, state } = twoArrivals();
    let q = scanQueue.complete(state, a.id, TOKEN);
    q = scanQueue.complete(q, scanQueue.head(q, TOKEN)?.id ?? "none", TOKEN);
    q = scanQueue.resolve(q, a.id, { kind: "unknown", failed: true });
    expect(scanQueue.pending(q, TOKEN)).toBe(0);
    expect(scanQueue.head(q, TOKEN)).toBeNull();
  });

  it("each event keeps its OWN case/inner choice", () => {
    const { a, b, state } = twoArrivals();
    const q = scanQueue.chooseLevel(state, a.id, "inner");
    expect(q.events.find((e) => e.id === a.id)?.level).toBe("inner");
    expect(q.events.find((e) => e.id === b.id)?.level).toBe("case");
  });

  it("dropping a generation removes only that generation's events", () => {
    const old = scanQueue.arrive(scanQueue.empty, { code: "AAA111", token: 1 });
    const fresh = scanQueue.arrive({ events: [], nextSeq: old.state.nextSeq }, { code: "BBB222", token: 2 });
    // Built by hand: `arrive` sweeps foreign tokens, so this tests `drop` on its own.
    const mixed = { events: [...old.state.events, ...fresh.state.events], nextSeq: fresh.state.nextSeq };
    expect(scanQueue.pending(mixed, 1)).toBe(1);
    expect(scanQueue.pending(mixed, 2)).toBe(1);

    const after = scanQueue.drop(mixed, 1);
    expect(scanQueue.pending(after, 1)).toBe(0);
    expect(scanQueue.pending(after, 2)).toBe(1);
    expect(scanQueue.head(after, 2)?.code).toBe("BBB222");
  });

  it("a new arrival sweeps the previous generation — the token only ever moves forward", () => {
    let q = scanQueue.arrive(scanQueue.empty, { code: "AAA111", token: 1 }).state;
    q = scanQueue.arrive(q, { code: "BBB222", token: 2 }).state;
    expect(scanQueue.pending(q, 1)).toBe(0);
    expect(scanQueue.pending(q, 2)).toBe(1);
  });

  /**
   * THE EXECUTOR, MODELLED — the parent. It is handed the head ONLY when the head is resolved
   * and nothing is already active, it runs one workflow at a time, and it completes exactly
   * once. `units` is the quantity on a line: the number the whole arc protects.
   */
  interface Active {
    id: string;
    stage: "twin" | "level";
    lineKey: string | null;
    level: Level;
  }
  const executor = (start: ScanQueueState) => {
    let q = start;
    let units = 0;
    let active: Active | null = null;
    const seen: Active[] = [];
    return {
      get units() {
        return units;
      },
      get pending() {
        return scanQueue.pending(q, TOKEN);
      },
      get active() {
        return active;
      },
      get seen() {
        return seen;
      },
      resolve(id: string, outcome: ScanQueueOutcome) {
        q = scanQueue.resolve(q, id, outcome);
      },
      chooseLevel(id: string, level: Level) {
        q = scanQueue.chooseLevel(q, id, level);
      },
      /** What ScanField would hand over right now, or null. */
      take() {
        if (active !== null) return null;
        const h = scanQueue.head(q, TOKEN);
        return h !== null && h.state === "resolved" ? h : null;
      },
      open(id: string, stage: "twin" | "level", lineKey: string | null, level: Level) {
        active = { id, stage, lineKey, level };
        seen.push(active);
      },
      /** The workflow ended in a count. */
      accept() {
        if (active === null) throw new Error("nothing active");
        units += 1;
        q = scanQueue.complete(q, active.id, TOKEN);
        active = null;
      },
      /** The workflow ended without one. */
      dismiss() {
        if (active === null) throw new Error("nothing active");
        q = scanQueue.complete(q, active.id, TOKEN);
        active = null;
      },
    };
  };

  it("two twin offers in a row each increment EXACTLY once — neither overwrites the other", () => {
    const { a, b, state } = twoArrivals();
    const ex = executor(state);
    // Both answer as twins, B's lookup first.
    ex.resolve(b.id, { kind: "match", match: match("sku-b", "twin") });
    ex.resolve(a.id, { kind: "match", match: match("sku-a", "twin") });

    const first = ex.take();
    expect(first?.id).toBe(a.id); // arrival order, not answer order
    ex.open(first!.id, "twin", null, "case");
    // While A's confirm is open, B is NOT handed over: that is the overwrite that used to
    // make the first scan count zero.
    expect(ex.take()).toBeNull();
    ex.accept();

    const second = ex.take();
    expect(second?.id).toBe(b.id);
    ex.open(second!.id, "twin", null, "case");
    ex.accept();

    expect(ex.units).toBe(2);
    expect(ex.pending).toBe(0);
  });

  it("two 409 level confirms in a row keep their own lineKey and level", () => {
    const { a, b, state } = twoArrivals();
    const ex = executor(state);
    ex.resolve(a.id, { kind: "unknown", failed: false });
    ex.resolve(b.id, { kind: "unknown", failed: false });

    // A: the receiver picks row k9 and answers INNER; the teach comes back 409.
    ex.chooseLevel(a.id, "inner");
    const first = ex.take();
    expect(first?.id).toBe(a.id);
    expect(first?.level).toBe("inner");
    ex.open(first!.id, "level", "k9", first!.level);
    expect(ex.take()).toBeNull();
    ex.accept();

    // B: a different row, its own level — A's slot was never touched.
    const second = ex.take();
    expect(second?.id).toBe(b.id);
    expect(second?.level).toBe("case");
    ex.open(second!.id, "level", "k2", second!.level);
    ex.accept();

    expect(ex.units).toBe(2);
    expect(ex.seen).toEqual([
      { id: a.id, stage: "level", lineKey: "k9", level: "inner" },
      { id: b.id, stage: "level", lineKey: "k2", level: "case" },
    ]);
  });

  it("dispatch takes the head out of the ASKING state without moving it off the head", () => {
    const { a, b, state } = twoArrivals();
    let q = scanQueue.resolve(state, a.id, { kind: "unknown", failed: false });
    expect(scanQueue.isPresentable(scanQueue.head(q, TOKEN))).toBe(true);

    q = scanQueue.dispatch(q, a.id); // the receiver tapped a line; the sheet must close
    expect(scanQueue.isPresentable(scanQueue.head(q, TOKEN))).toBe(false);
    expect(scanQueue.head(q, TOKEN)?.id).toBe(a.id); // …and B still waits behind it
    expect(scanQueue.pending(q, TOKEN)).toBe(2);

    q = scanQueue.complete(q, a.id, TOKEN);
    expect(scanQueue.head(q, TOKEN)?.id).toBe(b.id);
  });

  it("dispatching a working or unresolved event changes nothing — one scan executes once", () => {
    const { a, state } = twoArrivals();
    const looking = scanQueue.dispatch(state, a.id); // still looking up
    expect(looking.events.find((e) => e.id === a.id)?.state).toBe("looking_up");

    let q = scanQueue.resolve(state, a.id, { kind: "unknown", failed: false });
    q = scanQueue.dispatch(q, a.id);
    const twice = scanQueue.dispatch(q, a.id); // a double-tap
    expect(twice.events.find((e) => e.id === a.id)?.state).toBe("working");
    expect(scanQueue.pending(twice, TOKEN)).toBe(2);
  });

  it("a dismissed workflow increments zero times and still frees the queue", () => {
    const { a, b, state } = twoArrivals();
    const ex = executor(state);
    ex.resolve(a.id, { kind: "unknown", failed: false });
    ex.resolve(b.id, { kind: "match", match: match("sku-b") });

    ex.open(ex.take()!.id, "level", null, "case");
    ex.dismiss(); // closed without answering
    expect(ex.units).toBe(0);

    const next = ex.take();
    expect(next?.id).toBe(b.id);
    ex.open(next!.id, "twin", null, "case");
    ex.accept();
    expect(ex.units).toBe(1);
    expect(ex.pending).toBe(0);
  });
});

/**
 * Astra r4 item 1 — completion is bound to the generation that issued it.
 *
 * The scan island UNMOUNTS on a vendor change (the form sets `prefilling`), so a plain
 * counter restarted at 1 and vendor A's late teach could complete vendor B's event of the
 * same number: B's scan popped, or B's `working` head blocked for good.
 */
describe("scanQueue — a completion can never cross generations", () => {
  const A = 4;
  const B = 5;

  it("event ids never collide across generations, even after a drop and a fresh start", () => {
    const first = scanQueue.arrive(scanQueue.empty, { code: "AAA111", token: A });
    // The island unmounts and remounts: the replacement starts from an EMPTY queue, which is
    // exactly how a bare counter used to hand out `1` a second time.
    const remounted = scanQueue.arrive(scanQueue.empty, { code: "BBB222", token: B });
    expect(first.event.seq).toBe(remounted.event.seq); // same position…
    expect(first.event.id).not.toBe(remounted.event.id); // …different identity

    // And after a drop inside one generation, ids still never repeat.
    const dropped = scanQueue.drop(first.state, A);
    const again = scanQueue.arrive(dropped, { code: "CCC333", token: A });
    expect(again.event.id).not.toBe(first.event.id);
  });

  it("completing with a stale token is a no-op — nothing is removed", () => {
    const stale = scanQueue.arrive(scanQueue.empty, { code: "AAA111", token: A });
    const fresh = scanQueue.arrive(scanQueue.empty, { code: "BBB222", token: B });

    // A's completion, arriving late, aimed at the queue B is now using.
    const after = scanQueue.complete(fresh.state, stale.event.id, A);
    expect(after.events).toEqual(fresh.state.events);
    expect(scanQueue.pending(after, B)).toBe(1);

    // Even the RIGHT id under the WRONG generation removes nothing.
    const wrongGeneration = scanQueue.complete(fresh.state, fresh.event.id, A);
    expect(scanQueue.pending(wrongGeneration, B)).toBe(1);
  });

  it("a stale completion leaves the current head WORKING rather than unblocking it", () => {
    const fresh = scanQueue.arrive(scanQueue.empty, { code: "BBB222", token: B });
    let q = scanQueue.resolve(fresh.state, fresh.event.id, { kind: "unknown", failed: false });
    q = scanQueue.dispatch(q, fresh.event.id); // B's workflow is running

    const after = scanQueue.complete(q, fresh.event.id, A); // A's late teach lands
    const head = scanQueue.head(after, B);
    expect(head?.id).toBe(fresh.event.id);
    expect(head?.state).toBe("working"); // untouched: B's workflow still owns the head
    expect(scanQueue.isPresentable(head)).toBe(false);

    // B's own completion still works.
    expect(scanQueue.pending(scanQueue.complete(after, fresh.event.id, B), B)).toBe(0);
  });
});

/**
 * Astra r4 item 2 — the lines and the "Forget this code" attribution move together.
 *
 * Releasing a held head drains every resolved match in one synchronous pass. Computing the
 * attribution from a preview against the last COMMITTED lines made the second scan predict a
 * row that the (correct) functional update never created.
 */
describe("applyScanToIntake — one transition for the count and its code", () => {
  const empty: IntakeScanState<Line> = { lines: [], scanned: {} };
  const step = (
    state: IntakeScanState<Line>,
    code: string | null,
    over: { skuId?: string; levelLabel?: string; newLine?: Line | null; lineKey?: string | null } = {},
  ) =>
    applyScanToIntake(state, {
      skuId: over.skuId ?? "sku-a",
      levelLabel: over.levelLabel ?? "Case",
      level: "case",
      code,
      newLine: over.newLine === undefined ? line({ key: "new-" + (code ?? "x"), skuId: over.skuId ?? "sku-a" }) : over.newLine,
      lineKey: over.lineKey ?? null,
    });

  it("two codes for the same ABSENT SKU, drained in sequence, make ONE row with TWO units", () => {
    const first = step(empty, "CODE-AAA");
    const second = step(first, "CODE-BBB");

    expect(second.lines).toHaveLength(1);
    const row = second.lines[0];
    expect(row?.qty).toBe("2");

    // BOTH scans are attributed to the row that actually exists — the defect was the second
    // code landing on a predicted key no row ever carried.
    expect(Object.keys(second.scanned)).toEqual([row?.key]);
    // …and the Forget target for the visible row is the LATEST code.
    expect(second.scanned[row?.key ?? ""]).toEqual({ code: "CODE-BBB", level: "case" });
    expect(second.scanned["new-CODE-BBB"]).toBeUndefined();
  });

  it("the candidate row is adopted only when it is actually appended", () => {
    const first = step(empty, "CODE-AAA");
    const key = first.lines[0]?.key;
    expect(key).toBe("new-CODE-AAA");
    // The second scan's candidate is discarded, so its key must appear nowhere.
    const second = step(first, "CODE-BBB");
    expect(second.lines.map((l) => l.key)).toEqual([key]);
    expect(second.scanned["new-CODE-BBB"]).toBeUndefined();
  });

  it("two rows of one SKU at different levels each keep their OWN code", () => {
    const cases = applyScanToIntake(empty, {
      skuId: "sku-a", levelLabel: "Case", level: "case", code: "CODE-CASE",
      newLine: line({ key: "k-case", skuId: "sku-a" }), lineKey: null,
    });
    const both = applyScanToIntake(cases, {
      skuId: "sku-a", levelLabel: "Bag", level: "inner", code: "CODE-BAG",
      newLine: line({ key: "k-bag", skuId: "sku-a" }), lineKey: null,
    });
    expect(both.lines).toHaveLength(2);
    expect(both.scanned).toEqual({
      "k-case": { code: "CODE-CASE", level: "case" },
      "k-bag": { code: "CODE-BAG", level: "inner" },
    });
  });

  it("a count with no code to remember steps the line and attributes nothing", () => {
    const first = step(empty, "CODE-AAA");
    const declined = step(first, null);
    expect(declined.lines[0]?.qty).toBe("2");
    expect(declined.scanned).toEqual({ "new-CODE-AAA": { code: "CODE-AAA", level: "case" } });
  });

  it("nothing moved hands back the SAME references so the caller can bail out", () => {
    const state: IntakeScanState<Line> = { lines: [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })], scanned: {} };
    const next = applyScanToIntake(state, {
      skuId: "sku-z", levelLabel: "Case", level: "case", code: "CODE", newLine: null, lineKey: null,
    });
    expect(next.lines).toBe(state.lines);
    expect(next.scanned).toBe(state.scanned);
  });

  it("a picked row already counted at another level appends instead, and the code follows it", () => {
    const state: IntakeScanState<Line> = {
      lines: [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })],
      scanned: { k1: { code: "CODE-CASE", level: "case" } },
    };
    const next = applyScanToIntake(state, {
      skuId: "sku-a", levelLabel: "Bag", level: "inner", code: "CODE-BAG",
      newLine: line({ key: "k2", skuId: "sku-a" }), lineKey: "k1",
    });
    expect(next.lines).toHaveLength(2);
    expect(next.lines[0]).toEqual(state.lines[0]); // the two counted cases are untouched
    expect(next.scanned).toEqual({
      k1: { code: "CODE-CASE", level: "case" },
      k2: { code: "CODE-BAG", level: "inner" },
    });
  });

  // Astra r5. A forget is a round-trip; a scan can land on the same row while it is out.
  it("a forget in flight for code A does NOT clear code B that arrived on the row meanwhile", () => {
    const state: IntakeScanState<Line> = {
      lines: [line({ key: "k1" })],
      scanned: { k1: { code: "AAA", level: "case" } },
    };
    const captured = state.scanned.k1; // what the request set out to forget
    // B is scanned onto the same row before A's answer lands.
    const withB = applyScanToIntake(state, {
      skuId: "sku-a", levelLabel: "Case", level: "case", code: "BBB", newLine: null, lineKey: null,
    });
    expect(withB.scanned.k1).toEqual({ code: "BBB", level: "case" });

    const afterAnswer = forgetScannedCodeAt(withB, "k1", captured);
    expect(afterAnswer).toBe(withB); // B stays forgettable; only A was forgotten server-side
    expect(afterAnswer.scanned.k1).toEqual({ code: "BBB", level: "case" });
  });

  it("the same code re-attributed at a DIFFERENT level is also left alone", () => {
    const state: IntakeScanState<Line> = {
      lines: [line({ key: "k1" })],
      scanned: { k1: { code: "AAA", level: "inner" } },
    };
    expect(forgetScannedCodeAt(state, "k1", { code: "AAA", level: "case" })).toBe(state);
  });

  it("clears when the row still carries exactly the code the request forgot", () => {
    const state: IntakeScanState<Line> = {
      lines: [line({ key: "k1" }), line({ key: "k2", skuId: "sku-b" })],
      scanned: { k1: { code: "AAA", level: "case" }, k2: { code: "BBB", level: "inner" } },
    };
    // A fresh object with the same values — the state is rebuilt on every transition, so the
    // guard has to compare by VALUE, never by identity.
    const after = forgetScannedCodeAt(state, "k1", { code: "AAA", level: "case" });
    expect(after.scanned).toEqual({ k2: { code: "BBB", level: "inner" } });
  });

  it("forgetScannedCodeAt clears one row's code and leaves the rest alone", () => {
    const state: IntakeScanState<Line> = {
      lines: [line({ key: "k1" }), line({ key: "k2", skuId: "sku-b" })],
      scanned: { k1: { code: "AAA", level: "case" }, k2: { code: "BBB", level: "inner" } },
    };
    const after = forgetScannedCodeAt(state, "k1");
    expect(after.scanned).toEqual({ k2: { code: "BBB", level: "inner" } });
    expect(after.lines).toBe(state.lines);
    // A row with nothing remembered comes back untouched, by reference.
    expect(forgetScannedCodeAt(after, "k1")).toBe(after);
  });
});
