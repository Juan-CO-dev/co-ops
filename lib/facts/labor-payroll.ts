import "server-only";
/** Item 2, salaried cost to the payroll shop: the server side of the "Payroll shop" card on /admin/sevenshifts.
 * Both entry points refuse anyone but the owner / CGS / MoO by TRUSTED ROLE before any I/O. The loader returns
 * the census (lib/facts/labor-payroll-read.ts over payrollCensus) of EVERY 7shifts account in the mirror and no
 * wage amount (has-salary flags only); the save goes only through 0340's save_labor_payroll_shop, which
 * re-checks everything under its locks and writes its own audit row. Sends nothing. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleCode } from "@/lib/roles";
import { canManagePayrollShops, type PayrollShopErrorCode, type PayrollShopSave } from "./labor-payroll-shared";
import { PAYROLL_NOT_INSTALLED, readPayrollCensus, type PayrollCensusRead } from "./labor-payroll-read";

export class PayrollShopError extends Error {
  constructor(public status: number, public code: PayrollShopErrorCode) { super(code); }
}
export interface PayrollActor { userId: string; role: RoleCode }
export type PayrollShopCard = ({ state: "ready" } & PayrollCensusRead) | { state: "unavailable" };

export async function loadPayrollShopCard(sb: SupabaseClient, actor: PayrollActor, now = new Date()): Promise<PayrollShopCard> {
  if (!canManagePayrollShops(actor.role)) throw new PayrollShopError(403, "forbidden");
  try {
    return { state: "ready", ...await readPayrollCensus(sb, now) };
  } catch (e) {
    // 0340 not applied yet: the card says so, never a 500.
    if (PAYROLL_NOT_INSTALLED.has((e as { pgCode?: string }).pgCode ?? "")) return { state: "unavailable" };
    throw e;
  }
}

/** The writer's named refusals (0340). Longest names first: "labor_payroll_shop_invalid" prefixes two others. */
const REFUSALS: [string, number, PayrollShopErrorCode][] = [
  ["labor_payroll_shop_invalid_destination", 422, "invalid_destination"], ["labor_payroll_shop_unknown_account", 422, "unknown_account"],
  ["labor_payroll_shop_note_required", 422, "note_required"], ["labor_payroll_shop_invalid_date", 422, "invalid_date"],
  ["labor_payroll_shop_forbidden", 403, "forbidden"], ["labor_payroll_shop_moved", 409, "moved"], ["labor_payroll_shop_invalid", 400, "invalid"],
];

export async function savePayrollShop(sb: SupabaseClient, actor: PayrollActor, input: PayrollShopSave): Promise<{ id: string; seq: number }> {
  if (!canManagePayrollShops(actor.role)) throw new PayrollShopError(403, "forbidden");
  const { data, error } = await sb.rpc("save_labor_payroll_shop", {
    p_actor: actor.userId, p_account: input.account, p_location_id: input.locationId, p_disposition: input.disposition,
    p_valid_from: input.validFrom, p_note: input.note, p_expected_seq: input.expectedSeq,
  });
  if (error) {
    if (PAYROLL_NOT_INSTALLED.has(error.code ?? "")) throw new PayrollShopError(503, "unavailable");
    const hit = REFUSALS.find(([name]) => error.message.includes(name));
    if (hit) throw new PayrollShopError(hit[1], hit[2]);
    throw new PayrollShopError(500, "generic");
  }
  const r = (data ?? {}) as { id?: string; seq?: number | string };
  return { id: String(r.id), seq: Number(r.seq) };
}
