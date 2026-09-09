/** Builder-data exception. This is the sole F2 writer; never an application import. */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import net from "node:net";
import { assertSimTarget, SIM_PROJECT_REF } from "../../../lib/sim-isolation-shared";
import { SIM_PERSONAS, SIM_LOCATIONS, assertPersonaRow } from "../personas-shared";
import { assertHeld } from "./lease.mjs";
import { canonical, classifyTables, fingerprint, loadSnapshot, loadSnapshotManifest, parseExactJson, sha256, sortedRows, synthesize, type Catalog, type Row, type Snapshot } from "./fixtures";

import { planConfig, type SchemaMeta } from "./schema-order";

export const DEFAULT_SNAPSHOT_DIR = "scripts/sim/launch-readiness/.private/snapshot";
export const dirtyMarker = () => resolve("scripts/sim/launch-readiness/.private/DIRTY");
export function assertClean() { if (existsSync(dirtyMarker())) throw new Error("Sim DIRTY; full reset required"); }
export async function assertAppStopped() {
  // Cover both loopback families; a stale listener must never be reset underneath.
  for (const host of ["127.0.0.1", "::1"]) await new Promise<void>((ok, fail) => {
    const probe = net.createServer();
    probe.once("error", () => fail(new Error("Reset requires app stopped")));
    probe.listen({ port: 3100, host, ipv6Only: true }, () => probe.close(error => error ? fail(error) : ok()));
  });
}
export type Receipt = {
  fixtureId: string; recipeVersion: string; snapshotManifestHash: string; schemaDigest: string;
  counts: Record<string, number>; fingerprint: string; startedAt: string; finishedAt: string;
  identityDigest: string; rosterDigest: string;
  restorePlan: { deleteOrder: string[]; loadOrder: string[]; stagedColumns: string[]; leafFirstCounts: Record<string, number> };
};
export function exactCount(response: Response): number {
  const match = response.headers.get("content-range")?.match(/^(?:\*|\d+-\d+)\/(\d+)$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error("PostgREST exact count missing");
  return Number(match[1]);
}
/** Postgres NUMERIC(p,s) reads back at declared scale ("18.50") while the JSON snapshot carries "18.5":
 * value-equal, text-different. Compare decimals by value; the fingerprint still uses the exact readback text. */
export function numericNormalized(value: unknown): unknown {
  // Snapshot JSON may carry a JS number (20) where the readback carries exact text ("20.00"): same value.
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    const [int, frac = ""] = value.split(".");
    const trimmed = frac.replace(/0+$/, "");
    const out = trimmed ? `${int}.${trimmed}` : int!;
    return out === "-0" ? "0" : out;
  }
  if (Array.isArray(value)) return value.map(numericNormalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, numericNormalized(v)]));
  return value;
}
function writeVerified(file: string, value: unknown) {
  mkdirSync(resolve(file, ".."), { recursive: true });
  const bytes = JSON.stringify(value, null, 2);
  writeFileSync(file, bytes, { mode: 0o600 });
  if (readFileSync(file, "utf8") !== bytes) throw new Error("Reset evidence readback failed");
}
export async function resetFixture(options: {
  runId: string; fixtureId: string; env: Record<string, string | undefined>;
  schemaDigest: string; snapshotDir?: string;
}): Promise<Receipt> {
  const { runId, fixtureId, env } = options;
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("Invalid run ID");
  // Unleased callers cannot mutate even the shared dirty marker.
  const owner = assertHeld(runId);
  if (owner.pid !== process.pid) throw new Error("Only the parent lease owner may reset");
  const startedAt = new Date().toISOString();
  try {
    assertSimTarget(env.NEXT_PUBLIC_SUPABASE_URL);
    if (env.LRA_RESET_CONFIRM !== SIM_PROJECT_REF) throw new Error("Reset confirmation required");
    await assertAppStopped();
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Sim service role required");
    if (!/^[a-f0-9]{64}$/.test(options.schemaDigest)) throw new Error("Reviewed schema digest required");
    const catalog = JSON.parse(readFileSync(resolve("scripts/sim/launch-readiness/fixtures/manifest.json"), "utf8")) as Catalog;
    const dir = options.snapshotDir ?? env.LRA_SNAPSHOT_DIR ?? DEFAULT_SNAPSHOT_DIR;
    const manifest = loadSnapshotManifest(dir);
    classifyTables(manifest, catalog.inventory);
    // Explicitly refused prerequisites cannot be turned into a successful empty fixture.
    if (catalog.blocked.length) throw new Error("Fixture inventory blocked; inspect fixtures/manifest.json");
    const recipe = catalog.recipes.find(row => row.id === fixtureId);
    if (!recipe || recipe.blocked) throw new Error("Fixture recipe blocked; inspect fixtures/manifest.json");
    if (fixtureId !== "cold-empty" || recipe.synthetic.length || Object.keys(recipe.handles).length) throw new Error("Only cold-empty restore is provisioned");
    const schema = JSON.parse(readFileSync(resolve(dir, "schema-meta.json"), "utf8")) as SchemaMeta;
    const snapshot = loadSnapshot(dir, manifest);
    const plan = planConfig(schema, catalog.inventory, snapshot);
    const deletes = plan.deleteOrder, loads = plan.loadOrder;
    const primaryKeys = schema.primary_keys;
    for (const [table, metadata] of Object.entries(manifest.tables)) {
      if (metadata.primaryKey && canonical(metadata.primaryKey) !== canonical(primaryKeys[table])) throw new Error("Snapshot PK disagreement");
    }
    for (const table of deletes) {
      if (!primaryKeys[table]?.length) throw new Error("Verified primary key missing");
      sortedRows(snapshot[table] ?? [], primaryKeys[table]!);
    }
    for (const loc of Object.values(SIM_LOCATIONS)) {
      const rows = snapshot.locations?.filter(row => row.id === loc.id && row.code === loc.code && row.name === loc.name);
      if (rows?.length !== 1) throw new Error("Snapshot location identity mismatch");
    }
    // Resolve every prerequisite BEFORE deletes; these stand-ins never leave the planner.
    synthesize(recipe, snapshot, Object.fromEntries(SIM_PERSONAS.map(p => [p.email.split("@")[0]!, `persona:${p.email}`])));
    const base = `${env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/`;
    async function request(table: string, method: "GET" | "POST" | "DELETE" | "PATCH", query: URLSearchParams, rows?: Row[] | Row) {
      assertHeld(runId);
      if (!deletes.includes(table)) throw new Error("Unclassified write target");
      const response = await fetch(`${base}${table}?${query}`, {
        method, redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
          "Content-Type": "application/json", Prefer: method === "POST" ? "return=minimal" : "count=exact,return=minimal" },
        body: rows === undefined ? undefined : JSON.stringify(rows),
      });
      if (!response.ok) {
        // The PostgREST error body is surfaced ONLY under LRA_DEBUG (stderr, never evidence); it may name columns.
        const detail = process.env.LRA_DEBUG ? ` ${response.status} ${(await response.text()).slice(0, 400)}` : "";
        if (!detail) await response.body?.cancel();
        throw new Error(`Reset ${method} failed: ${table}${detail}`);
      }
      return response;
    }
    async function read(table: string): Promise<Row[]> {
      const rows: Row[] = []; let total: number | undefined;
      do {
        const query = new URLSearchParams({ select: "*", order: primaryKeys[table]!.map(key => `${key}.asc`).join(","), offset: String(rows.length), limit: "500" });
        const response = await request(table, "GET", query);
        const count = exactCount(response);
        if (total !== undefined && total !== count) throw new Error("Readback count changed under lease");
        total = count;
        const page = parseExactJson(await response.text());
        if (!Array.isArray(page) || page.length > 500 || (!page.length && rows.length < total)) throw new Error("Truncated reset readback");
        rows.push(...page as Row[]);
        if (rows.length > total) throw new Error("Readback exceeds exact count");
      } while (rows.length < total!);
      return sortedRows(rows, primaryKeys[table]!);
    }
    async function insert(table: string, rows: Row[]) {
      for (let offset = 0; offset < rows.length; offset += 500) {
        const response = await request(table, "POST", new URLSearchParams(), rows.slice(offset, offset + 500));
        await response.body?.cancel();
      }
    }
    async function patch(table: string, query: URLSearchParams, values: Row, expectedCount: number) {
      const response = await request(table, "PATCH", query, values);
      if (exactCount(response) !== expectedCount) throw new Error(`PATCH rowcount mismatch: ${table}`);
      await response.body?.cancel();
    }
    // Persist BEFORE the first mutation, so process termination also leaves DIRTY.
    writeVerified(dirtyMarker(), { runId, fixtureId, startedAt, status: "reset-in-progress" });
    for (const stage of plan.deleteStages) {
      const before = await read(stage.child);
      const count = before.filter(row => row[stage.column] !== null).length;
      await patch(stage.child, new URLSearchParams({ [stage.column]: "not.is.null" }), { [stage.column]: null }, count);
      if ((await read(stage.child)).some(row => row[stage.column] !== null)) throw new Error("Cycle staging readback mismatch");
    }
    for (const table of deletes) {
      const before = await read(table);
      // Every PK is non-null. This includes UUID zero and non-UUID/composite PKs.
      const response = await request(table, "DELETE", new URLSearchParams({ [primaryKeys[table]![0]!]: "not.is.null" }));
      if (exactCount(response) !== before.length) throw new Error("DELETE rowcount mismatch");
      await response.body?.cancel();
      if ((await read(table)).length !== 0) throw new Error("DELETE left rows behind");
    }
    // Generated columns (e.g. vendor_delivery_rhythm.delivery_dow) cannot take a value on INSERT (PostgREST 428C9);
    // they are omitted here and verified by the full readback below, where the DB's computed value must match the snapshot.
    const generated = new Set(schema.columns_generated ?? []);
    for (const table of loads) {
      const stages = plan.loadStages.filter(stage => stage.child === table);
      const rows = plan.rows[table]!.map(row => {
        const copy: Row = { ...row, ...Object.fromEntries(stages.map(stage => [stage.column, null])) };
        for (const key of Object.keys(copy)) if (generated.has(`${table}.${key}`)) delete copy[key];
        return copy;
      });
      await insert(table, rows);
    }
    for (const stage of plan.loadStages) {
      for (const row of plan.rows[stage.child]!) {
        if (row[stage.column] === null) continue;
        const query = new URLSearchParams(Object.fromEntries(primaryKeys[stage.child]!.map(key => [key, `eq.${row[key]}`])));
        await patch(stage.child, query, { [stage.column]: row[stage.column] }, 1);
      }
    }
    // F3 reads credentials only at call time. Restore parent environment even on failure.
    const seedKeys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AUTH_PIN_PEPPER", "AUTH_PASSWORD_PEPPER"];
    const previous = seedKeys.map(key => process.env[key]);
    try {
      for (const key of seedKeys) { if (!env[key]) throw new Error("Seed environment incomplete"); process.env[key] = env[key]; }
      await (await import("../seed-staff")).main();
    } finally { seedKeys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }); }
    const users = await read("users"), memberships = await read("user_locations");
    if (users.length !== 9 || memberships.length !== 10) throw new Error("Roster cardinality mismatch");
    const personas: Record<string, string> = {};
    for (const persona of SIM_PERSONAS) {
      const matches = users.filter(row => row.email === persona.email);
      if (matches.length !== 1) throw new Error("Roster identity not unique");
      const row = matches[0]!;
      const memberRows = memberships.filter(m => m.user_id === row.id).map(member => {
        if (typeof member.location_id !== "string" || typeof member.active !== "boolean") throw new Error("Malformed membership");
        return { location_id: member.location_id, active: member.active };
      });
      assertPersonaRow(persona, row as Parameters<typeof assertPersonaRow>[1], memberRows);
      if (typeof row.password_hash !== "string" || !row.password_hash.startsWith("hmac2$")) throw new Error("Roster credential scheme mismatch");
      personas[persona.email.split("@")[0]!] = row.id as string;
    }
    const synthetic = synthesize(recipe, snapshot, personas);
    const expected: Snapshot = Object.fromEntries(deletes.map(table => [table, [...snapshot[table] ?? []]]));
    for (const batch of synthetic) {
      if (catalog.inventory.CONFIG.includes(batch.table)) throw new Error("Recipe config changes require reviewed snapshot variant");
      await insert(batch.table, batch.rows); expected[batch.table]!.push(...batch.rows);
    }
    const actual: Snapshot = {};
    for (const table of deletes) actual[table] = await read(table);
    if (canonical(actual.users) !== canonical(users) || canonical(actual.user_locations) !== canonical(memberships)) throw new Error("Roster changed during fixture write");
    const counts = Object.fromEntries(deletes.map(table => [table, actual[table]!.length]));
    for (const table of deletes.filter(table => !["users", "user_locations"].includes(table))) {
      const rows = sortedRows(expected[table]!, primaryKeys[table]!);
      if (actual[table]!.length !== rows.length) throw new Error(`Fixture count mismatch: ${table}`);
      // CONFIG is compared in full. Synthetic rows compare all declared fields,
      // and the full readback (including defaults) enters the semantic fingerprint.
      for (let i = 0; i < rows.length; i++) {
        const target = rows[i]!, observed = actual[table]![i]!;
        const projection = catalog.inventory.CONFIG.includes(table) ? observed : Object.fromEntries(Object.keys(target).map(key => [key, observed[key]]));
        if (canonical(numericNormalized(target)) !== canonical(numericNormalized(projection))) {
          const diff = process.env.LRA_DEBUG
            ? " " + Object.keys(target).filter(k => canonical(target[k]) !== canonical(projection[k])).map(k => `${k}: ${JSON.stringify(target[k])} -> ${JSON.stringify(projection[k])}`).join("; ").slice(0, 400)
            : "";
          throw new Error(`Fixture content mismatch: ${table}${diff}`);
        }
      }
    }
    // F3's identity contract deliberately excludes credentials and DB-generated
    // user/membership identifiers and timestamps. Operational dates are never stripped.
    const roster = SIM_PERSONAS.map(p => ({ ...p, locations: [...p.locations] }));
    const rosterDigest = sha256(canonical(roster));
    actual.users = roster.map(p => ({ id: `persona:${p.email}`, email: p.email, name: p.name, role: p.role, language: p.language, active: true }));
    actual.user_locations = SIM_PERSONAS.flatMap(p => p.locations.map(code => ({ user_id: `persona:${p.email}`, location_id: SIM_LOCATIONS[code].id, active: true })));
    const aliases = new Map(Object.entries(personas).map(([alias, id]) => [id, `persona:${alias}@sim.co-ops`]));
    function normalize(value: unknown): unknown {
      if (typeof value === "string") return aliases.get(value) ?? value;
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
      return value;
    }
    const receipt: Receipt = {
      fixtureId, recipeVersion: recipe.recipeVersion, snapshotManifestHash: sha256(readFileSync(resolve(dir, "manifest.json"))), schemaDigest: options.schemaDigest,
      restorePlan: { deleteOrder: deletes, loadOrder: loads, stagedColumns: plan.deleteStages.map(s => `${s.child}.${s.column}`), leafFirstCounts: plan.leafFirstCounts },
      counts, startedAt, finishedAt: new Date().toISOString(), rosterDigest, identityDigest: sha256(canonical(personas)),
      fingerprint: fingerprint({ schemaDigest: options.schemaDigest, snapshotHashes: Object.fromEntries(Object.entries(manifest.tables).map(([table, meta]) => [table, meta.sha256])),
        recipeVersion: recipe.recipeVersion, anchorDateEt: recipe.anchorDateEt, tables: normalize(actual) as Snapshot, primaryKeys: { ...primaryKeys, users: ["id"], user_locations: ["user_id", "location_id"] }, rosterDigest }),
    };
    writeVerified(resolve("scripts/sim/launch-readiness/.private", runId, "receipt.json"), receipt);
    writeVerified(resolve("scripts/sim/launch-readiness/.artifacts", runId, "fixture.json"), { fixtureId, counts, fingerprint: receipt.fingerprint });
    unlinkSync(dirtyMarker()); assertClean();
    return receipt;
  } catch (error) {
    writeVerified(dirtyMarker(), { runId, fixtureId, startedAt, status: "reset-failed" });
    throw error;
  }
}
