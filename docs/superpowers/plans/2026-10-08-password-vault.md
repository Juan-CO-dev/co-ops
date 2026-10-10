# Password Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tests first, small steps, every commit green.

**Goal:** Build the CO-OPS Password Vault (Juan, 2026-10-08: "Build the vault"): a shared vault of company logins, codes and AI-key records plus each user's own "My logins", with envelope encryption (AES-256-GCM), a PIN step-up on every reveal, an append-only reveal record and in-app notification to management on every shared reveal, a per-user hourly reveal cap with a burst flag, 30-day recoverable previous secrets, and everything behind `VAULT_ENABLED` (off).

**Spec (authoritative):** `docs/superpowers/specs/2026-10-08-password-vault-design.md` (approved by Juan 2026-10-08, PR #426). GO: `CO-CHIEF/05-BRIDGE/from-cc/GO-coops-password-vault-2026-10-08.md`.

**Architecture:** Four deny-all-RLS tables (0235, AUTHORED ONLY): `vault_entries` (metadata, never a secret), `vault_secrets` (append-only versions of the envelope: ciphertext + wrapped data key; the current version is the one with `superseded_at IS NULL`; a superseded version is recoverable for 30 days and then crypto-shredded in place, so history stays append-only), `vault_reveals` (append-only record of shared reveals and recoveries, never the secret; a CHECK makes a recorded personal *reveal* impossible), `vault_reveal_counters` (per-user hourly attempt counter for the cap, which names no entry). Writers are service-role (`vault_entries`) or SECURITY DEFINER RPCs granted to service_role only (`vault_write_secret`, `vault_take_reveal_slot`, `vault_scrub_expired_secrets`). The master key lives ONLY in server env `VAULT_MASTER_KEY`; `lib/vault-crypto.ts` is `server-only`; decryption happens exclusively inside `lib/vault.ts`'s authorized reveal/recovery paths after the route verified the actor's PIN for that request. Notifications ride the existing `enqueueNotification` + bell.

**Tech stack:** Next.js 16.2.4 (App Router, `proxy.ts`), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Node 22 `node:crypto`, Supabase Postgres 17 (custom JWT/RLS), vitest.

**Build constraints (house):** migration 0235 authored only (0234 belongs to the parallel customer-profiles build); never run a migration; never write to prod; en + es for every string and ARIA label; 44 px controls paired with `items-center`; `AuditAction` vocabulary is closed (register every new action); location bind inside the lib before any I/O; commit per task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Decisions made from the spec (conservative readings, flagged as DEVIATIONS where they add anything)

1. **PIN step-up = PIN verified in the reveal request itself.** The spec's reveal flow names "PIN step-up (existing step-up tier)"; the only PIN tier in the code is the counts/cash pattern (`verifyActorPin` inline on the POST). A PIN re-entered on every reveal is fresher than Tier B's 120 s window, so it satisfies "step-up B or higher". No password gate is added for managers (every role has a 4-digit PIN; all levels reveal the same way).
2. **Rate cap counts attempts, not only successes, and counts personal reveals through a counter that names no entry.** The cap exists to stop a captured session draining the vault; a personal reveal still consumes a slot, but nothing about *which* entry is written (spec: personal = no record). A wrong PIN also consumes a slot (brute force through the vault is capped). Constants: 20 attempts/hour cap, burst flag from the 10th attempt in an hour, one burst notification to level 8+ per hour-bucket.
3. **Level 8+ sees and manages every shop's entries** (spec: "level 8+ manage everything"); `lockLocationContext` (9+) stays the bind for GM/AGM/SL/KH. A "both shops" entry (`location_id IS NULL`) is visible to anyone at/above its floor.
4. **A manager may not set a floor above their own level** (they would lock themselves out of what they just wrote). GM (7) manages shared entries of their own shop only, never AI keys and never both-shop entries. AI keys default to floor 9 (owner/cgs).
5. **Owner-level recovery of a personal entry = level 9+** (owner/cgs). The recoverer picks the user, sees that user's personal entry *names*, recovers one with their PIN; the recovery is recorded and the entry's owner is notified.
6. **Previous-secret retention is enforced twice:** at read time (a superseded version older than 30 days is never returned) and by crypto-shredding in place (`vault_write_secret` scrubs that entry's expired versions; `vault_scrub_expired_secrets()` is the sweep CC can schedule). Rows are never deleted.
7. **Decryption failure fails closed:** `503 vault_unavailable`, an audit row `vault.decrypt_failure` (entry id, version, reason code; never bytes), and a `vault_alert` notification to level 8+. Nothing partial is shown.
8. **Notification recipients exclude the actor** (a manager is not told about their own view; the record still exists).
9. **Lifecycle audit rows carry a shared entry's name/type/shop/floor and a personal entry's id only.** Reveals and recoveries are recorded in `vault_reveals` (the spec's record), not duplicated into `audit_log`.
10. **Nav:** `/vault` appears in the dashboard nav only when `VAULT_ENABLED=1`; unified search does not list it (search is level-only and pure).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0235_password_vault.sql` | Four tables, deny-all RLS, grants, three definer RPCs, grant assertions |
| `lib/vault-flag.ts` | `vaultEnabled()` (pure env read, client-safe: undefined → false) |
| `lib/vault-shared.ts` | Types, closed vocabularies, limits, pure access rules, cap verdict, retention window, `VaultError`, input validation |
| `lib/vault-crypto.ts` | `server-only`: master-key parsing, `encryptSecret`, `decryptSecret` (AES-256-GCM envelope, AAD-bound) |
| `lib/vault.ts` | `server-only`: list/create/update/deactivate, `takeRevealSlot`, `revealVaultSecret`, `recoverPersonalSecret`, `recoverPreviousSecret`, recipients |
| `lib/notifications.ts` (modify) | `VAULT_REVEAL`, `VAULT_ENTRY_CHANGE`, `VAULT_RECOVERY`, `VAULT_BURST`, `VAULT_ALERT` types |
| `lib/destructive-actions.ts` (modify) | `vault_entry.create` / `.update` / `.deactivate`, `vault_secret.rotate` |
| `lib/audit-actions.ts` (modify) | `vault.decrypt_failure` (non-destructive observation) |
| `lib/nav-links.ts`, `components/DashboardNav.tsx` (modify) | `nav.vault` chip behind the flag |
| `app/api/vault/entries/route.ts` | GET list (no secrets), POST create |
| `app/api/vault/entries/[id]/route.ts` | PATCH metadata and/or new secret |
| `app/api/vault/entries/[id]/deactivate/route.ts` | POST deactivate |
| `app/api/vault/entries/[id]/reveal/route.ts` | POST `{ pin }` → `{ secret, version, autoHideSeconds, recorded }` |
| `app/api/vault/entries/[id]/recover/route.ts` | POST `{ pin, mode: "owner" \| "previous" }` |
| `app/api/vault/personal/[userId]/route.ts` | GET another user's personal entry names (level 9+) |
| `app/(authed)/vault/page.tsx`, `vault-client.tsx` | Server loader + client surface (tabs, list, reveal, forms) |
| `components/vault/SecretReveal.tsx` | Banner, secret, Copy, 30 s auto-hide |
| `components/vault/VaultEntryForm.tsx` | Add/edit form (en/es, 44 px) |
| `lib/i18n/en.json`, `es.json` (modify) | `vault.*`, `nav.vault`, `notifications.vault_*` |
| `scripts/test-password-vault.sql` | SQL harness for CC's sim (grants, RLS, RPC behaviour) |
| `scripts/vault-bundle-scan.mjs` | Post-build scan: `.next/static` must not contain the env name, the crypto module, or a canary |
| `docs/runbooks/vault-master-key.md` | Generate / set / rotate the master key (re-wrap procedure, not built in v1) |
| `tests/vault-*.test.ts` | Everything in the spec's Testing section (see tasks) |

---

## Task 1: Pure contracts and access rules (`lib/vault-shared.ts`, `lib/vault-flag.ts`)

**Files:** create `lib/vault-shared.ts`, `lib/vault-flag.ts`, `tests/vault-shared.test.ts`

- [ ] **Step 1: Write the failing tests** (`tests/vault-shared.test.ts`)
  - Floors: for each floor in `VAULT_ROLE_FLOORS` (4,5,6,7,8,9) and every level 0–10, `canSeeSharedEntry` is true iff level ≥ floor AND shop allowed.
  - Shop bind: same-shop member sees; other-shop member does not; level 8+ sees every shop; `location_id: null` (both) visible to anyone at/above floor.
  - Personal: only the owner sees/reveals; a level-10 actor cannot *reveal* another's personal entry through `canRevealEntry` (recovery is a separate path).
  - Manage: GM manages own-shop shared entries; not other shops; not `ai_key`; not both-shop; cannot set floor above own level; 8+ manages everything; everyone manages own personal; nobody manages another's personal.
  - `revealCapVerdict(n)`: allowed iff n ≤ 20; burst iff n ≥ 10; `notifyBurst` only at n = 10.
  - `previousSecretRecoverable(supersededAt, now)`: true within 30 days, false after, false when scrubbed.
  - `validateEntryInput`: name 1–120 (trimmed), username ≤ 200, url ≤ 500 and http(s) only, notes ≤ 2000, secret 1–4096, type in vocabulary; personal entries carry no shop/floor.
  - `vaultEnabled()`: `"1"` → true; anything else → false.
- [ ] **Step 2: Run** `npx vitest run tests/vault-shared.test.ts` — fails (modules missing).
- [ ] **Step 3: Implement** both modules (pure, zero I/O, no server imports).
- [ ] **Step 4: Run** the test file — green. `npx eslint lib/vault-shared.ts lib/vault-flag.ts tests/vault-shared.test.ts`.
- [ ] **Step 5: Commit** `feat(vault): pure access rules, cap verdict and retention window (shared)`.

## Task 2: Envelope encryption (`lib/vault-crypto.ts`)

**Files:** create `lib/vault-crypto.ts`, `tests/vault-crypto.test.ts`

- [ ] **Step 1: Write the failing tests** (throwaway 32-byte key generated in the test; never a real key)
  - `parseMasterKey` accepts 64-hex or 44-char base64 of 32 bytes; refuses wrong length / garbage with `master_key_invalid`; `loadMasterKey()` with env unset throws `master_key_missing`.
  - Round trip: `decryptSecret(encryptSecret(pt, key, aad), key, aad) === pt` for ASCII, UTF-8, 4096-char input.
  - Two encryptions of the same plaintext differ in ciphertext, iv, wrapped key (fresh data key + IV each time).
  - Tampering any of ciphertext / tag / iv / wrapped_key / key_tag, a different AAD (another entry id or version), or a different master key → throws `decrypt_failed`, and the error message contains neither the plaintext nor any key material.
  - Output shape: base64 strings; iv 12 bytes, tags 16 bytes, wrapped key 32 bytes, `masterKeyId === "v1"`.
- [ ] **Step 2: Run** — fails. **Step 3: Implement** with `node:crypto` (`aes-256-gcm`, `randomBytes`, AAD = `vault:${entryId}:${version}` for the secret, AAD = `vault-key:${masterKeyId}` for the wrap). `import "server-only"` at the top.
- [ ] **Step 4: Run** green; eslint. **Step 5: Commit** `feat(vault): AES-256-GCM envelope encryption, server-only, fails closed`.

## Task 3: Migration 0235 + migration contract test + SQL harness

**Files:** create `supabase/migrations/0235_password_vault.sql`, `tests/vault-migration.test.ts`, `scripts/test-password-vault.sql`

- [ ] **Step 1: Write the failing migration test**
  - First line `-- Migration 0235_password_vault`; `AUTHORED ONLY 2026-10-08 … NOT APPLIED`; `0234` appears exactly once (the reservation note); starts `begin;`, ends `commit;`.
  - Preflight `do` block asserts `locations`, `users`, `user_locations` columns and refuses re-apply.
  - Four tables each: `enable row level security`, the four `_no_user_*` policies, `revoke all … from public,anon,authenticated,service_role`.
  - Grants: `vault_entries` service_role select+insert+update, no delete; `vault_secrets` select only; `vault_reveals` select+insert only; `vault_reveal_counters` select only.
  - No `create or replace`, no `drop function`; created functions are exactly `vault_write_secret`, `vault_take_reveal_slot`, `vault_scrub_expired_secrets`; every one `security definer set search_path=pg_catalog,public`; the private-grant block names all three and raises `'0235: RPC grant escaped'`.
  - Checks present: `kind <> 'reveal' or entry_kind='shared'` (a personal reveal cannot be recorded), the personal/shared pairing checks, base64 length checks, `vault_secrets_one_current` partial unique index, 30-day scrub interval literal, no secret-shaped column on `vault_reveals` or `vault_entries` (no `secret`, `plaintext`, `password` column names).
- [ ] **Step 2: Author the migration** (mirror 0233's header, preflight, policy naming, grant-assertion block).
- [ ] **Step 3: Author `scripts/test-password-vault.sql`** (CC SIM ONLY, named sentinel, every fixture rolls back): grants/RLS assertions as `authenticated` and `anon`; `vault_write_secret` versions, supersedes, scrubs an artificially aged version; `vault_take_reveal_slot` increments per hour bucket; the `vault_reveals` CHECK refuses a recorded personal reveal.
- [ ] **Step 4: Run** `npx vitest run tests/vault-migration.test.ts` green. Also `bash scripts/phase2-discipline-check.sh supabase/migrations/0235_password_vault.sql` must PASS? — NO: that script asserts the Phase 2 §8.4 fields and only applies to migrations that re-emit `save_phase2_item_atomic`. 0235 re-emits nothing. Record this; the brief's "discipline (+ the 0235 path)" is satisfied by running the standard two CI invocations and noting that 0235 is out of that script's domain.
- [ ] **Step 5: Commit** `feat(vault): migration 0235 password vault (AUTHORED ONLY) + contract test + sim harness`.

## Task 4: Registries — audit actions, notification types, i18n keys

**Files:** modify `lib/destructive-actions.ts`, `lib/audit-actions.ts`, `lib/notifications.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`; create `tests/vault-i18n.test.ts`

- [ ] **Step 1: Failing i18n test**: parity of every `vault.*`, `nav.vault`, `notifications.vault_*` key between en and es with matching `{placeholders}`; later tasks extend the key list the test scans (it also greps `app/(authed)/vault/*.tsx` and `components/vault/*.tsx` for `t("vault.…")` keys and asserts each exists in both files).
- [ ] **Step 2: Add** the four destructive actions and `vault.decrypt_failure`; add the five notification types; add the i18n keys (titles/bodies for the five notification types, the banner, reveal/hide/copy, form labels, errors, nav label; Spanish tú-form).
- [ ] **Step 3: Run** `npx vitest run tests/vault-i18n.test.ts tests/audit-actions.test.ts` green.
- [ ] **Step 4: Commit** `feat(vault): audit actions, notification types and en/es keys`.

## Task 5: Server lib (`lib/vault.ts`) with fake-client tests

**Files:** create `lib/vault.ts`, `tests/vault-lib.test.ts`

- [ ] **Step 1: Failing tests** (fake `SupabaseClient` recording every `from().insert/update` and `rpc()` call; `@/lib/audit` and `@/lib/notifications` mocked; `VAULT_MASTER_KEY` stubbed to a throwaway key; `VAULT_ENABLED=1`)
  - Off switch: every entry point rejects `not_enabled` (404) before any I/O when the flag is off.
  - Location bind before I/O: a KH of shop A creating/revealing a shop-B entry → `location_access_denied`, `from` never called.
  - Shared reveal: decrypts, inserts one `vault_reveals` row `{kind:'reveal', entry_kind:'shared', secret_version}`, enqueues one `vault_reveal` notification whose recipients are exactly the active level-8+ users plus the entry shop's active GM(s) (both shops' GMs for a both-shop entry), excluding the actor; `locationId` = entry shop.
  - Personal reveal by owner: returns the secret, inserts NO `vault_reveals` row, enqueues NOTHING.
  - Personal reveal by a non-owner (any level) → `forbidden`.
  - Owner recovery (level 9): record `{kind:'owner_recovery', entry_kind:'personal'}` + one `vault_recovery` notification to the owner only; level 8 refused.
  - Previous recovery (level 8+): picks the newest superseded, unscrubbed version within 30 days; record `{kind:'previous_recovery'}` + notification to 8+ and the GM; refuses when expired/scrubbed/none (`no_previous_secret`); level 7 refused.
  - Cap: `takeRevealSlot` maps counts to verdicts; at the 10th attempt one `vault_burst` notification to 8+; at the 21st `reveal_cap` (429) and no decrypt.
  - Decrypt failure (tampered row / wrong key): throws `vault_unavailable` (503), audits `vault.decrypt_failure` with no bytes, notifies 8+ `vault_alert`.
  - Create/update/deactivate shared: `vault_entries` write, `vault_write_secret` RPC for the secret, `audit` row with name/type/shop/floor and NO secret, `vault_entry_change` notification to 8+ and GM. Personal: audit with id only, no notification.
  - Floors on manage: GM refused for `ai_key`, both-shop, other shop, floor above level; level 4 refused for any shared create.
  - `listVaultEntries`: never selects secret columns; returns shared entries at/above floor in allowed shops + own personal; `previousAvailable` only computed for 8+.
- [ ] **Step 2: Implement** `lib/vault.ts` (`import "server-only"`; every function takes the service client and an actor `{ userId, role, level, locations }`; bind → authorize → I/O; secret strings never placed in error messages, audit metadata, notification params or `console.*`).
- [ ] **Step 3: Run** green; eslint; `npx tsc --noEmit`.
- [ ] **Step 4: Commit** `feat(vault): server lib — reveal, recovery, cap, lifecycle, notifications`.

## Task 6: Routes with tests

**Files:** create the six route files, `tests/vault-routes.test.ts`

- [ ] **Step 1: Failing route tests** (mock `@/lib/session`, `@/lib/auth-flows`, `@/lib/vault`, `@/lib/supabase-server`)
  - Reveal: missing Origin → 403; flag off → 404 `not_enabled`; no `pin` → 400 and `verifyActorPin` not called; slot taken BEFORE PIN; wrong PIN → 401 `pin_invalid` and `revealVaultSecret` not called; cap → 429; success → 200 `{ secret, version, autoHideSeconds: 30, recorded }` and the body has no other keys.
  - Recover: `mode` validated; same PIN order.
  - Entries GET/POST/PATCH/deactivate: flag off 404; `VaultError` → its status/code; secrets never echoed in any response (`PATCH`/`POST` return metadata only).
  - Personal listing for recovery: level < 9 → 403.
- [ ] **Step 2: Implement** routes (`assertSameOrigin` on every POST/PATCH, `requireSession`, `vaultEnabled()`, `parseJsonBody`, `jsonError`/`jsonOk`).
- [ ] **Step 3: Run** green; eslint; tsc. **Step 4: Commit** `feat(vault): API routes — PIN on every reveal, cap before PIN, no secret echo`.

## Task 7: Plaintext / master-key leak scan (REQUIRED)

**Files:** create `tests/vault-plaintext-scan.test.ts`, `scripts/vault-bundle-scan.mjs`

- [ ] **Step 1: Write the scan test**: plant `CANARY_SECRET = "CANARY-7f3a-…"` and a throwaway master key (hex AND its base64 form). Run the whole lifecycle through `lib/vault.ts` with a recording fake client: create (shared + personal), update with a new secret, reveal (shared + personal), owner recovery, previous recovery, cap burst, a forced decrypt failure, deactivate. Capture: every DB write payload and RPC arg, every `audit()` call, every `enqueueNotification()` call, every `console.log/warn/error` line, every thrown error (message + JSON), and the route responses from Task 6 for an error path. Assert the canary and both key forms appear NOWHERE except the `secret` field of a successful reveal/recovery result. Also assert the stored ciphertext does not contain the canary.
- [ ] **Step 2: Static scan in the same test**: `app/(authed)/vault/**`, `components/vault/**` never import `@/lib/vault`, `@/lib/vault-crypto`, `node:crypto`; the string `VAULT_MASTER_KEY` appears only in `lib/vault-crypto.ts`, tests, the runbook, and the migration/plan docs; no `localStorage`/`sessionStorage`/`document.cookie` in vault client files.
- [ ] **Step 3: `scripts/vault-bundle-scan.mjs`**: after `npm run build`, walk `.next/static/**` and fail if `VAULT_MASTER_KEY`, `vault-crypto`, `createDecipheriv`, or `CANARY-` appears. Run in CI step and paste the output into the PR body.
- [ ] **Step 4: Commit** `test(vault): plaintext and master-key leak scan (canary) + bundle scan script`.

## Task 8: UI — page, client, reveal panel, form, nav

**Files:** create `app/(authed)/vault/page.tsx`, `vault-client.tsx`, `components/vault/SecretReveal.tsx`, `components/vault/VaultEntryForm.tsx`, `tests/vault-ui.test.ts`; modify `lib/nav-links.ts`, `components/DashboardNav.tsx`

- [ ] **Step 1: Failing UI contract tests** (source-text, same shape as the repo's i18n/UI tests): every `<button`/`<a`/`<input`/`<select` in the vault client files carries `min-h-[44px]` and `items-center` (inputs: `min-h-[44px]`); `VAULT_AUTO_HIDE_SECONDS` (30) is the only hide timer and is imported from `lib/vault-shared.ts`; `SecretReveal` clears its timer on unmount; no `console.`; every visible string goes through `t(` / `serverT(`; `navDestinationsFor(level)` omits `/vault` and `navDestinationsFor(level, { vault: true })` includes it for every level ≥ 1.
- [ ] **Step 2: Implement**
  - `page.tsx`: `requireSessionFromHeaders("/vault")`; `vaultEnabled()` else `redirect("/dashboard")`; load entries + active locations (id, code, name) + the actor's abilities; render `DashboardBackLink` + `<VaultClient …/>`.
  - `vault-client.tsx`: tabs Shared / My logins (and "Recover a personal login" for 9+); shop chips; rows (name, type, username, shop; never the secret); Reveal → PIN dialog (reuse `PinKeypad` inside the cash-style modal) → `SecretReveal`; Add / Edit / Deactivate (`VaultEntryForm`), Recover previous (8+). Errors switch on `code`.
  - `SecretReveal.tsx`: banner `vault.reveal.recorded_banner` for shared (`vault.reveal.personal_banner` for personal), monospace secret, Copy (`navigator.clipboard.writeText`), countdown, Hide now; `setTimeout(hide, 30_000)`, cleared on unmount; the secret lives in component state only.
  - Nav: `nav.vault` chip when `vaultEnabled()`.
- [ ] **Step 3: Run** `npx vitest run tests/vault-ui.test.ts tests/vault-i18n.test.ts`; `npx eslint` on the new files; `npx tsc --noEmit`.
- [ ] **Step 4: Commit** `feat(vault): /vault surface — PIN reveal, 30 s auto-hide, en/es, 44 px`.

## Task 9: Runbook + docs

**Files:** create `docs/runbooks/vault-master-key.md`

- [ ] Generating the key (`openssl rand -hex 32`), setting `VAULT_MASTER_KEY` and `VAULT_ENABLED` in Vercel (never in the repo, never in chat), what happens when it is missing (fail closed, alert), the rotation procedure (new key id `v2`, re-wrap every `vault_secrets.wrapped_key` with the new master key in a one-off service-role script, flip `master_key_id`, retire the old key), and the 30-day scrub sweep (`select public.vault_scrub_expired_secrets()`).
- [ ] **Commit** `docs(vault): master-key runbook (set, fail-closed, rotation by re-wrap)`.

## Task 10: CI (owner-only build lock) and hand-back

- [ ] `mkdir C:/co/scratch/w1-build.lock && { … ; rmdir C:/co/scratch/w1-build.lock; }` around: `bash scripts/phase2-discipline-check.sh` (+ the 0215 invocation CI runs), `npx vitest run --shard=1/2` and `--shard=2/2`, `NODE_OPTIONS=--max-old-space-size=4096 npm run build`, `node scripts/check-training-trace.mjs`, `node scripts/vault-bundle-scan.mjs`.
- [ ] `git fetch origin && git merge origin/main` (resolve nothing by hand that touches 0234); re-run the vault tests after the merge.
- [ ] `git bundle create C:/co/scratch/password-vault-<shorthead>.bundle origin/main..feat/password-vault` and `git bundle verify`.
- [ ] PR body → `C:\co\CO-CHIEF\05-BRIDGE\to-cc\2026-10-08-password-vault-done.md` (Juan's "Build the vault", plan summary, non-negotiable map, 0235 authored only, `VAULT_MASTER_KEY` + `VAULT_ENABLED` for CC, scan evidence, test evidence, deviations).

---

## Spec non-negotiables → where each lands

| Non-negotiable | Where |
|---|---|
| Envelope AES-256-GCM; master key only in server env | `lib/vault-crypto.ts`, `VAULT_MASTER_KEY`, runbook; tests Task 2 |
| Decrypt only server-side inside an authorized reveal; no plaintext in logs/audit/errors/bundle | `lib/vault.ts` (bind → authorize → PIN already verified → decrypt), Task 7 scan |
| Deny-all RLS + service-role writers + location bind | 0235; `lib/vault.ts` bind before I/O; Task 3/5 tests |
| PIN step-up on every reveal | reveal/recover routes verify `verifyActorPin` per request; Task 6 |
| Shared/AI-key reveal → append-only record + notification to 8+ and shop GM | `vault_reveals` (insert-only grant), `enqueueNotification`; Task 5 |
| Personal reveal → no record, no notification | lib skips both; DB CHECK forbids a recorded personal reveal; Task 5 |
| Owner recovery of a personal entry → record + owner notified | `recoverPersonalSecret` (9+); Task 5 |
| 30 s auto-hide | `VAULT_AUTO_HIDE_SECONDS`, `SecretReveal`; Task 8 |
| Per-user hourly cap with burst flag | `vault_take_reveal_slot`, `revealCapVerdict`, `vault_burst`; Task 1/5 |
| Previous secret 30 days, 8+ recover, recorded | `vault_secrets` versions, `recoverPreviousSecret`, scrub; Task 3/5 |
| Behind `VAULT_ENABLED` (off) | `vaultEnabled()` on every lib entry, route and page; nav chip; Task 1/5/6/8 |
| en/es, 44 px | Task 4/8 tests |
