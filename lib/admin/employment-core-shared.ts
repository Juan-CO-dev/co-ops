/**
 * EMPLOYMENT STATUS — on leave, separated, rehired (staff separations, Juan 2026-10-20). Pure and client-safe: the
 * vocabulary, the status a person's append-only events add up to, who may record what, who may READ the reasons, and
 * the RPC argument builder. Zero I/O, and NO runtime import (the 0279 PGlite harness imports this file with plain node).
 *
 * THE RECORD (0279 `user_employment_events`, append-only): leave_start · leave_end · separated · rehired · correction.
 * The status is the latest leave_start / leave_end / separated / rehired event (leave_start → on leave, separated →
 * separated, anything else or nothing → active). A correction replaces the FIELDS of the event it names (the newest
 * correction wins), never the status.
 *
 * WHO SEES THE REASONS (Juan's decision): the full reason and the rehire note go to the owner, the MoO, the CGS and the
 * GM of a shop the person belongs to (GMs do the hiring). Everyone else gets the status chip only. The redaction runs on
 * the SERVER (`employmentViewFor`) — a viewer who may not read the reasons never receives them.
 *
 * WHO RECORDS (the SQL twin is 0279's actor rule): user management's rule (`userAdminRefusal`: GM own shop, MoO+ any,
 * strictly below oneself) for leave, back from leave and separation; a rehire follows the separation's rehire setting —
 * `yes` the same rule, `only_with_owner_ok` the owner / MoO / CGS, `no` the owner only, with a reason.
 */
import type { RoleCode } from "../roles";
import type { TranslationKey } from "../i18n/types";

export const LEAVE_REASONS = ["school", "seasonal", "personal", "other"] as const;
export type LeaveReason = (typeof LEAVE_REASONS)[number];
export const SEPARATION_TYPES = ["fired", "quit", "no_call_no_show", "other"] as const;
export type SeparationType = (typeof SEPARATION_TYPES)[number];
export const REHIRE_SETTINGS = ["yes", "only_with_owner_ok", "no"] as const;
export type RehireSetting = (typeof REHIRE_SETTINGS)[number];
export const EMPLOYMENT_EVENT_KINDS = ["leave_start", "leave_end", "separated", "rehired", "correction"] as const;
export type EmploymentEventKind = (typeof EMPLOYMENT_EVENT_KINDS)[number];
export type EmploymentStatus = "active" | "on_leave" | "separated";

/** Text limits (0279's CHECKs). */
export const EMPLOYMENT_REASON_MAX = 2000;
export const EMPLOYMENT_NOTE_MAX = 1000;

/** The roles that read every person's reasons. */
export const EMPLOYMENT_DETAIL_ROLES: readonly RoleCode[] = ["owner", "moo", "cgs"];
/** A rehire on `only_with_owner_ok`. */
export const REHIRE_OWNER_OK_ROLES: readonly RoleCode[] = ["owner", "moo", "cgs"];
/** A rehire on `no`. */
export const REHIRE_NO_ROLES: readonly RoleCode[] = ["owner"];

/** One row of 0279, as the loader maps it. */
export interface EmploymentEventRow {
  id: string;
  userId: string;
  kind: EmploymentEventKind;
  correctsId: string | null;
  leaveReason: LeaveReason | null;
  expectedBack: string | null;
  separationType: SeparationType | null;
  lastDayWorked: string | null;
  reason: string | null;
  rehire: RehireSetting | null;
  rehireNote: string | null;
  note: string | null;
  actorId: string;
  createdAt: string;
}

/** The event in force, corrections applied. */
export type EmploymentDetail =
  | { kind: "on_leave"; eventId: string; since: string; leaveReason: LeaveReason; expectedBack: string | null; note: string | null; corrected: boolean }
  | {
    kind: "separated"; eventId: string; since: string; separationType: SeparationType; lastDayWorked: string;
    reason: string; rehire: RehireSetting; rehireNote: string | null; corrected: boolean;
  };

export interface EmploymentState {
  status: EmploymentStatus;
  /** The latest event of ANY kind — what a write must name as `expectedId` (null = no event yet). */
  headId: string | null;
  current: EmploymentDetail | null;
}

export const ACTIVE_STATE: EmploymentState = Object.freeze({ status: "active", headId: null, current: null }) as EmploymentState;

const newestFirst = (a: EmploymentEventRow, b: EmploymentEventRow) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

/** One person's events (any order) → their state. Mirrors 0279's head / status reads. */
export function employmentStateOf(rows: readonly EmploymentEventRow[]): EmploymentState {
  if (rows.length === 0) return ACTIVE_STATE;
  const sorted = [...rows].sort(newestFirst);
  const head = sorted[0]!;
  const ev = sorted.find((r) => r.kind !== "correction");
  if (!ev || ev.kind === "leave_end" || ev.kind === "rehired") return { status: "active", headId: head.id, current: null };
  const fix = sorted.find((r) => r.kind === "correction" && r.correctsId === ev.id);
  const src = fix ?? ev;
  if (ev.kind === "leave_start") {
    return {
      status: "on_leave", headId: head.id,
      current: { kind: "on_leave", eventId: ev.id, since: ev.createdAt, leaveReason: src.leaveReason ?? "other",
        expectedBack: src.expectedBack, note: src.note, corrected: !!fix },
    };
  }
  return {
    status: "separated", headId: head.id,
    current: { kind: "separated", eventId: ev.id, since: ev.createdAt, separationType: src.separationType ?? "other",
      lastDayWorked: src.lastDayWorked ?? ev.createdAt.slice(0, 10), reason: src.reason ?? "", rehire: src.rehire ?? "no",
      rehireNote: src.rehireNote, corrected: !!fix },
  };
}

/** Every person's state from one batch of rows. */
export function employmentStatesByUser(rows: readonly EmploymentEventRow[]): Map<string, EmploymentState> {
  const by = new Map<string, EmploymentEventRow[]>();
  for (const r of rows) { const a = by.get(r.userId) ?? []; a.push(r); by.set(r.userId, a); }
  return new Map([...by].map(([u, rs]) => [u, employmentStateOf(rs)]));
}

/** Excluded from the schedule: on leave (while on leave) and separated (always, even if reactivated by mistake). */
export function excludedFromScheduling(status: EmploymentStatus): boolean {
  return status !== "active";
}

// ─── What a viewer may see ───────────────────────────────────────────────────

export interface EmploymentViewer { role: RoleCode; locations: readonly string[] }

/** Owner / MoO / CGS see every person's reasons; a GM sees them for a person who belongs to one of the GM's shops. */
export function canSeeEmploymentDetail(viewer: EmploymentViewer, subjectLocationIds: readonly string[]): boolean {
  if (EMPLOYMENT_DETAIL_ROLES.includes(viewer.role)) return true;
  if (viewer.role !== "gm") return false;
  return subjectLocationIds.some((l) => viewer.locations.includes(l));
}

/** The chip everyone who may see the person sees: never a reason. */
export type EmploymentChip =
  | { status: "on_leave"; until: string | null }
  | { status: "separated"; rehire: RehireSetting };

/** What reaches a viewer: the status, the chip, the head for writes, and the detail ONLY when they may read it. */
export interface EmploymentView {
  status: EmploymentStatus;
  headId: string | null;
  chip: EmploymentChip | null;
  /** Null unless the viewer may read the reasons (canSeeEmploymentDetail). */
  detail: EmploymentDetail | null;
}

/** The chip's i18n key (`{date}` = the expected-back date when there is one). */
export function employmentChipKey(chip: EmploymentChip): TranslationKey {
  if (chip.status === "on_leave") return chip.until ? "admin.users.employment.chip.on_leave_until" : "admin.users.employment.chip.on_leave";
  return `admin.users.employment.chip.separated_${chip.rehire}` as TranslationKey;
}

export function employmentChipOf(state: EmploymentState): EmploymentChip | null {
  const c = state.current;
  if (!c) return null;
  return c.kind === "on_leave" ? { status: "on_leave", until: c.expectedBack } : { status: "separated", rehire: c.rehire };
}

/** THE SERVER-SIDE REDACTION. */
export function employmentViewFor(viewer: EmploymentViewer, subjectLocationIds: readonly string[], state: EmploymentState): EmploymentView {
  return {
    status: state.status, headId: state.headId, chip: employmentChipOf(state),
    detail: state.current && canSeeEmploymentDetail(viewer, subjectLocationIds) ? state.current : null,
  };
}

// ─── Who may record what ────────────────────────────────────────────────────

/** The rehire setting in force for a separated person (null when not separated). */
export function currentRehire(state: EmploymentState): RehireSetting | null {
  return state.current?.kind === "separated" ? state.current.rehire : null;
}

/** What the act rules need: the status and, when separated, the rehire setting — from a state OR a redacted view. */
export interface ActState { status: EmploymentStatus; rehire: RehireSetting | null }
export function actStateOf(s: { status: EmploymentStatus; current?: EmploymentDetail | null; chip?: EmploymentChip | null }): ActState {
  const rehire = s.current?.kind === "separated" ? s.current.rehire : s.chip?.status === "separated" ? s.chip.rehire : null;
  return { status: s.status, rehire };
}

/** Who may lift a rehire setting: `no` → the owner; `only_with_owner_ok` → owner / MoO / CGS; `yes` → anyone who may act. */
export function rehireRefusal(role: RoleCode, from: RehireSetting, to: RehireSetting): "rehire_owner_ok_required" | "rehire_owner_required" | null {
  if (from === "no" && to !== "no" && !REHIRE_NO_ROLES.includes(role)) return "rehire_owner_required";
  if (from === "only_with_owner_ok" && to === "yes" && !REHIRE_OWNER_OK_ROLES.includes(role)) return "rehire_owner_ok_required";
  return null;
}

/** A rehire needs a reason unless the separation said rehire OK. */
export function rehireNeedsReason(state: EmploymentState): boolean {
  const r = currentRehire(state);
  return r !== null && r !== "yes";
}

// ─── The payload ─────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const realDate = (s: string) => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t === "") return null;
  return t.length > max ? undefined : t;
};

export type EmploymentFields =
  | { leaveReason: LeaveReason; expectedBack: string | null; note: string | null }
  | { separationType: SeparationType; lastDayWorked: string; reason: string; rehire: RehireSetting; rehireNote: string | null }
  | { note: string | null };

/** The fields for one kind (a correction: the corrected kind's fields), by EXACT keys — the twin of 0279's checks. Null = invalid. */
export function parseEmploymentFields(kind: Exclude<EmploymentEventKind, "correction">, raw: unknown): EmploymentFields | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const allowed = kind === "leave_start" ? ["leaveReason", "expectedBack", "note"]
    : kind === "separated" ? ["separationType", "lastDayWorked", "reason", "rehire", "rehireNote"] : ["note"];
  if (Object.keys(v).some((k) => !allowed.includes(k))) return null;
  if (kind === "leave_start") {
    if (!LEAVE_REASONS.includes(v.leaveReason as LeaveReason)) return null;
    const back = v.expectedBack ?? null;
    if (back !== null && (typeof back !== "string" || !realDate(back))) return null;
    const note = text(v.note, EMPLOYMENT_NOTE_MAX);
    if (note === undefined) return null;
    return { leaveReason: v.leaveReason as LeaveReason, expectedBack: back as string | null, note };
  }
  if (kind === "separated") {
    if (!SEPARATION_TYPES.includes(v.separationType as SeparationType) || !REHIRE_SETTINGS.includes(v.rehire as RehireSetting)) return null;
    if (typeof v.lastDayWorked !== "string" || !realDate(v.lastDayWorked)) return null;
    const reason = text(v.reason, EMPLOYMENT_REASON_MAX);
    const rehireNote = text(v.rehireNote, EMPLOYMENT_NOTE_MAX);
    if (!reason || rehireNote === undefined) return null;
    if (v.rehire !== "yes" && !rehireNote) return null;
    return { separationType: v.separationType as SeparationType, lastDayWorked: v.lastDayWorked, reason, rehire: v.rehire as RehireSetting,
      rehireNote: v.rehire === "yes" ? null : rehireNote };
  }
  const note = text(v.note, EMPLOYMENT_NOTE_MAX);
  if (note === undefined) return null;
  return { note };
}

/** The kind a correction would correct, from the state (null = nothing to correct). */
export function correctedKindOf(state: EmploymentState): "leave_start" | "separated" | null {
  return state.current?.kind === "on_leave" ? "leave_start" : state.current?.kind === "separated" ? "separated" : null;
}

export const isEmploymentUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The ONE writer's arguments (0279 `record_user_employment_event`) — the harness calls it with exactly these. */
export function recordEmploymentEventCall(a: {
  actorId: string; userId: string; expectedId: string | null; kind: EmploymentEventKind; fields: Record<string, unknown>;
}): { fn: "record_user_employment_event"; args: { p_actor: string; p_user: string; p_expected: string | null; p_kind: string; p_fields: Record<string, unknown> } } {
  return { fn: "record_user_employment_event", args: { p_actor: a.actorId, p_user: a.userId, p_expected: a.expectedId, p_kind: a.kind, p_fields: a.fields } };
}

/** 0279's named refusals (raise exception '<code>'). */
export const EMPLOYMENT_RPC_ERRORS = [
  "invalid_payload", "employment_forbidden", "employment_outside_shop", "employment_not_found", "employment_moved",
  "employment_invalid_transition", "rehire_owner_ok_required", "rehire_owner_required",
] as const;

// ─── The rehire warning on Add user ──────────────────────────────────────────

/** US phone → its 10 digits (a leading country 1 dropped); anything else is not matchable (null). Never matched by name. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^\d{10}$/.test(ten) ? ten : null;
}

/** A separated person whose rehire setting needs more than the usual authority is a match worth warning about. */
export function rehireWarns(setting: RehireSetting): boolean {
  return setting !== "yes";
}

/** May this actor proceed past a rehire match? (The same authority a rehire needs.) */
export function mayProceedPastRehire(role: RoleCode, setting: RehireSetting): boolean {
  return rehireRefusal(role, setting, "yes") === null;
}

