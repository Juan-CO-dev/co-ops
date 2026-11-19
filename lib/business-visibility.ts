import "server-only";
/** Business report access (Juan 2026-11-19): the server side of the "Business report: what GMs can see" card on
 * /admin/sevenshifts. Both entry points refuse anyone but the owner / CGS / MoO by TRUSTED ROLE before any I/O.
 * The loader reads the newest row of 0349 business_report_gm_visibility (service role holds SELECT only) and who
 * saved it; the save goes only through 0349's save_business_report_gm_visibility, which re-checks the role on the
 * locked users row, the settings' shape, the expected head under its lock, and writes its own destructive
 * business_report_visibility.save audit row in the same transaction (so this module never calls audit(): there is
 * no way to change what GMs see without that row). Sends nothing.
 *
 * The report's own reader of this table is lib/business-report.ts `resolveBusinessAccess` (fail closed, for a GM's
 * load); this module is the settings card only and is never on a report's path. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleCode } from "@/lib/roles";
import {
  GM_VISIBILITY_DEFAULTS, canManageBusinessVisibility, parseGmVisibility, type BusinessVisibilityErrorCode, type GmVisibility, type GmVisibilitySave,
} from "@/lib/business-access-shared";

export class BusinessVisibilityError extends Error {
  constructor(public status: number, public code: BusinessVisibilityErrorCode) { super(code); }
}
export interface VisibilityActor { userId: string; role: RoleCode }
export type BusinessVisibilityCard =
  | { state: "ready"; settings: GmVisibility; /** the newest row (null = never saved: the defaults are in force) */ headId: string | null;
      savedBy: string | null; savedAt: string | null }
  | { state: "unavailable" };

/** 0349's table or function is missing (not applied yet): the card says so, never a 500. */
const NOT_INSTALLED = new Set(["42P01", "PGRST205", "42883", "PGRST202"]);

export async function loadBusinessVisibilityCard(sb: SupabaseClient, actor: VisibilityActor): Promise<BusinessVisibilityCard> {
  if (!canManageBusinessVisibility(actor.role)) throw new BusinessVisibilityError(403, "forbidden");
  const { data, error } = await sb.from("business_report_gm_visibility").select("id, settings, created_by, created_at").order("seq", { ascending: false }).limit(1);
  if (error) {
    if (NOT_INSTALLED.has(error.code ?? "")) return { state: "unavailable" };
    throw new Error("business_visibility_read_failed");
  }
  const row = (data ?? [])[0] as { id: string; settings: unknown; created_by: string | null; created_at: string } | undefined;
  if (!row) return { state: "ready", settings: { ...GM_VISIBILITY_DEFAULTS }, headId: null, savedBy: null, savedAt: null };
  const settings = parseGmVisibility(row.settings);
  // The table's CHECK makes this unreachable; a row that is not the exact nine is not shown as if it were settings
  // (and a GM's report is refused while it stands: lib/business-report.ts).
  if (!settings) return { state: "unavailable" };
  let savedBy: string | null = null;
  if (row.created_by) {
    const who = await sb.from("users").select("id, name").eq("id", row.created_by).limit(1);
    savedBy = who.error ? null : ((who.data ?? [])[0] as { name?: string } | undefined)?.name ?? null;
  }
  return { state: "ready", settings, headId: row.id, savedBy, savedAt: row.created_at };
}

/** The writer's named refusals (0349). */
const REFUSALS: [string, number, BusinessVisibilityErrorCode][] = [
  ["business_visibility_forbidden", 403, "forbidden"], ["business_visibility_invalid", 400, "invalid"],
  ["business_visibility_moved", 409, "moved"], ["business_visibility_unchanged", 409, "unchanged"],
];

export async function saveBusinessVisibility(sb: SupabaseClient, actor: VisibilityActor, input: GmVisibilitySave): Promise<{ id: string }> {
  if (!canManageBusinessVisibility(actor.role)) throw new BusinessVisibilityError(403, "forbidden");
  const { data, error } = await sb.rpc("save_business_report_gm_visibility", { p_actor: actor.userId, p_settings: input.settings, p_expected_id: input.expectedId });
  if (error) {
    if (NOT_INSTALLED.has(error.code ?? "")) throw new BusinessVisibilityError(503, "unavailable");
    const hit = REFUSALS.find(([name]) => error.message.includes(name));
    if (hit) throw new BusinessVisibilityError(hit[1], hit[2]);
    throw new BusinessVisibilityError(500, "generic");
  }
  return { id: String(data) };
}
