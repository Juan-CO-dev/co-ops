/** Client fetch for the customer routes. The step-up unlock is done by the caller (literal tier). */
export async function postCustomerJson(url: string, payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; code: string | null; body: Record<string, unknown> }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const ok = response.ok && !response.redirected;
  return { ok, status: response.status, code: ok ? null : typeof body.code === "string" ? body.code : "generic", body };
}

export const STEP_UP_CODES = new Set(["step_up_required", "step_up_stale"]);
