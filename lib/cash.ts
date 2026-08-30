import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { RoleCode } from "@/lib/roles";
import { applyEffectiveResolution, type EffectiveResolvableBuilder } from "@/lib/admin/template-builder-shared";

import {
  CASH_REPORT_BASE_LEVEL,
  DEFAULT_FLOAT_CENTS,
  DENOMINATION_UNITS_CENTS,
  computeCashTotals,
  sumDenominations,
  type Denominations,
  type OnShiftEntry,
  type CashTotals,
} from "@/lib/cash-shared";

// Client-safe money math lives in lib/cash-shared.ts (see its header for why);
// re-exported here so existing server consumers keep their import paths.
export {
  CASH_REPORT_BASE_LEVEL,
  DEFAULT_FLOAT_CENTS,
  DENOMINATION_UNITS_CENTS,
  computeCashTotals,
  sumDenominations,
  type Denominations,
  type OnShiftEntry,
  type CashTotals,
};

export interface CashActor { userId: string; role: RoleCode; level: number }

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
  // Edit-window gate: refuse if today's closing is confirmed. PR-3 date-aware
  // resolution — resolve the closing version effective on args.date (the instance
  // lookup keys on that date).
  const cTmplBase = service.from("checklist_templates").select("id")
    .eq("location_id", args.locationId).eq("type", "closing") as unknown as EffectiveResolvableBuilder;
  const { data: cTmpl } = await applyEffectiveResolution(cTmplBase, args.date).maybeSingle<{ id: string }>();
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
    // BUG 4 fix: surface the supersede error (the insert has a partial-unique
    // backstop, so this is diagnostic clarity — match the file's discipline).
    const { error: supersedeErr } = await service
      .from("cash_reports").update({ superseded_at: nowIso }).eq("id", prior.id);
    if (supersedeErr) throw new Error(`submitCashReport: supersede: ${supersedeErr.message}`);
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
      // The rollback lifts OUR OWN stamp and nobody else's. Two simultaneous
      // submits both read this same prior row and both supersede it; the loser's
      // insert then loses to `cash_reports_one_live_per_day`, and an unfiltered
      // rollback would be asking that same index for a SECOND live row — which it
      // refuses. Matching on the stamp we wrote makes the no-op explicit instead
      // of leaving the index to refuse it, and `count` makes the silent UPDATE 0
      // (someone re-stamped the row) visible per the house rowcount law.
      const { error: rollbackErr, count: rolledBack } = await service
        .from("cash_reports")
        .update({ superseded_at: null }, { count: "exact" })
        .eq("id", prior.id)
        .eq("superseded_at", nowIso);

      if (rollbackErr || (rolledBack ?? 0) === 0) {
        // A FAILED ROLLBACK IS NOT PROOF OF A STRAND (wiring audit, 2026-08-29).
        // In the concurrent case above the refusal is the index doing its job and
        // the day is fine; in the single-writer case the prior row is now
        // superseded with no live successor, and every read surface
        // (loadCashReport, reports hub, dashboard) filters `superseded_at IS
        // NULL`, so the location silently reads as having filed no cash report.
        // The two are indistinguishable from the rollback's error alone, so ask
        // the question that actually decides it.
        const { data: liveNow } = await service
          .from("cash_reports").select("id")
          .eq("location_id", args.locationId).eq("report_date", args.date)
          .is("superseded_at", null)
          .maybeSingle<{ id: string }>();

        if (liveNow) {
          console.warn(
            `[cash] submitCashReport rollback refused for prior ${prior.id} — a live report (${liveNow.id}) already covers ${args.locationId}/${args.date}; a concurrent submit won and nothing is stranded.`,
          );
        } else {
          // Forensic row, not just a log line: a strand is invisible on every
          // read surface, so the evidence has to live somewhere queryable. The
          // action is the one this write already speaks (`cash_report.supersede`,
          // closed vocabulary); the outcome names the failure. Awaited because we
          // throw on the next line — `audit()` is fail-open and never throws.
          console.error(
            `[cash] submitCashReport STRANDED prior ${prior.id}: the supersede rolled back neither cleanly (${rollbackErr?.message ?? "0 rows matched"}) nor into a live successor — ${args.locationId}/${args.date} now reads as having no cash report until someone resubmits.`,
          );
          await audit({
            actorId: args.actor.userId, actorRole: args.actor.role,
            action: "cash_report.supersede",
            resourceTable: "cash_reports", resourceId: prior.id,
            metadata: {
              outcome: "supersede_strand",
              location_id: args.locationId,
              report_date: args.date,
              insert_error: insErr.message,
              rollback_error: rollbackErr?.message ?? null,
              rollback_rows: rolledBack ?? null,
            },
            ipAddress: null, userAgent: null,
          });
        }
      }
    }
    throw new Error(`submitCashReport: insert: ${insErr.message}`);
  }

  // Now fill in the back-pointer on the prior row.
  if (prior) {
    // BUG 4 fix: log a failed back-pointer write (non-fatal — the insert already
    // succeeded and the supersede already committed; the chain link is forensic).
    const { error: backPtrErr } = await service
      .from("cash_reports").update({ superseded_by: inserted.id }).eq("id", prior.id);
    if (backPtrErr) {
      console.error(
        `[cash] submitCashReport back-pointer write failed for prior ${prior.id}: ${backPtrErr.message}`,
      );
    }
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
