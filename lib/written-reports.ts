/**
 * lib/written-reports.ts — the SERVER data layer for Written Reports.
 *
 * Written Reports are free-text staff posts ("shift happened, something went
 * wrong, write it down"). The schema + all four RLS policies already exist
 * (pre-0044 provisioning; visibility renumbered in 0058) — this module is the
 * read/write layer over that schema.
 *
 * AUTHORIZATION MODEL (AGENTS.md — service-role + app-layer authz):
 * these loaders use the service-role client (RLS-bypassing), so every visibility
 * gate is reproduced HERE in app code, matching the live RLS predicates:
 *   READ   : level >= visibility_min_level
 *            AND (location_id IS NULL OR location_id ∈ my locations OR level >= 9)
 *   INSERT : submitted_by = me AND level >= 3
 *   UPDATE : submitted_by = me AND submitted_at > now() - 3h   (self-edit window)
 *   DELETE : false (append-only — never)
 *
 * The pure surface (categories, limits, draft validation) lives in
 * `written-reports-shared.ts` and is re-exported below so server consumers keep
 * a single import path.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLES, type RoleCode } from "@/lib/roles";
import type { WrittenReport } from "@/lib/types";
import {
  WRITTEN_REPORT_WRITE_MIN_LEVEL,
  isWithinEditWindow,
  type WrittenReportDraft,
} from "@/lib/written-reports-shared";

// Re-export the client-safe surface so server callers import from one place.
export * from "@/lib/written-reports-shared";

const ALL_LOCATIONS_READ_LEVEL = 9;

/** The DB row shape (snake_case). */
interface WrittenReportRow {
  id: string;
  location_id: string | null;
  submitted_by: string;
  submitted_by_role: string;
  submitted_at: string | null;
  last_edited_at: string | null;
  edit_count: number | null;
  category: string | null;
  title: string | null;
  body: string;
  visibility_min_level: number;
  related_table: string | null;
  related_id: string | null;
}

function mapRow(r: WrittenReportRow): WrittenReport {
  return {
    id: r.id,
    locationId: r.location_id,
    submittedBy: r.submitted_by,
    submittedByRole: r.submitted_by_role as RoleCode,
    submittedAt: r.submitted_at ?? "",
    lastEditedAt: r.last_edited_at,
    editCount: r.edit_count ?? 0,
    category: r.category,
    title: r.title,
    body: r.body,
    visibilityMinLevel: r.visibility_min_level,
    relatedTable: r.related_table,
    relatedId: r.related_id,
  };
}

const ROW_COLS =
  "id, location_id, submitted_by, submitted_by_role, submitted_at, last_edited_at, edit_count, category, title, body, visibility_min_level, related_table, related_id";

export interface WrittenReportViewer {
  userId: string;
  level: number;
  /** The viewer's authorized location ids, or "all" for level >= 9. */
  locations: string[] | "all";
}

/** A list item enriched with the resolved author name (never PII beyond name). */
export interface WrittenReportListItem extends WrittenReport {
  submittedByName: string | null;
  /** True when THIS viewer authored it and the edit window is still open. */
  canEdit: boolean;
}

/**
 * List written reports the viewer may see, newest first.
 *
 * Visibility is enforced in app code (service-role bypasses RLS): a report is
 * visible iff `viewer.level >= visibility_min_level` AND the location is either
 * null (all-location), one of the viewer's, or the viewer is level >= 9.
 *
 * `now` is injected for a deterministic canEdit computation (defaults to the
 * request clock).
 */
export async function listWrittenReports(
  service: SupabaseClient,
  args: { viewer: WrittenReportViewer; limit?: number; now?: Date },
): Promise<WrittenReportListItem[]> {
  const { viewer } = args;
  const now = args.now ?? new Date();
  const limit = args.limit ?? 200;

  // Base query: visibility floor gate. Location gate is applied below so the
  // "location IS NULL OR mine OR level>=9" three-way OR is expressed exactly.
  let q = service
    .from("written_reports")
    .select(ROW_COLS)
    .lte("visibility_min_level", viewer.level)
    .order("submitted_at", { ascending: false })
    .limit(limit);

  // Location scope: level >= 9 sees all; otherwise null-location OR one of mine.
  if (viewer.level < ALL_LOCATIONS_READ_LEVEL && viewer.locations !== "all") {
    const locs = viewer.locations;
    if (locs.length === 0) {
      // No authorized locations → only all-location (null) reports are visible.
      q = q.is("location_id", null);
    } else {
      const inList = locs.join(",");
      q = q.or(`location_id.is.null,location_id.in.(${inList})`);
    }
  }

  const { data, error } = await q;
  if (error) throw new Error(`listWrittenReports failed: ${error.message}`);
  const rows = (data ?? []) as WrittenReportRow[];

  // Resolve author names (batch).
  const authorIds = [...new Set(rows.map((r) => r.submitted_by))];
  const nameById = new Map<string, string>();
  if (authorIds.length) {
    const { data: users } = await service.from("users").select("id, name").in("id", authorIds);
    for (const u of (users ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(u.id, u.name);
    }
  }

  return rows.map((r) => {
    const rep = mapRow(r);
    return {
      ...rep,
      submittedByName: nameById.get(r.submitted_by) ?? null,
      canEdit:
        r.submitted_by === viewer.userId &&
        r.submitted_at != null &&
        isWithinEditWindow(r.submitted_at, now),
    };
  });
}

/**
 * Load one report by id, applying the SAME visibility gate as the list. Returns
 * null when the report doesn't exist OR the viewer may not see it (no distinct
 * 403 vs 404 — a hidden report and a missing one are indistinguishable to the
 * caller, which is the correct posture for a role-gated read).
 */
export async function loadWrittenReport(
  service: SupabaseClient,
  args: { viewer: WrittenReportViewer; id: string; now?: Date },
): Promise<WrittenReportListItem | null> {
  const { viewer } = args;
  const now = args.now ?? new Date();

  const { data } = await service
    .from("written_reports")
    .select(ROW_COLS)
    .eq("id", args.id)
    .maybeSingle<WrittenReportRow>();
  if (!data) return null;

  // Visibility floor.
  if (viewer.level < data.visibility_min_level) return null;
  // Location gate: null OR mine OR level>=9.
  if (data.location_id !== null && viewer.level < ALL_LOCATIONS_READ_LEVEL) {
    const locs = viewer.locations;
    const allowed = locs === "all" || locs.includes(data.location_id);
    if (!allowed) return null;
  }

  const rep = mapRow(data);
  let submittedByName: string | null = null;
  const { data: u } = await service
    .from("users")
    .select("name")
    .eq("id", data.submitted_by)
    .maybeSingle<{ name: string }>();
  submittedByName = u?.name ?? null;

  return {
    ...rep,
    submittedByName,
    canEdit:
      data.submitted_by === viewer.userId &&
      data.submitted_at != null &&
      isWithinEditWindow(data.submitted_at, now),
  };
}

export interface CreateWrittenReportArgs {
  /** The author. INSERT RLS requires submitted_by = current_user_id(). */
  authorId: string;
  authorRole: RoleCode;
  /** The location this report is scoped to; null = all-location post. */
  locationId: string | null;
  draft: WrittenReportDraft;
}

/**
 * Create a written report. Uses an AUTHED client (the caller passes one built
 * from the actor's JWT) so the INSERT RLS policy (submitted_by = me AND
 * level >= 3) is the real authority; this fn just shapes the row and checks the
 * returned id (INSERT denials raise 42501, surfaced as an error).
 *
 * The author's level floor (>= 3) is also asserted app-side for a clean early
 * error before the round-trip.
 */
export async function createWrittenReport(
  authed: SupabaseClient,
  args: CreateWrittenReportArgs,
): Promise<{ id: string }> {
  const level = ROLES[args.authorRole].level;
  if (level < WRITTEN_REPORT_WRITE_MIN_LEVEL) {
    throw new Error("forbidden: level below write floor");
  }

  const { data, error } = await authed
    .from("written_reports")
    .insert({
      location_id: args.locationId,
      submitted_by: args.authorId,
      submitted_by_role: args.authorRole,
      title: args.draft.title,
      body: args.draft.body,
      category: args.draft.category,
      visibility_min_level: args.draft.visibilityMinLevel,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw new Error(`createWrittenReport failed: ${error.message}`);
  return { id: data.id };
}

export interface UpdateWrittenReportArgs {
  id: string;
  /** Editable fields (append-only spirit: correction inside the 3h window). */
  draft: WrittenReportDraft;
}

/**
 * Self-edit a report inside the 3-hour window. Uses an AUTHED client so the
 * UPDATE RLS policy (submitted_by = me AND submitted_at > now()-3h) is the
 * authority. Per AGENTS.md silent-UPDATE-denial law, we check the returned
 * rowcount and treat 0 as a denial (window closed / not the author).
 * Bumps edit_count + stamps last_edited_at.
 */
export async function updateWrittenReport(
  authed: SupabaseClient,
  args: UpdateWrittenReportArgs,
): Promise<{ ok: boolean; denied?: boolean }> {
  // Read the current edit_count so we can bump it (append-only history spirit;
  // the RLS window gate still guards whether the UPDATE lands at all).
  const { data: current } = await authed
    .from("written_reports")
    .select("edit_count")
    .eq("id", args.id)
    .maybeSingle<{ edit_count: number | null }>();
  const nextCount = (current?.edit_count ?? 0) + 1;

  const { data: updatedRows, error } = await authed
    .from("written_reports")
    .update({
      title: args.draft.title,
      body: args.draft.body,
      category: args.draft.category,
      visibility_min_level: args.draft.visibilityMinLevel,
      last_edited_at: new Date().toISOString(),
      edit_count: nextCount,
    })
    .eq("id", args.id)
    .select("id");

  if (error) throw new Error(`updateWrittenReport failed: ${error.message}`);
  // Silent-denial law: 0 rows = RLS denied (window closed or not author).
  if (!updatedRows || updatedRows.length === 0) return { ok: false, denied: true };
  return { ok: true };
}
