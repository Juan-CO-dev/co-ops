import "server-only";
/** Board two labor views PR 2: the server side of the "Burden (taxes and benefits)" card on /admin/sevenshifts.
 * Both entry points refuse anyone but the owner / CGS / MoO by TRUSTED ROLE before any I/O. The loader reads the
 * setting's rows (service role holds SELECT only) and returns the card view; the save goes only through 0346's
 * save_labor_burden, which re-checks the role on the locked users row, the Sunday start, the expected head under
 * the scope's lock, and writes its own destructive labor_burden.save audit row in the same transaction (so this
 * module never calls audit(): there is no way to change the burden without that row). Sends nothing. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleCode } from "@/lib/roles";
import { etCalendarDate } from "@/lib/operational-day";
import { burdenCardView, canManageLaborBurden, type BurdenCardView, type BurdenRow, type BurdenSave, type LaborBurdenErrorCode } from "./labor-burden-shared";
import { payrollWeekOf } from "./labor-payroll-shared";

export class LaborBurdenError extends Error {
  constructor(public status: number, public code: LaborBurdenErrorCode) { super(code); }
}
export interface BurdenActor { userId: string; role: RoleCode }
export type LaborBurdenCard = ({ state: "ready"; userNames: Record<string, string> } & BurdenCardView) | { state: "unavailable" };

/** 0338's table or 0346's column / function is missing (not applied yet): the card says so, never a 500. */
const NOT_INSTALLED = new Set(["42P01", "PGRST205", "42703", "PGRST204", "42883", "PGRST202"]);
type Res<T> = { data: T[] | null; error: { code?: string; message: string } | null };
async function paged<T>(build: (from: number, to: number) => PromiseLike<Res<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw Object.assign(new Error("burden_read_failed"), { pgCode: error.code });
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}
interface RawRow {
  id: string; location_id: string | null; burden_pct: number | string | null; source: string | null; valid_from: string; follows_company: boolean;
  note: string | null; created_by: string | null; created_at: string;
}

export async function loadLaborBurdenCard(sb: SupabaseClient, actor: BurdenActor, now = new Date()): Promise<LaborBurdenCard> {
  if (!canManageLaborBurden(actor.role)) throw new LaborBurdenError(403, "forbidden");
  try {
    const [raw, shops] = await Promise.all([
      paged<RawRow>((a, b) => sb.from("labor_burden_settings")
        .select("id, location_id, burden_pct, source, valid_from, follows_company, note, created_by, created_at").order("created_at").order("id").range(a, b)),
      paged<{ id: string; name: string }>((a, b) => sb.from("locations").select("id, name").eq("active", true).order("name").range(a, b)),
    ]);
    const rows: BurdenRow[] = raw.map((r) => ({ id: r.id, location_id: r.location_id, burden_pct: r.burden_pct === null ? null : Number(r.burden_pct),
      source: r.source === "payroll" ? "payroll" : r.source === "estimated" ? "estimated" : null, valid_from: String(r.valid_from).slice(0, 10),
      follows_company: r.follows_company === true, created_at: r.created_at, created_by: r.created_by, has_note: (r.note ?? "").trim() !== "" }));
    const authors = [...new Set(rows.map((r) => r.created_by).filter((id): id is string => !!id))];
    const users: { id: string; name: string }[] = [];
    for (let i = 0; i < authors.length; i += 50) {
      const ids = authors.slice(i, i + 50);
      users.push(...await paged<{ id: string; name: string }>((a, b) => sb.from("users").select("id, name").in("id", ids).order("id").range(a, b)));
    }
    return { state: "ready", ...burdenCardView(rows, shops, payrollWeekOf(etCalendarDate(now.toISOString()))),
      userNames: Object.fromEntries(users.map((u) => [u.id, u.name])) };
  } catch (e) {
    if (NOT_INSTALLED.has((e as { pgCode?: string }).pgCode ?? "")) return { state: "unavailable" };
    throw e;
  }
}

/** The writer's named refusals (0346). Longest names first: "labor_burden_invalid" prefixes "labor_burden_invalid_date". */
const REFUSALS: [string, number, LaborBurdenErrorCode][] = [
  ["labor_burden_already_following", 409, "already_following"], ["labor_burden_invalid_date", 422, "invalid_date"],
  ["labor_burden_forbidden", 403, "forbidden"], ["labor_burden_moved", 409, "moved"], ["labor_burden_invalid", 400, "invalid"],
];

export async function saveLaborBurden(sb: SupabaseClient, actor: BurdenActor, input: BurdenSave): Promise<{ id: string }> {
  if (!canManageLaborBurden(actor.role)) throw new LaborBurdenError(403, "forbidden");
  const { data, error } = await sb.rpc("save_labor_burden", {
    p_actor: actor.userId, p_location_id: input.locationId, p_follow_company: input.followCompany, p_burden_pct: input.burdenPct,
    p_valid_from: input.validFrom, p_source: input.source, p_note: input.note, p_expected_id: input.expectedId,
  });
  if (error) {
    if (NOT_INSTALLED.has(error.code ?? "")) throw new LaborBurdenError(503, "unavailable");
    const hit = REFUSALS.find(([name]) => error.message.includes(name));
    if (hit) throw new LaborBurdenError(hit[1], hit[2]);
    throw new LaborBurdenError(500, "generic");
  }
  return { id: String(data) };
}
