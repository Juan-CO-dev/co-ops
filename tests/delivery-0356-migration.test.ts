/**
 * Catering delivery D1: migration 0356 (the delivery ledger). FILE ONLY — CC applies sim then prod on Juan's word.
 * Pins the file's shape, holds the TS vocabularies (statuses, manual moves, cost components, refusal names, audit
 * names, settings roles) to the SQL, pins the lock order on the text, and runs the offline PGlite proof
 * (scripts/sql-harness-0356.mjs, the REAL file). Pinned BY NAME.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESTRUCTIVE_ACTIONS, isDestructive } from "@/lib/destructive-actions";
import { NON_DESTRUCTIVE_ACTIONS, RESERVED_ACTIONS } from "@/lib/audit-actions";
import { DELIVERY_SETTINGS_ROLES } from "@/lib/delivery/access-shared";
import { DELIVERY_ERROR_CODES, DELIVERY_SQL_REFUSALS, deliveryErrorStatus } from "@/lib/delivery/errors";
import { MANUAL_MOVES, TERMINAL_STATUSES } from "@/lib/delivery/status-shared";
import {
  DELIVERY_BOOKED_VIA, DELIVERY_COST_COMPONENTS, DELIVERY_COST_SEMANTICS, DELIVERY_COST_SOURCES, DELIVERY_EVENT_SOURCES, DELIVERY_STATUSES,
  DEFAULT_GRATUITY_DRIVER_BPS, MAX_DELIVERY_NOTE, MAX_EXTERNAL_REF, MAX_MANUAL_PROVIDERS, MAX_PROVIDER_LABEL,
} from "@/lib/delivery/types-shared";

const sql = readFileSync("supabase/migrations/0356_delivery_jobs.sql", "utf8").replace(/\r\n/g, "\n");
const code = sql.replace(/--[^\n]*/g, "");
const list = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
const fn = (name: string) => {
  const m = code.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\n(?:end )?\\$\\$;`));
  if (!m) throw new Error(`function ${name} not found`);
  return m[0];
};
const TABLES = ["delivery_settings", "delivery_jobs", "delivery_job_events", "delivery_job_costs", "delivery_gratuity_splits", "delivery_pickup_decisions"];
const WRITERS = ["set_delivery_settings", "record_manual_delivery_job", "record_delivery_event", "record_delivery_cost", "keep_delivery_pickup", "record_delivery_gratuity_split"];
const AUDIT_NAMES = ["delivery.record", "delivery.status", "delivery.cost", "delivery.cost_correct", "delivery.pickup_kept", "delivery.gratuity_split", "delivery.settings_update"];

describe("0356 header and shape", () => {
  it("gate header, one transaction, file only, the number explained", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0356_delivery_jobs");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-22 .*NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(sql).toMatch(/0355 is reserved for the all-shops access build/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(code.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
    expect(code).toContain("raise exception '0356: public.%.% is missing', t, c;");
    expect(code).toContain("raise exception '0356: public.% already exists', t;");
    expect(code).toContain("raise exception '0356: function public.% already exists', t;");
  });

  it("PURELY ADDITIVE: creates its own objects only; re-emits no function, trigger, policy or table", () => {
    expect([...code.matchAll(/create table public\.(\w+)/g)].map((m) => m[1])).toEqual(TABLES);
    expect([...code.matchAll(/create view public\.(\w+)/g)].map((m) => m[1])).toEqual(["delivery_job_current"]);
    expect(code).not.toMatch(/create or replace|drop\s|create\s+trigger|create\s+policy|truncate\s+(table\s+)?public/i);
    // The only ALTER is switching RLS on for the six new tables.
    expect([...code.matchAll(/alter table public\.(\w+) ([^;]+);/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual(TABLES.map((t) => `${t}:enable row level security`));
    for (const m of code.matchAll(/create (?:unique )?index \w+ on public\.(\w+)/g)) expect(TABLES).toContain(m[1]);
    // Nothing writes a table this file does not own, except audit_log.
    const written = new Set([...code.matchAll(/(?:insert into|update|delete from)\s+public\.(\w+)/g)].map((m) => m[1]));
    expect([...written].sort()).toEqual(["audit_log", "delivery_gratuity_splits", "delivery_job_costs", "delivery_job_events", "delivery_jobs", "delivery_pickup_decisions", "delivery_settings"]);
    expect(code).not.toMatch(/delete from/i);
    expect(code).not.toMatch(/transfer_catering_lead|apply_ezcater_order|reserve_catering_prep_demand/);
  });

  it("deny-all: RLS on, no policy, service_role SELECT only; every function is revoked from public, anon and authenticated", () => {
    expect(code).toContain(`revoke all on public.delivery_settings, public.delivery_jobs, public.delivery_job_events, public.delivery_job_costs,
  public.delivery_gratuity_splits, public.delivery_pickup_decisions, public.delivery_job_current
  from public, anon, authenticated, service_role;`);
    expect(code.match(/grant\s+(select|insert|update|delete|all)\b[^;]*;/gi)).toHaveLength(1);
    expect(code).toMatch(/grant select on public\.delivery_settings,[^;]*public\.delivery_job_current to service_role;/);
    expect(code).toContain("create view public.delivery_job_current with (security_invoker = true) as");
    const created = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]!);
    expect(created).toHaveLength(18);
    for (const name of created) expect([name, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated(, service_role)?;`).test(code)]).toEqual([name, true]);
    const granted = [...code.matchAll(/grant execute on function public\.(\w+)\(/g)].map((m) => m[1]!);
    const internal = [...code.matchAll(/revoke all on function public\.(\w+)\([^)]*\) from public, anon, authenticated, service_role;/g)].map((m) => m[1]!);
    expect(internal.sort()).toEqual(["delivery_actor_role", "delivery_computed_split", "delivery_job_gate", "delivery_lead_gate", "delivery_status_terminal", "delivery_write_split"]);
    expect([...granted, ...internal].sort()).toEqual([...created].sort());
    expect(code).not.toMatch(/grant execute[^;]*to (anon|authenticated|public)/i);
    for (const w of WRITERS) expect([w, /security definer set search_path = pg_catalog, public as \$\$/.test(fn(w))]).toEqual([w, true]);
    expect(code).toContain("from information_schema.routine_privileges g");
  });
});

describe("the vocabularies are the TS lists", () => {
  it("the canonical statuses, in order; the terminal set; the manual moves", () => {
    const check = code.match(/status text not null check \(status in \(([^)]+)\)\)/)![1]!;
    expect(list(check)).toEqual([...DELIVERY_STATUSES]);
    expect(list(fn("delivery_status_terminal").match(/p_status in \(([^)]+)\)/)![1]!)).toEqual([...TERMINAL_STATUSES]);
    const moves = fn("delivery_manual_move_allowed");
    const sqlMoves = Object.fromEntries([...moves.matchAll(/p_from = '(\w+)' and p_to in \(([^)]+)\)/g)].map((m) => [m[1]!, list(m[2]!)]));
    expect(sqlMoves).toEqual(MANUAL_MOVES);
  });

  it("booked_via, cost components / semantics / sources, event sources, and the size limits", () => {
    expect(list(code.match(/booked_via text not null check \(booked_via in \(([^)]+)\)\)/)![1]!)).toEqual([...DELIVERY_BOOKED_VIA]);
    expect(list(code.match(/component text not null check \(component in \(([^)]+)\)\)/)![1]!)).toEqual([...DELIVERY_COST_COMPONENTS]);
    expect(list(code.match(/semantics text not null check \(semantics in \(([^)]+)\)\)/)![1]!)).toEqual([...DELIVERY_COST_SEMANTICS]);
    const sources = [...code.matchAll(/source text not null check \(source in \(([^)]+)\)\)/g)].map((m) => list(m[1]!));
    expect(sources).toEqual([[...DELIVERY_EVENT_SOURCES], [...DELIVERY_COST_SOURCES]]);
    // The writer accepts exactly the components the table does; there is no tip component.
    expect(list(fn("record_delivery_cost").match(/p_component not in \(([^)]+)\)/)![1]!)).toEqual([...DELIVERY_COST_COMPONENTS]);
    expect(DELIVERY_COST_COMPONENTS).not.toContain("tip");
    expect(code).toContain(`gratuity_driver_bps integer not null default ${DEFAULT_GRATUITY_DRIVER_BPS} check`);
    expect(fn("delivery_computed_split")).toContain(`v_bps := coalesce(v_bps, ${DEFAULT_GRATUITY_DRIVER_BPS});`);
    expect(code).toContain(`char_length(provider_label) between 1 and ${MAX_PROVIDER_LABEL}`);
    expect(code).toContain(`char_length(external_ref) between 1 and ${MAX_EXTERNAL_REF}`);
    expect(fn("set_delivery_settings")).toContain(`jsonb_array_length(v_providers) > ${MAX_MANUAL_PROVIDERS}`);
    expect(code.match(new RegExp(`char_length\\(note\\) <= ${MAX_DELIVERY_NOTE}`, "g"))).toHaveLength(3);
  });

  it("every refusal the SQL raises is a named DeliveryError code, and every code is raised (both ways)", () => {
    const raised = new Set([...code.matchAll(/raise exception '(\w+)' using errcode = 'P0001'/g)].map((m) => m[1]!));
    expect([...raised].sort()).toEqual([...DELIVERY_SQL_REFUSALS].sort());
    // Every named raise uses P0001; the only other raises are the pre-flight and the ceiling.
    const others = [...code.matchAll(/raise exception '([^']+)'(?! using errcode = 'P0001')/g)].map((m) => m[1]!);
    for (const o of others) expect(o).toMatch(/^(0356: |ceiling: )/);
    for (const c of DELIVERY_ERROR_CODES) expect([c, [400, 403, 404, 409, 500, 503].includes(deliveryErrorStatus(c))]).toEqual([c, true]);
    // The header's list of refusals is the same list.
    const header = sql.slice(sql.indexOf("EVERY REFUSAL IS NAMED"), sql.indexOf("-- Proof:")).replace(/--|\n/g, " ");
    expect(header.split(/\s+/).filter((w) => /^[a-z_]+$/.test(w) && raised.has(w)).sort()).toEqual([...raised].sort());
  });

  it("the audit names are registered: destructive, SQL-emitted (reserved), and nothing else is emitted", () => {
    const emitted = new Set([...code.matchAll(/'(delivery\.[a-z_]+)'/g)].map((m) => m[1]!));
    expect([...emitted].sort()).toEqual([...AUDIT_NAMES].sort());
    for (const name of AUDIT_NAMES) {
      expect([name, (DESTRUCTIVE_ACTIONS as readonly string[]).includes(name), isDestructive(name as never)]).toEqual([name, true, true]);
      expect([name, (RESERVED_ACTIONS as readonly string[]).includes(name)]).toEqual([name, true]);
      expect([name, (NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes(name)]).toEqual([name, false]);
    }
    for (const w of WRITERS) {
      const body = fn(w);
      expect([w, body.match(/insert into public\.audit_log\(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive\)/g)?.length]).toEqual([w, 1]);
      expect([w, /, true\);/.test(body)]).toEqual([w, true]);
    }
    // No free text in an audit row: a note or a reason is never a metadata value.
    for (const w of WRITERS) {
      const meta = fn(w).slice(fn(w).indexOf("insert into public.audit_log"));
      expect([w, /v_note\b(?! is not null)|v_reason\b|v_ref\b|p_note\b|p_reason\b/.test(meta.slice(0, meta.indexOf(", true);")))]).toEqual([w, false]);
    }
  });

  it("the settings writer admits exactly the settings roles; the actor rule names its roles", () => {
    expect(fn("set_delivery_settings")).toContain(`if v_role is null or v_role not in (${DELIVERY_SETTINGS_ROLES.map((r) => `'${r}'`).join(", ")}) then raise exception 'forbidden'`);
    const rule = fn("delivery_actor_role");
    expect(rule).toContain("if v_role in ('owner', 'cgs', 'moo', 'catering_mgr') then return v_role; end if;");
    expect(rule).toContain("if v_role in ('gm', 'agm') and p_shop_id is not null and exists (");
    expect(rule).toContain("from public.user_locations m where m.user_id = p_actor_id and m.location_id = p_shop_id and m.active");
    expect(rule).not.toMatch(/prep_mgr|social_media_mgr|role_level/);
  });
});

describe("lock order and the shop the person saw (on the text)", () => {
  it("(1) the lead FOR NO KEY UPDATE -> (2) the job FOR UPDATE -> (3) children, taken by the two gates only", () => {
    const leadGate = fn("delivery_lead_gate"), jobGate = fn("delivery_job_gate");
    const leadLock = "from public.catering_pipeline l where l.id = p_lead_id for no key update;";
    expect(leadGate.indexOf(leadLock)).toBeGreaterThan(0);
    expect(leadGate.indexOf("raise exception 'shop_moved'")).toBeGreaterThan(leadGate.indexOf(leadLock));
    expect(leadGate.indexOf("public.delivery_actor_role(")).toBeGreaterThan(leadGate.indexOf("raise exception 'shop_moved'"));
    const a = jobGate.indexOf("from public.catering_pipeline l where l.id = o_lead for no key update;");
    const b = jobGate.indexOf("from public.delivery_jobs j where j.id = p_job_id for update;");
    const c = jobGate.indexOf("raise exception 'shop_moved'");
    const d = jobGate.indexOf("public.delivery_actor_role(");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(d).toBeGreaterThan(c);
    expect(code.match(/for no key update/g)).toHaveLength(2);
    expect(code.match(/from public\.delivery_jobs j where j\.id = p_job_id for update;/g)).toHaveLength(1);
    // No delivery function locks a lead FOR UPDATE (that is transfer_catering_lead's lock; they serialize on the row).
    expect(code).not.toMatch(/catering_pipeline[^;]*\bfor update\b/);
  });

  it("every job-level and lead-level writer takes p_expected_shop and goes through a gate before any write", () => {
    const gates: Record<string, string> = { record_manual_delivery_job: "delivery_lead_gate", record_delivery_gratuity_split: "delivery_lead_gate",
      record_delivery_event: "delivery_job_gate", record_delivery_cost: "delivery_job_gate", keep_delivery_pickup: "delivery_job_gate" };
    for (const [writer, gate] of Object.entries(gates)) {
      const body = fn(writer);
      expect([writer, /p_expected_shop uuid/.test(body)]).toEqual([writer, true]);
      const at = body.indexOf(`from public.${gate}(p_actor_id, `);
      const firstWrite = Math.min(...["insert into public.", "update public.", "public.delivery_write_split("].map((x) => body.indexOf(x)).filter((i) => i >= 0));
      expect([writer, at > 0 && at < firstWrite]).toEqual([writer, true]);
      expect([writer, /, p_expected_shop\) g;/.test(body)]).toEqual([writer, true]);
    }
  });

  it("OFF MEANS OFF: both gates refuse delivery_off for the lead's CURRENT shop, after shop_moved and before the actor rule", () => {
    for (const gate of [fn("delivery_lead_gate"), fn("delivery_job_gate")]) {
      const moved = gate.indexOf("raise exception 'shop_moved'");
      const off = gate.indexOf("if not exists (select 1 from public.delivery_settings s where s.location_id = o_shop and s.enabled) then\n    raise exception 'delivery_off'");
      expect(off).toBeGreaterThan(moved);
      expect(gate.indexOf("public.delivery_actor_role(")).toBeGreaterThan(off);
    }
    // Every job-level and lead-level writer goes through a gate (pinned above), so none can skip the switch; no writer
    // carries an exception for a cancellation.
    expect(code.match(/raise exception 'delivery_off'/g)).toHaveLength(3);
    expect(code).not.toMatch(/p_status\s*(=|<>|in)\s*\(?'cancelled'[^;]*delivery_off|delivery_off[^;]*'cancelled'/);
    expect(sql).toContain("-- OFF MEANS OFF: every job-level and lead-level writer refuses `delivery_off`");
    // The settings save answers the open jobs of leads now at that shop: they wait while it is off.
    expect(fn("set_delivery_settings")).toMatch(/return to_jsonb\(v_new\) \|\| jsonb_build_object\('open_jobs', \(\s+select count\(\*\) from public\.delivery_jobs j join public\.catering_pipeline l on l\.id = j\.pipeline_id\s+where j\.closed_at is null and l\.location_id = p_location_id\)\);/);
  });

  it("decision 5 is permanent and no function can write an API booking", () => {
    const record = fn("record_manual_delivery_job");
    expect(record).toContain("if p_booked_via = 'co_ops_api' then raise exception 'api_booking_unavailable'");
    expect(record).toContain("if v_ez and p_booked_via <> 'provider_native' then raise exception 'ezcater_never_booked'");
    expect(code.match(/insert into public\.delivery_jobs\(/g)).toHaveLength(1);
    expect(fn("delivery_lead_is_ezcater")).toMatch(/l\.lead_source = 'ezcater'\)\s+or exists \(select 1 from public\.ezcater_orders o where o\.lead_id = p_lead_id\)/);
    // The refusals of a new job, in the plan's order.
    const order = [...record.matchAll(/raise exception '(\w+)'/g)].map((m) => m[1]!).filter((n) => !["invalid_request", "bad_amount"].includes(n));
    expect(order).toEqual(["lead_not_confirmed", "order_rejected", "quote_ambiguous", "delivery_off", "api_booking_unavailable", "ezcater_never_booked", "not_ezcater",
      "not_delivery", "unknown_provider", "delivery_job_open"]);
  });

  it("the order-quote candidates are the live revision of each family (0120's definition)", () => {
    const quote = fn("delivery_order_quote");
    expect(quote.match(/from public\.catering_quotes q where q\.pipeline_id = p_lead_id and q\.superseded_at is null/g)).toHaveLength(3);
    expect(quote).toContain("order by q.created_at desc, q.id desc limit 1;");
    expect(fn("delivery_order_rejected")).toContain("l.stage = 'lost' or (public.delivery_order_quote(l.id)->>'kind') = 'rejected'");
  });
});

describe("0356 behaviour (PGlite, the real file)", () => {
  it("scripts/sql-harness-0356.mjs passes", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0356.mjs"], { encoding: "utf8" });
    expect(Number(out.match(/sql-harness-0356: (\d+) checks passed/)![1])).toBeGreaterThanOrEqual(295);
  }, 300_000);
});
