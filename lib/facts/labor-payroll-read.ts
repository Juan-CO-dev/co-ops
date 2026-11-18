/** Item 2, payroll shop: THE census read (every 7shifts account in the mirror, its current wage versions, live
 * links, payroll-shop rows, shops), over a client the CALLER passes in. No authorization lives here: the card's
 * loader (lib/facts/labor-payroll.ts, server-only) refuses anyone but the owner / CGS / MoO before calling it,
 * and the read-only reconciliation script (scripts/check-labor-payroll-allocation.ts) runs it with its own
 * script-local client. Never imports lib/supabase-server. Returns no wage amount: has-salary flags only. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { etCalendarDate } from "../operational-day";
import { toWageVersion, type WageVersion } from "./labor-wages-shared";
import { payrollCensus, payrollWeekOf, PAYROLL_ROSTER_ROLES, type PayrollCensus, type PayrollShopRow } from "./labor-payroll-shared";

export interface PayrollCensusRead {
  census: PayrollCensus; shops: { id: string; name: string; linked: boolean }[]; userNames: Record<string, string>;
}
/** A missing 0340 table / function (not applied yet). */
export const PAYROLL_NOT_INSTALLED = new Set(["42P01", "PGRST205", "42883", "PGRST202"]);

type Res<T> = { data: T[] | null; error: { code?: string; message: string } | null };
async function paged<T>(build: (from: number, to: number) => PromiseLike<Res<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw Object.assign(new Error("payroll_read_failed"), { pgCode: error.code });
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}
function chunks<T>(xs: readonly T[], n: number): T[][] {
  return Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
}
type UserRow = { id: string; name: string; role: string; active: boolean };

/** Every payroll-shop row (paged, in seq order). */
export async function readPayrollShopRows(sb: SupabaseClient): Promise<PayrollShopRow[]> {
  const rows = await paged<{ seq: number; sevenshifts_user_id: number | string; location_id: string | null; disposition: string; valid_from: string;
    note: string | null; created_by: string; created_at: string }>((a, b) => sb.from("labor_payroll_shops")
      .select("seq, sevenshifts_user_id, location_id, disposition, valid_from, note, created_by, created_at").order("seq").range(a, b));
  return rows.map((r) => ({ seq: Number(r.seq), sevenshifts_user_id: String(r.sevenshifts_user_id), location_id: r.location_id,
    disposition: r.disposition === "excluded" ? "excluded" : "shop", valid_from: String(r.valid_from).slice(0, 10),
    created_at: r.created_at, created_by: r.created_by, has_note: (r.note ?? "").trim() !== "" }));
}

export async function readPayrollCensus(sb: SupabaseClient, now = new Date()): Promise<PayrollCensusRead> {
  const payrollShops = await readPayrollShopRows(sb);
  const [locations, locLinks, accounts, links, rosterUsers] = await Promise.all([
    paged<{ id: string; name: string }>((a, b) => sb.from("locations").select("id, name").eq("active", true).order("name").range(a, b)),
    paged<{ location_id: string }>((a, b) => sb.from("sevenshifts_location_links").select("location_id").eq("active", true).order("location_id").range(a, b)),
    paged<{ id: number | string; first_name: string | null; last_name: string | null; preferred_first_name: string | null; employee_id: string | null; active: boolean }>(
      (a, b) => sb.from("sevenshifts_users").select("id, first_name, last_name, preferred_first_name, employee_id, active").order("id").range(a, b)),
    paged<{ sevenshifts_user_id: number | string; user_id: string; linked_at_location_id: string }>((a, b) => sb.from("sevenshifts_user_links")
      .select("sevenshifts_user_id, user_id, linked_at_location_id").eq("active", true).order("id").range(a, b)),
    paged<UserRow>((a, b) => sb.from("users").select("id, name, role, active").eq("active", true).in("role", [...PAYROLL_ROSTER_ROLES]).order("id").range(a, b)),
  ]);
  const accountIds = [...new Set([...accounts.map((a) => String(a.id)), ...payrollShops.map((r) => r.sevenshifts_user_id)])];
  const wages: WageVersion[] = [];
  for (const ids of chunks(accountIds, 100)) {
    const got = await paged<Record<string, unknown>>((a, b) => sb.rpc("fact_wage_current_versions", { p_user_ids: ids }).range(a, b));
    wages.push(...got.map(toWageVersion));
  }
  const known = new Set(rosterUsers.map((u) => u.id));
  const wanted = [...new Set([...links.map((l) => l.user_id), ...payrollShops.map((r) => r.created_by ?? "")])].filter((id) => id && !known.has(id));
  const others: UserRow[] = [];
  for (const ids of chunks(wanted, 50)) {
    others.push(...await paged<UserRow>((a, b) => sb.from("users").select("id, name, role, active").in("id", ids).order("id").range(a, b)));
  }
  const users = [...rosterUsers, ...others];
  const stored = new Set(locLinks.map((l) => l.location_id));
  const census = payrollCensus({
    weekStart: payrollWeekOf(etCalendarDate(now.toISOString())), storedShops: [...stored],
    accounts: accounts.map((a) => ({ ...a, id: String(a.id) })), wages,
    links: links.map((l) => ({ ...l, sevenshifts_user_id: String(l.sevenshifts_user_id) })), users, payrollShops,
  });
  return { census, shops: locations.map((l) => ({ id: l.id, name: l.name, linked: stored.has(l.id) })),
    userNames: Object.fromEntries(users.map((u) => [u.id, u.name])) };
}
