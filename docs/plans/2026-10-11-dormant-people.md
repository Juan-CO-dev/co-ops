# Dormant people — collapse long-gone staff on Toast employees + User management

Juan 2026-10-11: "anyone who hasn't clocked into work in 6 months is not even shown unless that section is
expanded… they don't need to be deleted." Also user management: "that clock in rule can be for SL and below
since they have to clock in… anyone higher than that can be manually made dormant. And if they clock in that
reactivates their account."

## Rules (authoritative)

- **Window** = 182 days, measured from now. "Clock-in" = a `toast_time_entries` row with `deleted = false`
  (`in_at` is the instant).
- **Toast employees page** (`/admin/toast-employees`, per shop): an employee is *not seen* when they have no
  clock-in **at that shop** in the window, OR Toast marks them archived (`deleted`). Not-seen employees move
  out of the main "unlinked" list into a collapsed section (native `<details>`, closed by default) titled
  "Not seen in 6+ months (N)". The rows inside keep every existing control (link button, picker). The linked
  list is unchanged.
- **User management** (`/admin/users`): a user is *dormant* when any of these is true:
  1. **Auto (level ≤ 5, Shift Lead and below):** latest clock-in at any shop (via `toast_time_entries.user_id`)
     — or `created_at` if later / if none — is older than the window. (`created_at` is the grace for new hires
     and for people not yet linked to Toast.)
  2. **Manual (any level):** `users.dormant_at` is set AND they have no clock-in after `dormant_at`.
     A clock-in after `dormant_at` wakes them automatically — computed, no write needed.
  3. **Deactivated:** `active = false` (login off). These also go in the collapsed section.
  Dormant users render in a collapsed `<details>` "Dormant & deactivated (N)" below the active list.
  Each row shows why ("No clock-in since {date}", "Marked dormant {date}", "Deactivated").
- **Clock-in does NOT re-enable a deactivated login.** Dormancy is display only; switching a login back on
  stays an explicit manager action (existing Activate button). Dormancy does not touch sessions, PINs, roles,
  or any other screen (pickers, boards, digests unchanged).
- When the page is filtered (`status=inactive`, a search query, or a role filter), show matches flat — no
  collapsing — so search always finds people.

## Data — migration `0244_dormant_people.sql`

- `alter table public.users add column dormant_at timestamptz null, add column dormant_by uuid null references public.users(id);`
  Match the existing column-grant / RLS posture on `public.users` (check 0240 and earlier grants: if
  `authenticated` has column-level select, do NOT widen it; these columns are service-role only).
- `create function public.admin_last_clock_ins(p_since timestamptz)` returns
  `table(location_id uuid, employee_guid text, user_id uuid, last_in_at timestamptz)` — `max(in_at)` grouped by
  (location_id, employee_guid, user_id) over `deleted = false and in_at >= p_since`. `security invoker`,
  `stable`, `set search_path = ''`; revoke from public/anon/authenticated; grant execute to service_role only.
  (PostgREST caps plain selects at 1000 rows; an aggregate RPC avoids paging ~3k rows.)
- Header comment in the repo's migration style (authored, NOT YET APPLIED — GATE CC: sim first, then prod).
  Add a SQL harness under the repo's existing harness convention if one exists for similar migrations.

## App

- `lib/admin/dormancy-shared.ts` (pure, client-safe): `DORMANT_WINDOW_DAYS = 182`;
  `userDormancy({ level, active, createdAt, dormantAt, lastClockInAt, now })` →
  `{ dormant: false } | { dormant: true, reason: "deactivated" | "manual" | "no_clock_in", since: string | null }`
  (precedence: deactivated > manual > no_clock_in);
  `employeeNotSeen({ deleted, lastClockInAt, now })` → boolean. Unit-test every branch incl. boundary day,
  manual-then-clock-in wake, level 5 vs level 6, null created_at guard.
- `lib/admin/users.ts`: `AdminUserListItem` gains `dormancy` (computed server-side with one
  `admin_last_clock_ins` call per list load, max per user across shops) + `dormantAt`. Add
  `setDormant(ctx, id, dormant: boolean)` mirroring `setActive`: same `canActOn` / location-scope checks,
  writes `dormant_at = now()` / `dormant_by = actor` (or both null on wake), and an `audit_log` row
  (`user.dormant` / `user.wake`) exactly like setActive's audit. No-op (no audit) when already in that state.
- Routes `app/api/admin/users/[id]/dormant/route.ts` + `.../wake/route.ts` mirroring `deactivate/route.ts`
  (level ≥ 8, step-up "B").
- `components/admin/users/UserAdminClient.tsx`: split rows into active list + `<details>` section (unfiltered
  view only); reason line per dormant row. `UserActions.tsx`: "Move to dormant" / "Move back to active" button
  (same step-up + refresh pattern as Deactivate/Activate). Hide "Move to dormant" for deactivated users.
- `lib/toast/employee-links.ts` `loadLinkReview`: one `admin_last_clock_ins(now − window)` call (filter to the
  location) → each `ReviewEmployeeView` gains `lastClockInAt: string | null` and `notSeen: boolean`.
  The RPC failing must NOT break the page: log, treat every employee as seen (today's behavior), and surface a
  small muted notice ("Couldn't load clock-in history — showing everyone").
- `components/admin/toast-employees/ToastEmployeeLinks.tsx`: render seen rows as today; not-seen rows inside
  the collapsed `<details>`; the unlinked header count reflects seen rows; each not-seen row shows
  "Last clock-in {date}" or "No clock-in in 6 months" / existing archived text.
- i18n en + es for every new string (es: "inactivo/a" family; "No visto en más de 6 meses",
  "Inactivos y desactivados"). Follow the repo's i18n key-count tests.

## Backfill (operator script, CC runs it)

- `scripts/backfill-toast-labor.ts --from YYYY-MM-DD --through YYYY-MM-DD`: validates dates (through ≤ T-2,
  never today/yesterday), then calls `runToastLaborPull(dates, { deadlineMs, context: "backfill" })` in
  7-day chunks sequentially, printing per-chunk row counts + failure codes only (no names). Add `"backfill"` to
  `LaborPullContext` (audit job name becomes `toast-labor-pull-backfill`; make sure job-watch does not treat it
  as a required daily job). Never imports env files (runbook style); requires `TOAST_LABOR_PULL=1`.
  Historical dates never reconcile (already enforced in runToastLaborPull). Add a short runbook note.

## Tests

Unit: dormancy-shared (all branches); loadLinkReview split + RPC-failure fallback; setDormant permission /
no-op / audit; UI: users list collapses only when unfiltered; toast list header count. Keep existing tests green.
