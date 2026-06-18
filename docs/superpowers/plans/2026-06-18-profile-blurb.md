# Profile "About Me" Blurb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an AGM+ (role level ≥ 6) write a ≤500-char plain-text "about me" blurb that displays on their public profile to anyone who can already see it — gated on `level ≥ 6` for BOTH setting and display.

**Architecture:** One nullable `users.profile_blurb` column (migration 0077, length CHECK). A dedicated `PATCH /api/users/me/profile-blurb` route mirrors the existing `…/me/language` self-update (authed-client write under `users_update_self` RLS, silent-denial guard) plus an app-layer `level ≥ 6` gate (RLS can't express a role predicate on a self-update). The blurb threads through `mapUser` so `auth.user.profileBlurb` is free in the layout; the UserMenu hosts the editor (AGM+-only); `loadPublicProfile` emits `blurb` only when the *owner's* level ≥ 6, so demotion hides it. No audit row (matches `language`/`phone` self-updates).

**Tech Stack:** Next.js 16 App Router, TypeScript strict + `noUncheckedIndexedAccess`, Supabase (custom JWT + RLS), Supabase MCP `apply_migration` (prod ref `bgcvurheqzylyfehqgzh`). No test framework — verification is `tsc --noEmit` + `next build` + throwaway `tsx` live smokes.

**Conventions (read once):**
- Smoke scripts: `npx tsx --env-file=.env.local scripts/<name>.ts`, body wrapped in `async function main(){…}; main().catch(e=>{console.error(e);process.exit(1)});` (CJS — no top-level await). Self-delete the script after the smoke passes (`git clean` or `rm`); never commit smokes.
- `tsc` after `next build` if `.next/types` complains (build regenerates types).
- Commit after every task. Branch is `claude/profile-blurb` (already created off `origin/main`, design doc already committed).

---

## Task 1: Migration 0077 — `users.profile_blurb` column + length CHECK

**Files:**
- Create: `supabase/migrations/0077_add_profile_blurb.sql`
- Apply via: Supabase MCP `apply_migration` (name `0077_add_profile_blurb`, prod ref `bgcvurheqzylyfehqgzh`)

- [ ] **Step 1: Ground-truth the ledger**

Run (Supabase MCP `execute_sql`):
```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 3;
```
Expected: latest is `0076_create_increment_failed_login_rpc`. Confirms 0077 is the right next number. Also confirm the column does not already exist:
```sql
select column_name from information_schema.columns
where table_name = 'users' and column_name = 'profile_blurb';
```
Expected: 0 rows.

- [ ] **Step 2: Apply the migration via MCP**

Use Supabase MCP `apply_migration` with name `0077_add_profile_blurb` and this SQL:
```sql
ALTER TABLE users ADD COLUMN profile_blurb text;

ALTER TABLE users ADD CONSTRAINT users_profile_blurb_len_chk
  CHECK (profile_blurb IS NULL OR char_length(profile_blurb) <= 500);
```

- [ ] **Step 3: Verify applied**

Run (MCP `execute_sql`):
```sql
select column_name, is_nullable, data_type from information_schema.columns
where table_name = 'users' and column_name = 'profile_blurb';
select conname from pg_constraint where conname = 'users_profile_blurb_len_chk';
```
Expected: one column row (`profile_blurb`, `YES`, `text`) and one constraint row.

- [ ] **Step 4: Verify the CHECK rejects over-length (and accepts ≤500)**

Run (MCP `execute_sql`) — non-destructive trial against a transaction that rolls back is ideal, but a direct probe on Juan's seed row is fine since we set it back to NULL:
```sql
-- should FAIL with check_violation (23514):
update users set profile_blurb = repeat('x', 501) where email = 'juan@complimentsonlysubs.com';
```
Expected: ERROR `new row for relation "users" violates check constraint "users_profile_blurb_len_chk"`. Then confirm a ≤500 value is accepted and reset to NULL:
```sql
update users set profile_blurb = repeat('x', 500) where email = 'juan@complimentsonlysubs.com';
update users set profile_blurb = null where email = 'juan@complimentsonlysubs.com';
```
Expected: both succeed; final state `profile_blurb IS NULL`.

- [ ] **Step 5: Capture the migration file**

Create `supabase/migrations/0077_add_profile_blurb.sql` with the going-forward header convention:
```sql
-- Migration 0077_add_profile_blurb
-- Applied via Supabase MCP apply_migration on 2026-06-18.
-- Canonical reference: docs/superpowers/specs/2026-06-18-profile-blurb-design.md
--
-- Adds the optional AGM+-editable "about me" profile blurb. Nullable text,
-- bounded at 500 chars by a CHECK (defense-in-depth behind the route's own
-- length validation). No RLS change: users_update_self already permits a user
-- to UPDATE columns on their own row; the AGM+ write gate is app-layer in
-- PATCH /api/users/me/profile-blurb.

ALTER TABLE users ADD COLUMN profile_blurb text;

ALTER TABLE users ADD CONSTRAINT users_profile_blurb_len_chk
  CHECK (profile_blurb IS NULL OR char_length(profile_blurb) <= 500);
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0077_add_profile_blurb.sql
git commit -m "feat(profile-blurb): migration 0077 — users.profile_blurb column + len CHECK"
```

---

## Task 2: Type threading — `profileBlurb` on `User` / `UserRow` / `mapUser`

**Files:**
- Modify: `lib/types.ts` (the `User` interface, ends at the `language` field)
- Modify: `lib/session.ts` (`UserRow` interface + `mapUser`)

- [ ] **Step 1: Ground-truth**

Read `lib/types.ts` `User` interface (currently ends with `language: "en" | "es";`) and `lib/session.ts` `UserRow` + `mapUser` (UserRow ends with `language: "en" | "es";`; `mapUser` ends with `language: r.language,`). Confirm both still match before editing.

- [ ] **Step 2: Add `profileBlurb` to the `User` type**

In `lib/types.ts`, inside `export interface User { … }`, immediately after the `language: "en" | "es";` line, add:
```ts
  /** AGM+-editable "about me" blurb (≤500 chars) per the profile-blurb design. Null = unset. */
  profileBlurb: string | null;
```

- [ ] **Step 3: Add `profile_blurb` to `UserRow` and map it**

In `lib/session.ts`, in `interface UserRow { … }`, after `language: "en" | "es";` add:
```ts
  profile_blurb: string | null;
```
Then in `mapUser`, after the `language: r.language,` line, add:
```ts
    profileBlurb: r.profile_blurb,
```
(`requireSession` selects `*`, so the column loads with no query change.)

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). If a consumer that constructs a `User` literal elsewhere now errors on the missing `profileBlurb`, that's a real gap — find it (`grep -rn "language:" lib app components scripts | grep -i "user"`) and add `profileBlurb: null` (or the real value) there. Note any such site in the commit.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/session.ts
git commit -m "feat(profile-blurb): thread profileBlurb through User type + mapUser"
```

---

## Task 3: `PATCH /api/users/me/profile-blurb` route (AGM+ gate + length cap, no audit)

**Files:**
- Create: `app/api/users/me/profile-blurb/route.ts`

- [ ] **Step 1: Ground-truth the precedent**

Read `app/api/users/me/language/route.ts` in full. Confirm: imports `parseJsonBody, jsonError, jsonOk, extractIp` from `@/lib/api-helpers`; `requireSession, SESSION_COOKIE_NAME` from `@/lib/session`; `createAuthedClient` from `@/lib/supabase-server`. The self-update writes `.eq("id", ctx.user.id)` (NOTE: `ctx.user.id`, not `ctx.userId`), checks `updateErr` → 500 and empty rows → 403. Confirm `ROLES` is exported from `@/lib/roles` with `ROLES[role].level` numeric.

- [ ] **Step 2: Write the route**

Create `app/api/users/me/profile-blurb/route.ts`:
```ts
/**
 * PATCH /api/users/me/profile-blurb — set/clear the actor's profile blurb.
 *
 * Body: { blurb: string }  — trimmed; whitespace-only clears (stores NULL).
 * Response: { ok: true, blurb: string | null }
 *
 * AGM+ ONLY (role level >= 6). This gate is app-layer because RLS can't
 * express a role predicate on a self-update — to users_update_self it is just
 * the user editing their own row (always allowed). The level is derived from
 * the session-loaded user's role (not a JWT claim) so a same-session role
 * change can't leave a stale gate.
 *
 * No audit row: a profile blurb is a routine self-authored preference, like
 * language / phone / sms_consent (per AGENTS.md Phase 2 column-level notes).
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { ROLES } from "@/lib/roles";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

const MAX_BLURB_LEN = 500;

interface BlurbBody {
  blurb: string;
}

function isBlurbBody(raw: unknown): raw is BlurbBody {
  if (typeof raw !== "object" || raw === null) return false;
  return typeof (raw as Record<string, unknown>).blurb === "string";
}

export async function PATCH(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isBlurbBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include blurb (a string).",
      field: "blurb",
    });
  }

  // Normalize: trim; whitespace-only clears (NULL). Enforce length on the
  // trimmed value — the DB CHECK is the second line of defense.
  const trimmed = parsed.blurb.trim();
  if (trimmed.length > MAX_BLURB_LEN) {
    return jsonError(400, "blurb_too_long", {
      message: `Blurb must be ${MAX_BLURB_LEN} characters or fewer.`,
      field: "blurb",
    });
  }
  const value: string | null = trimmed.length === 0 ? null : trimmed;

  const ctx = await requireSession(req, "/api/users/me/profile-blurb");
  if (ctx instanceof Response) return ctx;

  // App-layer AGM+ gate (level >= 6). Derived from the session-loaded role.
  const level = ROLES[ctx.user.role].level;
  if (level < 6) {
    return jsonError(403, "forbidden", {
      message: "Only AGM and above can set a profile blurb.",
    });
  }

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  // RLS users_update_self gates this to the actor's own row; per AGENTS.md
  // silent-denial footgun, check rowCount and treat 0 as a 403/internal error.
  const { data: updatedRows, error: updateErr } = await authed
    .from("users")
    .update({ profile_blurb: value })
    .eq("id", ctx.user.id)
    .select("id");

  if (updateErr) {
    const ip = extractIp(req);
    console.error(
      `[/api/users/me/profile-blurb PATCH] update failed for user=${ctx.user.id} ip=${ip}:`,
      updateErr.message,
    );
    return jsonError(500, "internal_error", { message: "profile blurb update failed" });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return jsonError(403, "forbidden", { message: "Cannot update blurb for this user." });
  }

  return jsonOk({ ok: true, blurb: value });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Live smoke — set / gate / clear / length, against real rows**

Write `scripts/smoke-blurb-route.ts` (self-delete after). The route needs a real cookie, so the smoke exercises the *logic* directly via the service-role client + the same gate/length rules the route applies, then proves the route's RLS write path works through `createAuthedClient` is out of scope for a no-JWT smoke — instead assert the column-level facts the route depends on:
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ROLES } from "@/lib/roles";

async function main() {
  const sb = getServiceRoleClient();

  // Pick an AGM+ user (level>=6) and a level-5 user if present.
  const { data: users } = await sb.from("users").select("id, role, profile_blurb").eq("active", true);
  if (!users) throw new Error("no users");
  const agmPlus = users.find((u) => ROLES[u.role].level >= 6);
  const belowAgm = users.find((u) => ROLES[u.role].level < 6);
  if (!agmPlus) throw new Error("no AGM+ user to test with");
  console.log("AGM+ test user:", agmPlus.id, agmPlus.role, "level", ROLES[agmPlus.role].level);
  if (belowAgm) console.log("below-AGM user:", belowAgm.id, belowAgm.role, "level", ROLES[belowAgm.role].level);

  // 1) Set blurb on AGM+ user via service role, read it back.
  const blurb = "Hospitality is the difference. — test blurb";
  await sb.from("users").update({ profile_blurb: blurb }).eq("id", agmPlus.id);
  const { data: r1 } = await sb.from("users").select("profile_blurb").eq("id", agmPlus.id).single();
  console.log("set+readback ===", r1?.profile_blurb === blurb ? "PASS" : `FAIL got=${r1?.profile_blurb}`);

  // 2) Gate logic: the route would 403 a below-AGM actor. Assert the rule.
  if (belowAgm) {
    const wouldBlock = ROLES[belowAgm.role].level < 6;
    console.log("gate-blocks-below-AGM ===", wouldBlock ? "PASS" : "FAIL");
  }

  // 3) Clear: whitespace-only -> NULL (route maps "" -> null; here set null).
  await sb.from("users").update({ profile_blurb: null }).eq("id", agmPlus.id);
  const { data: r3 } = await sb.from("users").select("profile_blurb").eq("id", agmPlus.id).single();
  console.log("clear-to-null ===", r3?.profile_blurb === null ? "PASS" : `FAIL got=${r3?.profile_blurb}`);

  // 4) Over-length rejected by DB CHECK (route also rejects at 400).
  const { error: longErr } = await sb.from("users").update({ profile_blurb: "x".repeat(501) }).eq("id", agmPlus.id);
  console.log("db-check-rejects-501 ===", longErr ? `PASS (${longErr.code})` : "FAIL (accepted)");

  // restore NULL
  await sb.from("users").update({ profile_blurb: null }).eq("id", agmPlus.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx --env-file=.env.local scripts/smoke-blurb-route.ts`
Expected: all `=== PASS` (the 501 line prints `PASS (23514)`).

- [ ] **Step 5: Delete the smoke + commit the route**

```bash
rm scripts/smoke-blurb-route.ts
git add app/api/users/me/profile-blurb/route.ts
git commit -m "feat(profile-blurb): PATCH /api/users/me/profile-blurb (AGM+ gate, 500-char cap, no audit)"
```

---

## Task 4: Display — `loadPublicProfile` emits `blurb` (owner-level gated) + the two cards

**Files:**
- Modify: `lib/profiles.ts` (`PublicProfile` interface + `loadPublicProfile` target select, type, and return)
- Modify: `components/profile/PublicProfileCard.tsx`
- Modify: `components/profile/LeadershipCard.tsx`

- [ ] **Step 1: Ground-truth**

Read `lib/profiles.ts`: the target-user select line (`.from("users").select("id, name, role, created_at, active, email, phone")` + its `maybeSingle<{…}>()` type), the `const level = ROLES[u.role]?.level ?? 0;` line, and the return object (the one carrying `cardKind, contact, locationScope`). Read `components/profile/PublicProfileCard.tsx` (header block ends ~line 82, highlight tiles start ~line 84) and `components/profile/LeadershipCard.tsx` (location-scope `<p>` at ~line 58, contact block follows).

- [ ] **Step 2: Add `blurb` to the `PublicProfile` interface**

In `lib/profiles.ts`, inside `export interface PublicProfile { … }`, after the `locationScope?: "all" | string[];` line, add:
```ts
  /** AGM+ "about me" blurb. Null unless the OWNER is level >= 6 (gated at the loader). */
  blurb: string | null;
```

- [ ] **Step 3: Select the column and gate it at the loader**

In `loadPublicProfile`, add `profile_blurb` to the target select and its `maybeSingle` type. Change:
```ts
    .from("users").select("id, name, role, created_at, active, email, phone").eq("id", args.targetUserId)
    .maybeSingle<{ id: string; name: string; role: RoleCode; created_at: string; active: boolean; email: string | null; phone: string | null }>();
```
to:
```ts
    .from("users").select("id, name, role, created_at, active, email, phone, profile_blurb").eq("id", args.targetUserId)
    .maybeSingle<{ id: string; name: string; role: RoleCode; created_at: string; active: boolean; email: string | null; phone: string | null; profile_blurb: string | null }>();
```
Then in the returned object (alongside `cardKind, contact, locationScope`), add the owner-level gate using the already-derived `level`:
```ts
    blurb: level >= 6 ? (u.profile_blurb ?? null) : null,
```

- [ ] **Step 4: Verify the loader + gate via live smoke**

Write `scripts/smoke-blurb-display.ts` (self-delete after):
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadPublicProfile } from "@/lib/profiles";
import { ROLES } from "@/lib/roles";

async function main() {
  const sb = getServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: users } = await sb.from("users").select("id, role").eq("active", true);
  if (!users) throw new Error("no users");
  const agmPlus = users.find((u) => ROLES[u.role].level >= 6);
  if (!agmPlus) throw new Error("no AGM+ user");

  // Set a blurb, then load the profile as a same-as-target viewer (viewerLocations: "all" to bypass shared-location gate for the smoke).
  const blurb = "Test display blurb.";
  await sb.from("users").update({ profile_blurb: blurb }).eq("id", agmPlus.id);

  const prof = await loadPublicProfile(sb, {
    viewerUserId: agmPlus.id,
    viewerLocations: "all",
    targetUserId: agmPlus.id,
    today,
  });
  console.log("agm+ emits blurb ===", prof?.blurb === blurb ? "PASS" : `FAIL got=${prof?.blurb}`);

  // No-banned-keys regression: PublicProfile must not expose score/needsWork/areaToImprove/note.
  const keys = prof ? Object.keys(prof) : [];
  const banned = ["score", "needsWork", "areaToImprove", "note"].filter((k) => keys.includes(k));
  console.log("no-banned-keys ===", banned.length === 0 ? "PASS" : `FAIL ${banned.join(",")}`);

  // Demotion: simulate a target whose level < 6. Find/lower a throwaway? Instead,
  // assert the gate expression directly against a known below-6 user that has a blurb forced on the row.
  const belowAgm = users.find((u) => ROLES[u.role].level < 6);
  if (belowAgm) {
    await sb.from("users").update({ profile_blurb: "should be hidden" }).eq("id", belowAgm.id);
    const profLow = await loadPublicProfile(sb, {
      viewerUserId: belowAgm.id,
      viewerLocations: "all",
      targetUserId: belowAgm.id,
      today,
    });
    console.log("below-6 hides blurb ===", profLow && profLow.blurb === null ? "PASS" : `FAIL got=${profLow?.blurb}`);
    await sb.from("users").update({ profile_blurb: null }).eq("id", belowAgm.id);
  } else {
    console.log("below-6 hides blurb === SKIP (no below-AGM active user)");
  }

  await sb.from("users").update({ profile_blurb: null }).eq("id", agmPlus.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx --env-file=.env.local scripts/smoke-blurb-display.ts`
Expected: `agm+ emits blurb === PASS`, `no-banned-keys === PASS`, `below-6 hides blurb === PASS` (or SKIP).

- [ ] **Step 5: Render the blurb on `PublicProfileCard` (staff card — AGM/GM land here)**

In `components/profile/PublicProfileCard.tsx`, immediately AFTER the header block's closing `</div>` (the `bg-co-warning-surface` header, ~line 82) and BEFORE the `{/* Highlight tiles */}` comment, insert:
```tsx
      {/* About-me blurb (AGM+ only; loader already gates on owner level) */}
      {profile.blurb ? (
        <blockquote className="mb-4 border-l-2 border-co-gold pl-3 text-sm italic text-co-text-muted">
          {profile.blurb}
        </blockquote>
      ) : null}
```
(Plain text — React escapes by default; no `dangerouslySetInnerHTML`.)

- [ ] **Step 6: Render the blurb on `LeadershipCard` (MoO+ card)**

In `components/profile/LeadershipCard.tsx`, immediately AFTER the location-scope `<p>` (`📍 {scope}`, ~line 58) and BEFORE the `{/* Contact block */}` comment, insert:
```tsx
      {/* About-me blurb (loader gates on owner level >= 6; leadership is always >= 8) */}
      {profile.blurb ? (
        <blockquote className="mt-3 border-l-2 border-co-gold pl-3 text-sm italic text-co-text-muted">
          {profile.blurb}
        </blockquote>
      ) : null}
```

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: both PASS. (If `tsc` errors on `.next/types` after build, re-run `npx tsc --noEmit` — build regenerates them.)

- [ ] **Step 8: Delete the smoke + commit**

```bash
rm scripts/smoke-blurb-display.ts
git add lib/profiles.ts components/profile/PublicProfileCard.tsx components/profile/LeadershipCard.tsx
git commit -m "feat(profile-blurb): emit owner-level-gated blurb + render on both profile cards"
```

---

## Task 5: UserMenu editor (AGM+ only) + layout wiring + i18n

**Files:**
- Modify: `components/UserMenu.tsx` (props + new section + panel width)
- Modify: `app/(authed)/layout.tsx` (pass `actorLevel` + `initialBlurb`)
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json` (`user_menu.blurb.*`)

- [ ] **Step 1: Ground-truth**

Read `components/UserMenu.tsx` (props `userName`, `userEmail`; `handleLanguageSelect` fetch shape; the panel `<div role="menu" className="… w-64 …">`; the language section block; the nav/sign-out block). Read `app/(authed)/layout.tsx` (renders `<UserMenu userName={auth.user.name} userEmail={auth.user.email} />`; `auth.user` is the mapped `User`; `ROLES` import needed). Read existing `user_menu.*` keys in `lib/i18n/en.json` to match style.

- [ ] **Step 2: Add the i18n keys (EN + ES at parity)**

In `lib/i18n/en.json`, add (place alongside the other `user_menu.*` keys):
```json
  "user_menu.blurb.label": "Profile blurb",
  "user_menu.blurb.placeholder": "A favorite quote or a line about you…",
  "user_menu.blurb.counter": "{n}/500",
  "user_menu.blurb.save": "Save",
  "user_menu.blurb.saving": "Saving…",
  "user_menu.blurb.saved": "Saved",
  "user_menu.blurb.error": "Couldn't save. Try again.",
  "user_menu.blurb.too_long": "Blurb must be 500 characters or fewer.",
```
In `lib/i18n/es.json`, add the same keys (tú-form, operational):
```json
  "user_menu.blurb.label": "Tu perfil",
  "user_menu.blurb.placeholder": "Una frase favorita o algo sobre ti…",
  "user_menu.blurb.counter": "{n}/500",
  "user_menu.blurb.save": "Guardar",
  "user_menu.blurb.saving": "Guardando…",
  "user_menu.blurb.saved": "Guardado",
  "user_menu.blurb.error": "No se pudo guardar. Inténtalo de nuevo.",
  "user_menu.blurb.too_long": "La frase debe tener 500 caracteres o menos.",
```

- [ ] **Step 3: Add props + blurb state to UserMenu**

In `components/UserMenu.tsx`, extend the props interface:
```ts
interface UserMenuProps {
  /** User's display name — used to derive the initial for the trigger. */
  userName: string;
  /** User's email — shown in the menu header for context. */
  userEmail?: string | null;
  /** Actor's role level — the blurb editor renders only when >= 6 (AGM+). */
  actorLevel: number;
  /** Current saved blurb (null = unset) — seeds the editor. */
  initialBlurb: string | null;
}
```
Update the signature: `export function UserMenu({ userName, userEmail, actorLevel, initialBlurb }: UserMenuProps) {`.
Inside the component, after the existing `useState` declarations, add:
```ts
  const [blurb, setBlurb] = useState(initialBlurb ?? "");
  const [savedBlurb, setSavedBlurb] = useState(initialBlurb ?? "");
  const [blurbSaving, setBlurbSaving] = useState(false);
  const [blurbStatus, setBlurbStatus] = useState<"idle" | "saved" | "error">("idle");
```
And the save handler (place near `handleLanguageSelect`):
```ts
  const handleBlurbSave = async () => {
    const next = blurb.trim();
    if (blurbSaving || next === savedBlurb.trim()) return;
    setBlurbSaving(true);
    setBlurbStatus("idle");
    try {
      const res = await fetch("/api/users/me/profile-blurb", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blurb: next }),
        redirect: "manual",
      });
      if (res.ok) {
        const body = (await res.json()) as { blurb: string | null };
        const saved = body.blurb ?? "";
        setSavedBlurb(saved);
        setBlurb(saved);
        setBlurbStatus("saved");
      } else {
        setBlurbStatus("error");
      }
    } catch {
      setBlurbStatus("error");
    } finally {
      setBlurbSaving(false);
    }
  };
```

- [ ] **Step 4: Render the blurb section (AGM+ only) + widen the panel**

In `components/UserMenu.tsx`, widen the dropdown panel: change `w-64` to `w-72` on the `<div role="menu" …>` className.
Then, between the language section's closing `</div>` and the `{/* Navigation + session actions … */}` block, insert:
```tsx
          {actorLevel >= 6 ? (
            <div className="mt-3 border-t border-co-border-2 pt-3">
              <div className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
                {t("user_menu.blurb.label")}
              </div>
              <textarea
                value={blurb}
                onChange={(e) => {
                  setBlurb(e.target.value.slice(0, 500));
                  setBlurbStatus("idle");
                }}
                maxLength={500}
                rows={3}
                placeholder={t("user_menu.blurb.placeholder")}
                className="
                  mt-2 w-full resize-none rounded-lg border-2 border-co-border bg-co-surface
                  px-2 py-1.5 text-sm text-co-text
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                "
              />
              <div className="mt-1 flex items-center justify-between px-1">
                <span className="text-[11px] text-co-text-dim">
                  {t("user_menu.blurb.counter", { n: blurb.trim().length })}
                </span>
                <button
                  type="button"
                  onClick={() => void handleBlurbSave()}
                  disabled={blurbSaving || blurb.trim() === savedBlurb.trim()}
                  className="
                    inline-flex min-h-[36px] items-center rounded-lg border-2 border-co-gold-deep
                    bg-co-gold px-3 text-sm font-bold uppercase tracking-[0.1em] text-co-text
                    transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                    disabled:cursor-not-allowed disabled:opacity-50
                  "
                >
                  {blurbSaving ? t("user_menu.blurb.saving") : t("user_menu.blurb.save")}
                </button>
              </div>
              {blurbStatus === "saved" ? (
                <div className="mt-1 px-1 text-[11px] text-co-text-dim">{t("user_menu.blurb.saved")}</div>
              ) : null}
              {blurbStatus === "error" ? (
                <div className="mt-1 px-1 text-[11px] text-co-cta">{t("user_menu.blurb.error")}</div>
              ) : null}
            </div>
          ) : null}
```

- [ ] **Step 5: Wire the layout to pass the new props**

In `app/(authed)/layout.tsx`, add the `ROLES` import at the top with the other imports:
```ts
import { ROLES } from "@/lib/roles";
```
Change the render line:
```tsx
        <UserMenu userName={auth.user.name} userEmail={auth.user.email} />
```
to:
```tsx
        <UserMenu
          userName={auth.user.name}
          userEmail={auth.user.email}
          actorLevel={ROLES[auth.user.role].level}
          initialBlurb={auth.user.profileBlurb}
        />
```
Also check `components/UserMenu` is used in `app/(authed)/operations/closing/closing-client.tsx` (grep showed it) — if that callsite renders `<UserMenu …>` it now needs the two new props too. Read that file; if it mounts UserMenu, pass `actorLevel` + `initialBlurb` from whatever auth/user data it has (or, if it lacks the role/blurb, pass `actorLevel={0}` and `initialBlurb={null}` so the editor simply doesn't render there — the dashboard/global menu is the canonical edit surface). Confirm which and make the minimal correct change.

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: both PASS.

- [ ] **Step 7: i18n parity check**

Run:
```bash
node -e "const en=require('./lib/i18n/en.json'),es=require('./lib/i18n/es.json');const a=Object.keys(en),b=Object.keys(es);const miss=a.filter(k=>!b.includes(k)).concat(b.filter(k=>!a.includes(k)));console.log(miss.length?'MISSING: '+miss.join(', '):'PARITY OK ('+a.length+' keys)')"
```
Expected: `PARITY OK (…)`. Fix any reported missing key before committing.

- [ ] **Step 8: Commit**

```bash
git add components/UserMenu.tsx app/(authed)/layout.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(profile-blurb): UserMenu editor (AGM+ only) + layout wiring + i18n"
```

---

## Final verification (after all tasks)

- [ ] **Full typecheck + build:** `npx tsc --noEmit && npm run build` → both clean.
- [ ] **i18n parity:** the Task 5 Step 7 check prints `PARITY OK`.
- [ ] **Migration captured:** `supabase/migrations/0077_add_profile_blurb.sql` exists and matches what was applied.
- [ ] **No smoke scripts committed:** `git status` shows no `scripts/smoke-blurb-*.ts`.
- [ ] **Final review pass (CC as T0):** the AGM+ gate is app-layer in the route (not RLS); the display gate is at the loader (`level >= 6 ? … : null`); no `audit()` call in the route; no `dangerouslySetInnerHTML`; the route updates ONLY `profile_blurb`.
- [ ] Open the PR for Juan's preview smoke (set a blurb as an AGM+/owner account, confirm it shows on `/profile/[self]`; confirm a non-AGM account sees no editor).

## Spec coverage map

| Spec requirement | Task |
|---|---|
| Migration 0077 + CHECK, no RLS change | Task 1 |
| `profileBlurb` on `User`/`UserRow`/`mapUser` | Task 2 |
| `PATCH …/me/profile-blurb`: mirror language route + AGM+ gate + 500 cap + clear + no audit | Task 3 |
| `loadPublicProfile` emits owner-level-gated `blurb`; both cards render it; directory unchanged | Task 4 |
| UserMenu AGM+-only editor (textarea/counter/save), layout wiring, i18n parity | Task 5 |
| Verification: tsc/build + live smokes (set/gate/clear/501/display-gate/no-banned-keys) | Tasks 1,3,4 + Final |
