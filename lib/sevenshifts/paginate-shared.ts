/**
 * 7SHIFTS RESPONSE SHAPES — the cursor follower and the singleton validators. Pure.
 *
 * Scheduling Phase 1, Task 4 Step 2 (r1 P2-5, r2 #1).
 *
 * PAGINATED lists end ONLY on an explicit `meta.cursor.next === null` inside a well-formed
 * `meta.cursor` object. Anything else is `malformed`, which the follower turns into the resource
 * error `bad_pagination` — a FAILURE, never a quiet end. `page_cap` and `cursor_loop` are failures
 * too. Rows from earlier good pages are still returned (an upsert is idempotent), but with
 * `complete: false`, so the sync keeps that resource's watermark and treats any snapshot built
 * from it as incomplete.
 *
 * SINGLETONS (assignments, wages, labor settings, whoami) are one request each, checked by their
 * own validator; a failure is `bad_snapshot`, never an empty success. A singleton that carries a
 * `meta.cursor` anyway is not followed.
 */

export const MAX_PAGES_PER_RESOURCE = 200;

export type PageStep = { kind: "next"; cursor: string } | { kind: "end" } | { kind: "malformed" };
export type PaginationError = "bad_pagination" | "page_cap" | "cursor_loop";
export type SnapshotResult<T> = { ok: true; value: T } | { ok: false; code: "bad_snapshot" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function pageStep(json: unknown): PageStep {
  if (!isRecord(json) || !Array.isArray(json.data)) return { kind: "malformed" };
  const meta = json.meta;
  if (!isRecord(meta)) return { kind: "malformed" };
  const cursor = meta.cursor;
  if (!isRecord(cursor) || !("next" in cursor)) return { kind: "malformed" };
  if (cursor.next === null) return { kind: "end" };
  if (typeof cursor.next === "string" && cursor.next !== "") return { kind: "next", cursor: cursor.next };
  return { kind: "malformed" };
}

export interface FollowResult {
  rows: unknown[];
  /** Pages whose rows were accepted. */
  pages: number;
  complete: boolean;
  error: PaginationError | null;
}

/**
 * Follows cursors from the first page (`cursor = null`). `fetchPage` does the HTTP and throws its
 * own fixed error codes; a throw propagates. Only a page that passes `pageStep` contributes rows.
 */
export async function followPages(
  fetchPage: (cursor: string | null) => Promise<unknown>,
  maxPages: number = MAX_PAGES_PER_RESOURCE,
): Promise<FollowResult> {
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    if (pages >= maxPages) return { rows, pages, complete: false, error: "page_cap" };
    const json = await fetchPage(cursor);
    const step = pageStep(json);
    if (step.kind === "malformed") return { rows, pages, complete: false, error: "bad_pagination" };
    rows.push(...((json as { data: unknown[] }).data));
    pages += 1;
    if (step.kind === "end") return { rows, pages, complete: true, error: null };
    if (seen.has(step.cursor)) return { rows, pages, complete: false, error: "cursor_loop" };
    seen.add(step.cursor);
    cursor = step.cursor;
  }
}

// ─── Singletons ──────────────────────────────────────────────────────────────

export interface AssignmentsSnapshot {
  locations: unknown[];
  departments: unknown[];
  roles: unknown[];
}
export interface WagesSnapshot {
  current_wages: unknown[];
  upcoming_wages: unknown[];
}

const BAD: { ok: false; code: "bad_snapshot" } = { ok: false, code: "bad_snapshot" };

function objectTagOk(json: Record<string, unknown>, tag: string): boolean {
  return !("object" in json) || json.object === tag;
}

/** `data` is an object whose locations, departments and roles are each an ARRAY; `object`, if present, is "assignments". */
export function assignmentsSnapshot(json: unknown): SnapshotResult<AssignmentsSnapshot> {
  if (!isRecord(json) || !objectTagOk(json, "assignments") || !isRecord(json.data)) return BAD;
  const { locations, departments, roles } = json.data;
  if (!Array.isArray(locations) || !Array.isArray(departments) || !Array.isArray(roles)) return BAD;
  return { ok: true, value: { locations, departments, roles } };
}

/** `data.current_wages` and `data.upcoming_wages` are arrays. */
export function wagesSnapshot(json: unknown): SnapshotResult<WagesSnapshot> {
  if (!isRecord(json) || !isRecord(json.data)) return BAD;
  const { current_wages, upcoming_wages } = json.data;
  if (!Array.isArray(current_wages) || !Array.isArray(upcoming_wages)) return BAD;
  return { ok: true, value: { current_wages, upcoming_wages } };
}

/** `data` is an object. */
export function laborSettingsSnapshot(json: unknown): SnapshotResult<Record<string, unknown>> {
  if (!isRecord(json) || !objectTagOk(json, "labor_settings") || !isRecord(json.data)) return BAD;
  return { ok: true, value: json.data };
}

/** `data.users` is an array; the companies are the DISTINCT `company_id`s (each 1–18 digits). */
export function whoamiSnapshot(json: unknown): SnapshotResult<{ companyIds: string[] }> {
  if (!isRecord(json) || !objectTagOk(json, "whoami") || !isRecord(json.data) || !Array.isArray(json.data.users)) return BAD;
  const ids: string[] = [];
  for (const u of json.data.users) {
    if (!isRecord(u)) return BAD;
    const c = u.company_id;
    const s = typeof c === "number" && Number.isSafeInteger(c) && c >= 0 ? String(c) : typeof c === "string" ? c : null;
    if (s === null || !/^\d{1,18}$/.test(s)) return BAD;
    if (!ids.includes(s)) ids.push(s);
  }
  return { ok: true, value: { companyIds: ids } };
}

/** An unpaginated list: `data` is an array; no cursor is demanded. */
export function listUnpaginatedSnapshot(json: unknown): SnapshotResult<unknown[]> {
  if (!isRecord(json) || !Array.isArray(json.data)) return BAD;
  return { ok: true, value: json.data };
}
