import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0272_postgrest_write_lockdown.sql", "utf8");

const expected: Record<string, string[]> = {
  announcement_acknowledgements: ["announcement_acks_insert"],
  announcements: ["announcements_insert", "announcements_update"],
  cash_reports: ["cash_reports_insert"],
  catering_customers: ["catering_customers_insert", "catering_customers_update"],
  catering_order_items: ["catering_order_items_insert"],
  catering_orders: ["catering_orders_insert", "catering_orders_update"],
  catering_pipeline: ["catering_pipeline_insert", "catering_pipeline_update"],
  catering_pipeline_events: ["catering_pipeline_events_insert"],
  catering_quote_items: ["catering_quote_items_insert"],
  catering_quotes: ["catering_quotes_insert"],
  checklist_template_items: ["checklist_template_items_insert", "checklist_template_items_update"],
  checklist_templates: ["checklist_templates_insert", "checklist_templates_update"],
  customer_feedback: ["customer_feedback_insert", "customer_feedback_update"],
  deep_clean_assignments: ["deep_clean_assignments_insert", "deep_clean_assignments_update"],
  deep_clean_tasks: ["deep_clean_tasks_insert", "deep_clean_tasks_update"],
  locations: ["locations_insert", "locations_update"],
  lto_performance: ["lto_performance_insert", "lto_performance_update"],
  maintenance_notes: ["maintenance_notes_insert"],
  maintenance_tickets: ["maintenance_tickets_insert", "maintenance_tickets_update"],
  notification_recipients: ["notification_recipients_update_self"],
  opening_setup_items: ["opening_setup_items_insert_policy"],
  opening_setup_verifications: ["opening_setup_verifications_insert_policy"],
  par_levels: ["par_levels_insert", "par_levels_update"],
  position_responsibilities: ["position_responsibilities_insert", "position_responsibilities_update"],
  positions: ["positions_insert", "positions_update"],
  recipe_ingredients: ["recipe_ingredients_insert", "recipe_ingredients_update"],
  recipe_steps: ["recipe_steps_insert", "recipe_steps_update"],
  report_photos: ["report_photos_insert"],
  report_views: ["report_views_insert"],
  shift_overlay_corrections: ["shift_overlay_corrections_insert"],
  shift_overlays: ["shift_overlays_insert", "shift_overlays_update_self"],
  tip_pool_distributions: ["tip_pool_distributions_insert", "tip_pool_distributions_update"],
  tip_pools: ["tip_pools_insert", "tip_pools_update"],
  training_modules: ["training_modules_insert", "training_modules_update"],
  training_progress: ["training_progress_insert", "training_progress_update"],
  training_reports: ["training_reports_insert", "training_reports_update"],
  user_locations: ["user_locations_insert", "user_locations_update"],
  user_notification_prefs: ["user_notification_prefs_insert", "user_notification_prefs_update"],
  vendor_deliveries: ["vendor_deliveries_insert", "vendor_deliveries_update"],
  vendor_items: ["vendor_items_insert", "vendor_items_update"],
  vendor_orders: ["vendor_orders_insert", "vendor_orders_update"],
  vendors: ["vendors_insert", "vendors_update_trivial"],
};

describe("0272 PostgREST write lockdown", () => {
  it("keeps the authoring gate even after an applied stamp", () => {
    const ok = (text: string) => {
      const lines = text.split("\n");
      return lines[0] === "-- Migration 0272_postgrest_write_lockdown"
        && /^-- AUTHORED 2026-10-15\. NOT YET APPLIED — apply via MCP after review \(sim → prod; no code depends on it\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter(line => /^-- APPLIED /.test(line))
          .every(line => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(line));
    };
    expect(ok(sql)).toBe(true);
    const [first, gate, ...rest] = sql.split("\n");
    expect(ok([first, gate, "-- APPLIED TO PROD 2026-10-16 (schema_migrations version 20261016000001, name 'postgrest_write_lockdown')", ...rest].join("\n"))).toBe(true);
  });

  it("pins exactly 42 tables and each permissive policy being dropped", () => {
    const manifest = Object.fromEntries(
      [...sql.matchAll(/^  \('([a-z_]+)', array\[([^\]]+)\]\)[,;]$/gm)].map(([, table, names]) => [
        table,
        [...(names ?? "").matchAll(/'([^']+)'/g)].map(match => match[1]),
      ]),
    );
    expect(Object.keys(expected)).toHaveLength(42);
    expect(manifest).toEqual(expected);
    expect(sql).toContain("if (select count(*) from lockdown_0272) <> 42 then");
    expect(sql).toContain("drop policy if exists %I on public.%I");
    expect(sql).toContain("foreach p in array r.drop_policies");
    expect(sql).toContain("EXCLUDED STEP 2: checklist_instances, checklist_completions,");
    expect(sql).toContain("checklist_submissions, checklist_incomplete_reasons, written_reports.");
  });

  it("pins write revocation, service checks, denies, and 42 audit rows", () => {
    expect(sql).toContain("revoke insert, update, delete, truncate, references, trigger on table public.%I from public, anon, authenticated");
    expect(sql).toContain("has_any_column_privilege(role_name, obj, 'INSERT, UPDATE, REFERENCES')");
    expect(sql).toContain("has_table_privilege(role_name, obj, 'DELETE, TRUNCATE, REFERENCES, TRIGGER')");
    expect(sql).toContain("create policy opening_setup_items_no_user_insert");
    expect(sql).toContain("lockdown_0272_reads");
    expect(sql).toContain("has_function_privilege('authenticated', f.oid, 'EXECUTE')");
    expect(sql).toContain("has_function_privilege('anon', f.oid, 'EXECUTE')");
    expect(sql).not.toContain("f.signature, 'EXECUTE'");
    // Column ACLs survive a table-level REVOKE on real Postgres (PGlite cannot observe it), so pin the loop text.
    expect(sql).toContain("revoke insert (%1$I), update (%1$I), references (%1$I) on table public.%2$I from public, anon, authenticated");
    expect(sql).toContain("rolbypassrls from pg_roles where rolname = 'service_role'");
    for (const kind of ["insert", "update", "delete"]) {
      expect(sql).toContain(`create policy opening_setup_verifications_no_user_${kind}`);
    }
    expect(sql).toContain("'security.grants_change', table_name, null, true");
    expect(sql).toContain("'actor_context', 'migration_apply', 'migration', '0272_postgrest_write_lockdown'");
    expect(sql).toContain("from lockdown_0272;");
  });

  it("runs the PGlite proof in CI", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0272.mjs"], {
      encoding: "utf8",
      timeout: 240_000,
    });
    expect(output).not.toContain("FAIL ");
    expect(output).toContain("PASS 0272:");
  }, 260_000);
});
