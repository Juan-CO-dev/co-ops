/**
 * lib/scan-field-shared.ts — the two arithmetic decisions a scan makes to the door's
 * line list, pulled out of the component so they can be tested in node (V3-B §6).
 *
 * `lib/barcodes-shared.ts` owns what a LABEL means; this file owns what a MATCH does to
 * the lines already on the screen. Both are pure by design: the test suite is node-only
 * (no component tests exist in this repo), so anything worth asserting has to live outside
 * the JSX. What is left inside `ScanField`/`ReceivingForm` is DOM and network — the
 * keystroke re-dispatch, the camera sheet, the three fetches.
 *
 * ZERO IMPORTS except the `Level` type, for the same reason `barcodes-shared` has none.
 */

import type { Level } from "./barcodes-shared";

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
  skuId: string;
  level: string;
  qty: string;
  expanded: boolean;
  confirmed: boolean;
}

/**
 * ONE SCAN EVENT = ONE UNIT (spec §4 counting rule), applied to the line the match names.
 *
 * The step is deliberately the same patch the +/− stepper writes: open the row, set its
 * level, put a number in `qty`, and drop `confirmed` — a row whose count just changed is
 * no longer the row the operator ticked, and leaving the tick on would let a scanned
 * over-count ride out under a confirmation that predates it.
 *
 * `newLine` is how a `sku` match (this vendor's item, not yet on the delivery) joins the
 * list: the caller builds the row with the form's own `offeredLine`, so a scanned addition
 * is indistinguishable from one the template offered. Absent SKU + no `newLine` = the
 * lines come back untouched and `index` is -1; the caller decides what to say.
 *
 * A blank `levelLabel` (a SKU with no pack chain) LEAVES the existing level alone rather
 * than clearing it — a template-seeded level is real information and a scan that knows no
 * level has no business erasing it.
 */
export function applyScanToLines<L extends ScanStepLine>(
  lines: readonly L[],
  match: { skuId: string },
  levelLabel: string,
  newLine: L | null = null,
): { lines: L[]; index: number } {
  const found = lines.findIndex((l) => l.skuId === match.skuId);
  const base = found >= 0 ? [...lines] : newLine ? [...lines, newLine] : null;
  if (base === null) return { lines: [...lines], index: -1 };
  const index = found >= 0 ? found : base.length - 1;
  const target = base[index];
  if (target === undefined) return { lines: [...lines], index: -1 };
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
