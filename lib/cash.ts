import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { RoleCode } from "@/lib/roles";

/** KH+ — matches the closing-finalize gate (the closer deposits). */
export const CASH_REPORT_BASE_LEVEL = 4;
/** $200 float kept in the register. */
export const DEFAULT_FLOAT_CENTS = 20000;

/** US denomination units in cents, largest first (bills then coins). */
export const DENOMINATION_UNITS_CENTS = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1] as const;

/** unit_cents (as string key) → quantity. */
export type Denominations = Record<string, number>;
export interface OnShiftEntry { userId: string | null; name: string }
export interface CashActor { userId: string; role: RoleCode; level: number }

export interface CashTotals { overShortCents: number; depositCents: number }

/**
 * The one money rule. deposit = drawer − float; over/short = deposit − projected
 * (negative = short, positive = over). Pure + total; the server recomputes with
 * this at write time and never trusts client-sent totals.
 */
export function computeCashTotals(input: {
  projectedCents: number;
  drawerTotalCents: number;
  floatCents: number;
}): CashTotals {
  const depositCents = input.drawerTotalCents - input.floatCents; // actual deposit (drawer minus float)
  const overShortCents = depositCents - input.projectedCents;     // over/short = actual − projected
  return { overShortCents, depositCents };
}

/** Sum a denomination map to cents. Ignores non-positive / unknown-unit entries. */
export function sumDenominations(denoms: Denominations): number {
  let total = 0;
  for (const unit of DENOMINATION_UNITS_CENTS) {
    const qty = denoms[String(unit)];
    if (typeof qty === "number" && Number.isFinite(qty) && qty > 0) {
      total += unit * Math.floor(qty);
    }
  }
  return total;
}

export interface CashReport {
  id: string;
  locationId: string;
  reportDate: string;
  projectedCents: number;
  drawerTotalCents: number;
  floatCents: number;
  countMethod: "hand" | "denomination";
  denominations: Denominations | null;
  cashTipsCents: number;
  onShift: OnShiftEntry[];
  overShortCents: number;
  depositCents: number;
  overShortNote: string | null;
  signedBy: string;
  signedByName: string | null; // resolved by loader
  signedAt: string;
  createdAt: string;
}

const ROW = "id, location_id, report_date, projected_cents, drawer_total_cents, float_cents, count_method, denominations, cash_tips_cents, on_shift, over_short_cents, deposit_cents, over_short_note, signed_by, signed_at, created_at";

function rowToCashReport(r: Record<string, unknown>, signedByName: string | null): CashReport {
  return {
    id: r.id as string, locationId: r.location_id as string, reportDate: r.report_date as string,
    projectedCents: r.projected_cents as number, drawerTotalCents: r.drawer_total_cents as number,
    floatCents: r.float_cents as number, countMethod: r.count_method as "hand" | "denomination",
    denominations: (r.denominations as Denominations | null) ?? null, cashTipsCents: r.cash_tips_cents as number,
    onShift: (r.on_shift as OnShiftEntry[]) ?? [], overShortCents: r.over_short_cents as number,
    depositCents: r.deposit_cents as number, overShortNote: (r.over_short_note as string | null) ?? null,
    signedBy: r.signed_by as string, signedByName, signedAt: r.signed_at as string, createdAt: r.created_at as string,
  };
}

/** The live cash report for a location/day, or null. */
export async function loadCashReport(
  service: SupabaseClient, args: { locationId: string; date: string },
): Promise<CashReport | null> {
  const { data, error } = await service.from("cash_reports").select(ROW)
    .eq("location_id", args.locationId).eq("report_date", args.date).is("superseded_at", null)
    .maybeSingle<Record<string, unknown>>();
  if (error) throw new Error(`loadCashReport: ${error.message}`);
  if (!data) return null;
  let name: string | null = null;
  if (data.signed_by) {
    const { data: u } = await service.from("users").select("name").eq("id", data.signed_by as string).maybeSingle<{ name: string }>();
    name = u?.name ?? null;
  }
  return rowToCashReport(data, name);
}

export interface CashDashboardState { isVisibleToActor: boolean; report: CashReport | null }

export async function loadCashDashboardState(
  service: SupabaseClient, args: { locationId: string; date: string; actor: CashActor },
): Promise<CashDashboardState> {
  if (args.actor.level < CASH_REPORT_BASE_LEVEL) return { isVisibleToActor: false, report: null };
  return { isVisibleToActor: true, report: await loadCashReport(service, args) };
}

export type CashSubmitResult =
  | { ok: true; id: string }
  | { ok: false; reason: "closing_finalized" };

/**
 * Append-only signed write. Recomputes totals server-side (never trusts the
 * client). Supersedes the prior live row (edit). Refuses if today's closing is
 * already finalized (edit window closed). PIN already verified by the route;
 * signedBy is the authenticated actor.
 */
export async function submitCashReport(
  service: SupabaseClient,
  args: {
    locationId: string; date: string; actor: CashActor;
    projectedCents: number; drawerTotalCents: number; floatCents: number;
    countMethod: "hand" | "denomination"; denominations: Denominations | null;
    cashTipsCents: number; onShift: OnShiftEntry[]; overShortNote: string | null;
  },
): Promise<CashSubmitResult> {
  // Edit-window gate: refuse if today's closing is confirmed.
  const { data: cTmpl } = await service.from("checklist_templates").select("id")
    .eq("location_id", args.locationId).eq("type", "closing").eq("active", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  if (cTmpl) {
    const { data: cInst } = await service.from("checklist_instances").select("status")
      .eq("template_id", cTmpl.id).eq("location_id", args.locationId).eq("date", args.date)
      .maybeSingle<{ status: string }>();
    if (cInst && (cInst.status === "confirmed" || cInst.status === "incomplete_confirmed")) {
      return { ok: false, reason: "closing_finalized" };
    }
  }

  const { overShortCents, depositCents } = computeCashTotals({
    projectedCents: args.projectedCents,
    drawerTotalCents: args.drawerTotalCents,
    floatCents: args.floatCents,
  });
  const nowIso = new Date().toISOString();

  const { data: prior } = await service.from("cash_reports").select("id")
    .eq("location_id", args.locationId).eq("report_date", args.date).is("superseded_at", null)
    .maybeSingle<{ id: string }>();

  // Supersede BEFORE insert: the partial unique index (superseded_at IS NULL)
  // enforces one live row per (location_id, report_date). We must clear the
  // prior row's null superseded_at before the new row can satisfy the index.
  // We temporarily write a sentinel superseded_at; after insert we overwrite
  // with the canonical (nowIso, new row id) pair.
  if (prior) {
    await service.from("cash_reports").update({ superseded_at: nowIso }).eq("id", prior.id);
  }

  const { data: inserted, error: insErr } = await service.from("cash_reports").insert({
    location_id: args.locationId, report_date: args.date,
    projected_cents: args.projectedCents, drawer_total_cents: args.drawerTotalCents,
    float_cents: args.floatCents, count_method: args.countMethod,
    denominations: args.countMethod === "denomination" ? args.denominations : null,
    cash_tips_cents: args.cashTipsCents, on_shift: args.onShift,
    over_short_cents: overShortCents, deposit_cents: depositCents,
    over_short_note: args.overShortNote, signed_by: args.actor.userId, signed_at: nowIso,
    entered_by: args.actor.userId,
  }).select("id").single<{ id: string }>();
  if (insErr) {
    // Attempt to undo the supersede so the prior row remains live.
    if (prior) {
      await service.from("cash_reports").update({ superseded_at: null }).eq("id", prior.id);
    }
    throw new Error(`submitCashReport: insert: ${insErr.message}`);
  }

  // Now fill in the back-pointer on the prior row.
  if (prior) {
    await service.from("cash_reports").update({ superseded_by: inserted.id }).eq("id", prior.id);
  }

  void audit({
    actorId: args.actor.userId, actorRole: args.actor.role,
    action: prior ? "cash_report.supersede" : "cash_report.submit",
    resourceTable: "cash_reports", resourceId: inserted.id,
    metadata: { over_short_cents: overShortCents, deposit_cents: depositCents, superseded: prior?.id ?? null },
    ipAddress: null, userAgent: null,
  });
  return { ok: true, id: inserted.id };
}
