/**
 * Phase 2.5 — provision temporary production accounts for Pete and Cristian.
 *
 * Bridge task between Phase 2 (auth lifecycle complete) and Phase 5+ (admin
 * tooling + Resend domain verification). Pete and Cristian need to log in to
 * watch Phase 3 progress; the proper invite/verify flow can't deliver email
 * to non-Juan recipients yet (foundation Resend constraint, AGENTS.md Phase 2
 * Session 4). Service-role direct insert is the deliberate workaround.
 *
 * These accounts get scrubbed and re-onboarded through the proper verify flow
 * once Phase 5+ admin tooling + Resend domain verification land. See
 * docs/PHASE_2.5_TEMP_USERS.md for the scrub procedure.
 *
 * Run:
 *   PETE_PASSWORD='...' CRISTIAN_PASSWORD='...' \
 *     npx tsx --env-file=.env.local scripts/phase-2.5-provision-temp-users.ts
 *
 * Plaintext passwords NEVER touch disk. Pass them via env vars at invocation.
 * The script reads them, hashes them via lib/auth.ts hashPassword() (which
 * applies AUTH_PASSWORD_PEPPER), and zeros the variables before continuing.
 *
 * Per §6.2 discipline (AGENTS.md Phase 2 Session 5): every service-role write
 * destructures { error } and throws on error so constraint violations surface
 * immediately. The most likely catch is users.pin_hash NOT NULL (§6.1).
 *
 * Idempotency: re-running after partial success will fail at the users insert
 * with the unique-email constraint. To re-run cleanly, manually surface the
 * partial state to Juan and decide on cleanup — do NOT silently skip.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { hashPassword, hashPin } from "../lib/auth";
import { getRoleLevel, type RoleCode } from "../lib/roles";

// Juan's user_id — actor for the audit rows. Stable since Phase 1 seed.
const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

// Location ids supplied by Juan from the provisioning spec.
const LOCATION_MEP = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const LOCATION_EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";

// Placeholder PIN. users.pin_hash is NOT NULL (§6.1 schema-as-defense). These
// users won't use PIN auth (level 5+ uses email+password); the placeholder is
// strictly to satisfy the schema constraint. Documented in metadata.
const PLACEHOLDER_PIN = "0000";

interface UserSpec {
  email: string;
  name: string;
  role: RoleCode;
  password: string;
  locations: string[]; // explicit user_locations assignments; [] for level-7+
}

function readPassword(envVar: string, who: string): string {
  const v = process.env[envVar];
  if (!v) {
    throw new Error(
      `${envVar} is not set. Pass via: ${envVar}='...' npx tsx --env-file=.env.local scripts/phase-2.5-provision-temp-users.ts`,
    );
  }
  if (v.length < 8) {
    throw new Error(`${envVar} must be at least 8 characters (got ${v.length}) for ${who}.`);
  }
  return v;
}

async function provisionUser(
  sb: SupabaseClient,
  spec: UserSpec,
): Promise<{ userId: string; auditRowId: string }> {
  // Pre-flight: refuse if email already exists. Belt-and-suspenders to the
  // unique constraint — gives a clearer error than a 23505.
  const { data: existing, error: existErr } = await sb
    .from("users")
    .select("id, email")
    .ilike("email", spec.email)
    .maybeSingle<{ id: string; email: string }>();
  if (existErr) throw new Error(`pre-flight email check failed: ${existErr.message}`);
  if (existing) {
    throw new Error(
      `email ${spec.email} already exists as user_id=${existing.id}; resolve manually before re-running`,
    );
  }

  const passwordHash = await hashPassword(spec.password);
  const pinHash = await hashPin(PLACEHOLDER_PIN);

  const { data: row, error: insertErr } = await sb
    .from("users")
    .insert({
      email: spec.email,
      name: spec.name,
      role: spec.role,
      active: true,
      email_verified: true,
      email_verified_at: new Date().toISOString(),
      password_hash: passwordHash,
      pin_hash: pinHash,
      phone: null,
      sms_consent: false,
      created_by: JUAN_USER_ID,
    })
    .select("id, email, name, role, active, email_verified")
    .maybeSingle<{
      id: string;
      email: string;
      name: string;
      role: RoleCode;
      active: boolean;
      email_verified: boolean;
    }>();
  if (insertErr) throw new Error(`users insert failed for ${spec.email}: ${insertErr.message}`);
  if (!row) throw new Error(`users insert returned no row for ${spec.email}`);

  // Assign explicit user_locations rows when the spec supplies any.
  // Pete's spec is [] (level-7 override applies); Cristian's is [MEP, EM].
  if (spec.locations.length > 0) {
    const locationRows = spec.locations.map((locId) => ({
      user_id: row.id,
      location_id: locId,
      assigned_by: JUAN_USER_ID,
    }));
    const { error: locErr } = await sb.from("user_locations").insert(locationRows);
    if (locErr) {
      throw new Error(`user_locations insert failed for ${spec.email}: ${locErr.message}`);
    }
  }

  // Verify post-state with explicit reads. NOT a sign-in test (per spec —
  // Phase 2 audit harness already proves auth-flow correctness).
  const { data: verify, error: verifyErr } = await sb
    .from("users")
    .select("id, email, name, role, active, email_verified, password_hash, pin_hash")
    .eq("id", row.id)
    .maybeSingle<{
      id: string;
      email: string;
      name: string;
      role: RoleCode;
      active: boolean;
      email_verified: boolean;
      password_hash: string | null;
      pin_hash: string | null;
    }>();
  if (verifyErr || !verify) {
    throw new Error(`post-insert verify failed for ${spec.email}: ${verifyErr?.message ?? "no row"}`);
  }
  if (!verify.password_hash) throw new Error(`post-insert verify: ${spec.email} password_hash is null`);
  if (!verify.pin_hash) throw new Error(`post-insert verify: ${spec.email} pin_hash is null`);
  if (!verify.active) throw new Error(`post-insert verify: ${spec.email} not active`);
  if (!verify.email_verified) throw new Error(`post-insert verify: ${spec.email} not email_verified`);

  // Verify location assignments separately (empty for level-7+).
  const { data: locRows, error: locReadErr } = await sb
    .from("user_locations")
    .select("location_id")
    .eq("user_id", row.id);
  if (locReadErr) throw new Error(`post-insert user_locations read failed: ${locReadErr.message}`);
  const assignedLocs = (locRows ?? []).map((r) => r.location_id as string).sort();
  const expectedLocs = [...spec.locations].sort();
  if (assignedLocs.length !== expectedLocs.length) {
    throw new Error(
      `post-insert verify: ${spec.email} expected ${expectedLocs.length} locations, got ${assignedLocs.length}`,
    );
  }
  for (let i = 0; i < expectedLocs.length; i++) {
    if (assignedLocs[i] !== expectedLocs[i]) {
      throw new Error(
        `post-insert verify: ${spec.email} location mismatch at index ${i}: expected ${expectedLocs[i]}, got ${assignedLocs[i]}`,
      );
    }
  }

  // Audit. user.create is the canonical lifecycle action (lib/destructive-actions.ts);
  // auto-derives destructive=true via lib/audit.ts isDestructive(). This script
  // bypasses the audit() helper because it has no NextRequest to drive
  // ip_address / user_agent extraction — but follows the same convention.
  const { data: auditRow, error: auditErr } = await sb
    .from("audit_log")
    .insert({
      actor_id: JUAN_USER_ID,
      actor_role: "cgs",
      action: "user.create",
      resource_table: "users",
      resource_id: row.id,
      destructive: true,
      metadata: {
        phase: "2.5_temp_provisioning",
        reason: "pre-admin-tools manual creation for visibility into Phase 3 build",
        scrub_target_phase: "5+",
        creation_method: "service_role_direct_insert",
        email_pipeline_used: false,
        credentials_transmitted_via: "out-of-band (Juan to user)",
        provisioned_email: spec.email,
        provisioned_role: spec.role,
        provisioned_role_level: getRoleLevel(spec.role),
        provisioned_locations: spec.locations,
        pin_hash_origin: `placeholder hashPin('${PLACEHOLDER_PIN}') — schema NOT NULL constraint per audit doc §6.1`,
        ip_address: null,
        user_agent: null,
      },
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (auditErr || !auditRow) {
    throw new Error(`audit_log insert failed for ${spec.email}: ${auditErr?.message ?? "no row"}`);
  }

  return { userId: row.id, auditRowId: auditRow.id };
}

async function main() {
  // Read passwords from env first; fail fast if missing. Variables stay
  // local to main(); never logged, never written to disk, never persisted.
  let petePassword = readPassword("PETE_PASSWORD", "Pete");
  let cristianPassword = readPassword("CRISTIAN_PASSWORD", "Cristian");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const peteResult = await provisionUser(sb, {
    email: "Pete@complimentsonlysubs.com",
    name: "Pete",
    role: "owner",
    password: petePassword,
    locations: [],
  });

  const cristianResult = await provisionUser(sb, {
    email: "Cristian@complimentsonlysubs.com",
    name: "Cristian",
    role: "moo",
    password: cristianPassword,
    locations: [LOCATION_MEP, LOCATION_EM],
  });

  // Best-effort scrub of the in-memory plaintext. Not a security guarantee
  // (V8 may have copies elsewhere), but doesn't hurt.
  petePassword = "";
  cristianPassword = "";

  process.stdout.write(
    `OK: provisioned 2 temp accounts\n` +
      `  Pete:     user_id=${peteResult.userId}  audit_id=${peteResult.auditRowId}\n` +
      `  Cristian: user_id=${cristianResult.userId}  audit_id=${cristianResult.auditRowId}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
