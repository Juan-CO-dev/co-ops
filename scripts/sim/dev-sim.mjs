/**
 * SIM ONLY — launch the dev server against the co-ops-sim sandbox.
 *
 * Next.js env precedence: SHELL env beats .env.local. This launcher loads
 * .env.sim into the child's environment so every value there (sim Supabase,
 * sim peppers, sim JWT secret) OVERRIDES .env.local's prod values without
 * touching that file. Port 3100 so a normal dev server can coexist.
 *
 * Refuses to start unless .env.sim points at the sim project ref.
 *
 * Run:  node scripts/sim/dev-sim.mjs
 */

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const SIM_REF = "jepgzucrvklhqpthowsc";
const raw = readFileSync(".env.sim", "utf8");
const env = { ...process.env };
for (const line of raw.split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
// The app hex-decodes AUTH_JWT_SECRET; PostgREST verifies with the project's
// legacy JWT secret as UTF-8 bytes. Juan pastes the RAW legacy secret and we
// derive the hex here — no dashboard changes needed.
if (!env.AUTH_JWT_SECRET && env.SIM_LEGACY_JWT_SECRET) {
  env.AUTH_JWT_SECRET = Buffer.from(env.SIM_LEGACY_JWT_SECRET, "utf8").toString("hex");
}
if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(SIM_REF)) {
  console.error(`REFUSING: .env.sim NEXT_PUBLIC_SUPABASE_URL must point at ${SIM_REF}`);
  process.exit(1);
}
// Belt + suspenders: dormant legs stay dormant in sim regardless of stray values.
// SET to empty (never delete): Next fills absent keys from .env.local (prod!) —
// an empty string blocks the backfill AND fails every truthiness gate.
for (const k of ["RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "ANTHROPIC_API_KEY", "TOAST_API_HOSTNAME", "TOAST_CLIENT_ID", "TOAST_CLIENT_SECRET", "SEVENSHIFTS_API_KEY"]) {
  env[k] = "";
}
env.TOAST_ENABLED = "false";
env.TWILIO_ENABLED = "false";
env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";

const child = spawn("npx", ["next", "dev", "-p", "3100"], {
  env, stdio: "inherit", shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
