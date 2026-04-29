# JWT Secret Rotation Runbook

**Audience:** future you at 2am during an incident.
**Last updated:** 2026-04-29 (Phase 2 Session 3).
**Owner:** Juan (CGS).

---

## When to rotate

- **Suspected leak.** Anyone who shouldn't has had `AUTH_JWT_SECRET` in their hands. Rotate immediately. **This is the only "do it now" trigger.**
- **Planned rotation.** Annual hygiene, or after personnel changes with secret access. Schedule into a low-traffic window (CO is closed, mid-week 4–6am ET ideal).
- **Compliance.** Some auditors want quarterly or biannual rotation evidence. Keep this runbook executions log at the bottom.

If you're rotating because you *think* something might be wrong but you don't have a specific signal, instead:
- Check `audit_log` for `session_token_mismatch` rows in the last 30 days.
- Check Vercel logs for unusual 401 patterns.
- Decide *then* whether you're rotating.

---

## Why this is tricky: the dual-secret problem

`AUTH_JWT_SECRET` lives in **two places** that must stay in sync:

1. **Vercel env var** (`AUTH_JWT_SECRET`) — used by `lib/auth.ts` to sign JWTs.
2. **Supabase HS256 standby key** — used by PostgREST to verify the JWT signature when our app calls Supabase with `Authorization: Bearer <jwt>`.

If these drift even briefly:
- App-signed JWT can't be verified by Supabase → every authenticated request 500s with PostgREST error.
- App can't sign new JWTs (or signs them with one secret while Supabase verifies with another) → users can't log in, existing sessions die at next request.

**The Supabase Management API hex-decodes HS256 secret values on key creation.** When you `POST /v1/projects/{ref}/config/auth/signing-keys` with `private_jwk.k` set to a hex string like `"a1b2c3..."`, Supabase interprets it as hex and stores 32 raw bytes (one byte per pair of hex chars). Our app must read `AUTH_JWT_SECRET` via `Buffer.from(secret, "hex")` to produce the matching 32-byte key. **`lib/auth.ts` already does this** (`getJwtKey()`). If you ever rewrite the JWT signing path: hex-decode, not UTF-8.

---

## Pre-rotation checklist

Before doing anything destructive:

- [ ] Confirm you have admin access to both Vercel (env vars) and Supabase (signing keys via Management API or dashboard).
- [ ] Confirm you're rotating in a low-traffic window. During CO operating hours, every active user gets logged out and has to sign back in mid-shift.
- [ ] Have this runbook open in a tab the entire time.
- [ ] Have Vercel project ID and Supabase project ref handy:
    - Vercel project: (find in Vercel dashboard → project → settings)
    - Supabase project ref: `bgcvurheqzylyfehqgzh` (us-east-1)
- [ ] Confirm `audit_log` is healthy and writable. End-user clients can't insert into `audit_log` (RLS denies); the check must run via service-role:
    ```sql
    -- Run via Supabase SQL editor (uses service-role) or MCP execute_sql.
    INSERT INTO audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    VALUES (NULL, NULL, 'jwt_rotation_preflight', 'audit_log', NULL, '{"check": "writable"}', false)
    RETURNING id;
    ```
    If this fails, **stop and fix** before rotating — losing rotation evidence is a compliance risk.
- [ ] Optional but recommended: take a Supabase backup snapshot before rotating.

---

## Rotation procedure

### Step 1 — Generate the new secret

On your local machine, in this repo:

```sh
# POSIX / Git Bash
openssl rand -hex 32        # 64 hex chars → 32 bytes raw
# Or:
./scripts/generate-secrets.sh   # prints AUTH_JWT_SECRET, AUTH_PIN_PEPPER, AUTH_PASSWORD_PEPPER

# Windows PowerShell
.\scripts\generate-secrets.ps1  # AUTH_JWT_SECRET line is what you want
# Or:
npm run secrets:generate
```

The repo scripts emit all three peppers (JWT + PIN + password). Copy **only** the `AUTH_JWT_SECRET` line — leave PIN and password peppers alone, rotating those is a separate, more invasive operation that invalidates every existing PIN and password hash.

Save the new value to a temporary local file (e.g., `.env.local.generated.tmp`, gitignored). **Do not paste it into Slack, chat, screenshots, or commits.**

### Step 2 — Add new key as Supabase **standby**

Add the new HS256 key to Supabase as a *standby* (not current). Supabase will accept signatures from any in-rotation key (current + standby) on verification. Standby exists explicitly so you can stage a key before promoting it.

Via Management API:

```sh
curl -X POST \
  "https://api.supabase.com/v1/projects/bgcvurheqzylyfehqgzh/config/auth/signing-keys" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "algorithm": "HS256",
    "status": "standby",
    "private_jwk": {
      "kty": "oct",
      "k": "<NEW_HEX_SECRET_HERE>"
    }
  }'
```

The dashboard may eventually expose a "create key" UI; the API path always works. **Do not** delete or rotate the existing current key in this step — only add a new standby.

### Step 3 — Verify standby was accepted

```sh
curl "https://api.supabase.com/v1/projects/bgcvurheqzylyfehqgzh/config/auth/signing-keys" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
```

Confirm the response shows the new key with `"status": "standby"`. If anything looks wrong, **stop and fix before continuing** — at this stage the existing system is unaffected and you can roll back trivially by deleting the standby.

### Step 4 — Update Vercel env var

In the Vercel dashboard:
1. Project → Settings → Environment Variables.
2. Edit `AUTH_JWT_SECRET` to the new hex value.
3. Apply to **all environments** (Production, Preview, Development).
4. Save.

### Step 5 — Trigger a redeploy (or wait for env propagation)

Env var changes don't apply to running deployments retroactively. Either:
- Trigger a new production deploy (recommended), OR
- Wait for the next deploy in your normal cadence (acceptable only if next deploy is imminent).

Confirm the new deploy is live before proceeding.

### Step 6 — Wait for in-flight requests to settle

Wait **at least 10 minutes** before promoting the standby — longer than the configured `SESSION_IDLE_MINUTES` (default 10). This drains in-flight authenticated requests that may still be using JWTs signed with the old secret.

If `SESSION_IDLE_MINUTES` is set higher in env, wait longer (idle window + 2 min buffer).

### Step 7 — Promote standby to current in Supabase

**Preferred path: dashboard "Rotate keys" action.** Supabase → Project Settings → JWT Signing Keys (or Auth → Signing Keys depending on dashboard version). Click **Rotate keys** to atomically swap standby ↔ current. This is what we used during Phase 2 Session 2's standby-key resolution; we know it works end-to-end.

**Fallback: Management API PATCH** when only API access is available:

```sh
curl -X PATCH \
  "https://api.supabase.com/v1/projects/bgcvurheqzylyfehqgzh/config/auth/signing-keys/<NEW_KEY_ID>" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "status": "in_use" }'
```

(Adjust endpoint and payload to match the API as actually exposed when you read this — see https://supabase.com/docs/reference/api/. The conceptual operation is "promote standby".)

After Step 7:
- The new key is the **current** signing key.
- The old key drops to **previously used** state — Supabase will *not* verify signatures against it. Existing JWTs signed with the old secret die at their next request.

### Step 8 — Optional: revoke old key after 12 hours

Wait at least 12 hours (longer than the JWT `exp` ceiling). At that point all sessions signed with the old secret have expired naturally. You can now `DELETE` the old key. Until then, leave it in `previously_used` state — it provides a safety net if you need to roll back.

---

## What to monitor during rotation

Each prose item below has a copy-pasteable SQL or shell check. Don't make 2am-you write these from scratch.

### Vercel function logs — 401 spikes

A small bump after Step 7 is expected (sessions with old JWTs being rejected as users hit the system). A *sustained high rate* means something is wrong — jump to "Recovery" below.

```sh
# Vercel CLI: stream production runtime logs
vercel logs <your-project> --follow

# Or the Vercel dashboard: Project → Logs, filter status=401, time range = last 30 min
```

### `audit_log` — `session_token_mismatch` spike

**Mental model:** the JWT body and `token_hash` are independent of the signing secret. So `session_token_mismatch` during rotation is **not** a rotation health signal. A spike here likely indicates an **active attack** — someone replaying a captured cookie or attempting JWT forgery. Investigate separately, but **continue the rotation** rather than abort. Two issues at once doesn't mean two-issues-merged.

```sql
SELECT count(*)
FROM audit_log
WHERE action = 'session_token_mismatch'
  AND occurred_at > now() - interval '30 minutes';
```

### `audit_log` — sign-in failure rate by reason

A breakdown by reason is more diagnostic than a raw count. `wrong_pin` / `wrong_password` ticks are normal user behavior. `missing_password_hash` / `missing_pin_hash` / `account_inactive` clusters indicate user-data problems independent of rotation.

```sql
SELECT action,
       metadata->>'reason' AS reason,
       count(*) AS n
FROM audit_log
WHERE action LIKE 'auth_signin_%_failure'
  AND occurred_at > now() - interval '30 minutes'
GROUP BY action, metadata->>'reason'
ORDER BY n DESC;
```

### Active session count delta

Should approach zero shortly after Step 7 (all old sessions die), then climb again as users sign back in. Run this *before* rotating to capture baseline, then again ~30 min after Step 7.

```sql
SELECT count(*) AS active_sessions
FROM sessions
WHERE expires_at > now()
  AND revoked_at IS NULL;
```

### `auth_logout` outcome distribution

After Step 7, expect a temporary uptick in `outcome=session_not_found` and `outcome=jwt_invalid` as clients with stale cookies hit logout. Should stabilize within ~10 minutes.

```sql
SELECT metadata->>'outcome' AS outcome, count(*) AS n
FROM audit_log
WHERE action = 'auth_logout'
  AND occurred_at > now() - interval '30 minutes'
GROUP BY metadata->>'outcome'
ORDER BY n DESC;
```

### User reports

"I keep getting logged out" is expected for ~10 minutes after Step 7 as old JWTs expire on next request. After that, *new* reports indicate something's broken.

---

## Recovery (rotation failed mid-flight)

### Symptom: Vercel env updated, Supabase still has only old key as current

→ App signs JWTs with new secret; Supabase verifies with old. **Every authenticated request fails.**

**Recovery:** Revert Vercel `AUTH_JWT_SECRET` to the old value. Trigger redeploy. Wait for propagation. Existing sessions resume. Retry rotation.

### Symptom: Standby was promoted in Supabase, Vercel env still has old secret

→ App signs with old secret; Supabase only verifies new. **Every authenticated request fails.**

**Recovery — pick one:**

- **Cleanest rollback: DELETE the new (now-current) key**, which causes Supabase to fall back to the previous-used (old) key as current. Use the Management API:
    ```sh
    curl -X DELETE \
      "https://api.supabase.com/v1/projects/bgcvurheqzylyfehqgzh/config/auth/signing-keys/<NEW_KEY_ID>" \
      -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
    ```
- **Reversible alternative: PATCH the new key's `status` back to `previously_used`** (or whatever the API uses for non-current standby) and PATCH the old key back to `in_use`:
    ```sh
    # Demote new key
    curl -X PATCH "<...>/signing-keys/<NEW_KEY_ID>" \
      -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
      -d '{ "status": "previously_used" }'
    # Re-promote old key
    curl -X PATCH "<...>/signing-keys/<OLD_KEY_ID>" \
      -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
      -d '{ "status": "in_use" }'
    ```

In both paths, Vercel can stay on the old secret. System returns to pre-rotation state. Retry rotation from Step 4.

### Symptom: Both rotated but users are still failing

→ Stale browser caches with old JWT cookies. Expected for up to 12 hours (JWT exp ceiling). Log all users out forcibly via:

```sql
UPDATE sessions
SET revoked_at = now()
WHERE revoked_at IS NULL;
```

Append-only philosophy keeps the rows for audit. Users will sign back in fresh.

---

## Forbidden patterns

- **Never delete the old key first, then add new.** There's a window with no signing key at all and EVERY authenticated request fails. The order is always: **add new → verify → promote → demote old → optionally delete old.**
- **Never rotate without redeploying.** Env var change without redeploy = inconsistent state across instances. Confirm new deploy is live before promoting standby.
- **Never rotate during operating hours unless responding to a known leak.** Even a clean rotation logs everyone out at Step 7. Schedule planned rotations into closed-window slots.
- **Never paste the new secret into chat / Slack / commits.** Always: `.env.local.generated.tmp` (gitignored), copy values to Vercel UI manually, delete the tmp file.

---

## Post-rotation verification

After Step 7 (and again after Step 8 if you delete the old key):

1. Sign in as Juan via PIN. Confirm 200 + Set-Cookie.
2. Sign in as Juan via password. Confirm 200 + Set-Cookie.
3. Hit a protected route (e.g., `/api/admin/*` once they exist) — confirm session validates.
4. Check `audit_log`:
    ```sql
    SELECT action, count(*) FROM audit_log
    WHERE occurred_at > now() - interval '1 hour'
      AND action LIKE 'auth_%'
    GROUP BY action;
    ```
    Expect normal volumes; high `auth_signin_*_failure` means something's still off.

---

## Rotation log

Append a row each time you rotate. Don't include the secret value. Date, reason, who performed it, post-rotation status.

| Date | Reason | Performed by | Outcome |
|---|---|---|---|
| _none yet_ | | | |
