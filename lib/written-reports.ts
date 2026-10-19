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
 * gate is reproduced HERE in app code, aligned with the report read policies authored in migration 0217:
 *   READ   : level >= visibility_min_level
 *            AND (location_id IS NULL OR location_id ∈ my locations OR level >= 8)
 *   INSERT : submitted_by = me AND level >= 3
 *   UPDATE : author + strict 3h window + active actor + current visibility/location
 *            (0276 SQL predicate; location membership must be active under R8)
 *   DELETE : false (append-only — never)
 *
 * The pure surface (categories, limits, draft validation) lives in
 * `written-reports-shared.ts` and is re-exported below so server consumers keep
 * a single import path.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { type RoleCode } from "@/lib/roles";
import { ChecklistActorNotAuthorizedError, type ChecklistWriteActor } from "@/lib/checklist-write-actor";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { WrittenReport } from "@/lib/types";
import { parseReportRange, reportTimestampBounds } from "@/lib/report-range";
import { etCalendarDate } from "@/lib/operational-day";
import {
  WRITTEN_REPORT_WRITE_MIN_LEVEL,
  isWithinEditWindow,
  type WrittenReportDraft,
} from "@/lib/written-reports-shared";

// Re-export the client-safe surface so server callers import from one place.
export * from "@/lib/written-reports-shared";

const ALL_LOCATIONS_READ_LEVEL = REPORT_ALL_LOCATIONS_LEVEL;

/** Juan's pending product choice is intentionally isolated to this switch. */
export const EMPLOYEE_WRITTEN_REPORTS_OWN_ONLY = false;
export const WRITTEN_REPORTS_PAGE_SIZE = 50;

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
  /** The viewer's authorized location ids, or "all" for level >= 8. */
  locations: string[] | "all";
}

/** A list item enriched with the resolved author name (never PII beyond name). */
export interface WrittenReportListItem extends WrittenReport {
  submittedByName: string | null;
  /** True when THIS viewer authored it and the edit window is still open. */
  canEdit: boolean;
}

export interface WrittenReportCursor {
  submittedAt: string;
  id: string;
  context: string;
}

export interface WrittenReportPage {
  reports: WrittenReportListItem[];
  nextCursor: string | null;
}

function encodeCursor(cursor: WrittenReportCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function parseWrittenReportCursor(raw: string | undefined): WrittenReportCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<WrittenReportCursor>;
    if (
      typeof value.submittedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.submittedAt) ||
      Number.isNaN(Date.parse(value.submittedAt)) ||
      typeof value.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ||
      typeof value.context !== "string"
    ) return null;
    return { submittedAt: value.submittedAt.replace(/\+00:00$/, "Z"), id: value.id, context: value.context };
  } catch {
    return null;
  }
}

/**
 * List written reports the viewer may see, newest first.
 *
 * Visibility is enforced in app code (service-role bypasses RLS): a report is
 * visible iff the viewer authored it or meets `visibility_min_level`, AND the location is either
 * null (all-location), one of the viewer's, or the viewer is level >= 8.
 *
 * `now` is injected for a deterministic canEdit computation (defaults to the
 * request clock).
 */
export async function listWrittenReports(
  service: SupabaseClient,
  args: {
    viewer: WrittenReportViewer;
    from?: string;
    to?: string;
    locationId?: string;
    cursor?: string;
    pageSize?: number;
    now?: Date;
  },
): Promise<WrittenReportPage> {
  const { viewer } = args;
  if (viewer.level < 2) throw new Error("written_report_scope_forbidden");
  const now = args.now ?? new Date();
  const pageSize = Math.min(Math.max(args.pageSize ?? WRITTEN_REPORTS_PAGE_SIZE, 1), WRITTEN_REPORTS_PAGE_SIZE);
  const today = etCalendarDate(now.toISOString());
  const range = parseReportRange(
    args.from || args.to ? { range: "custom", from: args.from, to: args.to } : {},
    today,
  );
  const cursorContext = JSON.stringify({
    from: range.from,
    to: range.to,
    userId: viewer.userId,
    level: viewer.level,
    locations: viewer.locations === "all" ? "all" : [...viewer.locations].sort(),
    ownOnly: EMPLOYEE_WRITTEN_REPORTS_OWN_ONLY,
    locationId: args.locationId ?? null,
  });
  const parsedCursor = parseWrittenReportCursor(args.cursor);
  const cursor = parsedCursor?.context === cursorContext ? parsedCursor : null;

  // Base query: visibility floor gate. Location gate is applied below so the
  // "location IS NULL OR mine OR level>=8" three-way OR is expressed exactly.
  let q = service
    .from("written_reports")
    .select(ROW_COLS)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(pageSize + 1);

  const { start, end } = reportTimestampBounds(range.from, range.to);
  q = q.gte("submitted_at", start).lt("submitted_at", end);

  const scopeFilters: string[] = [
    viewer.level < 4 && EMPLOYEE_WRITTEN_REPORTS_OWN_ONLY
      ? `submitted_by.eq.${viewer.userId}`
      : `or(submitted_by.eq.${viewer.userId},visibility_min_level.lte.${viewer.level})`,
  ];

  if (args.locationId) {
    // This value is interpolated into PostgREST's boolean grammar below.
    if (!/^[a-zA-Z0-9_-]+$/.test(args.locationId) || args.locationId === "all") throw new Error("written_report_scope_forbidden");
    const authorized = viewer.level >= ALL_LOCATIONS_READ_LEVEL ||
      (viewer.locations !== "all" && viewer.locations.includes(args.locationId));
    if (!authorized) throw new Error("written_report_scope_forbidden");
    scopeFilters.push(`or(location_id.is.null,location_id.eq.${args.locationId})`);
  // Location scope: level >= 8 sees all; otherwise null-location OR one of mine.
  } else if (viewer.level < ALL_LOCATIONS_READ_LEVEL) {
    // A sentinel cannot grant authority above the viewer's actual role.
    const locs = viewer.locations === "all" ? [] : viewer.locations;
    if (locs.length === 0) {
      // No authorized locations → only all-location (null) reports are visible.
      scopeFilters.push("location_id.is.null");
    } else {
      const inList = locs.join(",");
      scopeFilters.push(`or(location_id.is.null,location_id.in.(${inList}))`);
    }
  }

  if (cursor) scopeFilters.push(
    `or(submitted_at.lt.${cursor.submittedAt},and(submitted_at.eq.${cursor.submittedAt},id.gt.${cursor.id}))`,
  );
  q = q.or(scopeFilters.length === 1 ? scopeFilters[0]! : `and(${scopeFilters.join(",")})`);

  const { data, error } = await q;
  if (error) throw new Error(`listWrittenReports failed: ${error.message}`);
  const fetched = (data ?? []) as WrittenReportRow[];
  const hasMore = fetched.length > pageSize;
  const rows = fetched.slice(0, pageSize);

  // Resolve author names (batch).
  const authorIds = [...new Set(rows.map((r) => r.submitted_by))];
  const nameById = new Map<string, string>();
  if (authorIds.length) {
    const { data: users } = await service.from("users").select("id, name").in("id", authorIds);
    for (const u of (users ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(u.id, u.name);
    }
  }

  const reports = rows.map((r) => {
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
  const last = rows.at(-1);
  return {
    reports,
    nextCursor: hasMore && last?.submitted_at
      ? encodeCursor({ submittedAt: last.submitted_at.replace(/\+00:00$/, "Z"), id: last.id, context: cursorContext })
      : null,
  };
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
  if (viewer.level < 2) return null;
  const now = args.now ?? new Date();

  const { data } = await service
    .from("written_reports")
    .select(ROW_COLS)
    .eq("id", args.id)
    .maybeSingle<WrittenReportRow>();
  if (!data) return null;

  // Visibility floor.
  const isAuthor = data.submitted_by === viewer.userId;
  if (!isAuthor && viewer.level < data.visibility_min_level) return null;
  if (viewer.level < 4 && EMPLOYEE_WRITTEN_REPORTS_OWN_ONLY && !isAuthor) return null;
  // Location gate: null OR mine OR level>=8.
  if (data.location_id !== null && viewer.level < ALL_LOCATIONS_READ_LEVEL) {
    const locs = viewer.locations;
    const allowed = locs !== "all" && locs.includes(data.location_id);
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
  /** Resolved from a verified AuthContext, never request attribution. */
  actor: ChecklistWriteActor;
  /** The location this report is scoped to; null = all-location post. */
  locationId: string | null;
  draft: WrittenReportDraft;
}

/**
 * Service write with the former INSERT policy and null-or-member route gate.
 * Attribution is taken exclusively from the server-resolved actor.
 */
export async function createWrittenReport(
  args: CreateWrittenReportArgs,
): Promise<{ id: string }> {
  const { actor } = args;
  if (!actor.active || actor.level < WRITTEN_REPORT_WRITE_MIN_LEVEL ||
    (args.locationId !== null && !actor.locations.includes(args.locationId))) {
    throw new ChecklistActorNotAuthorizedError();
  }

  const { data, error } = await getServiceRoleClient()
    .from("written_reports")
    .insert({
      location_id: args.locationId,
      submitted_by: actor.userId,
      submitted_by_role: actor.role,
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
  actor: ChecklistWriteActor;
  id: string;
  /** Editable fields (append-only spirit: correction inside the 3h window). */
  draft: WrittenReportDraft;
}

/**
 * The service-only RPC evaluates author, strict 3h window and current read-policy
 * visibility/location in the UPDATE and increments edit_count atomically.
 * Zero rows retains the existing denial, including demotion or shop removal.
 */
export async function updateWrittenReport(
  args: UpdateWrittenReportArgs,
): Promise<{ ok: boolean; denied?: boolean }> {
  if (!args.actor.active) throw new ChecklistActorNotAuthorizedError();
  const { data: count, error } = await getServiceRoleClient().rpc("written_report_update_self", {
    p_actor: args.actor.userId, p_id: args.id, p_title: args.draft.title,
    p_body: args.draft.body, p_category: args.draft.category,
    p_visibility_min_level: args.draft.visibilityMinLevel,
  });
  if (error) throw new Error(`updateWrittenReport failed: ${error.message}`);
  if (count === 0) return { ok: false, denied: true };
  if (count !== 1) throw new Error("updateWrittenReport failed: invalid rowcount");
  return { ok: true };
}
