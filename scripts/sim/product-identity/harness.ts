/**
 * SIM HARNESS — product-identity days (2026-08-21).
 *
 * ── WHY THIS EXISTS AND WHY IT IS NOT THE AUGUST HARNESS ─────────────────────
 * The 2026-08-11 sim program drove nine Playwright personas against a byte-identical
 * prod-schema CLONE (`co-ops-sim`). That clone does not exist today, and this arc's
 * scenarios have to be walked on the ONLY database that carries the arc's data —
 * production. The plan's Phase 7 was written expecting a sandbox ("the lead
 * deactivates the PRIMARY ham twin on the sandbox DB"), so the rule this harness
 * enforces is the substitute for that sandbox:
 *
 *   **THE SIM NEVER WRITES TO PRODUCTION. The guarantee is MECHANICAL, not
 *   disciplinary** — every non-GET PostgREST request is intercepted at the fetch
 *   boundary and either CAPTURED (its exact payload recorded for assertion) or
 *   REFUSED. There is no code path in this harness that can mutate a live row.
 *
 * That inverts the usual sandbox tradeoff in the sim's favour on one axis and
 * against it on another, and both halves are stated in the findings doc:
 *   + the code under test is the REAL, unmodified server code, reading REAL prod
 *     rows — no fixture drift, no "the clone was seeded differently" caveat;
 *   − a scenario's WRITES are proven by their captured payload rather than by
 *     reading them back out of a table afterwards.
 *
 * ── FAULT INJECTION ───────────────────────────────────────────────────────────
 * "The vendor is down" is injected at the PostgREST RESPONSE boundary: the row for
 * the named SKU comes back with `active: false`, exactly as it would if the lead had
 * flipped the column. Every layer above the wire — loadWalkerData, loadProductIndex,
 * resolveProductMember, the flatten — is untouched real code that cannot tell the
 * difference. It was 08:58 ET on a Friday when this ran (peak prep); deactivating a
 * live SKU that two shops were about to order from was not a defensible way to prove
 * a failover works.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/sim/product-identity/day1-vendor-down.ts
 */
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";

// ── Output ────────────────────────────────────────────────────────────────────

export function h(text: string): void {
  console.log(`\n─── ${text.toUpperCase()} ${"─".repeat(Math.max(3, 68 - text.length))}\n`);
}

export function p(text = ""): void {
  console.log(text);
}

// ── Assertions (the sim's ledger: every claim is named, none are vibes) ───────

export interface SimAssertion {
  id: string;
  what: string;
  expected: string;
  observed: string;
  pass: boolean;
}

export interface SimIncident {
  id: string;
  severity: "P1" | "P2" | "NOTE";
  what: string;
}

const assertions: SimAssertion[] = [];
const incidents: SimIncident[] = [];

export function assertThat(id: string, what: string, expected: string, observed: string, pass: boolean): boolean {
  assertions.push({ id, what, expected, observed, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${id}  ${what}`);
  if (!pass) {
    console.log(`        expected: ${expected}`);
    console.log(`        observed: ${observed}`);
  }
  return pass;
}

export function assertEq(id: string, what: string, expected: unknown, observed: unknown): boolean {
  const e = JSON.stringify(expected);
  const o = JSON.stringify(observed);
  return assertThat(id, what, e, o, e === o);
}

export function incident(id: string, severity: SimIncident["severity"], what: string): void {
  incidents.push({ id, severity, what });
  console.log(`  ${severity === "NOTE" ? "NOTE" : `INCIDENT ${severity}`}  ${id}  ${what}`);
}

export function summary(): { pass: number; fail: number } {
  h("assertion ledger");
  for (const a of assertions) {
    console.log(`  ${a.pass ? "PASS" : "FAIL"}  ${a.id}  ${a.what}`);
    if (!a.pass) {
      console.log(`          expected ${a.expected}`);
      console.log(`          observed ${a.observed}`);
    }
  }
  const fail = assertions.filter((a) => !a.pass).length;
  const pass = assertions.length - fail;
  h("incidents");
  if (incidents.length === 0) console.log("  (none)");
  for (const i of incidents) console.log(`  ${i.severity}  ${i.id}  ${i.what}`);
  console.log(`\n  ${pass} passed · ${fail} failed · ${incidents.length} incidents\n`);
  return { pass, fail };
}

// ── The write guard + fault-injection shim ───────────────────────────────────

/** A write the sim intercepted instead of letting it reach production. */
export interface CapturedWrite {
  method: string;
  table: string;
  body: unknown;
}

type RowRewriter = (
  table: string,
  rows: Array<Record<string, unknown>>,
  url: string,
) => Array<Record<string, unknown>>;

interface ShimState {
  rewriters: RowRewriter[];
  captured: CapturedWrite[];
  /** Tables whose writes are captured and answered with a synthetic success. */
  captureTables: Set<string>;
  /** Table → the synthetic representation returned for an insert that selects back. */
  syntheticReturn: Map<string, Record<string, unknown>>;
  blocked: number;
  installed: boolean;
}

const shim: ShimState = {
  rewriters: [],
  captured: [],
  captureTables: new Set(),
  syntheticReturn: new Map(),
  blocked: 0,
  installed: false,
};

const realFetch = globalThis.fetch.bind(globalThis);

/** `https://x.supabase.co/rest/v1/vendor_items?...` → `vendor_items` (else null). */
function restTable(url: string): string | null {
  const m = /\/rest\/v1\/([A-Za-z0-9_]+)/.exec(url);
  return m ? m[1]! : null;
}

export class SimWriteBlocked extends Error {}

/**
 * Patch globalThis.fetch. supabase-js is constructed with no custom fetch
 * (lib/supabase-server.ts), so it resolves `globalThis.fetch` per call — patching it
 * here puts the guard under EVERY server module without touching one line of app code.
 */
export function installShim(): void {
  if (shim.installed) return;
  shim.installed = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const table = restTable(url);

    if (table == null || method === "GET" || method === "HEAD") {
      const res = await realFetch(input as RequestInfo, init);
      if (table == null || shim.rewriters.length === 0 || method === "HEAD") return res;
      const text = await res.text();
      if (text === "") return new Response(text, { status: res.status, headers: res.headers });
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return new Response(text, { status: res.status, headers: res.headers });
      }
      if (!Array.isArray(parsed)) return new Response(text, { status: res.status, headers: res.headers });
      let rows = parsed as Array<Record<string, unknown>>;
      for (const rw of shim.rewriters) rows = rw(table, rows, url);
      // Content-Range et al. are preserved; we never change the ROW COUNT, only fields.
      return new Response(JSON.stringify(rows), { status: res.status, headers: res.headers });
    }

    // ── A WRITE. It does not reach production, ever. ──
    let body: unknown = null;
    try {
      const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
      body = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      body = init?.body ?? null;
    }
    shim.captured.push({ method, table, body });
    if (!shim.captureTables.has(table)) {
      shim.blocked += 1;
      throw new SimWriteBlocked(
        `SIM WRITE GUARD: refused ${method} /rest/v1/${table}. The sim is read-only; ` +
          `add the table to captureTables if this write is part of the scenario under test.`,
      );
    }
    const synthetic = shim.syntheticReturn.get(table);
    const accept = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    ).get("accept");
    const single = accept?.includes("vnd.pgrst.object") === true;
    const payload = synthetic ? (single ? synthetic : [synthetic]) : single ? {} : [];
    return new Response(JSON.stringify(payload), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

export function uninstallShim(): void {
  globalThis.fetch = realFetch;
  shim.installed = false;
}

export function addRewriter(rw: RowRewriter): void {
  shim.rewriters.push(rw);
}

export function clearRewriters(): void {
  shim.rewriters = [];
}

export function captureWritesTo(table: string, syntheticReturn?: Record<string, unknown>): void {
  shim.captureTables.add(table);
  if (syntheticReturn) shim.syntheticReturn.set(table, syntheticReturn);
}

export function stopCapturing(table: string): void {
  shim.captureTables.delete(table);
  shim.syntheticReturn.delete(table);
}

export function capturedWrites(): CapturedWrite[] {
  return [...shim.captured];
}

export function resetCaptured(): void {
  shim.captured = [];
}

/**
 * "The vendor is down." The named SKUs come back from PostgREST with `active: false`.
 * Applied to `vendor_items` only — the one table whose `active` column means
 * "we can order this from this vendor".
 */
export function vendorDownRewriter(skuIds: ReadonlySet<string>): RowRewriter {
  return (table, rows) => {
    if (table !== "vendor_items") return rows;
    return rows.map((r) => (typeof r.id === "string" && skuIds.has(r.id) ? { ...r, active: false } : r));
  };
}

/**
 * "Both twins carry a par." The audit's double-order hazard (P2 §ORDERING (2)) does
 * not exist in live data — every product has exactly one par'd member today — so the
 * dedupe it was built for can only be walked by injecting the second par.
 *
 * The walker's own query PRE-FILTERS on `or(weekday_par.not.is.null,...)`, so a
 * par-less twin never appears in the response at all and rewriting fields cannot
 * reach it: the row has to be ADDED. `urlMatch` keeps that addition on the one query
 * that means "the par'd catalogue" and off every other vendor_items read.
 */
export function injectRowsRewriter(
  table: string,
  urlMatch: string,
  rows: Array<Record<string, unknown>>,
): RowRewriter {
  return (t, existing, url) => {
    if (t !== table || !url.includes(urlMatch)) return existing;
    const have = new Set(existing.map((r) => r.id));
    return [...existing, ...rows.filter((r) => !have.has(r.id))];
  };
}

/**
 * Inject prior `product.resolution_flip` history. Live there is none (the writer runs
 * off the nightly depletion pass and no product has ever flipped), so without this the
 * only branch reachable is the first-observation SEED — and the FLIP branch, which is
 * the one the spec's "why did ham cost move Tuesday" promise rests on, would go
 * unwalked. The injected row is a response-shaped fabrication and is declared as such
 * in the findings; nothing is written anywhere.
 */
export function priorFlipRewriter(rows: Array<Record<string, unknown>>): RowRewriter {
  return (table, existing, url) => {
    if (table !== "audit_log") return existing;
    if (!url.includes("product.resolution_flip")) return existing;
    return [...rows, ...existing];
  };
}

// ── Personas ─────────────────────────────────────────────────────────────────

/**
 * A sim persona. `AuthContext` is a session-shaped record; a script has no session,
 * so the shape is synthesized around a REAL user id (read live) so any captured
 * write payload names somebody who actually exists.
 */
export function persona(userId: string, role: RoleCode, locations: string[]): AuthContext {
  return {
    user: { id: userId, role },
    session: { id: "sim", user_id: userId },
    role,
    level: 0,
    locations,
  } as unknown as AuthContext;
}

/** The highest-level active user — the sim's "AGM/GM on shift". */
export async function loadPersonaUser(): Promise<{ id: string; role: RoleCode; name: string }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("users")
    .select("id, role, name, active")
    .eq("active", true)
    .returns<Array<{ id: string; role: RoleCode; name: string | null }>>();
  if (error) throw new Error(`loadPersonaUser: ${error.message}`);
  const { getRoleLevel } = await import("@/lib/roles");
  const sorted = [...(data ?? [])].sort(
    (a, b) => getRoleLevel(b.role) - getRoleLevel(a.role) || a.id.localeCompare(b.id),
  );
  const top = sorted[0];
  if (!top) throw new Error("loadPersonaUser: no active users");
  return { id: top.id, role: top.role, name: top.name ?? top.id };
}

export function round(n: number | null | undefined, dp = 4): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
