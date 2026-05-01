/**
 * Admin script — set a temporary PIN on a user account.
 *
 * Bridge until Build #1.5 / Build #2 ships the user-initiated PIN-set
 * flow (verify-and-set-PIN, modeled on the existing verify-and-set-
 * password flow). This script exists for the same reason
 * `phase-2.5-provision-temp-users.ts` exists: real onboarding tooling
 * isn't shipped yet, but operational testing needs working credentials.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/set-temp-pin.ts <email> <4-digit-pin>
 *
 * Examples:
 *   npx tsx --env-file=.env.local scripts/set-temp-pin.ts juan@complimentsonlysubs.com 1234
 *
 * Validation:
 *   - PIN must be exactly 4 digits (regex /^\d{4}$/) — clear error otherwise
 *   - Email is lowercased before lookup (per Phase 2.5 lesson — emails are
 *     case-sensitive in schema; lookups must normalize)
 *   - User must exist + be active — clear error if not
 *
 * Idempotency: re-running for the same user with a different PIN
 * overwrites cleanly (last-write-wins). Re-running with the same PIN
 * still produces a new bcrypt hash (different salt) and a new audit
 * row — that's the expected forensic trail of an admin action.
 *
 * Audit: writes a `user.set_pin` row, destructive=true (admin auth-state
 * mutation; on the locked DESTRUCTIVE_ACTIONS list). Metadata captures
 * { user_id, target_email, set_method: "admin_script", actor:
 * "phase_3_smoke_test", script: "scripts/set-temp-pin.ts" }.
 *
 * Scrub procedure: when the proper PIN-set flow ships, run a script
 * to null `users.pin_hash` for users whose only PIN was admin-set
 * (find them via `audit_log` rows with action='user.set_pin' AND
 * metadata->>'set_method' = 'admin_script' AND no later user-driven
 * PIN-set audit row). See docs/PHASE_2.5_TEMP_USERS.md for context.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { hashPin } from "../lib/auth";

// Juan's user_id — actor for the audit rows. Stable since Phase 1 seed.
// This script is admin-action with no logged-in actor; we attribute to Juan
// because he's the operator running it. Matches the phase-2.5-provision
// pattern for the same reason.
const ACTOR_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";
const ACTOR_ROLE = "cgs"; // Juan's actual role per the Phase 1 seed

const PIN_RE = /^\d{4}$/;

interface UserRow {
  id: string;
  email: string | null;
  name: string;
  active: boolean;
  pin_hash: string | null;
}

async function lookupUser(sb: SupabaseClient, emailLower: string): Promise<UserRow | null> {
  const { data, error } = await sb
    .from("users")
    .select("id, email, name, active, pin_hash")
    .eq("email", emailLower)
    .maybeSingle<UserRow>();
  if (error) throw new Error(`user lookup failed for ${emailLower}: ${error.message}`);
  return data ?? null;
}

async function setPinForUser(
  sb: SupabaseClient,
  user: UserRow,
  pin: string,
): Promise<{ auditRowId: string; newHashPrefix: string }> {
  const newHash = await hashPin(pin);

  // Update users.pin_hash. Per AGENTS.md UPDATE-silent-denial footgun,
  // service-role bypasses RLS and the schema has NOT NULL on pin_hash —
  // this update should always succeed; we still check the error and
  // verify with a follow-up read.
  const { error: updateErr } = await sb
    .from("users")
    .update({ pin_hash: newHash })
    .eq("id", user.id);
  if (updateErr) {
    throw new Error(`pin_hash update failed for ${user.email}: ${updateErr.message}`);
  }

  // Verify by reading back. Confirms the column is non-null and matches
  // the bcryptjs $2[ab]$ prefix.
  const { data: verifyRow, error: verifyErr } = await sb
    .from("users")
    .select("id, pin_hash")
    .eq("id", user.id)
    .maybeSingle<{ id: string; pin_hash: string | null }>();
  if (verifyErr) throw new Error(`post-update verify read failed: ${verifyErr.message}`);
  if (!verifyRow || !verifyRow.pin_hash) {
    throw new Error(`post-update verify: pin_hash is null for ${user.email}`);
  }
  if (!/^\$2[ab]\$/.test(verifyRow.pin_hash)) {
    throw new Error(
      `post-update verify: pin_hash for ${user.email} doesn't match bcryptjs $2[ab]$ prefix`,
    );
  }

  // Audit. user.set_pin is on DESTRUCTIVE_ACTIONS (admin auth-state mutation).
  // Bypassing the audit() helper because this is a one-shot script with no
  // NextRequest to derive ip_address / user_agent from; matches the
  // phase-2.5-provision pattern.
  const { data: auditRow, error: auditErr } = await sb
    .from("audit_log")
    .insert({
      actor_id: ACTOR_USER_ID,
      actor_role: ACTOR_ROLE,
      action: "user.set_pin",
      resource_table: "users",
      resource_id: user.id,
      destructive: true,
      metadata: {
        user_id: user.id,
        target_email: user.email,
        set_method: "admin_script",
        actor: "phase_3_smoke_test",
        script: "scripts/set-temp-pin.ts",
        ip_address: null,
        user_agent: null,
      },
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (auditErr || !auditRow) {
    throw new Error(`audit_log insert failed: ${auditErr?.message ?? "no row"}`);
  }

  return { auditRowId: auditRow.id, newHashPrefix: verifyRow.pin_hash.slice(0, 4) };
}

async function main() {
  const args = process.argv.slice(2);
  const email = args[0];
  const pin = args[1];

  if (!email || !pin) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/set-temp-pin.ts <email> <4-digit-pin>",
    );
    process.exit(2);
  }

  if (!PIN_RE.test(pin)) {
    console.error(`Invalid PIN: must be exactly 4 digits (got ${JSON.stringify(pin)})`);
    process.exit(2);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set " +
        "(use --env-file=.env.local).",
    );
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const emailLower = email.trim().toLowerCase();
  const user = await lookupUser(sb, emailLower);
  if (!user) {
    console.error(`User not found: ${emailLower}`);
    process.exit(1);
  }
  if (!user.active) {
    console.error(`User ${emailLower} is inactive — refusing to set PIN on inactive account`);
    process.exit(1);
  }

  const { auditRowId, newHashPrefix } = await setPinForUser(sb, user, pin);

  process.stdout.write(
    `OK: temp PIN set for ${user.email} (${user.name})\n` +
      `  user_id:        ${user.id}\n` +
      `  hash_prefix:    ${newHashPrefix}\n` +
      `  audit_row_id:   ${auditRowId}\n` +
      `\n` +
      `  ⚠ This is a TEMPORARY admin-set PIN. Replace with the user-initiated\n` +
      `    PIN-set flow (Build #1.5 / Build #2) once it ships. Tracked in\n` +
      `    docs/PHASE_2.5_TEMP_USERS.md.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
