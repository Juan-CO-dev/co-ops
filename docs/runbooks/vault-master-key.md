# Password vault: the master key (`VAULT_MASTER_KEY`)

Spec: `docs/superpowers/specs/2026-10-08-password-vault-design.md`. Code: `lib/vault-crypto.ts` (the only reader of the variable), `lib/vault.ts`, migration `0235_password_vault.sql`.

## What it is

Every vault secret is encrypted with its own 32-byte data key (AES-256-GCM). That data key is wrapped (AES-256-GCM again) by the **master key**, which lives only in the server environment. The database holds ciphertext plus wrapped keys and never the master key, so a dump of `vault_secrets` reveals nothing without the Vercel environment. Each envelope row carries `master_key_id` (`v1` today) so a rotation can tell old wraps from new ones.

## Setting it (CC, Vercel, once)

1. Generate 32 random bytes as hex, on a machine you trust, never in chat and never in the repo:
   `openssl rand -hex 32`
   (44-char base64 of 32 bytes is accepted too.)
2. Vercel project -> Settings -> Environment Variables -> add `VAULT_MASTER_KEY` for Production (and Preview if the sim needs the vault). Mark it sensitive.
3. Keep an offline copy of the key in the owner's physical safe (paper or an encrypted drive). **If this key is lost, every vault secret is lost**: there is no recovery path by design.
4. Redeploy. Then, and only then, set `VAULT_ENABLED=1` (also Vercel). Until both are set the app deploys dark: `/vault` redirects to the dashboard, every `/api/vault/*` route answers `404 not_enabled`, the nav chip is absent.
5. Apply migration 0235 first (CC: sim, harness `scripts/test-password-vault.sql`, then prod on Juan's word). The app never runs a migration.

The sim and local builds use a throwaway key of their own. The vitest suite generates one per run and never reads a real one.

## What happens when it is missing or wrong

The vault **fails closed**. A reveal or a create with no key, a malformed key, or a key that does not unwrap the row:
- answers `503 vault_unavailable` (the UI says the vault is unavailable and that management has been alerted; nothing partial is shown),
- writes an audit row `vault.decrypt_failure` with the entry id, version and a reason code (`master_key_missing`, `master_key_invalid`, `decrypt_failed`, `scrubbed`, `no_current_version`), never bytes,
- sends an urgent `vault_alert` notification to level 8+.

Fix: restore the correct key in Vercel and redeploy. No data is touched by a failure.

## Rotation (documented procedure, not built in v1)

Rotating the master key means re-wrapping every data key; the secrets themselves are not re-encrypted and nothing is decrypted to plaintext in the process.

1. Generate the new key (`v2`). Keep the old one available for the duration.
2. Deploy a version of `lib/vault-crypto.ts` that knows both ids (`v1` unwraps with the old key, `v2` wraps and unwraps with the new one). `MASTER_KEY_ID` becomes `v2` so every NEW write uses the new key immediately.
3. Run a one-off, service-role script (foreground, from a trusted machine, both keys in env): for every `vault_secrets` row with `master_key_id = 'v1'` and `scrubbed_at IS NULL`, unwrap the data key with the old master key, wrap it with the new one, and update `wrapped_key`, `key_iv`, `key_tag`, `master_key_id`. The ciphertext, iv and tag of the secret stay byte-identical. The script must hold no plaintext secret at any point (it handles data keys only) and must log counts, never key material.
   This UPDATE is the one write the service role does not hold on `vault_secrets` today; the script runs as the owner connection or through a dedicated definer RPC shipped with the rotation PR.
4. Verify: `select master_key_id, count(*) from vault_secrets where scrubbed_at is null group by 1` shows only `v2`; reveal one shared entry on the sim.
5. Remove the old key from Vercel and the `v1` branch from the code in a follow-up PR; write an audit row for the rotation (`system.config_update` is reserved for this class).

## The 30-day scrub

On every secret change the previous version stays recoverable for 30 days by level 8+ (`recover previous` in the UI, recorded + notified). `vault_write_secret` scrubs the entry's older versions when a new one is written; `select public.vault_scrub_expired_secrets();` is the same sweep for every entry and is safe to schedule nightly (service role). Rows are kept as history; only the envelope bytes are nulled (`scrubbed_at` set).

## Never

- Never paste the key into chat, a ticket, a commit, a `.env` in the repo, or a log line.
- Never set `VAULT_ENABLED=1` before `VAULT_MASTER_KEY` is set and 0235 is applied.
- Never read `VAULT_MASTER_KEY` anywhere but `lib/vault-crypto.ts` (`tests/vault-plaintext-scan.test.ts` pins this).
