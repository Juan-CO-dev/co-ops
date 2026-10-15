/**
 * Catalog Phase 3a — migration 0262 pinned: header + gate line; the dated version table and its
 * one-live index; the DB-proven line link; the backfill's assertions; the journal and its deferred
 * triggers; the per-shop cycle functions; the writers (SECURITY DEFINER, pinned search_path,
 * service_role only, graph lock FIRST); the privilege ceilings; and the four 0258 re-emits as
 * line-subsequences of their latest definer ± the enumerated mods, nothing else.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECIPE_REEMITS, applyMods, extractFunction, isLineSubsequence, normalize } from "../scripts/recipe-versions/reemit-mods";

const DIR = "supabase/migrations";
const read = (f: string) => normalize(readFileSync(`${DIR}/${f}`, "utf8"));
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const M0262 = "0262_recipe_shop_versions.sql";
const src = read(M0262);
const WRITERS = ["save_recipe_version", "retire_recipe_version", "remove_recipe_input_atomic"];
const HELPERS = [
  "recipe_journal_lines_equal", "recipe_global_journal", "recipe_inputs_journal_trg", "recipes_journal_trg",
  "recipe_scope_item_edges", "recipe_lines_would_cycle", "recipe_shops_input_would_cycle", "recipe_shops_output_would_cycle",
  "recipe_scope_lines", "recipe_change_closure", "recipe_change_lock", "recipe_journal_refuse_truncate",
];

/** The house header: the first line names the file; the AUTHORED line carries the gate; a later APPLIED stamp is allowed. */
function headerProblems(sql: string): string[] {
  const lines = sql.split("\n");
  const problems: string[] = [];
  if (lines[0] !== "-- Migration 0262_recipe_shop_versions") problems.push(`first line: ${lines[0]}`);
  if (!/^-- AUTHORED 2026-10-15\. NOT YET APPLIED — apply via MCP after review/.test(lines[1] ?? "")) problems.push(`gate line: ${lines[1]}`);
  // AGENTS.md: once applied, an "-- APPLIED TO PROD <date> (…)" (or SIM) stamp is ADDED under the gate line — never replacing it.
  for (const l of lines.slice(2, 8).filter((x) => /^-- APPLIED /.test(x))) {
    if (!/^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l)) problems.push(`stamp: ${l}`);
  }
  return problems;
}

describe("0262 header", () => {
  it("carries the house header and the gate line", () => {
    expect(headerProblems(src)).toEqual([]);
  });
  it("still passes once an APPLIED stamp is added under the gate line (the pin never fights the stamp)", () => {
    const [first, gate, ...rest] = src.split("\n");
    const stamped = [first, gate, "-- APPLIED TO PROD 2026-10-16 (schema_migrations version 20261016000000, name 'recipe_shop_versions')", ...rest].join("\n");
    expect(headerProblems(stamped)).toEqual([]);
    expect(headerProblems(src.replace("NOT YET APPLIED — apply via MCP after review", "applied"))).not.toEqual([]);
  });
});

describe("0262 structure", () => {
  it("dated versions: one live per (recipe, scope), valid_to paired with active, the identity triple", () => {
    expect(src).toContain("create table if not exists public.recipe_versions");
    expect(src).toMatch(/scope_key\s+uuid\s+generated always as \(coalesce\(location_id, '00000000-0000-0000-0000-000000000000'::uuid\)\) stored/);
    expect(src).toContain("constraint recipe_versions_live_window check ((valid_to is null) = active)");
    expect(src).toContain("on public.recipe_versions (recipe_id, scope_key) where active;");
    expect(src).toContain("constraint recipe_versions_identity_uq unique (id, recipe_id, scope_key)");
  });
  it("lines are proven to belong to their version's recipe and shop, with the 3-way exactly-one rule", () => {
    expect(src).toContain("create table if not exists public.recipe_version_lines");
    expect(src).toContain("foreign key (version_id, recipe_id, scope_key) references public.recipe_versions (id, recipe_id, scope_key)");
    expect(src).toContain("constraint recipe_version_lines_exactly_one_component check");
  });
  it("the backfill gives every recipe ONE global baseline from 2000-01-01 and asserts instead of hoping", () => {
    expect(src).toContain("'2000-01-01T00:00:00Z'");
    expect(src).toContain("recipes without exactly one live global version");
    expect(src).toContain("baseline lines do not match recipe_inputs");
    // the triggers come AFTER the backfill, so the backfill journals nothing
    expect(src.indexOf("create constraint trigger recipe_inputs_journal")).toBeGreaterThan(src.indexOf("baseline lines do not match recipe_inputs"));
  });
  it("the cutover is closed: the table lock comes BEFORE the backfill, the triggers before COMMIT, then the per-recipe proof (Astra 3a r1#4)", () => {
    const lock = src.indexOf("lock table public.recipes, public.recipe_inputs in share row exclusive mode;");
    expect(lock).toBeGreaterThan(src.indexOf("\nbegin;"));
    expect(lock).toBeLessThan(src.indexOf("insert into public.recipe_versions (recipe_id, location_id, active, valid_from, note)"));
    expect(src.indexOf("select pg_advisory_xact_lock(7258025800);")).toBeLessThan(lock);
    const proof = src.indexOf("a line write landed during the cutover");
    expect(proof).toBeGreaterThan(src.indexOf("create constraint trigger recipes_journal"));
    // nothing commits between the lock and the triggers: the file's only COMMIT is its last statement
    expect(src.indexOf("\ncommit;")).toBe(src.lastIndexOf("\ncommit;"));
    expect(src.indexOf("\ncommit;")).toBeGreaterThan(proof);
  });
  it("the dependency snapshot is SCOPED to the change's closure — never a whole table (lead decision (a), Astra r2#1/#2)", () => {
    const snap = extractFunction(src, "create or replace function public.recipe_change_snapshot(", "\n$$;");
    expect(src).not.toContain("catalog_table_digest");
    expect(snap).toContain("from public.recipe_change_closure(p_recipe, p_location, p_lines);");
    // product resolution's inputs: product rows, members, primaries, activation overlay, vendors, receipts
    for (const needle of ["from public.products t where t.id = any(v_products)", "from public.product_primaries t",
      "from public.location_sku_settings t where t.sku_id = any(v_skus)", "from public.vendors t where t.id = any(v_vendors)",
      "from public.vendor_delivery_items di", "from public.vendor_items t where t.id = any(v_skus)",
      "from public.sku_pack_versions t", "from public.vendor_price_history t", "from public.sku_price_lanes t"]) {
      expect(snap, needle).toContain(needle);
    }
    const closure = extractFunction(src, "create or replace function public.recipe_change_closure(", "\n$$;");
    expect(closure).toContain("select vi.id from public.vendor_items vi join products p on vi.product_id = p.product_id"); // every member
    expect(closure).toContain("up(recipe_id) as (");   // the sandwiches the preview shows
    expect(closure).toContain("down(recipe_id) as ("); // everything their costs read
    // flat-pack measurement and only the affected shops (Astra r3)
    expect(closure).toContain("union select 'measure', vi.each_measure from public.vendor_items vi join skus s on s.id = vi.id");
    expect(closure).toContain("then not exists (select 1 from public.recipe_versions v");
    expect(closure).not.toContain("where s.active and (p_location is null or s.id = p_location)");
  });
  it("serialized: the closure locks (NOWAIT, after the graph lock) come BEFORE the snapshot re-check in both writers (Astra r2#3)", () => {
    const lockFn = extractFunction(src, "create or replace function public.recipe_change_lock(", "\n$$;");
    // ROW locks, never a table SHARE lock (review P3b: that conflicts with autovacuum / ANALYZE → spurious busy).
    expect(lockFn).not.toMatch(/lock table/i);
    expect(lockFn).toContain("from public.locations where active order by id for share nowait;");
    expect(lockFn).toContain("from public.measure_units where label = any(v_measures) order by label for share nowait;");
    expect(lockFn).toContain("from public.products where id = any(v_products) order by id for update nowait;");
    expect(lockFn).toContain("from public.vendor_items where id = any(v_skus) order by id for update nowait;");
    expect(lockFn).toContain("when lock_not_available then");
    expect(lockFn).toContain("'recipe_version:dependencies_busy'");
    for (const [fn, lines] of [["save_recipe_version", "v_lines"], ["retire_recipe_version", "v_default"]] as const) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      const graph = body.indexOf("pg_advisory_xact_lock(7258025800)");
      const lock = body.indexOf("perform public.recipe_change_lock(");
      const check = body.indexOf("public.recipe_change_snapshot(");
      expect(graph).toBeGreaterThan(-1);
      expect(lock).toBeGreaterThan(graph);
      expect(check).toBeGreaterThan(lock);
      expect(body).toContain(`, ${lines}) is distinct from p_snapshot`);
      expect(body).toContain("'recipe_version:dependencies_changed'");
    }
    expect(src).toContain("grant execute on function public.recipe_change_snapshot(uuid, uuid, jsonb) to service_role;");
    expect(src).toContain("revoke all on function public.recipe_change_lock(uuid, uuid, jsonb) from public, anon, authenticated, service_role;");
  });
  it("the product rule: no ADDED or CREATED invalid line, carried ones may stay, and the refusal names the line (lead decision (b))", () => {
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    const copy = save.indexOf("from public.recipe_version_lines l where l.version_id = v_source.id;");
    const check = save.indexOf("public.recipe_change_snapshot(p_recipe, p_location, v_lines)");
    const rule = save.indexOf("'recipe_version:product_line_invalid:%', v_i + 1");
    expect(rule).toBeGreaterThan(copy);
    expect(rule).toBeGreaterThan(check); // validated against the locked, re-checked state
    expect(save).toContain("where m.label = btrim(v_line ->> 'unit') and m.active");
    expect(save).toContain("and cur.quantity = (v_line ->> 'quantity')::numeric");
    // a copied set carries nothing; an edit's carried lines are counted with multiplicity (Astra r3#3)
    expect(save).toContain("v_copy := coalesce(p_restored_from, p_adopted_from, p_promoted_from) is not null;");
    expect(save).toContain("if v_seen > v_have then");
  });
  it("PROMOTE retires its source in the same transaction, closing when the new default opens (lead decision 5)", () => {
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    const journal = save.indexOf("v_new := public.recipe_global_journal(p_recipe, p_actor, p_promoted_from,");
    const changed = save.indexOf("v_changed := coalesce(");
    const retire = save.indexOf("where id = p_promoted_from and active;");
    expect(journal).toBeGreaterThan(-1);
    expect(changed).toBeGreaterThan(journal);
    expect(retire).toBeGreaterThan(changed);
    expect(save).toContain("valid_to = greatest((select valid_from from public.recipe_versions where id = v_new), valid_from),");
    expect(save).toContain("'returned_shop', case when p_promoted_from is not null then v_source.location_id end,");
  });
  it("provenance follows the content: an EDIT keeps it; a RESTORE takes the restored version's pointer (none = ended) (Astra 3a r5#1, r6)", () => {
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    expect(save).toContain("v_new_adopted := case when p_adopted_from is not null then p_adopted_from");
    expect(save).toContain("else (select rv.adopted_from_version_id from public.recipe_versions rv where rv.id = v_live) end;");
    // the END is recorded explicitly from the replaced row, never inferred (Astra r7)
    expect(save).toContain("v_ended := case when v_live is not null and v_new_adopted is null");
    const retire = extractFunction(src, "create or replace function public.retire_recipe_version(", "\n$$;");
    expect(retire).toContain("adoption_ended_from_version_id = coalesce(adoption_ended_from_version_id,"); // never nulls an earlier record (Astra r8)
    // every closing UPDATE of a version / overlay row touches only a LIVE row: a retired row's history columns are never rewritten
    for (const fn of ["recipe_global_journal", "save_recipe_version", "retire_recipe_version"]) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      for (const m of body.matchAll(/update public\.recipe_versions[\s\S]*?;/g)) expect(m[0], fn).toMatch(/and active;$/);
    }
  });
  it("a RESTORE copies only global or THIS scope's own history — refused by name in SQL, the database as backstop (lead, after Task 3)", () => {
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    const rule = save.indexOf("if p_restored_from is not null and v_source.location_id is not null and v_source.location_id is distinct from p_location then");
    expect(rule).toBeGreaterThan(save.indexOf("'recipe_version:invalid_source'"));
    expect(rule).toBeLessThan(save.indexOf("from public.recipe_version_lines l where l.version_id = v_source.id;"));
    expect(save).toContain("raise exception 'recipe_version:restore_source_out_of_scope' using errcode = 'P0001';");
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
      expect(dict["catalog.error.restore_source_out_of_scope"], lang).toBeTruthy();
    }
  });
  it("dependencies_busy (two sessions) has its sim check script, which refuses a prod URL and rolls everything back", () => {
    const script = readFileSync("scripts/sim-0262-busy-check.mjs", "utf8");
    expect(script).toContain("recipe_version:dependencies_busy");
    expect(script).toContain("bgcvurheqzylyfehqgzh");
    expect(script).toContain('await b.query("rollback")');
  });
  it("recipes are row-locked FOR NO KEY UPDATE, never FOR UPDATE (review P3c: FK checks against the recipe keep flowing)", () => {
    for (const fn of ["recipe_global_journal", "save_recipe_version", "retire_recipe_version"]) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      expect(body, fn).toMatch(/from public\.recipes( r)? where (r\.)?id = [a-z_.]+ for no key update;/);
      expect(body, fn).not.toMatch(/from public\.recipes( r)? where (r\.)?id = [a-z_.]+ for update;/);
    }
  });
  it("promote's retirement of the source records an adoption link ending (review P2-3); receipts digest product members only (P3a)", () => {
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    const retire = save.slice(save.indexOf("where id = p_promoted_from and active;") - 600, save.indexOf("where id = p_promoted_from and active;"));
    expect(retire).toContain("adoption_ended_from_version_id = coalesce(adoption_ended_from_version_id,");
    const snap = extractFunction(src, "create or replace function public.recipe_change_snapshot(", "\n$$;");
    expect(snap).toContain("where di.vendor_item_id in (select vi.id from public.vendor_items vi where vi.product_id = any(v_products))");
  });
  it("TRUNCATE of recipe_inputs / recipes is refused by a BEFORE TRUNCATE trigger (review P3d)", () => {
    expect(src).toMatch(/create trigger recipe_inputs_no_truncate before truncate on public\.recipe_inputs/);
    expect(src).toMatch(/create trigger recipes_no_truncate before truncate on public\.recipes/);
    expect(src).toContain("raise exception 'recipe_version:truncate_refused'");
  });
  it("the journal: graph lock, then the recipe row; a same-transaction head is updated, never versioned twice", () => {
    const body = extractFunction(src, "create or replace function public.recipe_global_journal(", "\n$$;");
    expect(body.indexOf("pg_advisory_xact_lock(7258025800)")).toBeLessThan(body.indexOf("from public.recipes where id = p_recipe for no key update"));
    expect(body).toContain("v_head.created_xact = pg_current_xact_id()");
    expect(body).toContain("current_setting('app.recipe_journal_actor', true)");
    expect(body).toContain("then v_now else '2000-01-01T00:00:00Z'::timestamptz end");
  });
  it("deferred constraint triggers journal every line change and every new recipe at COMMIT", () => {
    expect(src).toMatch(/create constraint trigger recipe_inputs_journal\s+after insert or update or delete on public\.recipe_inputs\s+deferrable initially deferred/);
    expect(src).toMatch(/create constraint trigger recipes_journal\s+after insert on public\.recipes\s+deferrable initially deferred/);
  });
  it("the cycle law per shop: a shop's graph substitutes its own versions", () => {
    const edges = extractFunction(src, "create or replace function public.recipe_scope_item_edges(", "\n$$;");
    expect(edges).toContain("from public.recipe_version_lines l");
    expect(edges).toContain("v.location_id = p_scope and v.active");
  });
  it("every writer: SECURITY DEFINER, pinned search_path, service_role only, takes the graph lock (save: before its first row lock)", () => {
    for (const fn of WRITERS) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = pg_catalog, public");
      expect(body).toContain("perform pg_advisory_xact_lock(7258025800);");
      expect(src).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(src).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    expect(save.indexOf("pg_advisory_xact_lock(7258025800)")).toBeLessThan(save.indexOf("for update"));
    expect(save).toContain("recipe_version:version_changed");
    expect(save).toContain("public.recipe_global_journal(p_recipe, p_actor, p_promoted_from,");
    // adopt / promote / restore COPY the source in SQL; the caller's payload is ignored for them
    expect(save).toContain("from public.recipe_version_lines l where l.version_id = v_source.id;");
  });
  it("helpers are callable by nobody but their definer callers", () => {
    for (const fn of HELPERS) {
      expect(src).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`));
    }
    expect(src).toContain("raise exception '0262: unexpected execute grant'");
  });
  it("privilege ceilings: revoke all (service_role too), grant exactly, RLS deny-all, asserted both ways", () => {
    const grants: Record<string, string> = {
      recipe_versions: "select, insert, update", recipe_version_lines: "select, insert", recipe_notice_dismissals: "select, insert",
    };
    for (const [t, g] of Object.entries(grants)) {
      expect(src).toContain(`alter table public.${t} enable row level security;`);
      expect(src).toContain(`create policy ${t}_no_user_select on public.${t} for select using (false);`);
      expect(src).toContain(`create policy ${t}_no_user_delete on public.${t} for delete using (false);`);
      expect(src).toContain(`revoke all on public.${t} from public, anon, authenticated, service_role;`);
      expect(src).toContain(`grant ${g} on public.${t} to service_role;`);
      expect(src).toContain(`has_table_privilege('service_role', 'public.${t}', 'DELETE')`);
    }
    expect(src).toContain("raise exception '0262: service_role above its ceiling'");
    expect(src).toContain("raise exception '0262: service_role is missing a privilege the writers need'");
  });
});

describe("0262 re-emits the four 0258 graph writers faithfully", () => {
  for (const r of RECIPE_REEMITS) {
    describe(r.name, () => {
      it(`${r.source} was the latest definer before 0262, and 0262 is now`, () => {
        const defining = files.filter((f) => read(f).includes(r.start));
        expect(defining[defining.length - 1]).toBe(M0262);
        expect(defining[defining.length - 2]).toBe(r.source);
      });
      it("the source body (± the enumerated mods) is a line-subsequence of the 0262 body", () => {
        const source = applyMods(extractFunction(read(r.source), r.start, r.end), r.mods);
        const check = isLineSubsequence(source, extractFunction(src, r.startReplaced, r.end));
        expect(check.ok, `missing from 0262 → ${check.missing}`).toBe(true);
      });
      it("adds nothing beyond the mods except comment lines", () => {
        const source = applyMods(extractFunction(read(r.source), r.start, r.end), r.mods);
        const srcLines = new Set(source.split("\n").map((l) => l.trimEnd()));
        const extra = extractFunction(src, r.startReplaced, r.end).split("\n").map((l) => l.trimEnd())
          .filter((l) => l.trim() !== "" && !srcLines.has(l) && !l.trim().startsWith("--"));
        expect(extra).toEqual([]);
      });
    });
  }
  it("the authorship overload: + p_actor, the journal actor set from it, service_role only; the old signature kept (Astra 3a r4#1)", () => {
    const overload = extractFunction(src, "create or replace function public.update_recipe_input_atomic( -- 0262 overload: + p_actor (journal authorship)", "\n$$;");
    expect(overload).toContain("  p_expected_portioned boolean,\n  p_actor uuid\n) returns table (");
    expect(overload).toContain("perform set_config('app.recipe_journal_actor', coalesce(p_actor::text, ''), true);");
    expect(overload).toContain("recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id)");
    expect(src).toContain("grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid) to service_role;");
    expect(src).toContain("grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) to service_role;");
    expect(src).not.toContain("drop function");
  });
  it("every re-emit adds the shop sweep; the two line writers also name their actor for the journal", () => {
    expect(extractFunction(src, "create or replace function public.add_recipe_input_atomic(", "\n$$;")).toContain("recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, null)");
    expect(extractFunction(src, "create or replace function public.update_recipe_input_atomic(", "\n$$;")).toContain("recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id)");
    expect(extractFunction(src, "create or replace function create_recipe_full(", "end $$;")).toContain("recipe_shops_output_would_cycle(v_recipe_id,");
    expect(extractFunction(src, "create or replace function add_recipe_output(", "end $$;")).toContain("recipe_shops_output_would_cycle(p_recipe_id, p_output_item_id)");
    expect(extractFunction(src, "create or replace function public.add_recipe_input_atomic(", "\n$$;")).toContain("set_config('app.recipe_journal_actor'");
  });
});

describe("the executable proof (PGlite: the REAL 0258 → 0262 on synthetic rows) runs green in CI", () => {
  it("backfill, journal completeness, the per-shop cycle law under the graph lock, every refusal by name, provenance + promote, the scoped snapshot, ceilings, the overload pair", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0262.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0262:");
  }, 260_000);
});
