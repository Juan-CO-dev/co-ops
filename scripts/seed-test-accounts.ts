/**
 * Seed durable test accounts for Commit B smoke — location d2cced11 (EM).
 * Run: npx tsx scripts/seed-test-accounts.ts
 *
 * 3 accounts by role code: ZZ_TEST_KH1 (key_holder), ZZ_TEST_KH2 (key_holder), ZZ_TEST_PREP (trainee).
 * Levels resolve from role code at runtime — post-C.41 renumber, key_holder=4, trainee=3 (lib/roles.ts).
 * The `level` field in the ACCOUNTS array below is pre-renumber and unused by the insert; ignore it.
 *
 * Durable fixtures — Juan ruled: keep until full-system launch, scrub then (append-only: active=false).
 * Recorded in docs/handoff_C53-commitB-next-session.md under "TEST FIXTURES — REMOVE AT FULL LAUNCH"
 * (added 2026-06-04 in the C.55 close — earlier versions of this comment claimed the section existed
 * before it actually did; it exists now).
 *
 * NOTE: the `pin` values below are the ORIGINAL 6-digit seeds and are now stale — this script has a
 * skip-if-exists pre-flight so re-runs do NOT reseed. Current live 4-digit PINs (KH1/PREP reset during
 * the C.55 smoke) are the source of truth in the handoff doc: KH1=4417, KH2=7394, PREP=4413.
 */

import { createClient } from "@supabase/supabase-js";
import { hashPin } from "../lib/auth";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually (no dotenv dep)
const envPath = resolve(__dirname, "../.env.local");
const envRaw = readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envRaw.split("\n")) {
  const eq = line.indexOf("=");
  if (eq > 0 && !line.startsWith("#")) {
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";
const JUAN = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

const SUPABASE_URL = env["NEXT_PUBLIC_SUPABASE_URL"];
const SUPABASE_SERVICE_KEY = env["SUPABASE_SERVICE_ROLE_KEY"];

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

// Set required env vars for hashPin (reads from process.env)
process.env.AUTH_PIN_PEPPER = env["AUTH_PIN_PEPPER"];
if (!process.env.AUTH_PIN_PEPPER) {
  console.error("Missing AUTH_PIN_PEPPER in .env.local");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface TestAccount {
  name: string;
  email: string;
  role: string;
  level: number;
  pin: string;
  khPlus: boolean;
}

const ACCOUNTS: TestAccount[] = [
  { name: "ZZ_TEST_KH1",    email: "zz_test_kh1@co-ops.test".toLowerCase(),   role: "key_holder", level: 3, pin: "482917", khPlus: true },
  { name: "ZZ_TEST_KH2",    email: "zz_test_kh2@co-ops.test".toLowerCase(),   role: "key_holder", level: 3, pin: "739405", khPlus: true },
  { name: "ZZ_TEST_PREP",   email: "zz_test_prep@co-ops.test".toLowerCase(),  role: "trainee",    level: 2, pin: "150683", khPlus: false },
];

async function main() {
  console.log("=== SEEDING TEST ACCOUNTS ===\n");

  for (const acct of ACCOUNTS) {
    // Pre-flight: check if email already exists
    const { data: existing } = await sb.from("users").select("id, name").eq("email", acct.email).maybeSingle();
    if (existing) {
      console.log(`SKIP ${acct.name}: already exists (${existing.id}, ${existing.name})`);
      continue;
    }

    const pinHash = await hashPin(acct.pin);
    const now = new Date().toISOString();

    const { data: row, error } = await sb.from("users").insert({
      email: acct.email,
      name: acct.name,
      role: acct.role,
      active: true,
      email_verified: true,
      email_verified_at: now,
      password_hash: null,
      pin_hash: pinHash,
      phone: null,
      sms_consent: false,
      created_by: JUAN,
    }).select("id").maybeSingle();

    if (error) {
      console.error(`FAIL ${acct.name}: users insert error — ${error.message}`);
      continue;
    }

    if (!row) {
      // maybeSingle() returns null (no error) when the insert's RETURNING
      // select matched no row. Guard so the row.id reads below (console +
      // user_locations + audit_log) are type-safe under noUncheckedIndexedAccess.
      console.error(`FAIL ${acct.name}: users insert returned no row`);
      continue;
    }

    console.log(`CREATED ${acct.name}: id=${row.id}, role=${acct.role}, level=${acct.level}, pin=${acct.pin}`);

    // Location assignment
    const { error: locErr } = await sb.from("user_locations").insert({
      user_id: row.id,
      location_id: EM,
      assigned_by: JUAN,
    });
    if (locErr) {
      console.error(`  WARN location insert for ${acct.name}: ${locErr.message}`);
    }

    // Audit log
    const { error: auditErr } = await sb.from("audit_log").insert({
      actor_id: JUAN,
      actor_role: "cgs",
      action: "user.create",
      resource_table: "users",
      resource_id: row.id,
      destructive: true,
      metadata: {
        phase: "C53-commitB-smoke",
        reason: "Durable test fixtures for Commit B Phase 2 collaborative prep smoke. Seed date 2026-06-03. Remove at full-system launch.",
        creation_method: "service_role_direct_insert",
        provisioned_email: acct.email,
        provisioned_role: acct.role,
        provisioned_role_level: acct.level,
        provisioned_locations: [EM],
        pin_hash_origin: "real hashPin() — test account",
        ip_address: null,
        user_agent: null,
      },
    });
    if (auditErr) {
      console.error(`  WARN audit insert for ${acct.name}: ${auditErr.message}`);
    }
  }

  console.log("\n=== DONE ===\n");

  // Summary for Juan
  console.log("PINs for login:");
  for (const acct of ACCOUNTS) {
    console.log(`  ${acct.name} (${acct.role}, level ${acct.level}): PIN = ${acct.pin}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
