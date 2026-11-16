/** The ONE content_hash of a captured Toast order (item 1 PR B, plan r3 §1; churn fix PR 1, plan r2 §1).
 * Server/script only (node:crypto). Both capture writers (capture.ts, capture-modified.ts) go through
 * it; the closed list in tests/toast-line-prices-equivalence.test.ts fails any other site. The input
 * is main's field set in CANONICAL order (canonicalHashInput): TOAST_LINE_PRICES never changes the
 * hash of an unchanged order, and neither does Toast returning its arrays in another order. */
import { createHash } from "node:crypto";
import { canonicalHashInput, type ToastCapturedOrder } from "./capture-shared";

export function toastContentHash(order: ToastCapturedOrder): string {
  const input = canonicalHashInput(order);
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** `TOAST_LINE_PRICES=1` turns line prices on for new snapshots. Unset (the default) = main. */
export function toastLinePricesEnabled(): boolean {
  return process.env.TOAST_LINE_PRICES === "1";
}
