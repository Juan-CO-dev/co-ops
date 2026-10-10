/**
 * A recording fake SupabaseClient for the vault tests. Supports the chains lib/vault.ts uses
 * (select/eq/is/in/not/gte/order/limit/maybeSingle, insert().select().maybeSingle(), update().eq()…,
 * rpc) over in-memory tables, records every write and RPC call, and emulates the two definer RPCs
 * (vault_write_secret with its version check and supersede, vault_take_reveal_slot).
 * Never a real database: nothing here touches Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
export interface Write { table: string; op: "insert" | "update"; payload: unknown; matched?: number }
export interface RpcCall { name: string; args: Record<string, unknown> }

export interface FakeVaultClient {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  writes: Write[];
  rpcCalls: RpcCall[];
  /** Tables whose INSERT should fail (error returned, nothing stored). */
  failInsert: Set<string>;
  /** RPC names that should return an error message. */
  failRpc: Map<string, string>;
  /** Simulate a widened SQL read while retaining pagination. */
  ignoreVisibilityFilters: boolean;
}

let seq = 0;
const nextId = (table: string) => `${table}-${++seq}`;

export function fakeVaultClient(tables: Record<string, Row[]>, rowLimit = 1000): FakeVaultClient {
  const writes: Write[] = [];
  const rpcCalls: RpcCall[] = [];
  const failInsert = new Set<string>();
  const failRpc = new Map<string, string>();
  const counters = new Map<string, number>();

  function query(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: unknown;
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    const rowsOf = () => (tables[table] ??= []);
    const run = () => {
      const matched = rowsOf().filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        writes.push({ table, op, payload });
        if (failInsert.has(table)) return { data: null, error: { message: `insert failed: ${table}` } };
        const arr = (Array.isArray(payload) ? payload : [payload]) as Row[];
        // Column defaults the migration supplies (the lib relies on them exactly as it would on Postgres).
        const defaults: Row = table === "vault_entries"
          ? { revision: 1, active: true, updated_by: null, updated_at: null, deactivated_by: null, deactivated_at: null }
          : table === "vault_reveals" ? { burst: false, at: new Date().toISOString() } : {};
        const inserted = arr.map((p) => ({ id: nextId(table), created_at: new Date().toISOString(), ...defaults, ...p }));
        rowsOf().push(...inserted);
        return { data: inserted, error: null };
      }
      if (op === "update") {
        writes.push({ table, op, payload, matched: matched.length });
        for (const r of matched) Object.assign(r, payload as Row);
        return { data: matched, error: null };
      }
      let out = [...matched];
      if (orderBy) {
        const { col, asc } = orderBy;
        out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limitN !== null) out = out.slice(0, limitN);
      return { data: out.slice(0, rowLimit).map((r) => ({ ...r })), error: null };
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { if (!(result.ignoreVisibilityFilters && table === "vault_entries" && ["kind", "active"].includes(c))) filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return q; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      not: (c: string, _operator: string, v: unknown) => { filters.push((r) => !(v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return q; },
      gt: (c: string, v: unknown) => { filters.push((r) => String(r[c]) > String(v)); return q; },
      lte: (c: string, v: number) => { if (!result.ignoreVisibilityFilters) filters.push((r) => typeof r[c] === "number" && Number(r[c]) <= v); return q; },
      or: (expression: string) => {
        const ids = expression.match(/location_id\.in\.\(([^)]*)\)/)?.[1]?.split(",") ?? [];
        if (!result.ignoreVisibilityFilters) filters.push((r) => r.location_id === null || ids.includes(String(r.location_id)));
        return q;
      },
      gte: (c: string, v: unknown) => { filters.push((r) => String(r[c]) >= String(v)); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { orderBy = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { limitN = n; return q; },
      insert: (p: unknown) => { op = "insert"; payload = p; return q; },
      update: (p: unknown) => { op = "update"; payload = p; return q; },
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }

  const rpc = async (name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> => {
    rpcCalls.push({ name, args });
    const fail = failRpc.get(name);
    if (fail) return { data: null, error: { message: fail } };
    if (name === "vault_take_reveal_slot") {
      const key = String(args.p_user_id);
      const attempts = (counters.get(key) ?? 0) + 1;
      counters.set(key, attempts);
      return { data: { attempts, bucket_start: "2026-10-08T12:00:00Z" }, error: null };
    }
    if (name === "vault_update_entry") {
      const entry = (tables.vault_entries ?? []).find((r) => r.id === args.p_entry_id);
      if (!entry || !entry.active) return { data: null, error: { message: "entry_not_found" } };
      if (entry.revision !== args.p_expected_revision) return { data: null, error: { message: "version_conflict" } };
      if (failInsert.has("audit_log")) return { data: null, error: { message: "audit_failed" } };
      const { _audit, ...patch } = args.p_patch as Row;
      const changed = Object.keys(patch).filter((key) => patch[key] !== entry[key]).sort();
      if (args.p_version !== null) {
        const enc = args.p_envelope as Row;
        const result = await rpc("vault_write_secret", {
          p_entry_id: args.p_entry_id, p_actor_id: args.p_actor_id, p_version: args.p_version,
          p_ciphertext: enc.ciphertext, p_iv: enc.iv, p_tag: enc.tag, p_wrapped_key: enc.wrappedKey,
          p_key_iv: enc.keyIv, p_key_tag: enc.keyTag, p_master_key_id: enc.masterKeyId,
        });
        if (result.error) return result;
      }
      Object.assign(entry, patch, { revision: Number(entry.revision) + 1, updated_by: args.p_actor_id, updated_at: new Date().toISOString() });
      const metadata: Row = { kind: entry.kind, entry_id: entry.id, entry_type: entry.entry_type, ...(_audit as Row) };
      if (entry.kind === "shared") Object.assign(metadata, { name: entry.name, location_id: entry.location_id, min_level: entry.min_level });
      const base = { actor_id: args.p_actor_id, actor_role: tables.users?.find((u) => u.id === args.p_actor_id)?.role, resource_id: entry.id, destructive: true };
      const logs = (tables.audit_log ??= []);
      if (changed.length || args.p_version !== null) logs.push({ ...base, action: "vault_entry.update", resource_table: "vault_entries", metadata: { ...metadata, changed, secret_rotated: args.p_version !== null, secret_version: args.p_version } });
      if (args.p_version !== null) logs.push({ ...base, action: "vault_secret.rotate", resource_table: "vault_secrets", metadata: { ...metadata, secret_version: args.p_version } });
      return { data: { ...entry }, error: null };
    }
    if (name === "vault_write_secret") {
      const secrets = (tables.vault_secrets ??= []);
      const entry = (tables.vault_entries ?? []).find((r) => r.id === args.p_entry_id);
      if (!entry || entry.active === false) return { data: null, error: { message: "entry_not_found" } };
      const mine = secrets.filter((r) => r.entry_id === args.p_entry_id);
      const next = Math.max(0, ...mine.map((r) => Number(r.version))) + 1;
      if (args.p_version !== next) return { data: null, error: { message: "version_conflict" } };
      const now = new Date().toISOString();
      let superseded = 0;
      for (const r of mine) if (r.superseded_at == null) { r.superseded_at = now; superseded += 1; }
      secrets.push({
        id: nextId("vault_secrets"), entry_id: args.p_entry_id, version: next, ciphertext: args.p_ciphertext, iv: args.p_iv, tag: args.p_tag,
        wrapped_key: args.p_wrapped_key, key_iv: args.p_key_iv, key_tag: args.p_key_tag, master_key_id: args.p_master_key_id,
        created_by: args.p_actor_id, created_at: now, superseded_at: null, scrubbed_at: null,
      });
      return { data: { version: next, superseded: superseded > 0, scrubbed: 0 }, error: null };
    }
    return { data: null, error: { message: `unknown rpc ${name}` } };
  };

  const result = { client: { from: query, rpc } as unknown as SupabaseClient, tables, writes, rpcCalls, failInsert, failRpc, ignoreVisibilityFilters: false };
  return result;
}
