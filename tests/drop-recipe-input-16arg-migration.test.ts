import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedShopOwnedDb, SHOP_OWNED_ID as I } from "./fixtures/shop-owned-pglite";

const path = "supabase/migrations/0266_drop_recipe_input_16arg.sql";
const signature = "public.update_recipe_input_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,text,boolean,uuid,uuid,uuid,numeric,text,text,boolean)";
let db: PGlite;
afterEach(async () => { await db?.close(); });

it("preserves the authored post-READY/drain gate and accepts dated deployment stamps", () => {
  const sql = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const valid = (source: string) => {
    const lines = source.split("\n");
    return lines[0] === "-- Migration 0266_drop_recipe_input_16arg"
      && lines[1] === "-- AUTHORED 2026-10-16; FILE ONLY. Apply only after deployment READY and older deployments drain; CC/Juan gate."
      && lines.filter(line => line.startsWith("-- APPLIED ")).every(line => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}(?: \(.*\))?$/.test(line));
  };
  expect(valid(sql)).toBe(true);
  const [head, gate, ...rest] = sql.split("\n");
  for (const destination of ["SIM", "PROD"]) expect(valid([head, gate, `-- APPLIED TO ${destination} 2026-10-17`, ...rest].join("\n"))).toBe(true);
  expect(valid(sql.replace("older deployments drain", "ready"))).toBe(false);
  expect(valid([head, ...rest].join("\n"))).toBe(false);
  expect(valid([head, gate, "-- APPLIED TO SIM yesterday", ...rest].join("\n"))).toBe(false);
  const statements = sql.replace(/--[^\n]*/g, "").trim().split(";").map(s => s.trim()).filter(Boolean);
  expect(statements).toEqual([`drop function ${signature}`]);
});

it("drops only the 16-argument overload and preserves the callable 17-argument writer", async () => {
  db = await migratedShopOwnedDb();
  const newer = signature.replace(/\)$/, ",uuid)");
  const resolve = async (name: string) => (await db.query<{ present: boolean }>("select to_regprocedure($1) is not null present", [name])).rows[0]!.present;
  expect(await resolve(signature)).toBe(true);
  expect(await resolve(newer)).toBe(true);
  await db.exec(readFileSync(path, "utf8"));
  expect(await resolve(signature)).toBe(false);
  expect(await resolve(newer)).toBe(true);
  expect((await db.query("select has_function_privilege('service_role',$1,'execute') allowed", [newer])).rows).toEqual([{ allowed: true }]);
  const input = (await db.query<{ id: string }>("select id from recipe_inputs where recipe_id=$1", [I.sharedRecipe])).rows[0]!.id;
  const result = await db.query<{ quantity: string }>(`select quantity from update_recipe_input_atomic(
    $1,$2,$3,null,null,9,'oz',null,false,$3,null,null,4,'oz',null,false,$4)`, [input, I.sharedRecipe, I.sharedSku, I.actor]);
  expect(result.rows).toEqual([{ quantity: "9" }]);
}, 120_000);
