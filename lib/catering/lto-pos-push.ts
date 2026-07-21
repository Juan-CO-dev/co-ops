/**
 * Provider-agnostic POS push for LTO/discount events. STUB until the Toast-integration phase —
 * logs and returns not_pushed. Swapping this one function to a real Toast client is the entire
 * "go live at the register" step (mirrors the Portal-3 payment-provider seam pattern).
 */
export interface PosPushResult {
  status: "not_pushed" | "pushed" | "failed";
  reason?: string;
}

export async function pushLtoToPos(event: {
  id: string;
  kind: "lto" | "discount";
  locationId: string;
}): Promise<PosPushResult> {
  // Toast integration pending — no-op seam. Intentionally never throws.
  void event;
  return { status: "not_pushed", reason: "toast_integration_pending" };
}
