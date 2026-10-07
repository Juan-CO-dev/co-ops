/**
 * Unit spine — migration 0218 (batch vs bottle Phase B), source pins.
 *
 *   · recipe_yield_retrain_notes is deny-all (RLS on, every PostgREST role revoked, no policies)
 *     and append-only by grant (service_role: SELECT + INSERT, never UPDATE/DELETE/TRUNCATE);
 *   · update_recipe_output_yield takes the RECIPE row lock before it touches the output row
 *     (the serialisation point every 0215 recipe/output writer shares), refuses by name, and is
 *     executable by service_role only;
 *   · the migration is authored-only (gate line present) and self-checks its grants.
 *   · the audit actions its callers emit are registered (recipe_output.update destructive,
 *     yield.retrain_noted not).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isDestructive } from "@/lib/destructive-actions";
import { isKnownAuditAction } from "@/lib/audit-actions";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(ROOT, "supabase", "migrations", "0218_yield_retrain_notes.sql"), "utf8").replace(/\r\n/g, "\n");
const sql = raw.replace(/--[^\n]*/g, "").toLowerCase();

function fnBody(name: string): string {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  expect(at, `${name} not defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("end $$;", at);
  expect(end).toBeGreaterThan(at);
  return sql.slice(at, end);
}

describe("0218 header", () => {
  it("is authored only, behind the CC/Juan gate", () => {
    expect(raw).toMatch(/NOT YET APPLIED — GATE \(CC\/JUAN\)/);
    expect(raw).not.toMatch(/APPLIED TO PROD/);
  });
  it("runs in one transaction", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });
});

describe("recipe_yield_retrain_notes — deny-all, append-only", () => {
  it("enables RLS and revokes every PostgREST role", () => {
    expect(sql).toMatch(/alter table public\.recipe_yield_retrain_notes enable row level security;/);
    expect(sql).toMatch(/revoke all on public\.recipe_yield_retrain_notes from public, anon, authenticated;/);
  });
  it("writes NO policy (a policy for a role with no privilege is decoration)", () => {
    expect(sql).not.toMatch(/create policy/);
  });
  it("service_role may read and insert, never update/delete/truncate", () => {
    expect(sql).toMatch(/grant select, insert on public\.recipe_yield_retrain_notes to service_role;/);
    expect(sql).toMatch(/revoke update, delete, truncate on public\.recipe_yield_retrain_notes from service_role;/);
    expect(sql).not.toMatch(/grant [^;]*update[^;]*recipe_yield_retrain_notes/);
  });
  it("is location-keyed, and a maker note names exactly one maker", () => {
    expect(sql).toMatch(/location_id\s+uuid\s+not null references public\.locations\(id\)/);
    expect(sql).toMatch(/check \(scope in \('recipe', 'maker'\)\)/);
    expect(sql).toMatch(/check \(\(scope = 'maker'\) = \(maker_id is not null\)\)/);
    expect(sql).toMatch(/snooze_batches\s+integer\s+not null default 10/);
  });
});

describe("update_recipe_output_yield — the serialised card writer", () => {
  const body = fnBody("update_recipe_output_yield");
  it("is SECURITY DEFINER with the pinned search_path", () => {
    expect(body).toMatch(/security definer set search_path = pg_catalog, public/);
  });
  it("locks the recipe row BEFORE it reads or writes the output row", () => {
    const recipeLock = body.search(/from recipes r where r\.id = p_recipe_id for update/);
    const outputRead = body.indexOf("from recipe_outputs");
    const outputWrite = body.indexOf("update recipe_outputs set yield");
    expect(recipeLock).toBeGreaterThan(-1);
    expect(recipeLock).toBeLessThan(outputRead);
    expect(outputRead).toBeLessThan(outputWrite);
  });
  it("refuses by name: missing/inactive recipe, non-batch recipe, bad yield, missing or ambiguous output", () => {
    for (const code of ["recipe_not_found", "recipe_inactive", "not_batch_recipe", "invalid_yield", "edge_not_found", "ambiguous_output"]) {
      expect(body).toContain(`raise exception '${code}' using errcode = 'p0001'`);
    }
  });
  it("writes ONE output row by id and stamps the recipe's updated_by", () => {
    expect(body).toMatch(/update recipe_outputs set yield = p_yield where id = v_output_id;/);
    expect(body).toMatch(/update recipes set updated_at = now\(\), updated_by = p_actor where id = p_recipe_id;/);
  });
  it("is executable by service_role only, and the migration verifies it", () => {
    expect(sql).toMatch(/revoke all on function public\.update_recipe_output_yield\(uuid, uuid, numeric, uuid\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.update_recipe_output_yield\(uuid, uuid, numeric, uuid\) to service_role;/);
    expect(sql).toMatch(/unexpected update_recipe_output_yield execute grant/);
  });
});

describe("audit vocabulary (registered before any caller)", () => {
  it("recipe_output.update is destructive; yield.retrain_noted is not", () => {
    expect(isKnownAuditAction("recipe_output.update")).toBe(true);
    expect(isDestructive("recipe_output.update")).toBe(true);
    expect(isKnownAuditAction("yield.retrain_noted")).toBe(true);
    expect(isDestructive("yield.retrain_noted")).toBe(false);
  });
});
