# Leadership Profile Variant (MoO+) — Design

**Date:** 2026-06-18
**Status:** Approved design, pre-plan
**Builds on / folds into:** PR #74 public profiles (`lib/profiles.ts` `loadPublicProfile`/`loadProfileDirectory`, `/profile` directory + `/profile/[userId]`, `components/profile/{PublicProfileCard, ProfileDirectory}`). **Ships on the `claude/public-profiles` branch (folds into #74).**
**Cycle:** the leadership card variant for MoO+. (Editable "about me" blurb = the separate next cycle.)

---

## Goal

MoO+ (`ROLES[role].level >= 8` — moo / owner / cgs) don't do floor tasks, so the operational stats card is mostly empty for them. Give them a **leadership contact card** — identity + how to reach them — that any staff member can find (reachability). Their operational stats card still renders below (they do some operational things; positive-only, no notes — unchanged).

## What changes (read-only, no migration)

### `loadPublicProfile` — add a `cardKind` discriminator
Determine `cardKind` from the target's level: `ROLES[targetRole].level >= 8` → `"leadership"`, else `"staff"`.

- **`"staff"` (level < 8):** unchanged — the shared-location visibility gate applies; returns the positive stats aggregate only.
- **`"leadership"` (level ≥ 8):** **bypasses the shared-location gate** (any authenticated viewer may see it — reachability is the intent; it's also the only way the owner, who has 0 `user_locations` rows, is reachable). Adds:
  - `contact: { email: string | null; phone: string | null }` (from `users.email` / `users.phone`; phone shown only when present).
  - `locationScope: "all" | string[]` — `"all"` when the target's level ≥ 9 (owner/cgs all-locations) OR they have no location rows; else their location codes.
  - Still computes the **same positive stats aggregate** (so the stats card renders below the leadership card).

The returned `PublicProfile` gains optional `cardKind`, `contact`, `locationScope` (present only for leadership). All other fields unchanged. **No score/needs-work/notes ever** — leadership stats are the same positive projection as staff.

### Profile page (`/profile/[userId]`)
- `cardKind === "leadership"` → render `<LeadershipCard>` (identity + contact + oversees) **then** the existing `<PublicProfileCard>` (stats) below.
- `cardKind === "staff"` → just `<PublicProfileCard>` (as now).

### `loadProfileDirectory` — add a leadership section
Return `{ staff: DirectoryEntry[]; leadership: LeadershipDirectoryEntry[] }` where `leadership` = **all active users with `ROLES[role].level >= 8`** (regardless of shared location), each `{ userId, name, role }`. `staff` = the current shared-location list, now excluding level ≥ 8 (they live in the leadership section). The page renders a **"Leadership"** section (cards → leadership profile) above the location-scoped staff grid.

### Components
- **`components/profile/LeadershipCard.tsx`** (new) — avatar · name · role chip · location scope (`profile.leadership.all_locations` or codes) · a "what they oversee" line (`profile.leadership.oversees.<role>`) · contact rows: ✉ `mailto:{email}` (when present), 📞 `tel:{phone}` (when present). A small "Leadership" tag.
- **`ProfileDirectory`** — render a Leadership section (heading `profile.leadership.section`) of leadership cards + the existing staff grid.

### i18n `profile.leadership.*` (EN+ES)
section heading, "All locations", contact labels (email/phone/"contact"), and `oversees.moo` / `oversees.owner` / `oversees.cgs` short lines (e.g. "Oversees all store operations" / "Owns the business" / "Growth & strategy").

## Security / privacy

- **Leadership email + phone are visible to every authenticated staff member** — the deliberate "how to reach leadership" choice (confirmed). Phone rendered only when set. (Not gated on `sms_consent` — that governs SMS messaging, not display.)
- **Leadership bypasses the shared-location gate; staff profiles do NOT** — only the `level >= 8` branch is ungated. The staff path keeps its `if (!shared) return null`.
- Stats for leadership = the same positive-only aggregate (no score/needs-work/notes; the eval SELECT still lists only the four gradient columns).
- `loadPublicProfile` still derives nothing for an arbitrary caller beyond the target's positive/contact fields; inactive target → null (both kinds).

## Verification (no test framework)

`tsc` + `next build` + throwaway `tsx` smokes (live):
- A leadership target (level ≥ 8) is viewable by a viewer sharing **no** location (gate bypassed); `cardKind === "leadership"`; `contact.email` present; `locationScope` is `"all"` for owner/cgs.
- A staff target (level < 8) with no shared location still returns `null` (staff gate intact).
- Leadership profile still has **no** score/needsWork/note keys (positive stats unchanged).
- `loadProfileDirectory` returns a `leadership` array containing all active level≥8 users (incl. the owner with no location rows), and `staff` excludes level≥8.

## Deferred (tracked)

- **Editable "about me" blurb** (AGM+ settable; needs a `users` column + edit UI + API) — the next cycle.
- Bio/photo beyond the blurb; company-wide staff visibility; opt-out.
