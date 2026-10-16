/**
 * PM v2 CRITERIA — the editor's loader and writers. Server-only, service role. Scheduling Phase 1, Task 22.
 *
 * Who: GM own shop, MoO+ any shop (`canEditPmCriteria`, decided before any I/O); the ROUTE adds the Tier E
 * edit window (R10, `assertStepUp(ctx, "E")`). Criteria are config: add, rename (en + es side by side, C.44),
 * reorder, deactivate / reactivate — NEVER delete (service_role holds no DELETE on `pm_criteria`). A criterion
 * names a position of THIS shop that is usable (active, on an active station), or none ("Every position").
 * A deactivated criterion keeps its past grades and stops appearing on new copies. Every write is audited
 * (`pm_criteria.create` / `pm_criteria.update`, before/after with the labels). Nothing is sent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { canEditPmCriteria, type PeopleActor } from "@/lib/people/access-shared";
import { isMissingTable } from "@/lib/people/facts";
import { positionUsable } from "@/lib/people/skill-matrix-shared";
import {
  criteriaEditorGroups, nextCriterionSort, normalizeLabelEs, pmCriterionLabelProblem, type CriterionRow, type EditorGroup,
} from "@/lib/pm-criteria-shared";
import { selectAllRows } from "@/lib/supabase-paginate";

export const PM_CRITERIA_ERROR_STATUS = {
  forbidden: 403, not_found: 404, invalid_payload: 400, invalid_label: 400, position_not_at_shop: 422, position_retired: 422,
  duplicate_label: 409, pm_v2_unavailable: 503, write_failed: 500,
} as const;
export type PmCriteriaErrorCode = keyof typeof PM_CRITERIA_ERROR_STATUS;
export class PmCriteriaError extends Error {
  constructor(public status: number, public code: PmCriteriaErrorCode) { super(code); }
}
function refuse(code: PmCriteriaErrorCode): never {
  throw new PmCriteriaError(PM_CRITERIA_ERROR_STATUS[code], code);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(v: unknown): asserts v is string {
  if (typeof v !== "string" || !UUID.test(v)) refuse("invalid_payload");
}
function front(actor: PeopleActor, locationId: unknown): asserts locationId is string {
  requireUuid(locationId);
  if (!canEditPmCriteria(actor, locationId)) refuse("forbidden");
}
function readFailure(error: { code?: string; message: string }): never {
  if (isMissingTable(error)) refuse("pm_v2_unavailable");
  throw new Error(`pm criteria: ${error.message}`);
}

interface FullRow extends CriterionRow { location_id: string }
async function loadRows(service: SupabaseClient, locationId: string): Promise<FullRow[]> {
  try {
    return await selectAllRows<FullRow>((from, to) => service.from("pm_criteria")
      .select("id, location_id, position_id, label, label_es, sort, active").eq("location_id", locationId).order("id", { ascending: true }).range(from, to));
  } catch (e) {
    readFailure({ message: e instanceof Error ? e.message : String(e) });
  }
}

/** The shop's usable positions in display order (station sort, position sort, name). */
async function loadPositions(service: SupabaseClient, locationId: string) {
  const positions = await selectAllRows<{ id: string; station_id: string; name: string; name_es: string | null; sort: number; active: boolean }>((from, to) => service
    .from("station_positions").select("id, station_id, name, name_es, sort, active").eq("location_id", locationId).order("id", { ascending: true }).range(from, to));
  const stations = await selectAllRows<{ id: string; active: boolean; sort: number }>((from, to) => service
    .from("stations").select("id, active, sort").eq("location_id", locationId).order("id", { ascending: true }).range(from, to));
  const sortOf = new Map(stations.map((s) => [s.id, s.sort] as const));
  return { positions, stations, usable: positions.filter((p) => positionUsable(p, stations))
    .sort((a, b) => (sortOf.get(a.station_id) ?? 0) - (sortOf.get(b.station_id) ?? 0) || a.sort - b.sort || a.name.localeCompare(b.name)) };
}

export interface PmCriteriaEditorView { locationId: string; groups: EditorGroup[] }

/** "Every position" first, then each usable position of the shop with its criteria (deactivated ones listed last). */
export async function loadCriteriaEditor(service: SupabaseClient, args: { actor: PeopleActor; locationId: string }): Promise<PmCriteriaEditorView> {
  front(args.actor, args.locationId);
  const rows = await loadRows(service, args.locationId);
  const { usable } = await loadPositions(service, args.locationId);
  return { locationId: args.locationId, groups: criteriaEditorGroups(usable.map((p) => ({ positionId: p.id, name: p.name, nameEs: p.name_es })), rows) };
}

async function requireUsablePositionAt(service: SupabaseClient, locationId: string, positionId: string): Promise<void> {
  const { positions, stations } = await loadPositions(service, locationId);
  const p = positions.find((x) => x.id === positionId);
  if (!p) refuse("position_not_at_shop");
  if (!positionUsable(p, stations)) refuse("position_retired");
}
function writeFailure(error: { code?: string; message: string }): never {
  if (error.code === "23505" || /duplicate key|pm_criteria_one_active_label/i.test(error.message)) refuse("duplicate_label");
  if (error.code === "23514") refuse("invalid_label");
  if (isMissingTable(error)) refuse("pm_v2_unavailable");
  refuse("write_failed");
}

/** Add a criterion to a position of this shop (or to "Every position"); sort = last + 10. */
export async function createCriterion(service: SupabaseClient, args: {
  actor: PeopleActor; locationId: unknown; positionId: unknown; label: unknown; labelEs: unknown;
}): Promise<{ id: string }> {
  front(args.actor, args.locationId);
  if (args.positionId !== null) requireUuid(args.positionId);
  if (pmCriterionLabelProblem(args.label, args.labelEs)) refuse("invalid_label");
  const locationId = args.locationId;
  const positionId = args.positionId as string | null;
  if (positionId !== null) await requireUsablePositionAt(service, locationId, positionId);
  const rows = await loadRows(service, locationId);
  const after = { position_id: positionId, label: (args.label as string).trim(), label_es: normalizeLabelEs(args.labelEs), sort: nextCriterionSort(rows, positionId), active: true };
  const { data, error } = await service.from("pm_criteria").insert({ location_id: locationId, ...after, created_by: args.actor.userId }).select("id").maybeSingle();
  if (error) writeFailure(error);
  const id = (data as { id: string } | null)?.id ?? "";
  await audit({ actorId: args.actor.userId, actorRole: args.actor.role, action: "pm_criteria.create", resourceTable: "pm_criteria", resourceId: id || null,
    metadata: { location_id: locationId, before: null, after }, ipAddress: null, userAgent: null });
  return { id };
}

/** Rename (en + es), deactivate or reactivate one criterion. Never a delete; never moves it to another shop. */
export async function updateCriterion(service: SupabaseClient, args: {
  actor: PeopleActor; locationId: unknown; criterionId: unknown; label?: unknown; labelEs?: unknown; active?: unknown;
}): Promise<void> {
  front(args.actor, args.locationId);
  requireUuid(args.criterionId);
  if (args.active !== undefined && typeof args.active !== "boolean") refuse("invalid_payload");
  const rows = await loadRows(service, args.locationId);
  const row = rows.find((r) => r.id === args.criterionId);
  if (!row) refuse("not_found");
  const label = args.label === undefined ? row.label : args.label;
  const labelEs = args.labelEs === undefined ? row.label_es : args.labelEs;
  if (pmCriterionLabelProblem(label, labelEs)) refuse("invalid_label");
  const patch = { label: (label as string).trim(), label_es: normalizeLabelEs(labelEs), active: args.active === undefined ? row.active : (args.active as boolean) };
  if (patch.active && !row.active && row.position_id !== null) await requireUsablePositionAt(service, args.locationId, row.position_id);
  await writePatch(service, args.actor, args.locationId, row, patch);
}

/** Move a criterion one place up or down within its scope (swaps sort with its neighbour; both audited). */
export async function moveCriterion(service: SupabaseClient, args: { actor: PeopleActor; locationId: unknown; criterionId: unknown; direction: unknown }): Promise<void> {
  front(args.actor, args.locationId);
  requireUuid(args.criterionId);
  if (args.direction !== "up" && args.direction !== "down") refuse("invalid_payload");
  const rows = await loadRows(service, args.locationId);
  const row = rows.find((r) => r.id === args.criterionId);
  if (!row) refuse("not_found");
  const scope = rows.filter((r) => r.position_id === row.position_id && r.active).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const i = scope.findIndex((r) => r.id === row.id);
  const other = scope[args.direction === "up" ? i - 1 : i + 1];
  if (i < 0 || !other) return;
  const [a, b] = row.sort === other.sort ? [args.direction === "up" ? other.sort - 1 : other.sort + 1, row.sort] : [other.sort, row.sort];
  await writePatch(service, args.actor, args.locationId, row, { sort: a });
  await writePatch(service, args.actor, args.locationId, other, { sort: b });
}

async function writePatch(service: SupabaseClient, actor: PeopleActor, locationId: string, row: FullRow, patch: Partial<Pick<FullRow, "label" | "label_es" | "sort" | "active">>): Promise<void> {
  const { error, count } = await service.from("pm_criteria")
    .update({ ...patch, updated_by: actor.userId, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", row.id).eq("location_id", locationId);
  if (error) writeFailure(error);
  if (count === 0) refuse("not_found");
  const before = { label: row.label, label_es: row.label_es, sort: row.sort, active: row.active };
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "pm_criteria.update", resourceTable: "pm_criteria", resourceId: row.id,
    metadata: { location_id: locationId, position_id: row.position_id, before, after: { ...before, ...patch } }, ipAddress: null, userAgent: null });
}
