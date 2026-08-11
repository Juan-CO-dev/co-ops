/**
 * SIM ONLY — seed the simulation staff roster into the co-ops-sim project.
 *
 * NEVER run against prod: the script refuses unless the Supabase URL contains
 * the sim project ref. Credentials below are DELIBERATELY known plaintext —
 * they exist so AI persona agents can log in to the sandbox. The sim project
 * has its own peppers/JWT secret (.env.sim); these hashes are worthless
 * anywhere else.
 *
 * Run:  npx tsx --env-file=.env.sim scripts/sim/seed-staff.ts
 *
 * Mirrors scripts/phase-2.5-provision-temp-users.ts's insert shape (users +
 * user_locations, error-checked per the §6.2 discipline).
 */

import { createClient } from "@supabase/supabase-js";
import { hashPassword, hashPin } from "../../lib/auth";
import type { RoleCode } from "../../lib/roles";

const SIM_REF = "jepgzucrvklhqpthowsc";

// Location UUIDs carry over verbatim from the prod config clone.
const LOC_MEP = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a"; // P Street
const LOC_EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09"; // Eastern Market

interface SimStaff {
  email: string;
  name: string;
  role: RoleCode;
  language: "en" | "es";
  pin: string; // 4 digits — known sim credential
  password: string; // known sim credential (step-up needs it for AGM+)
  locations: string[];
}

// The cast. Casting law (Juan): employee=haiku · KH/SL=sonnet · AGM+=opus.
// Two Spanish-language personas exercise the es UX end to end.
// Deshawn is the designated gremlin (double-taps, abandons forms, junk input).
export const SIM_STAFF: SimStaff[] = [
  { email: "maya@sim.co-ops", name: "Maya Torres", role: "employee", language: "en", pin: "1111", password: "sim-maya-pw", locations: [LOC_EM] },
  { email: "deshawn@sim.co-ops", name: "Deshawn Carter", role: "employee", language: "en", pin: "2222", password: "sim-deshawn-pw", locations: [LOC_EM] },
  { email: "luis@sim.co-ops", name: "Luis Herrera", role: "employee", language: "es", pin: "3333", password: "sim-luis-pw", locations: [LOC_MEP] },
  { email: "rosa@sim.co-ops", name: "Rosa Delgado", role: "key_holder", language: "es", pin: "4444", password: "sim-rosa-pw", locations: [LOC_EM] },
  { email: "angel@sim.co-ops", name: "Angel Reyes", role: "key_holder", language: "en", pin: "5555", password: "sim-angel-pw", locations: [LOC_MEP] },
  { email: "tommy@sim.co-ops", name: "Tommy Nguyen", role: "shift_lead", language: "en", pin: "6666", password: "sim-tommy-pw", locations: [LOC_EM] },
  { email: "priya@sim.co-ops", name: "Priya Shah", role: "agm", language: "en", pin: "7777", password: "sim-priya-pw", locations: [LOC_EM] },
  { email: "nicole@sim.co-ops", name: "Nicole Boyd", role: "agm", language: "en", pin: "8888", password: "sim-nicole-pw", locations: [LOC_MEP] },
  { email: "marcus@sim.co-ops", name: "Marcus Webb", role: "gm", language: "en", pin: "9999", password: "sim-marcus-pw", locations: [LOC_EM, LOC_MEP] },
];

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(SIM_REF)) {
    throw new Error(`REFUSING: NEXT_PUBLIC_SUPABASE_URL does not point at the sim project (${SIM_REF}). Run with --env-file=.env.sim.`);
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.sim");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  for (const s of SIM_STAFF) {
    const { data: existing, error: exErr } = await sb
      .from("users").select("id").ilike("email", s.email).maybeSingle<{ id: string }>();
    if (exErr) throw new Error(`${s.email} pre-flight: ${exErr.message}`);
    if (existing) { console.log(`= ${s.email} already seeded`); continue; }

    const pinHash = await hashPin(s.pin);
    const passwordHash = await hashPassword(s.password);
    const { data: row, error: insErr } = await sb
      .from("users")
      .insert({
        email: s.email, name: s.name, role: s.role,
        pin_hash: pinHash, password_hash: passwordHash,
        active: true, language: s.language,
      })
      .select("id").maybeSingle<{ id: string }>();
    if (insErr) throw new Error(`${s.email} insert: ${insErr.message}`);
    if (!row) throw new Error(`${s.email}: insert returned no row`);

    for (const loc of s.locations) {
      const { error: locErr } = await sb
        .from("user_locations")
        .insert({ user_id: row.id, location_id: loc, active: true });
      if (locErr) throw new Error(`${s.email} user_locations: ${locErr.message}`);
    }
    console.log(`+ ${s.name} (${s.role}, ${s.language}) @ ${s.locations.length} location(s)`);
  }
  console.log("SIM STAFF SEEDED.");
}

void main();
