/**
 * Toast employee → CO-OPS user links — PURE (client-safe, zero I/O). Juan 2026-10-08.
 *
 * THE RULE: an AUTO link needs an EXACT FULL-NAME match at the SAME shop, and it must be unique both
 * ways (one Toast employee ↔ one CO-OPS user, neither already linked). Anything else goes to the
 * review list with suggestions for a manager to tap. NEVER link on a first name alone — a first-name
 * match is only ever a SUGGESTION.
 *
 * "Exact" is deliberately strict: case and runs of whitespace are ignored, nothing else is.
 * Accents, hyphens and nicknames are NOT folded — "Jose Perez" vs "José Pérez" is a suggestion, not
 * an auto link (a wrong auto link would release the wrong person's station on a clock-out).
 *
 * Toast fields read (GET /labor/v1/employees; fixture tests/fixtures/toast/labor-employees-sample.json):
 * guid, firstName, chosenName, lastName, deleted. Full names stay IN MEMORY for matching and the
 * admin review page; nothing here is stored (toast_time_entries keeps the first name only, 0224).
 * UNVERIFIED against a live shop (no Toast credentials on the build machine): whether
 * /labor/v1/employees returns archived (deleted=true) employees by default and whether it paginates;
 * deleted employees are excluded from auto links and listed separately for review.
 */

export interface ToastEmployee {
  guid: string;
  firstName: string | null;
  chosenName: string | null;
  lastName: string | null;
  deleted: boolean;
}

export interface LinkCandidateUser { id: string; name: string }
export interface ExistingLink { id: string; employeeGuid: string; userId: string; active: boolean; source: "auto" | "manual" }

export type SuggestionKind = "full_name" | "last_name" | "first_name";
export interface LinkSuggestion { userId: string; kind: SuggestionKind }
export interface ReviewRow { employee: ToastEmployee; suggestions: LinkSuggestion[] }
export interface LinkPlan { auto: Array<{ employeeGuid: string; userId: string }>; review: ReviewRow[] }

type Row = Record<string, unknown>;
const obj = (x: unknown): Row => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Row) : {});
const text = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

/** Raw /labor/v1/employees → the five fields we read. Rows without a guid are dropped. */
export function parseToastEmployees(raw: unknown): ToastEmployee[] {
  if (!Array.isArray(raw)) throw new Error("toast_employees_bad_payload");
  const out: ToastEmployee[] = [];
  for (const e of raw.map(obj)) {
    const guid = text(e.guid);
    if (!guid) continue;
    out.push({ guid, firstName: text(e.firstName), chosenName: text(e.chosenName), lastName: text(e.lastName), deleted: e.deleted === true });
  }
  return out;
}

/** Case- and whitespace-insensitive; nothing else is folded. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** The full names a Toast employee answers to: legal first + last, and chosen + last. */
export function toastFullNames(e: ToastEmployee): string[] {
  if (!e.lastName) return [];
  const names = new Set<string>();
  for (const first of [e.firstName, e.chosenName]) if (first) names.add(normalizeName(`${first} ${e.lastName}`));
  return [...names];
}

/** Display label for the review list (full name; first names only when Toast has no last name). */
export function toastDisplayName(e: ToastEmployee): string {
  const first = e.chosenName ?? e.firstName ?? "";
  return [first, e.lastName ?? ""].join(" ").trim() || e.guid;
}

const tokens = (name: string) => normalizeName(name).split(" ").filter(Boolean);

/** Ranked suggestions (never links): full name (ambiguous), last name + first initial, first name only. */
export function suggestUsers(e: ToastEmployee, users: readonly LinkCandidateUser[]): LinkSuggestion[] {
  const full = new Set(toastFullNames(e));
  const firsts = new Set([e.firstName, e.chosenName].filter((x): x is string => !!x).map((x) => tokens(x)[0]!).filter(Boolean));
  const last = e.lastName ? tokens(e.lastName).at(-1) ?? null : null;
  const out: LinkSuggestion[] = [];
  for (const u of users) {
    const t = tokens(u.name);
    if (t.length === 0) continue;
    if (full.has(normalizeName(u.name))) { out.push({ userId: u.id, kind: "full_name" }); continue; }
    if (t.length >= 2 && last && t.at(-1) === last && [...firsts].some((f) => f[0] === t[0]![0])) { out.push({ userId: u.id, kind: "last_name" }); continue; }
    if (firsts.has(t[0]!)) out.push({ userId: u.id, kind: "first_name" });
  }
  const rank: Record<SuggestionKind, number> = { full_name: 0, last_name: 1, first_name: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.userId.localeCompare(b.userId));
}

/**
 * Decide auto links and the review list for ONE shop. `users` = the people who may be linked at
 * that shop (active, member). Linked employees/users are out of both lists.
 */
export function planLinks(employees: readonly ToastEmployee[], users: readonly LinkCandidateUser[], links: readonly ExistingLink[]): LinkPlan {
  const active = links.filter((l) => l.active);
  const linkedEmployees = new Set(active.map((l) => l.employeeGuid));
  const linkedUsers = new Set(active.map((l) => l.userId));
  const openEmployees = employees.filter((e) => !linkedEmployees.has(e.guid));
  const openUsers = users.filter((u) => !linkedUsers.has(u.id));
  const exact = new Map<string, string[]>(); // employee guid → users whose full name matches exactly
  const reverse = new Map<string, string[]>(); // user id → employees matching it exactly
  for (const e of openEmployees) {
    if (e.deleted) continue;
    const names = new Set(toastFullNames(e));
    const hits = openUsers.filter((u) => tokens(u.name).length >= 2 && names.has(normalizeName(u.name))).map((u) => u.id);
    exact.set(e.guid, hits);
    for (const id of hits) reverse.set(id, [...(reverse.get(id) ?? []), e.guid]);
  }
  const auto: LinkPlan["auto"] = [];
  const review: ReviewRow[] = [];
  for (const e of openEmployees) {
    const hits = exact.get(e.guid) ?? [];
    const only = hits.length === 1 ? hits[0]! : null;
    if (!e.deleted && only && (reverse.get(only) ?? []).length === 1) { auto.push({ employeeGuid: e.guid, userId: only }); continue; }
    review.push({ employee: e, suggestions: suggestUsers(e, openUsers) });
  }
  review.sort((a, b) => Number(a.employee.deleted) - Number(b.employee.deleted)
    || toastDisplayName(a.employee).localeCompare(toastDisplayName(b.employee)));
  return { auto, review };
}
