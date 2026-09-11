/**
 * SIM ONLY — seed the simulation staff roster into the co-ops-sim project.
 *
 * NEVER run against prod: the script refuses unless the Supabase URL is the exact
 * sim origin. Credentials below are DELIBERATELY known plaintext —
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
import { pathToFileURL } from "node:url";
import { assertSimTarget } from "../../lib/sim-isolation-shared";
import { SIM_PERSONAS, SIM_LOCATIONS, assertPersonaRow, type SimPersona } from "./personas-shared";

const credentials: Record<string, { pin: string; password: string }> = {
  "maya@sim.co-ops": { pin: "1111", password: "sim-maya-pw" },
  "deshawn@sim.co-ops": { pin: "2222", password: "sim-deshawn-pw" },
  "luis@sim.co-ops": { pin: "3333", password: "sim-luis-pw" },
  "rosa@sim.co-ops": { pin: "4444", password: "sim-rosa-pw" },
  "angel@sim.co-ops": { pin: "5555", password: "sim-angel-pw" },
  "tommy@sim.co-ops": { pin: "6666", password: "sim-tommy-pw" },
  "priya@sim.co-ops": { pin: "7777", password: "sim-priya-pw" },
  "nicole@sim.co-ops": { pin: "8888", password: "sim-nicole-pw" },
  "marcus@sim.co-ops": { pin: "9999", password: "sim-marcus-pw" },
};

type UserRow = {
  id: string; email: string; name: string; role: string; active: boolean;
  language: string; pin_hash: string | null; password_hash: string | null;
};
const columns = "id,email,name,role,active,language,pin_hash,password_hash";

export async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  assertSimTarget(url);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from sim environment");
  const sb = createClient(url!, key, { auth: { persistSession: false } });
  const ids: Record<string, string> = {};
  const missing: SimPersona[] = [];
  async function readUser(s: SimPersona) {
    const { data, error } = await sb.from("users").select(columns).ilike("email", s.email).maybeSingle<UserRow>();
    if (error) throw new Error(`${s.email}: users read failed; full fixture restore required`);
    return data;
  }
  async function verify(s: SimPersona, row: UserRow) {
    const { data, error } = await sb.from("user_locations").select("location_id,active").eq("user_id", row.id);
    if (error || !data) throw new Error(`${s.email}: user_locations read failed; full fixture restore required`);
    assertPersonaRow(s, row, data);
    const bcrypt = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;
    if (!row.pin_hash || !bcrypt.test(row.pin_hash)) throw new Error(`${s.email}: pin credential scheme mismatch; full fixture restore required`);
    if (!row.password_hash?.startsWith("hmac2$") || !bcrypt.test(row.password_hash.slice(6))) throw new Error(`${s.email}: password credential scheme mismatch; full fixture restore required`);
    ids[s.email] = row.id;
  }
  // Preflight the ENTIRE existing roster before creating even one missing user.
  for (const s of SIM_PERSONAS) {
    const row = await readUser(s);
    if (row) await verify(s, row);
    else missing.push(s);
  }
  for (const s of missing) {
    const credential = credentials[s.email];
    if (!credential) throw new Error(`${s.email}: private credential missing`);
    const { data: row, error } = await sb.from("users").insert({
      email: s.email, name: s.name, role: s.role, language: s.language, active: true,
      pin_hash: await hashPin(credential.pin), password_hash: await hashPassword(credential.password),
    }).select("id").maybeSingle<{ id: string }>();
    if (error || !row) throw new Error(`${s.email}: users insert failed; full fixture restore required`);
    for (const code of s.locations) {
      const { error } = await sb.from("user_locations").insert({ user_id: row.id, location_id: SIM_LOCATIONS[code].id, active: true });
      if (error) throw new Error(`${s.email}: user_locations insert failed; full fixture restore required`);
    }
    const readback = await readUser(s);
    if (!readback) throw new Error(`${s.email}: missing readback; full fixture restore required`);
    await verify(s, readback);
  }
  if (process.argv.includes("--print-map")) console.log(JSON.stringify(ids));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main().catch(error => { process.exitCode = 1; console.error(error instanceof Error && /^(?:[a-z]+@sim\.co-ops:|NEXT_PUBLIC_SUPABASE_URL:|SUPABASE_SERVICE_ROLE_KEY)/.test(error.message) ? error.message : "Sim seed failed; full fixture restore required"); });
}
