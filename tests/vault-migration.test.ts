/** SQL contract checks for 0235 (authored only); they complement (never replace) scripts/test-password-vault.sql on the sim. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VAULT_PREVIOUS_SECRET_RETENTION_DAYS, VAULT_ROLE_FLOORS } from "@/lib/vault-shared";

const sql = readFileSync("supabase/migrations/0235_password_vault.sql", "utf8").replace(/\r\n/g, "\n");
const TABLES = ["vault_entries", "vault_secrets", "vault_reveals", "vault_reveal_counters"];
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
}
const tableBody = (name: string) => between(sql, `create table public.${name} (`, "\n);");

describe("0235 password vault: migration discipline", () => {
  it("is numbered 0235, authored only, never touches 0234's number, one transaction", () => {
    expect(sql.split("\n")[0]).toBe("-- Migration 0235_password_vault");
    expect(sql).toMatch(/AUTHORED ONLY 2026-10-08.*NOT APPLIED/);
    expect(sql).not.toMatch(/APPLIED TO PROD/);
    expect(sql.match(/\b0234\b/g)).toHaveLength(1); // the reservation note only
    expect(sql).toMatch(/\nbegin;\n/);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("pre-flights the columns it depends on and refuses a re-apply", () => {
    const pre = between(sql, "do $$ declare entry text;", "end $$;");
    for (const c of ["locations.id", "locations.code", "users.id", "users.role", "users.active", "user_locations.user_id", "user_locations.location_id", "user_locations.active"]) {
      expect(pre).toContain(`'${c}'`);
    }
    expect(pre).toContain("raise exception '0235: already applied'");
    for (const t of TABLES) expect(pre).toContain(`to_regclass('public.${t}')`);
  });

  it("re-emits NO existing object: every function is new, nothing is replaced or dropped", () => {
    expect(sql).not.toMatch(/create or replace/i);
    expect(sql).not.toMatch(/drop (function|table|policy|index)/i);
    expect(sql).not.toMatch(/alter table public\.(?!vault_)/);
    const created = [...sql.matchAll(/create function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    expect(created).toEqual(["vault_write_secret", "vault_update_entry", "vault_take_reveal_slot", "vault_scrub_expired_secrets"]);
    for (const body of sql.split("create function ").slice(1)) expect(body.slice(0, 400)).toContain("security definer set search_path=pg_catalog,public");
  });

  it("every definer function is private: revoked from public/anon/authenticated, granted to service_role, asserted", () => {
    const grantList = between(sql, "-- Definer helpers are private", "commit;");
    for (const f of ["vault_write_secret(uuid,uuid,integer,text,text,text,text,text,text,text)", "vault_take_reveal_slot(uuid)", "vault_scrub_expired_secrets()"]) {
      expect(grantList).toContain(`'public.${f}'::regprocedure`);
    }
    expect(grantList).toContain("revoke all on function %s from public,anon,authenticated");
    expect(grantList).toContain("raise exception '0235: RPC grant escaped'");
    for (const t of TABLES) expect(grantList).toContain(`'${t}'`);
    expect(grantList).toContain("raise exception '0235: vault grant escaped'");
  });

  it("all four tables are deny-all RLS with the house policy names and a full revoke before the grant", () => {
    for (const table of TABLES) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      for (const op of ["select", "insert", "update", "delete"]) expect(sql).toContain(`create policy ${table}_no_user_${op} on public.${table} for ${op}`);
      expect(sql).toContain(`revoke all on public.${table} from public,anon,authenticated,service_role;`);
      expect(sql).not.toMatch(new RegExp(`grant [^;]*delete[^;]*on public\\.${table}`));
      expect(sql).not.toMatch(new RegExp(`grant [^;]*on public\\.${table} to (anon|authenticated|public)`));
    }
  });

  it("grants are the writer shape: entries insert/update, secrets read-only (RPC writes), reveals append-only, counters read-only", () => {
    expect(sql).toContain("grant select, insert, update on public.vault_entries to service_role;");
    expect(sql).toContain("grant select on public.vault_secrets to service_role;");
    expect(sql).toContain("grant select, insert on public.vault_reveals to service_role;");
    expect(sql).toContain("grant select on public.vault_reveal_counters to service_role;");
    const grantList = between(sql, "-- Definer helpers are private", "commit;");
    expect(grantList).toContain("has_table_privilege('service_role','public.vault_secrets','INSERT,UPDATE')");
    expect(grantList).toContain("has_table_privilege('service_role','public.vault_reveals','UPDATE')");
    expect(grantList).toContain("has_table_privilege('service_role','public.vault_reveal_counters','INSERT,UPDATE')");
  });

  it("vault_entries: shared = floor (the spec's six) + shop or both; personal = owner, no shop; deactivate never delete; no secret column", () => {
    const body = tableBody("vault_entries");
    expect(body).toContain(`min_level integer check (min_level in (${[...VAULT_ROLE_FLOORS].join(",")}))`);
    expect(body).toContain("check ((kind='personal') = (owner_id is not null))");
    expect(body).toContain("check ((kind='shared') = (min_level is not null))");
    expect(body).toContain("check (kind='shared' or location_id is null)");
    expect(body).toContain("check (active = (deactivated_at is null))");
    expect(body).toContain("entry_type text not null check (entry_type in ('login','code','ai_key'))");
    expect(body).toContain("char_length(btrim(name)) between 1 and 120");
    expect(body).not.toMatch(/\b(secret|plaintext|password|ciphertext)\b/);
  });

  it("vault_secrets: one current version per entry, whole-envelope-or-scrubbed, base64 shapes, only a previous version is scrubbed", () => {
    const body = tableBody("vault_secrets");
    expect(sql).toContain("create unique index vault_secrets_one_current on public.vault_secrets(entry_id) where superseded_at is null;");
    expect(body).toContain("unique (entry_id, version)");
    expect(body).toContain("check ((scrubbed_at is null) = (ciphertext is not null and iv is not null and tag is not null");
    expect(body).toContain("check (scrubbed_at is null or superseded_at is not null)");
    expect(body).toContain("char_length(iv) = 16"); // 12-byte GCM IV
    expect(body).toContain("char_length(tag) = 24"); // 16-byte GCM tag
    expect(body).toContain("char_length(wrapped_key) = 44"); // 32-byte data key
    expect(body).toContain("char_length(key_iv) = 16");
    expect(body).toContain("char_length(key_tag) = 24");
    expect(body).not.toMatch(/\bmaster_key\b/); // the master key has no column, anywhere
  });

  it("vault_reveals: a recorded personal REVEAL is impossible by CHECK; an owner recovery is always personal; never a secret", () => {
    const body = tableBody("vault_reveals");
    expect(body).toContain("check (kind <> 'reveal' or entry_kind = 'shared')");
    expect(body).toContain("check (kind <> 'owner_recovery' or entry_kind = 'personal')");
    expect(body).toContain("kind text not null check (kind in ('reveal','owner_recovery','previous_recovery'))");
    expect(body).toContain("burst boolean not null default false");
    expect(body).not.toMatch(/\b(secret|plaintext|password|ciphertext|wrapped_key)\b/);
    expect(body).toContain("secret_version integer"); // the version NUMBER is the only "secret" word allowed
  });

  it("vault_write_secret: entry row lock, supersede-then-append, scrub of this entry's expired versions, never inspects the envelope", () => {
    const fn = between(sql, "create function public.vault_write_secret", "$$;\n");
    expect(fn).toContain("from public.vault_entries where id=p_entry_id for update");
    expect(fn.indexOf("set superseded_at=clock_timestamp() where entry_id=p_entry_id and superseded_at is null"))
      .toBeLessThan(fn.indexOf("insert into public.vault_secrets"));
    expect(fn).toContain("coalesce(max(version),0)+1");
    // The app encrypted for p_version (AAD); a concurrent writer makes this a refusal, never a mis-versioned row.
    expect(fn).toContain("if p_version <> v_version then raise exception 'version_conflict'");
    expect(fn.indexOf("raise exception 'version_conflict'")).toBeLessThan(fn.indexOf("set superseded_at=clock_timestamp()"));
    expect(fn).toContain(`superseded_at < clock_timestamp() - interval '${VAULT_PREVIOUS_SECRET_RETENTION_DAYS} days'`);
    expect(fn).toContain("set ciphertext=null,iv=null,tag=null,wrapped_key=null,key_iv=null,key_tag=null,scrubbed_at=clock_timestamp()");
    expect(fn).not.toMatch(/decode|decrypt|pgp_|convert_from/);
    expect(fn).toContain("if not found or not v_entry.active then raise exception 'entry_not_found'");
  });

  it("vault_take_reveal_slot: an atomic upsert per (user, hour) returning the count including this attempt", () => {
    const fn = between(sql, "create function public.vault_take_reveal_slot", "$$;\n");
    expect(fn).toContain("date_trunc('hour',clock_timestamp())");
    expect(fn).toContain("on conflict (user_id,bucket_start) do update set attempts=public.vault_reveal_counters.attempts+1");
    expect(fn).toContain("returning attempts into v_attempts");
    expect(fn).not.toMatch(/entry_id/); // the counter never learns which entry
  });

  it("vault_scrub_expired_secrets: the same 30-day sweep for every entry, rows kept", () => {
    const fn = between(sql, "create function public.vault_scrub_expired_secrets", "$$;\n");
    expect(fn).toContain(`superseded_at < clock_timestamp() - interval '${VAULT_PREVIOUS_SECRET_RETENTION_DAYS} days'`);
    expect(fn).not.toMatch(/\bdelete\b/);
    expect(sql).not.toMatch(/\bdelete from\b/i);
  });
});


it("BC-007/033: atomic edits lock and check the revision before either write, with no exception swallowing", () => {
  const fn = between(sql, "create function public.vault_update_entry", "$$;\n");
  expect(tableBody("vault_entries")).toContain("revision integer not null default 1");
  const lock = fn.indexOf("where id=p_entry_id for update");
  const check = fn.indexOf("if v_entry.revision <> p_expected_revision");
  const rotation = fn.indexOf("perform public.vault_write_secret");
  const metadata = fn.indexOf("update public.vault_entries");
  expect(lock).toBeGreaterThan(0);
  expect(check).toBeGreaterThan(lock);
  expect(rotation).toBeGreaterThan(check);
  expect(metadata).toBeGreaterThan(rotation);
  expect(fn).toContain("revision=revision+1");
  expect(fn).not.toMatch(/exception when|commit;/);
  expect(sql).toContain("'public.vault_update_entry(uuid,uuid,integer,jsonb,integer,jsonb)'::regprocedure");
});
