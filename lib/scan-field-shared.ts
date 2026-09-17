/**
 * lib/scan-field-shared.ts — the arithmetic decisions a scan makes to the door's line list,
 * plus the one DOM question the wedge listener asks, pulled out of the component so they can
 * be tested in node (V3-B §6).
 *
 * `lib/barcodes-shared.ts` owns what a LABEL means; this file owns what a MATCH does to
 * the lines already on the screen. Both are pure by design: the test suite is node-only
 * (no component tests exist in this repo), so anything worth asserting has to live outside
 * the JSX. What is left inside `ScanField`/`ReceivingForm` is DOM and network — the camera
 * sheet and the three fetches.
 *
 * ZERO IMPORTS except the `Level` type, for the same reason `barcodes-shared` has none.
 */

import type { Level, ScanMatch } from "./barcodes-shared";

/**
 * The receiving level picker speaks the SKU's own pack-chain labels ("Case", "Bag", …),
 * not the two-value `Level` the barcode table stores. `chainLabels` arrives ROOT → LEAF
 * (lib/receiving.ts `chainLabelsInWalkOrder`), so the outermost container is [0] and the
 * thing inside it is [1].
 *
 * A one-rung chain (a SKU sold only by the case) answers "inner" with that same rung
 * rather than with nothing: the receiver scanned a real object and a blank level picker
 * would be a worse answer than the only level the SKU has. A SKU with NO chain at all
 * (legacy rows — see `receiving.form.level_legacy`) answers "", which the caller reads as
 * "leave the line's level alone".
 */
export function levelLabelFor(chainLabels: readonly string[], level: Level): string {
  if (chainLabels.length === 0) return "";
  const root = chainLabels[0] ?? "";
  if (level === "case") return root;
  return chainLabels[1] ?? root;
}

/** The slice of a door line this module touches. `ReceivingForm`'s `LineDraft` satisfies it. */
export interface ScanStepLine {
  /** The form's own stable row key. The scan binds to THIS, never to an index (finding 4). */
  key: string;
  skuId: string;
  level: string;
  qty: string;
  expanded: boolean;
  confirmed: boolean;
}

/**
 * The outcome of one scan against the list. `index` is -1 when nothing moved; `conflict` is
 * set only on the explicit-pick path, and only for the one case the caller has to re-decide.
 */
export interface ScanStepResult<L> {
  lines: L[];
  index: number;
  /** The row the receiver picked already carries a DIFFERENT non-empty level. Nothing moved. */
  conflict?: "level";
}

/**
 * ONE SCAN EVENT = ONE UNIT (spec §4 counting rule), applied to the line the match names —
 * AT THE SCANNED LEVEL.
 *
 * THE LEVEL IS PART OF THE MATCH KEY (Astra finding 2). v1 found the first line carrying the
 * SKU, overwrote its level and stepped its quantity, so two counted CASES plus one scanned
 * INNER read back as three bags: the cases were not converted, they were relabelled, and the
 * receiver's own count silently changed unit. A counted line's level is the receiver's
 * statement about what they counted and this function may never contradict it.
 *
 * A line therefore qualifies when
 *   ① its level already IS the scanned level (the ordinary repeat scan), or
 *   ② it carries no level at all — an offered/added row, where stamping a level overwrites
 *     nothing, or
 *   ③ the scan knows no level (`levelLabel` empty: a SKU with no pack chain), in which case
 *     there is no level to disagree about and the line's own level is left alone.
 * ① is preferred over ②, so a template-seeded "Case" row wins over a blank added row.
 *
 * When nothing qualifies — the SKU is on the delivery but only at ANOTHER level — the scan
 * APPENDS `newLine` at the scanned level rather than touching a counted row. Absent SKU and
 * no `newLine` = the lines come back untouched and `index` is -1; the caller decides what to
 * say.
 *
 * `lineKey` is the receiver answering the unknown sheet by hand: step THAT row, whatever the
 * automatic rule would have chosen (v1 stepped the first row of the SKU instead, so picking
 * the second of two rows counted the first). Its level is set only when the row has none; a
 * row already at a different level comes back `conflict: "level"` with NOTHING stepped, and
 * the caller re-runs without the key to append a row at the scanned level.
 */
export function applyScanToLines<L extends ScanStepLine>(
  lines: readonly L[],
  match: { skuId: string },
  levelLabel: string,
  newLine: L | null = null,
  lineKey: string | null = null,
): ScanStepResult<L> {
  const untouched = (): ScanStepResult<L> => ({ lines: [...lines], index: -1 });

  if (lineKey !== null) {
    const at = lines.findIndex((l) => l.key === lineKey);
    const picked = at >= 0 ? lines[at] : undefined;
    if (picked === undefined) return untouched();
    if (levelLabel !== "" && picked.level.trim() !== "" && picked.level !== levelLabel) {
      return { lines: [...lines], index: -1, conflict: "level" };
    }
    return step([...lines], at, levelLabel);
  }

  const sameLevel = lines.findIndex(
    (l) => l.skuId === match.skuId && (levelLabel === "" || l.level === levelLabel),
  );
  const found =
    sameLevel >= 0 ? sameLevel : lines.findIndex((l) => l.skuId === match.skuId && l.level.trim() === "");

  if (found < 0) {
    if (newLine === null) return untouched();
    const base = [...lines, newLine];
    return step(base, base.length - 1, levelLabel);
  }
  return step([...lines], found, levelLabel);
}

/**
 * The patch itself — deliberately the same one the +/− stepper writes: open the row, set its
 * level, put a number in `qty`, and drop `confirmed`, because a row whose count just changed
 * is no longer the row the operator ticked and leaving the tick on would let a scanned
 * over-count ride out under a confirmation that predates it.
 *
 * A blank `levelLabel` LEAVES the existing level alone rather than clearing it — a
 * template-seeded level is real information and a scan that knows no level has no business
 * erasing it.
 */
function step<L extends ScanStepLine>(base: L[], index: number, levelLabel: string): ScanStepResult<L> {
  const target = base[index];
  if (target === undefined) return { lines: base, index: -1 };
  base[index] = {
    ...target,
    expanded: true,
    level: levelLabel || target.level,
    qty: stepQty(target.qty),
    confirmed: false,
  };
  return { lines: base, index };
}

/**
 * +1 on whatever the box holds. Empty is 0, so the first scan of an offered row writes "1".
 * A NON-NUMERIC box is also 0 — `Number("abc") + 1` is `NaN`, and "NaN" in a quantity field
 * is a worse outcome than restarting the count the scan is about to take over anyway.
 * Fractional counts (a half case, "2.5") survive as fractions: this is the same arithmetic
 * the ± stepper does, not a re-typing of the value.
 */
function stepQty(qty: string): string {
  const trimmed = qty.trim();
  const n = trimmed === "" ? 0 : Number(trimmed);
  return String((Number.isFinite(n) ? n : 0) + 1);
}

/**
 * The one DOM question the keyboard wedge asks, structurally so node can test it.
 *
 * THE WEDGE IS ARMED ONLY WHEN NOTHING EDITABLE HAS FOCUS (Astra finding 1). v1 buffered and
 * provisionally swallowed EVERY keystroke on the page and re-dispatched the buffer into the
 * focused field when the burst hypothesis died — which moved a character into the NEXT input
 * if the operator tabbed first, fought number inputs that will not report a selection, and
 * discarded a select's typeahead. A person typing in a field now simply types: the listener
 * never sees the key at all, and a Bluetooth gun fired into a focused field types into it
 * like the keyboard it claims to be, which is honest and lossless.
 *
 * Structural duck-typing, not `instanceof`: this module may not import the DOM, and the
 * walk up `parentElement` is what catches a caret sitting inside a `contenteditable` (real
 * browsers also inherit `isContentEditable` down the tree, so the walk is the belt and the
 * property is the braces).
 */
export interface EditableProbe {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  parentElement?: EditableProbe | null;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
/** Deep enough for any real DOM, finite so a cyclic fake can never hang the door. */
const MAX_ANCESTOR_WALK = 64;

export function isEditableTarget(el: EditableProbe | null | undefined): boolean {
  let node: EditableProbe | null = el ?? null;
  for (let depth = 0; node && depth < MAX_ANCESTOR_WALK; depth++) {
    if (EDITABLE_TAGS.has((node.tagName ?? "").toUpperCase())) return true;
    if (node.isContentEditable === true) return true;
    const attr = node.getAttribute?.("contenteditable");
    if (attr != null && attr.toLowerCase() !== "false") return true;
    node = node.parentElement ?? null;
  }
  return false;
}

// ── The scan event machine (Astra r3) ──────────────────────────────────────

/**
 * Every match that names a SKU — i.e. everything a lookup can answer but `unknown`.
 * A type-only import, so this module still pulls in nothing at runtime.
 */
export type ResolvedScanMatch = Exclude<ScanMatch, { kind: "unknown" }>;

/** What the lookup turned out to mean. `ambiguous` resolves as `unknown`: it is the same question. */
export type ScanQueueOutcome =
  /** Nobody has taught this code, or the lookup could not answer (`failed`). Ask which line. */
  | { kind: "unknown"; failed: boolean }
  /** Taught at BOTH levels — case or inner must be asked before anything steps or teaches. */
  | { kind: "needs_level"; match: ResolvedScanMatch; levels: readonly Level[] }
  /** A single-level match (`line`, `sku`, or a `twin` offer): the executor can act on it. */
  | { kind: "match"; match: ResolvedScanMatch };

export interface ScanQueueEvent {
  /** Identity. Monotonic and never reused, so a completion can never land on a later event. */
  id: number;
  /** ARRIVAL ORDER, allocated the instant the label was read — not when the network answered. */
  seq: number;
  /** The intake generation the label was scanned under. */
  token: number;
  code: string;
  /**
   * `looking_up` the lookup is out · `resolved` it answered and the event is presentable ·
   * `working` it has been handed to the executor and its workflow is running. The third one
   * is why the sheet closes on the tap that answers it while the event itself STAYS at the
   * head of the queue: the question is over, the workflow is not.
   */
  state: "looking_up" | "resolved" | "working";
  outcome: ScanQueueOutcome | null;
  /** The case/inner this event's own sheet is showing. Per EVENT, never a shared slot. */
  level: Level;
}

export interface ScanQueueState {
  events: readonly ScanQueueEvent[];
  nextSeq: number;
}

/**
 * ONE EVENT MACHINE FOR THE DOOR (Astra r3, both P1s).
 *
 * THE POSITION IS ALLOCATED WHEN THE LABEL IS READ, NOT WHEN THE SERVER ANSWERS. Scanning
 * unknown labels A then B and letting B's lookup return first used to ask about B first —
 * with no code on screen — so a receiver answering for the box in their hands taught B's
 * barcode onto A's SKU and corrupted every future match. `arrive` allocates `seq`; the
 * lookup only ever RESOLVES an entry that already exists, so network timing cannot reorder
 * the questions.
 *
 * ONLY THE HEAD IS EVER PRESENTED, AND IT STAYS THE HEAD UNTIL ITS WHOLE WORKFLOW ENDS. That
 * is what retires the downstream single slots: the twin confirm, the level choice, the teach
 * 409 confirm and the "not on this delivery" hand-off were each one slot that a second scan
 * overwrote mid-workflow, so the first scan counted zero units. Because the executor is never
 * handed event N+1 until it calls `complete(N)`, a single active slot is provably enough.
 *
 * THE COUNTING RULE FALLS OUT OF THE SHAPE: an accepted event is completed exactly once and
 * increments exactly once; a dismissed event is completed exactly once and increments zero
 * times; `complete` on an id that has already left is a no-op, so a double-tap cannot pop the
 * event behind it.
 */
export const scanQueue = {
  empty: { events: [], nextSeq: 1 } as ScanQueueState,

  /**
   * A label was read. Entries from RETIRED generations are swept here — the token only ever
   * moves forward, so anything carrying an older one is a question about a truck that has
   * gone, and sweeping on the way in keeps the machine honest with no effect and no
   * cascading render.
   */
  arrive(
    state: ScanQueueState,
    input: { code: string; token: number },
  ): { state: ScanQueueState; event: ScanQueueEvent } {
    const event: ScanQueueEvent = {
      id: state.nextSeq,
      seq: state.nextSeq,
      token: input.token,
      code: input.code,
      state: "looking_up",
      outcome: null,
      level: "case",
    };
    return {
      state: {
        events: [...state.events.filter((e) => e.token === input.token), event],
        nextSeq: state.nextSeq + 1,
      },
      event,
    };
  },

  /** The lookup answered. Resolves the EXISTING entry in place; it never creates one. */
  resolve(state: ScanQueueState, id: number, outcome: ScanQueueOutcome): ScanQueueState {
    return {
      ...state,
      events: state.events.map((e) => (e.id === id ? { ...e, state: "resolved" as const, outcome } : e)),
    };
  },

  /**
   * Handed to the executor. ONLY a `resolved` event can be dispatched, which is what makes a
   * double-tap and a re-render idempotent: the second call finds a `working` event and
   * changes nothing, so one scan can never be executed twice.
   */
  dispatch(state: ScanQueueState, id: number): ScanQueueState {
    return {
      ...state,
      events: state.events.map((e) =>
        e.id === id && e.state === "resolved" ? { ...e, state: "working" as const } : e,
      ),
    };
  },

  /** Is this event presentable — resolved, and not already out with the executor? */
  isPresentable(event: ScanQueueEvent | null): boolean {
    return event !== null && event.state === "resolved";
  },

  /** The case/inner toggle, remembered on the event so two queued codes keep their own answer. */
  chooseLevel(state: ScanQueueState, id: number, level: Level): ScanQueueState {
    return { ...state, events: state.events.map((e) => (e.id === id ? { ...e, level } : e)) };
  },

  /** The oldest unfinished scan of this generation — resolved or not. Null when there is none. */
  head(state: ScanQueueState, token: number): ScanQueueEvent | null {
    let head: ScanQueueEvent | null = null;
    for (const e of state.events) {
      if (e.token !== token) continue;
      if (head === null || e.seq < head.seq) head = e;
    }
    return head;
  },

  /** How many scans of this generation are still unfinished, the head included. */
  pending(state: ScanQueueState, token: number): number {
    return state.events.filter((e) => e.token === token).length;
  },

  /**
   * This scan's workflow is over — stepped, taught, cancelled or abandoned. Idempotent by id:
   * calling it twice removes nothing the second time, so a double-tap can never consume the
   * event queued behind it.
   */
  complete(state: ScanQueueState, id: number): ScanQueueState {
    return { ...state, events: state.events.filter((e) => e.id !== id) };
  },

  /** Retire one generation's events and leave every other generation untouched. */
  drop(state: ScanQueueState, token: number): ScanQueueState {
    return { ...state, events: state.events.filter((e) => e.token !== token) };
  },
};
