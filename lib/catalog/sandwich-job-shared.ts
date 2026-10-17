/** Client-safe sandwich request lifecycle. */
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import type { NewSandwichRequest } from "@/lib/catalog/new-sandwich-shared";
import type { JobPreviewState } from "@/lib/catalog/jobs-shared";

export function createSandwichCostController<T>() {
  const guard = createRequestGuard();
  let state: JobPreviewState<T> = { status: "idle", value: null };
  return {
    getState: () => state,
    invalidate() { guard.invalidate(); state = { status: "pending", value: null }; },
    async run(load: () => Promise<T>) {
      state = { status: "pending", value: null };
      const result = await guard.run(async (): Promise<JobPreviewState<T>> => {
        try { return { status: "ready", value: await load() }; }
        catch { return { status: "failed", value: null }; }
      });
      if (result !== null) state = result;
      return result;
    },
  };
}
export interface SandwichAttempt { key: string; shopId: string; request: NewSandwichRequest }
export function createSandwichAttempt(makeId: () => string = () => crypto.randomUUID()) {
  let current: SandwichAttempt | null = null;
  return {
    // attemptKey is correlation only, never replay. No persistence or SQL idempotency exists.
    begin(request: NewSandwichRequest, shopId: string): SandwichAttempt {
      current ??= { key: makeId(), shopId, request: structuredClone({ ...request, name: request.name.trim() }) };
      return current;
    },
    isCurrent: (attempt: SandwichAttempt) => current === attempt,
    reset() { current = null; },
  };
}
export const sandwichRecoveryHref = (name: string) => `/admin/items?view=catalog&q=${encodeURIComponent(name)}`;
export const sandwichUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export type SandwichResponse = { kind: "response"; data: Record<string, unknown> } | { kind: "refused"; code: string } | { kind: "uncertain" };
export async function postSandwichJson(url: string, body: unknown, fetcher: typeof fetch = fetch): Promise<SandwichResponse> {
  try {
    const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
    if (response.status >= 500 || response.status >= 300 && response.status < 400) return { kind: "uncertain" };
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "uncertain" };
    const row = data as Record<string, unknown>;
    return response.ok ? { kind: "response", data: row } : { kind: "refused", code: typeof row.code === "string" ? row.code : "generic" };
  } catch { return { kind: "uncertain" }; }
}
