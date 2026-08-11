/**
 * CONCURRENCY HARNESS — session driver (sim-2, 2026-08-11).
 *
 * The foundation for the directed-crew concurrency sim. Holds N authenticated
 * sessions against the sim sandbox (:3100), drives the real API, and provides
 * the primitives the race battery + coverage hunt need: precise simultaneous
 * firing and a service-role DB probe for invariant assertions.
 *
 * SIM-ONLY: refuses to run unless BASE points at localhost and the DB URL at
 * the sim project ref. Never targets prod.
 *
 * Run pieces via: node scripts/sim/concurrency/<runner>.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SIM_REF = "jepgzucrvklhqpthowsc";
export const BASE = "http://localhost:3100";

// Load sim env (same file the dev launcher uses).
const env = {};
for (const line of readFileSync(".env.sim", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(SIM_REF)) {
  throw new Error(`REFUSING: .env.sim is not the sim project (${SIM_REF}).`);
}

/** Service-role client for INVARIANT PROBES ONLY (never a write in the harness). */
export const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export const LOC = {
  // From the config clone. NOTE: codes are crossed vs names (SIM-4) — key by code.
  EM: "d2cced11-b167-49fa-bab6-86ec9bf4ff09", // "P Street"
  MEP: "54ce1029-400e-4a92-9c2b-0ccb3b031f0a", // "Capitol Hill"
};

/** A logged-in session: cookie string + identity, with request helpers. */
export class Session {
  constructor(user, pin) {
    this.user = user; // { id, name, role }
    this.pin = pin;
    this.cookie = null;
  }
  async login(locationId) {
    const res = await fetch(`${BASE}/api/auth/pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: this.user.id, pin: this.pin }),
      redirect: "manual",
    });
    if (!res.ok) throw new Error(`login ${this.user.name}: ${res.status} ${await res.text()}`);
    // Collect every Set-Cookie the auth flow emits.
    const set = res.headers.getSetCookie?.() ?? [];
    this.cookie = set.map((c) => c.split(";")[0]).join("; ");
    if (!this.cookie) throw new Error(`login ${this.user.name}: no cookie set`);
    this.locationId = locationId;
    return this;
  }
  /** A single API call under this session. Returns { status, code, json }. */
  async call(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, code: json?.code ?? null, json, actor: this.user.name };
  }
}

/** Resolve a sim user by (locationId, role, name) via the public tile endpoint. */
export async function findUser(locationId, role, name) {
  const res = await fetch(`${BASE}/api/users/login-options?location_id=${locationId}&role=${role}`);
  const { users } = await res.json();
  const u = users.find((x) => x.name === name) ?? users[0];
  if (!u) throw new Error(`no ${role} user at ${locationId}${name ? ` named ${name}` : ""}`);
  return u;
}

/**
 * THE RACE PRIMITIVE: fire an array of thunks as simultaneously as the runtime
 * allows. Pre-resolves nothing; every thunk is invoked in the same microtask
 * flush, so all requests dispatch before any awaits resolve — maximal server
 * contention on the guarded write. Returns settled results in order.
 */
export async function fireSimultaneous(thunks) {
  return Promise.all(thunks.map((t) => t().catch((e) => ({ status: 0, code: "threw", error: String(e) }))));
}

/** Assertion helper — records pass/fail into a shared report array. */
export function makeReport(title) {
  const rows = [];
  const check = (name, cond, detail = "") => {
    rows.push({ name, pass: !!cond, detail });
    const tag = cond ? "PASS" : "**FAIL**";
    console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const done = () => {
    const fails = rows.filter((r) => !r.pass);
    console.log(`\n${title}: ${rows.length - fails.length}/${rows.length} passed${fails.length ? ` — ${fails.length} FAILED` : ""}`);
    return { title, rows, fails };
  };
  return { check, done };
}

/** Today's ET date, sim-consistent (the app derives the same). */
export function todayEt() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
