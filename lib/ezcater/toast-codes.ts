import "server-only";
import { toastGet } from "@/lib/toast/client";
import { captureBudget } from "@/lib/toast/capture-runner";
import { normalizeOrderCode } from "./pass2-shared";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const id = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
export const toastCodeSelectionKey = (order: string, check: string, selection: string) => JSON.stringify([order, check, selection]);
const versionInstant = (value: unknown): number => typeof value === "string" && /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? Date.parse(value) : NaN;

/** Ephemeral lookup only: raw notes never enter capture snapshots, audit, or storage.
 * Pass expectedVersions for captured catering-channel orders to fence both scope
 * and source version. Unknown/missing versions cannot authorize snapshot links. */
export async function loadKnownToastOrderCodes(restaurantGuid: string, businessDate: string,
  knownCodes: string[], opts: { deadlineAt?: number; signal?: AbortSignal;
    expectedVersions?: Map<string, string | null> } = {}): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const known = new Set(knownCodes.map(normalizeOrderCode).filter(Boolean));
  if (!known.size || opts.expectedVersions?.size === 0) return result;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error("ezcater_toast_invalid_date");
  const budget = captureBudget(Math.max(1, (opts.deadlineAt ?? Date.now() + 20_000) - Date.now()), opts.signal);
  try {
    for (let page = 1; page <= 500; page++) {
      const raw = await budget.request(() => toastGet<unknown>(
        `/orders/v2/ordersBulk?businessDate=${businessDate.replaceAll("-", "")}&page=${page}&pageSize=100`, restaurantGuid, budget.signal));
      if (!Array.isArray(raw) || raw.length > 100) throw new Error("ezcater_toast_bad_page");
      for (const order of raw.map(row)) {
        const orderGuid = id(order.guid);
        if (!orderGuid || order.voided === true || order.deleted === true || order.excessFood === true) continue;
        if (opts.expectedVersions) {
          const expected = versionInstant(opts.expectedVersions.get(orderGuid));
          if (!Number.isFinite(expected) || versionInstant(order.modifiedDate) !== expected) continue;
        }
        for (const check of rows(order.checks)) {
          const checkGuid = id(check.guid);
          if (!checkGuid || check.voided === true || check.deleted === true) continue;
          const walk = (selections: unknown, parentItem: string | null) => {
            for (const selection of rows(selections)) {
              if (selection.voided === true || selection.deleted === true) continue;
              const itemGuid = id(row(selection.item).guid);
              const selectionGuid = id(selection.guid);
              if (!itemGuid && parentItem && selection.selectionType === "SPECIAL_REQUEST" && typeof selection.displayName === "string") {
                // Whole tokens only; intersect before anything escapes this stack frame.
                const matched = (selection.displayName.match(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g) ?? [])
                  .map(normalizeOrderCode).filter((code) => known.has(code));
                if (matched.length) {
                  const key = toastCodeSelectionKey(orderGuid, checkGuid, parentItem);
                  result.set(key, [...new Set([...(result.get(key) ?? []), ...matched])]);
                }
              }
              walk(selection.modifiers, itemGuid && selectionGuid ? selectionGuid : parentItem);
            }
          };
          walk(check.selections, null);
        }
      }
      if (raw.length < 100) return result;
    }
    throw new Error("ezcater_toast_page_limit");
  } finally { budget.close(); }
}
