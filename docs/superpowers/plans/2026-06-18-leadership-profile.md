# Leadership Profile Variant (MoO+) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A leadership contact-card variant for MoO+ (level ≥ 8) in public profiles — company-wide reachable (email/phone/role/oversees/location-scope) with the positive stats card stacked below — folding into the open #74 branch.

**Architecture:** `loadPublicProfile` gains a `cardKind` discriminator; the `level >= 8` branch bypasses the shared-location gate and adds contact + locationScope (staff path unchanged). The directory gains a company-wide Leadership section. A new `LeadershipCard` renders above the existing stats card. No migration.

**Tech Stack:** Next.js 16 App Router (Server Components), TS strict + `noUncheckedIndexedAccess`, Supabase service-role reads, Tailwind v4. No test framework — `tsc` + `next build` + `tsx` live smokes.

**Branch:** `claude/public-profiles` (the open #74 branch — this FOLDS IN; do NOT branch off main).

**Spec:** `docs/superpowers/specs/2026-06-18-leadership-profile-design.md`

---

## Ground-truth (verified, current on this branch)

- `lib/profiles.ts` (committed in #74): `PublicProfile` (≈L22), `DirectoryEntry` (L37), private `viewableUserIds` (L45), `loadProfileDirectory` → `DirectoryEntry[]` (L64), `loadPublicProfile(service, { viewerUserId, viewerLocations, targetUserId, today })` (L86) with gate `if (!u || !u.active) return null` (L93) and the shared-location gate `if (!shared) return null` (L100). Imports `type RoleCode` from `@/lib/roles` — **NOT `ROLES`** (add it for the level lookup). The `users` SELECT in `loadPublicProfile` is `id, name, role, created_at, active` (add `email, phone`).
- `ROLES[role].level`: moo 8, owner 9, cgs 10 (the level≥8 set); agm/gm 6/7; below that ≤5. `users.email` / `users.phone` are `text` (phone often null).
- Directory page `app/(authed)/profile/page.tsx`: `const entries = await loadProfileDirectory(...)` → `<ProfileDirectory entries={entries} viewerUserId=... language=... />`. `ProfileDirectory` props `{ entries: DirectoryEntry[]; viewerUserId; language }`.
- `/profile/[userId]` page renders `<PublicProfileCard profile={profile} ... isSelf=... />`.
- i18n `profile.*` keys exist (en/es parity). Reuse `PublicProfileCard` unchanged for the stats portion.

---

## File structure

- **Modify `lib/profiles.ts`** — `cardKind`/`contact`/`locationScope` on `loadPublicProfile`; `loadProfileDirectory` → `{ staff, leadership }`.
- **Modify `lib/i18n/en.json` + `es.json`** — `profile.leadership.*`.
- **Create `components/profile/LeadershipCard.tsx`**; **Modify `components/profile/ProfileDirectory.tsx`** (Leadership section).
- **Modify `app/(authed)/profile/page.tsx`** (new directory shape) + **`app/(authed)/profile/[userId]/page.tsx`** (render LeadershipCard + stats for leadership).

---

### Task 1: `loadPublicProfile` — `cardKind` + contact + locationScope (leadership bypasses gate)

**Files:** Modify `lib/profiles.ts`; Smoke `scripts/smoke-leadership-profile.ts` (throwaway, live).

- [ ] **Step 1: Read `lib/profiles.ts`** to anchor the exact lines.

- [ ] **Step 2: Change the roles import** at the top:
`import type { RoleCode } from "@/lib/roles";` → `import { ROLES, type RoleCode } from "@/lib/roles";`

- [ ] **Step 3: Extend the `PublicProfile` interface** — add three fields (the last two optional, present only for leadership):
```ts
  cardKind: "staff" | "leadership";
  contact?: { email: string | null; phone: string | null };
  locationScope?: "all" | string[];
```

- [ ] **Step 4: In `loadPublicProfile`:**
  1. Add `email, phone` to the target `users` SELECT: `.select("id, name, role, created_at, active, email, phone")` and widen the `maybeSingle<...>` generic to include `email: string | null; phone: string | null`.
  2. After the `if (!u || !u.active) return null;` line, compute the kind:
     ```ts
     const level = ROLES[u.role]?.level ?? 0;
     const cardKind: "staff" | "leadership" = level >= 8 ? "leadership" : "staff";
     ```
  3. Replace the existing shared-location gate so it ONLY runs for staff (leadership is company-wide reachable). The current block is:
     ```ts
     const { data: tul } = await service.from("user_locations").select("location_id").eq("user_id", args.targetUserId);
     const targetLocationIds = (tul ?? []).map((r) => (r as { location_id: string }).location_id);
     if (args.viewerLocations !== "all") {
       const shared = targetLocationIds.some((l) => args.viewerLocations.includes(l));
       if (!shared) return null;
     }
     ```
     Change the `if` to gate only staff:
     ```ts
     const { data: tul } = await service.from("user_locations").select("location_id").eq("user_id", args.targetUserId);
     const targetLocationIds = (tul ?? []).map((r) => (r as { location_id: string }).location_id);
     if (cardKind === "staff" && args.viewerLocations !== "all") {
       const shared = targetLocationIds.some((l) => args.viewerLocations.includes(l));
       if (!shared) return null;
     }
     ```
  4. After `locationCodes` is computed, derive the leadership extras:
     ```ts
     const contact = cardKind === "leadership" ? { email: u.email ?? null, phone: u.phone ?? null } : undefined;
     const locationScope: "all" | string[] | undefined =
       cardKind === "leadership" ? (level >= 9 || targetLocationIds.length === 0 ? "all" : locationCodes) : undefined;
     ```
  5. Add `cardKind, contact, locationScope` to the returned object (everything else unchanged):
     ```ts
     return {
       userId: u.id, name: u.name, role: u.role, locationCodes, tenureDays,
       mvpWins, tasksAllTime, gradient: { great, good }, streaks, velocity,
       cardKind, contact, locationScope,
     };
     ```
  Leave the stats computation (comps/streaks/velocity/mvp/evals) exactly as-is — it still runs for leadership (so the stats card renders). The eval SELECT stays the 4 gradient columns only (no area_to_improve/note).

- [ ] **Step 5: Live smoke** `scripts/smoke-leadership-profile.ts` (wrap in `main()`):
```ts
import { loadPublicProfile } from "@/lib/profiles";
import { ROLES } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { operationalNow } from "@/lib/midshift";
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
function lvl(role: string): number { return (ROLES as Record<string, { level: number }>)[role]?.level ?? 0; }
async function main() {
  const sb = getServiceRoleClient();
  const today = operationalNow(new Date()).date;
  const bogus = "00000000-0000-0000-0000-000000000000";

  // find a leadership user (level>=8) and a staff user (level<8)
  const { data: users } = await sb.from("users").select("id, role, active").eq("active", true);
  const all = (users ?? []) as Array<{ id: string; role: string }>;
  const leader = all.find((u) => lvl(u.role) >= 8);
  const staff = all.find((u) => lvl(u.role) < 8);

  if (leader) {
    // viewer shares NO location → leadership STILL visible (gate bypassed)
    const p = await loadPublicProfile(sb, { viewerUserId: "v", viewerLocations: [bogus], targetUserId: leader.id, today });
    assert(p !== null, "leadership viewable with no shared location (gate bypassed)");
    assert(p!.cardKind === "leadership", "cardKind=leadership");
    assert(!!p!.contact && "email" in p!.contact, "leadership has contact");
    assert(p!.locationScope !== undefined, "leadership has locationScope");
    if (lvl(leader.role) >= 9) assert(p!.locationScope === "all", "owner/cgs locationScope=all");
    for (const banned of ["score", "needsWork", "areaToImprove", "note"]) assert(!Object.keys(p!).includes(banned) && !(banned in (p!.gradient as object)), `no ${banned}`);
  } else { console.log("(no leadership user; leadership sub-checks skipped)"); }

  if (staff) {
    // viewer shares NO location → staff still gated to null
    const targetLocs = (await sb.from("user_locations").select("location_id").eq("user_id", staff.id)).data ?? [];
    if (targetLocs.length) {
      const s = await loadPublicProfile(sb, { viewerUserId: "v", viewerLocations: [bogus], targetUserId: staff.id, today });
      assert(s === null, "staff still gated to null with no shared location");
    }
    // shared-location staff → staff card
    const firstLoc = (targetLocs[0] as { location_id: string } | undefined)?.location_id;
    if (firstLoc) {
      const s2 = await loadPublicProfile(sb, { viewerUserId: "v", viewerLocations: [firstLoc], targetUserId: staff.id, today });
      assert(s2 !== null && s2!.cardKind === "staff" && s2!.contact === undefined, "shared-location staff → staff card, no contact");
    }
  } else { console.log("(no staff user; staff sub-checks skipped)"); }

  console.log("ALL PASS");
}
main();
```

- [ ] **Step 6:** Run → `ALL PASS`. **Step 7:** `tsc` clean. **Step 8:** delete smoke + commit:
```bash
rm scripts/smoke-leadership-profile.ts
git add lib/profiles.ts
git commit -m "feat(profiles): loadPublicProfile cardKind — leadership (MoO+) bypasses gate, adds contact + locationScope

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: i18n `profile.leadership.*` (en + es)

**Files:** Modify `lib/i18n/en.json` + `es.json`; parity smoke (throwaway).

- [ ] **Step 1: en.json:**
```json
  "profile.leadership.section": "Leadership",
  "profile.leadership.tag": "Leadership",
  "profile.leadership.all_locations": "All locations",
  "profile.leadership.contact": "Contact",
  "profile.leadership.email": "Email",
  "profile.leadership.phone": "Phone",
  "profile.leadership.oversees.moo": "Oversees all store operations",
  "profile.leadership.oversees.owner": "Owner",
  "profile.leadership.oversees.cgs": "Growth & strategy"
```
- [ ] **Step 2: es.json:**
```json
  "profile.leadership.section": "Liderazgo",
  "profile.leadership.tag": "Liderazgo",
  "profile.leadership.all_locations": "Todas las ubicaciones",
  "profile.leadership.contact": "Contacto",
  "profile.leadership.email": "Correo",
  "profile.leadership.phone": "Teléfono",
  "profile.leadership.oversees.moo": "Supervisa todas las operaciones",
  "profile.leadership.oversees.owner": "Propietario",
  "profile.leadership.oversees.cgs": "Crecimiento y estrategia"
```
- [ ] **Step 3: Parity smoke** (assert key parity + the 9 `profile.leadership.*` keys present in both). Run → `ALL PASS`. **Step 4:** `tsc` clean. **Step 5:** delete smoke + commit:
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(profiles): profile.leadership.* i18n (en+es)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `loadProfileDirectory` → `{ staff, leadership }` + ProfileDirectory section + directory page

**Files:** Modify `lib/profiles.ts`, `components/profile/ProfileDirectory.tsx`, `app/(authed)/profile/page.tsx`. (These change together — the return shape couples them.)

- [ ] **Step 1: `lib/profiles.ts`** — add the leadership directory type + rework `loadProfileDirectory`:
```ts
export interface LeadershipDirectoryEntry {
  userId: string;
  name: string;
  role: RoleCode;
}

export interface ProfileDirectoryResult {
  staff: DirectoryEntry[];
  leadership: LeadershipDirectoryEntry[];
}
```
Replace the body of `loadProfileDirectory` so it returns `ProfileDirectoryResult`:
- Keep the existing shared-location `viewableUserIds` → users → MVP-tally logic to build the staff list, BUT **exclude level ≥ 8** from `staff` (they belong in `leadership`): when mapping `userRows`, filter `ROLES[u.role]?.level ?? 0) < 8`.
- Build `leadership` from a separate query — **all active users whose role is a leadership role** (`ROLES[r].level >= 8`), regardless of location:
```ts
  const LEADERSHIP_ROLES = (Object.keys(ROLES) as RoleCode[]).filter((r) => (ROLES[r]?.level ?? 0) >= 8);
  const { data: leaders } = await service.from("users").select("id, name, role").eq("active", true).in("role", LEADERSHIP_ROLES);
  const leadership: LeadershipDirectoryEntry[] = ((leaders ?? []) as Array<{ id: string; name: string; role: RoleCode }>)
    .map((u) => ({ userId: u.id, name: u.name, role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
```
- Return `{ staff, leadership }`. (`staff` keeps the existing mvp-desc sort, minus leadership roles.)

- [ ] **Step 2: `components/profile/ProfileDirectory.tsx`** — change props to the new shape + render a Leadership section above the staff grid:
  - Import `type { DirectoryEntry, LeadershipDirectoryEntry } from "@/lib/profiles"`.
  - Props: `{ staff: DirectoryEntry[]; leadership: LeadershipDirectoryEntry[]; viewerUserId: string; language: Language }`.
  - Render: if `leadership.length`, a section with heading `serverT(language, "profile.leadership.section")` + a 2-col grid of leadership cards (`<Link href={\`/profile/${e.userId}\`}>`: avatar initial · name (+ `profile.you` when self) · `ROLES[e.role].shortLabel` · a small `profile.leadership.tag` chip). Then the existing staff grid (the current `entries.map` markup, now over `staff`); if BOTH `staff.length === 0` and `leadership.length === 0`, show `profile.directory_empty`.

- [ ] **Step 3: `app/(authed)/profile/page.tsx`** — update the call + props:
```tsx
  const { staff, leadership } = await loadProfileDirectory(sb, {
    viewer: { userId: auth.user.id, locations: accessibleLocations(actor) },
  });
  // ...
      <ProfileDirectory staff={staff} leadership={leadership} viewerUserId={auth.user.id} language={lang} />
```

- [ ] **Step 4:** `tsc` + `npm run build` → clean. **Step 5:** commit:
```bash
git add lib/profiles.ts components/profile/ProfileDirectory.tsx "app/(authed)/profile/page.tsx"
git commit -m "feat(profiles): directory Leadership section (all active MoO+, company-wide)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `LeadershipCard` component

**Files:** Create `components/profile/LeadershipCard.tsx`. Server Component; `tsc` + `next build`.

- [ ] **Step 1:** Create `components/profile/LeadershipCard.tsx`. Props `{ profile: PublicProfile; language: Language }` (uses `profile.name`, `profile.role`, `profile.locationScope`, `profile.contact`). Layout:
  - Wrapper `rounded-2xl border-2 border-co-border bg-co-warning-surface p-5` (warm leadership accent).
  - Header: avatar circle (44px `bg-co-gold`, first letter) + name (`text-xl font-extrabold`) + role chip (`ROLES[profile.role].shortLabel`) + a `profile.leadership.tag` pill.
  - Oversees line (`text-xs text-co-text-muted`): `serverT(language, \`profile.leadership.oversees.${profile.role}\` as TranslationKey)` — only render if that role has an oversees key (the 3 leadership roles do; guard: only `moo`/`owner`/`cgs` reach this card, so it's always present).
  - Location scope line: `📍 {profile.locationScope === "all" ? serverT(language,"profile.leadership.all_locations") : (profile.locationScope ?? []).join(" · ")}`.
  - Contact block (`mt-3`): heading `profile.leadership.contact`; an email row when `profile.contact?.email` — `<a href={\`mailto:${email}\`}>✉ {email}</a>`; a phone row when `profile.contact?.phone` — `<a href={\`tel:${phone}\`}>📞 {phone}</a>`. Style as tappable rows (`text-sm text-co-text`, link underline-offset/hover).
  Use small inline helpers if useful. Guard `profile.contact` optional.

- [ ] **Step 2:** `tsc` + `npm run build` → clean. **Step 3:** commit:
```bash
git add components/profile/LeadershipCard.tsx
git commit -m "feat(profiles): LeadershipCard (contact/identity card for MoO+)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `/profile/[userId]` — render LeadershipCard + stats for leadership

**Files:** Modify `app/(authed)/profile/[userId]/page.tsx`.

- [ ] **Step 1:** Import `LeadershipCard`: `import { LeadershipCard } from "@/components/profile/LeadershipCard";`
- [ ] **Step 2:** Replace the single-card render with conditional stacking. The current render is:
```tsx
      <PublicProfileCard profile={profile} language={lang} isSelf={profile.userId === auth.user.id} />
```
Replace with:
```tsx
      {profile.cardKind === "leadership" ? (
        <div className="flex flex-col gap-4">
          <LeadershipCard profile={profile} language={lang} />
          <PublicProfileCard profile={profile} language={lang} isSelf={profile.userId === auth.user.id} />
        </div>
      ) : (
        <PublicProfileCard profile={profile} language={lang} isSelf={profile.userId === auth.user.id} />
      )}
```
(The back link + main wrapper stay. `PublicProfileCard` is unchanged — it ignores the new `cardKind`/`contact`/`locationScope` fields.)

- [ ] **Step 3:** `tsc` + `npm run build` → clean. Confirm `/profile` + `/profile/[userId]` still in the route list. **Step 4:** commit:
```bash
git add "app/(authed)/profile/[userId]/page.tsx"
git commit -m "feat(profiles): stack LeadershipCard + stats card on MoO+ profiles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Final verification + push (updates #74)

- [ ] **Step 1:** `npx tsc --noEmit && npm run build` → clean.
- [ ] **Step 2:** Comprehensive live smoke `scripts/smoke-leadership-final.ts` (throwaway): leadership target viewable with no shared location (gate bypassed) + cardKind/contact/locationScope correct; staff target with no shared location → null (staff gate intact); no banned keys on either; `loadProfileDirectory` returns a `leadership` array including all active level≥8 (incl. owner with no location rows) and `staff` excludes level≥8. Run → `ALL PASS`; `rm`.
- [ ] **Step 3:** Commit any remaining + push to the existing branch (updates PR #74):
```bash
git push   # branch claude/public-profiles already tracks origin; updates PR #74
```
Then update the PR #74 description/title note (optional via `gh pr edit 74`) to mention the leadership variant, OR add a PR comment summarizing the fold-in. Report the PR #74 URL + preview.

---

## Self-review

**Spec coverage:** cardKind discriminator + leadership-bypass + staff-gate-intact (T1) ✓; contact email/phone + locationScope all-vs-codes (T1) ✓; stats still computed for leadership (T1 — unchanged path) ✓; directory Leadership section company-wide incl. owner (T3) ✓; staff excludes level≥8 (T3) ✓; LeadershipCard with mailto/tel + oversees + scope (T4) ✓; profile page stacks leadership + stats (T5) ✓; i18n (T2); no migration ✓; folds into #74 (branch) ✓; blurb deferred (noted) ✓.

**Placeholder scan:** complete code T1–T3, T5; structural-with-exact-props T4. No TBD.

**Type consistency:** `PublicProfile` gains `cardKind`/`contact?`/`locationScope?` (T1), consumed by LeadershipCard (T4) + the [userId] page (T5). `ProfileDirectoryResult { staff, leadership }` + `LeadershipDirectoryEntry` (T3) consumed by ProfileDirectory (T3) + page (T3). `loadProfileDirectory` return shape change is contained to T3 (loader + component + page together → compiles). `ROLES` import added (T1) used in T1 + T3 (level lookup, LEADERSHIP_ROLES). `PublicProfileCard` untouched (ignores new optional fields).

**Privacy check:** only the `level >= 8` branch skips the gate; the staff `if (cardKind === "staff" && ... ) { if (!shared) return null }` keeps the staff gate exactly. Stats path + eval SELECT unchanged → still no score/needs-work/notes for either kind. Leadership email/phone exposure is the deliberate company-wide choice (spec-confirmed).
