import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SIM_LOCATIONS } from "../personas-shared";

export type Row = Record<string, unknown>;
export type Snapshot = Record<string, Row[]>;
export type Inventory = Record<"CONFIG" | "AUTH" | "HISTORY", string[]>;
export type SnapshotManifest = {
  sanitized_at: string; source_export: string; dropped: string[];
  tables: Record<string, { rows: number; sha256: string; primaryKey?: string[] }>;
};
export type Handle = { resolve: "snapshot"; table: string; match: Row; vendor?: string; blocked?: string };
export type Recipe = {
  id: string; recipeVersion: string; anchorDateEt: string; blocked?: string;
  handles: Record<string, Handle>;
  synthetic: { table: string; handle: string; row: Row; repeat?: number; sentinel?: Row }[];
  expected: { counts: Record<string, number>; [key: string]: unknown };
};
export type Catalog = {
  expectedTableCount: number; inventory: Inventory; blocked: string[];
  recipes: Recipe[];
};
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const identifier = /^[a-z][a-z0-9_]*$/;
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error("Unsafe integer; supply an exact string");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Row)[key])}`).join(",")}}`;
  }
  throw new Error("Non-JSON fingerprint value");
}

/** Preserve decimal lexemes before JSON.parse can round them. Integer counts stay integers. */
export function parseExactJson(text: string): unknown {
  const protectedNumbers = text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
    if (token.startsWith('"')) return token;
    return /[.eE]/.test(token) || !Number.isSafeInteger(Number(token)) ? JSON.stringify(token) : token;
  });
  return JSON.parse(protectedNumbers);
}
export function loadSnapshotManifest(dir: string): SnapshotManifest {
  const manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8")) as SnapshotManifest;
  if (!manifest || typeof manifest.sanitized_at !== "string" || !Number.isFinite(Date.parse(manifest.sanitized_at)) ||
      typeof manifest.source_export !== "string" || !Array.isArray(manifest.dropped) || !manifest.tables) throw new Error("Invalid snapshot manifest");
  for (const [table, entry] of Object.entries(manifest.tables)) {
    if (!identifier.test(table) || !Number.isSafeInteger(entry.rows) || entry.rows < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid snapshot table metadata");
  }
  return manifest;
}
export function classifyTables(manifest: SnapshotManifest, inventory: Inventory): Map<string, keyof Inventory> {
  const classified = new Map<string, keyof Inventory>();
  for (const kind of ["CONFIG", "AUTH", "HISTORY"] as const) {
    for (const table of inventory[kind]) {
      if (!identifier.test(table) || classified.has(table)) throw new Error("Inventory is not disjoint");
      classified.set(table, kind);
    }
  }
  if (classified.size !== 141) throw new Error(`Inventory must classify 141 tables; found ${classified.size}`);
  const dropped = new Set(manifest.dropped);
  if (dropped.size !== manifest.dropped.length || [...dropped].some(table => !classified.has(table))) throw new Error("Invalid dropped table inventory");
  for (const table of Object.keys(manifest.tables)) if (classified.get(table) !== "CONFIG" || dropped.has(table)) throw new Error("Snapshot contains an unexpected table");
  for (const table of inventory.CONFIG) if (!dropped.has(table) && !manifest.tables[table]) throw new Error("Snapshot CONFIG table missing");
  return classified;
}
export function loadSnapshot(dir: string, manifest: SnapshotManifest): Snapshot {
  const snapshot: Snapshot = {};
  for (const [table, metadata] of Object.entries(manifest.tables)) {
    if (!identifier.test(table)) throw new Error("Invalid snapshot table name");
    const bytes = readFileSync(resolve(dir, `${table}.json`));
    if (sha256(bytes) !== metadata.sha256) throw new Error(`Snapshot hash mismatch: ${table}`);
    const rows = parseExactJson(bytes.toString("utf8"));
    if (!Array.isArray(rows) || rows.length !== metadata.rows || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error(`Snapshot row mismatch: ${table}`);
    snapshot[table] = rows;
  }
  return snapshot;
}
export function ordered(tables: string[], fks: { child: string; parent: string }[]): string[] {
  if (new Set(tables).size !== tables.length) throw new Error("Duplicate order entry");
  const remaining = new Set(tables), out: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].sort().filter(table => !fks.some(fk => fk.child === table && fk.parent !== table && remaining.has(fk.parent)));
    if (!ready.length) throw new Error("FK cycle requires reviewed reset plan");
    for (const table of ready) { out.push(table); remaining.delete(table); }
  }
  return out;
}
export function resolveHandle(snapshot: Snapshot, handle: Handle): Row {
  if (handle.resolve !== "snapshot") throw new Error("Unknown handle resolution");
  if (handle.blocked) throw new Error(`Blocked handle: ${handle.blocked}`);
  let candidates = snapshot[handle.table];
  if (!candidates) throw new Error("Handle table missing");
  if (handle.vendor !== undefined) {
    const vendors = (snapshot.vendors ?? []).filter(row => row.name === handle.vendor);
    if (vendors.length !== 1) throw new Error("Vendor handle must resolve exactly once");
    candidates = candidates.filter(row => row.vendor_id === vendors[0]!.id);
  }
  const matches = candidates.filter(row => Object.entries(handle.match).every(([key, value]) => canonical(row[key]) === canonical(value)));
  if (matches.length !== 1) throw new Error("Recipe handle must resolve exactly once");
  return matches[0]!;
}
/** RFC 4122 v5, DNS namespace; no randomness or wall clock in synthetic IDs. */
export function stableId(recipeVersion: string, handle: string): string {
  const bytes = createHash("sha1").update(Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex")).update(`${recipeVersion}:${handle}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function synthesize(recipe: Recipe, snapshot: Snapshot, personasMap: Record<string, string>): { table: string; rows: Row[] }[] {
  const entries = recipe.synthetic.flatMap(entry => {
    const count = entry.repeat ?? 1;
    if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new Error("Invalid repeat count");
    const handles = Array.from({ length: count }, (_, index) => entry.repeat === undefined ? entry.handle : `${entry.handle}:${index}`);
    const sentinel = [...handles].sort((a,b) => stableId(recipe.recipeVersion, a).localeCompare(stableId(recipe.recipeVersion, b))).at(-1);
    function sequence(value: unknown, index: number): unknown {
      if (Array.isArray(value)) return value.map(child => sequence(child, index));
      if (value && typeof value === "object") {
        const row = value as Row;
        if (typeof row.$sequence === "string" && Object.keys(row).length === 1) return { $handle: `${row.$sequence}:${index}` };
        return Object.fromEntries(Object.entries(row).map(([key, child]) => [key, sequence(child, index)]));
      }
      return value;
    }
    return handles.map((handle, index) => ({ table: entry.table, handle, row: sequence({ ...entry.row, ...(handle === sentinel ? entry.sentinel : {}) }, index) as Row }));
  });
  const handles = new Map<string, string>();
  for (const [name, handle] of Object.entries(recipe.handles)) {
    const row = resolveHandle(snapshot, handle);
    if (typeof row.id !== "string") throw new Error("Handle requires an id");
    handles.set(name, row.id);
  }
  for (const [alias, id] of Object.entries(personasMap)) handles.set(`persona:${alias}`, id);
  for (const [code, location] of Object.entries(SIM_LOCATIONS)) handles.set(`location:${code}`, location.id);
  for (const entry of entries) {
    if (handles.has(entry.handle)) throw new Error("Duplicate synthetic handle");
    handles.set(entry.handle, stableId(recipe.recipeVersion, entry.handle));
  }
  function expand(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === "object") {
      const row = value as Row;
      if (Object.keys(row).length === 1 && typeof row.$handle === "string") {
        if (!handles.has(row.$handle)) throw new Error("Undeclared recipe handle");
        return handles.get(row.$handle)!;
      }
      return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, expand(item)]));
    }
    return value;
  }
  const batches = new Map<string, Row[]>();
  for (const entry of entries) {
    const rows = batches.get(entry.table) ?? [];
    rows.push({ ...expand(entry.row) as Row, id: handles.get(entry.handle)! }); batches.set(entry.table, rows);
  }
  // Recipe order is explicit and reviewed, including intra-table FK relationships.
  for (const [table, rows] of batches) if (recipe.expected.counts[table] !== rows.length) throw new Error("Synthetic count differs from declared oracle");
  return [...batches].map(([table, rows]) => ({ table, rows }));
}
export function sortedRows(rows: Row[], pk: string[]): Row[] {
  if (!pk.length || pk.some(key => !identifier.test(key))) throw new Error("Missing primary key");
  const keyed = rows.map(row => {
    if (pk.some(key => row[key] === undefined || row[key] === null)) throw new Error("Missing row primary key");
    return { row, key: canonical(pk.map(key => row[key])) };
  }).sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  if (new Set(keyed.map(row => row.key)).size !== rows.length) throw new Error("Duplicate readback primary key");
  return keyed.map(entry => entry.row);
}
export type FingerprintState = {
  schemaDigest: string; snapshotHashes: Record<string, string>; recipeVersion: string; anchorDateEt: string;
  tables: Snapshot; primaryKeys: Record<string, string[]>; rosterDigest: string;
};
export function fingerprint(state: FingerprintState): string {
  if (!/^[a-f0-9]{64}$/.test(state.schemaDigest) || !/^[a-f0-9]{64}$/.test(state.rosterDigest)) throw new Error("Schema and roster digests required");
  const tables = Object.fromEntries(Object.keys(state.tables).sort().map(table => {
    const rows = sortedRows(state.tables[table]!, state.primaryKeys[table] ?? []);
    return [table, { count: rows.length, digest: sha256(canonical(rows)) }];
  }));
  return sha256(canonical({ schemaDigest: state.schemaDigest, snapshotHashes: state.snapshotHashes, recipeVersion: state.recipeVersion, anchorDateEt: state.anchorDateEt, tables, rosterDigest: state.rosterDigest }));
}
