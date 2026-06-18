# Profile "About Me" Blurb — Design

**Date:** 2026-06-18
**Status:** Approved design, pre-plan
**Builds on:** the public-profiles arc (PR #74 — `lib/profiles.ts` `loadPublicProfile`, `components/profile/{PublicProfileCard, LeadershipCard}`, `/profile/[userId]`) and the self-update route precedent (`PATCH /api/users/me/language`, `lib/session.ts` `mapUser`, `components/UserMenu.tsx`).
**Cycle:** Juan's deferred "editable about-me blurb" — the first **write** feature on profiles.

---

## Goal

Let an **AGM+ (role level ≥ 6)** write a short free-text blurb — a favorite quote, a one-liner about themselves, whatever they want — that displays on their public profile. **Everyone who can already see that profile sees the blurb.** This is the first write path that touches profile content; it reuses the established self-update pattern and adds one app-layer role gate.

## Decisions (locked with Juan, 2026-06-18)

- **Who can set:** AGM+ only (`ROLES[role].level >= 6`). Lower staff get no edit affordance.
- **Who sees:** everyone who can already view that profile (the blurb rides the profile's existing visibility gate — shared-location for staff cards, company-wide for leadership cards). No separate visibility logic.
- **Edit surface:** the **UserMenu** dropdown (the documented growth path for account settings — the component was named generically in C.31 "as foundation for future expansion: password change, notification prefs, etc."). The blurb editor section renders only when the actor is AGM+.
- **Length & format:** **500 characters max, plain text** (no HTML, no markdown — rendered as text). Whitespace-only is treated as "no blurb" (stored `NULL`).
- **Audit:** **none** — mirrors `language` / `phone` / `sms_consent` self-updates (routine UI/profile preference, not an authorization or security event; per AGENTS.md Phase 2 column-level-enforcement notes).

## Data model — migration 0077 (next in the ledger; 0076 is latest applied)

Add one nullable column to `users`:

```sql
ALTER TABLE users ADD COLUMN profile_blurb text;
ALTER TABLE users ADD CONSTRAINT users_profile_blurb_len_chk
  CHECK (profile_blurb IS NULL OR char_length(profile_blurb) <= 500);
```

- **Nullable**, default `NULL` (no blurb). Append-only philosophy is unaffected — this is a mutable self-preference field like `phone`/`language`, not an operational artifact.
- The `CHECK` is **defense-in-depth** behind the route's own length validation (so a direct service-role write can't store an oversized blurb).
- **No RLS change.** `users_update_self` already permits a user to UPDATE any column on their own row; column-level gating is app-layer (AGENTS.md). The new column is writable under the existing self-update policy; the route enforces the AGM+ gate and the field whitelist (only `profile_blurb`).
- Captured as `supabase/migrations/0077_add_profile_blurb.sql` per the migration-text-repo-capture convention, applied via Supabase MCP `apply_migration`.

## Type threading

- `lib/types.ts` `User`: add `profileBlurb: string | null`.
- `lib/session.ts`: add `profile_blurb: string | null` to `UserRow`; map `profileBlurb: r.profile_blurb` in `mapUser`. `requireSession*` already `select("*")`, so the column loads with no extra query — `auth.user.profileBlurb` is available everywhere a session is loaded.

## API route — `PATCH /api/users/me/profile-blurb` (mirrors `…/me/language`)

```
Body:     { blurb: string }            // "" or whitespace-only ⇒ clears (stores NULL)
Response: { ok: true, blurb: string | null }
Errors:   400 invalid_payload          // body.blurb not a string
          400 blurb_too_long           // trimmed length > 500 (field: "blurb")
          403 forbidden                // actor level < 6 (not AGM+)
          401 / 500                     // unauth / silent-denial rowCount===0
```

Flow (exact `language` route shape):
1. `parseJsonBody` → validate `blurb` is a string. Trim; if trimmed length is 0 → `value = null`; else `value = trimmed`. Reject `> 500` (on the trimmed string) with `400 blurb_too_long`.
2. `requireSession(req, "/api/users/me/profile-blurb")`.
3. **AGM+ gate (app-layer):** `const level = ROLES[ctx.user.role].level; if (level < 6) return jsonError(403, "forbidden", …)`. (Derive from the role on the session-loaded user, not from a JWT claim, so a same-session role change can't leave a stale gate.)
4. `createAuthedClient(rawJwt)` → `.from("users").update({ profile_blurb: value }).eq("id", ctx.userId).select("id")`.
5. **Silent-denial guard:** if `error` → 500; if `rowCount === 0` (or no row returned) → 500 `internal_error` ("self row not updated"). Else `jsonOk({ blurb: value })`.
6. **No `audit()` call.**

## UserMenu editor (client)

`components/UserMenu.tsx` gains two props: `actorLevel: number` and `initialBlurb: string | null`. The layout passes `actorLevel={ROLES[auth.user.role].level}` and `initialBlurb={auth.user.profileBlurb}`.

- A **"Profile blurb"** section renders **only when `actorLevel >= 6`**, below the language section, above the nav/sign-out block.
- A `textarea` (max 500, `maxLength={500}`), seeded from `initialBlurb ?? ""`, with a live **`{n}/500`** counter and a **Save** button.
- Save → `PATCH /api/users/me/profile-blurb` with `{ blurb }` (same fetch/`redirect: "manual"`/error-surfacing shape as `handleLanguageSelect`). On 200: show a brief "Saved" confirmation, keep the menu open, and update local state to the returned value. Pessimistic (wait for 200 before treating as saved). Disable Save while in-flight and when the textarea equals the last-saved value.
- The dropdown panel widens enough to hold the textarea comfortably (the current `w-64` may grow to ~`w-72`/`w-80`); textarea is multi-row. Keeps the click-outside-to-close behavior.
- i18n: `user_menu.blurb.*` (section label, placeholder, counter `{n}`, save, saving, saved, error, too-long) EN + ES at parity.

## Display on the profile cards

- `lib/profiles.ts` `loadPublicProfile`: add `profile_blurb` to the `users` select; add `blurb: string | null` to the `PublicProfile` type (present for **both** `cardKind` values). No gate change — the blurb is shown whenever the profile itself is viewable.
- **`PublicProfileCard`** (staff, level < 8 — this is where an **AGM/GM**'s blurb shows, levels 6–7): render the blurb as a quote-styled block (italic, subtle quote mark, `text-co-text-muted`) directly under the header, before the highlight tiles. Only when `profile.blurb` is non-null.
- **`LeadershipCard`** (level ≥ 8 — MoO/owner/CGS): render the blurb in the same quote style, below the role/oversees line (near the contact block). Only when non-null.
- **Directory** (`ProfileDirectory`): unchanged — no blurb on directory cards (kept minimal: headline highlight only).
- Plain-text rendering only (React escapes by default; no `dangerouslySetInnerHTML`).

## Security / privacy

- **Write gate is app-layer and role-based** (AGM+ ≥ 6); RLS can't express "only AGM+ may set their own blurb" because to RLS it's just a self-row update. The route is the enforcement point. Verified by a smoke that a level-5 (shift_lead) self-update returns 403 and writes nothing.
- **Field whitelist:** the route updates only `profile_blurb`; no other column is touchable through it.
- **Length** bounded at the route (400) and the DB (`CHECK`) — two layers.
- **Display visibility = the profile's existing visibility.** No new exposure surface: a viewer who can't load the profile can't see the blurb. Leadership blurbs are company-wide-visible (same as the rest of the leadership card, by design).
- **Demotion edge (documented, accepted):** if an AGM+ sets a blurb and is later demoted below 6, the blurb keeps displaying but they can no longer edit it. Acceptable — the blurb is benign self-authored content and demotions are rare; no scrub step.
- Plain text only; no markup injection path.

## Verification (no test framework)

`tsc` + `next build` + throwaway `tsx` live smokes (`npx tsx --env-file=.env.local`, wrapped `async function main(){…}; main();`, self-deleting):

1. **Migration applied:** `profile_blurb` column exists on `users`, nullable, with the length CHECK (query `information_schema.columns` + `pg_constraint`).
2. **Set as AGM+:** for a level-≥6 user, the route logic path updates `profile_blurb` and a re-read returns it; `loadPublicProfile` surfaces it as `blurb`.
3. **Gate holds:** simulate the route's gate decision for a level-5 (shift_lead) actor → 403, no write (verify the row's `profile_blurb` is unchanged/NULL).
4. **Clear:** sending whitespace-only stores `NULL`; `loadPublicProfile.blurb` is `null`.
5. **Over-length rejected:** a 501-char string is rejected by the route's length check (400) and, independently, the DB CHECK rejects a direct insert of 501 chars.
6. **No banned keys regression:** `loadPublicProfile` still exposes no `score`/`needsWork`/`areaToImprove`/`note` keys (the blurb addition didn't widen the positive-only contract).

## Deferred (tracked)

- Blurb on directory cards / hover (kept minimal for now).
- Rich text / links / emoji-only styling beyond plain text.
- Per-employee (all-staff) blurbs — currently AGM+ only; revisit if Juan wants frontline staff to have one.
- Profile photo / avatar upload (needs storage; separate cycle).
- Moderation tooling (small trusted team; not needed at this scale).
