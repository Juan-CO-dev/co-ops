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
 * Run pieces via: node --import tsx (F4 runner initializes under its lease)
 */
import { createClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import { createHash } from "node:crypto";
import { loadSimEnv } from "../launch-readiness/env.ts";
import { assertSimTarget, SIM_APP_ORIGIN } from "../../../lib/sim-isolation-shared.ts";
import { SIM_PERSONAS, SIM_LOCATIONS, personaFor, assertPersonaRow } from "../personas-shared.ts";
export { personaFor } from "../personas-shared.ts";
export const BASE = SIM_APP_ORIGIN;
export const LOC = Object.fromEntries(Object.entries(SIM_LOCATIONS).map(([code, loc]) => [code, loc.id]));
let client, env, leaseCheck;
let identities = new Map();

function ready() {
  if (!client || !leaseCheck) throw new Error("Driver init required under F4 lease");
  leaseCheck();
}
// Expose only SELECT builders, never the service client or RPC/write methods.
export const db = Object.freeze({ from(table) {
  ready();
  return Object.freeze({ select(...args) { return client.from(table).select(...args).throwOnError(); } });
} });

/** F4 supplies synchronous lease assertion and build/server receipt verification.
 * No environment read or client construction until both prerequisites are supplied.
 * @param {{assertLease?: () => void, verifyServer?: (target: import('../../../lib/sim-isolation-shared').SimTarget) => Promise<void>, root?: string}} options
 */
export async function init({ assertLease, verifyServer, root = process.cwd() } = {}) {
  client = undefined; env = undefined; leaseCheck = undefined; identities = new Map();
  if (typeof assertLease !== "function" || typeof verifyServer !== "function") throw new Error("F4 runner required: lease and server verification");
  assertLease();
  const loaded = loadSimEnv(root);
  if (!loaded.ok) throw new Error(loaded.reasons.join("; "));
  assertSimTarget(loaded.env.NEXT_PUBLIC_SUPABASE_URL);
  await verifyServer(loaded.target);
  const readOnlyFetch = async (input, options = {}) => {
    assertLease();
    const method = (options.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!["GET", "HEAD"].includes(method)) throw new Error("Oracle is read-only");
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== loaded.target.dbOrigin || url.username || url.password || !url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/rest/v1/rpc/")) throw new Error("Oracle target refused");
    const response = await fetch(input, { ...options, redirect: "error" });
    if (!response.ok) throw new Error(`Oracle read failed (${response.status})`);
    return response;
  };
  const oracle = createClient(loaded.env.NEXT_PUBLIC_SUPABASE_URL, loaded.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: readOnlyFetch },
  });
  const resolved = new Map();
  for (const loc of Object.values(SIM_LOCATIONS)) {
    const { data, error } = await oracle.from("locations").select("id,code,name").eq("id", loc.id).single();
    if (error || !data || data.code !== loc.code || data.name !== loc.name) throw new Error(`Location ${loc.code}: readback mismatch`);
  }
  for (const persona of SIM_PERSONAS) {
    const { data: row, error } = await oracle.from("users").select("id,email,name,role,active,language").ilike("email", persona.email).single();
    if (error || !row) throw new Error(`${persona.email}: identity readback failed`);
    const { data: memberships, error: membershipError } = await oracle.from("user_locations").select("location_id,active").eq("user_id", row.id);
    if (membershipError || !memberships) throw new Error(`${persona.email}: membership readback failed`);
    assertPersonaRow(persona, row, memberships);
    resolved.set(persona.email, Object.freeze({ ...row }));
  }
  assertLease();
  client = oracle; env = loaded.env; identities = resolved; leaseCheck = assertLease;
}
function atLocation(locationId, role, name) {
  const location = Object.values(SIM_LOCATIONS).find(loc => loc.id === locationId);
  if (!location) throw new Error("Unknown sim location");
  return personaFor({ locationCode: location.code, role, name });
}
export function assertPersona(session, persona) {
  ready();
  const identity = identities.get(persona.email);
  const canonical = atLocation(session.locationId, persona.role, persona.name);
  const claims = session.claims;
  if (canonical.email !== persona.email || !identity || session.user.id !== identity.id || session.user.role !== identity.role ||
      !claims || claims.user_id !== identity.id || claims.app_role !== identity.role || claims.role_level !== persona.level ||
      !Array.isArray(claims.locations) || JSON.stringify([...claims.locations].sort()) !== JSON.stringify(persona.locations.map(code => LOC[code]).sort())) {
    throw new Error(`${persona.email}: authenticated persona mismatch`);
  }
}

/** A logged-in session: cookie string + identity, with request helpers. */
export class Session {
  constructor(user, pin) {
    this.user = user; // { id, name, role }
    this.pin = pin;
    this.cookie = null;
  }
  async login(locationId) {
    ready();
    const persona = atLocation(locationId, this.user.role, this.user.name);
    if (identities.get(persona.email)?.id !== this.user.id) throw new Error(`${persona.email}: selected id mismatch`);
    const res = await fetch(`${BASE}/api/auth/pin`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ user_id: this.user.id, pin: this.pin }),
      redirect: "manual",
    });
    if (!res.ok) throw new Error(`login ${this.user.name}: ${res.status}`);
    // Collect every Set-Cookie the auth flow emits.
    const set = res.headers.getSetCookie?.() ?? [];
    this.cookie = set.map((c) => c.split(";")[0]).join("; ");
    if (!this.cookie) throw new Error(`login ${this.user.name}: no cookie set`);
    const body = await res.json();
    if (body?.user_id !== this.user.id) throw new Error(`${persona.email}: login user_id mismatch`);
    const token = set.map(c => c.split(";")[0]).find(c => c.startsWith("co_ops_session="))?.slice("co_ops_session=".length);
    if (!token) throw new Error(`${persona.email}: session cookie missing`);
    try {
      const { payload } = await jwtVerify(token, Buffer.from(env.AUTH_JWT_SECRET, "hex"), { algorithms: ["HS256"], issuer: "co-ops" });
      this.claims = payload;
    } catch { throw new Error(`${persona.email}: session signature invalid`); }
    const { data: stored, error } = await db.from("sessions").select("user_id,token_hash,revoked_at,expires_at").eq("id", this.claims.session_id).single();
    if (error || !stored || stored.user_id !== this.user.id || stored.revoked_at !== null ||
        !(Date.parse(stored.expires_at) > Date.now()) || stored.token_hash !== createHash("sha256").update(token).digest("hex")) throw new Error(`${persona.email}: session readback mismatch`);
    this.locationId = locationId;
    assertPersona(this, persona);
    return this;
  }
  /** A single API call under this session. Returns { status, code, json }. */
  async call(method, path, body) {
    ready();
    assertPersona(this, atLocation(this.locationId, this.user.role, this.user.name));
    const destination = new URL(path, BASE);
    if (destination.origin !== BASE) throw new Error("Session target refused");
    const res = await fetch(destination, {
      method,
      headers: { "content-type": "application/json", cookie: this.cookie, origin: BASE },
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
  if (typeof name !== "string" || !name.trim()) throw new Error("findUser: name required");
  const persona = atLocation(locationId, role, name);
  ready();
  const res = await fetch(`${BASE}/api/users/login-options?${new URLSearchParams({ location_id: locationId, role })}`, { redirect: "error" });
  if (!res.ok) throw new Error(`login-options: status ${res.status}`);
  const payload = await res.json();
  if (!payload || !Array.isArray(payload.users) || payload.users.some(u => !u || typeof u.id !== "string" || !u.id || typeof u.name !== "string" || typeof u.role !== "string")) throw new Error("login-options: malformed users");
  const matches = payload.users.filter(u => u.name === name && u.role === role);
  if (matches.length !== 1) throw new Error(`${persona.email}: expected exactly one login option`);
  const user = matches[0];
  if (user.id !== identities.get(persona.email)?.id) throw new Error(`${persona.email}: login option id mismatch`);
  return user;
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
