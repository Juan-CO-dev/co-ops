/** The ONE content_hash of a captured Toast order (item 1 PR B, plan r3 §1). Server/script only
 * (node:crypto). Both capture writers (capture.ts, capture-modified.ts) go through it; the closed
 * list in tests/toast-line-prices-equivalence.test.ts fails any other site. The input is main's
 * field set (legacyHashInput), so TOAST_LINE_PRICES never changes the hash of an unchanged order. */
import { createHash } from "node:crypto";
import { legacyHashInput, type ToastCapturedOrder } from "./capture-shared";

export function toastContentHash(order: ToastCapturedOrder): string {
  const input = legacyHashInput(order);
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** `TOAST_LINE_PRICES=1` turns line prices on for new snapshots. Unset (the default) = main. */
export function toastLinePricesEnabled(): boolean {
  return process.env.TOAST_LINE_PRICES === "1";
}
