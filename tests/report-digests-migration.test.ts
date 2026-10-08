/**
 * 0220 report_recipients_digests — text pins on the AUTHORED migration (no DB in the spine).
 * Pins the parts the digest code leans on: the idempotency index, the "external row with no
 * email can never be active" CHECK (the accountant row), the OFF-by-default delivery switch,
 * deny-all RLS and the grant posture. Plus the catering stage-CHECK lineage CC asked to verify.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES } from "@/lib/catering/pipeline-shared";

const dir = join(__dirname, "..", "supabase", "migrations");
const sql = readFileSync(join(dir, "0220_report_recipients_digests.sql"), "utf8");
const flat = sql.replace(/\s+/g, " ");

describe("0220 posture", () => {
  it("is authored only, with the gate line", () => {
    expect(sql).toMatch(/AUTHORED 2026-10-07\. NOT YET APPLIED — GATE \(CC\/JUAN\)/);
    expect(sql).not.toMatch(/APPLIED TO PROD/);
  });

  it.each(["report_recipients", "report_digest_sends", "report_settings"])("%s is deny-all and service-role only, never deletable", (table) => {
    expect(flat).toContain(`alter table public.${table} enable row level security;`);
    expect(flat).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
    expect(flat).toContain(`grant select, insert, update on public.${table} to service_role;`);
    expect(flat).toContain(`revoke delete, truncate on public.${table} from service_role;`);
    expect(flat).not.toMatch(new RegExp(`create policy [a-z_]+ on public\\.${table}`));
  });

  it("the idempotency key is a partial unique index over claimed|sent, including revision and mode", () => {
    expect(flat).toContain(
      "create unique index report_digest_sends_once on public.report_digest_sends (recipient_ref, kind, business_day, revision, mode, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) where outcome in ('claimed', 'sent', 'ambiguous', 'failed_ambiguous');",
    );
  });

  it("send-once columns: provider id before finish, first attempt, ambiguous shape (Astra r2 P1)", () => {
    for (const col of ["provider_message_id text  null", "sent_at       timestamptz null", "idempotency_key text", "first_attempt_at timestamptz null"]) expect(sql).toContain(col);
    expect(flat).toContain("check (outcome in ('claimed', 'sent', 'skipped', 'failed', 'ambiguous', 'failed_ambiguous'))");
    expect(flat).toContain("check (outcome not in ('ambiguous', 'failed_ambiguous') or first_attempt_at is not null)");
    expect(sql).not.toContain("email_id");
  });

  it("an external row with no email can never be active (the accountant row)", () => {
    expect(flat).toContain("check (not active or kind = 'internal' or email is not null)");
    expect(flat).toMatch(/values \('external', null, 'Accountant', false,/);
  });

  it("the delivery switch ships OFF", () => {
    expect(flat).toContain("('digest_delivery_mode', '\"off\"'::jsonb)");
    expect(flat).toContain("('catering_digest_time_et', '\"07:00\"'::jsonb)");
    expect(flat).toContain("('unified_fallback_time_et', '\"03:00\"'::jsonb)");
  });

  it("seeds no UUIDs and no names beyond the generic Accountant label", () => {
    const seeds = sql.slice(sql.indexOf("── Seeds"));
    expect(seeds).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(seeds).not.toMatch(/@/);
  });

  it("every skip reason the code writes is allowed by the CHECK", () => {
    for (const reason of ["no_email", "inactive", "recipient_disabled", "no_locations", "already_sent", "not_due", "shop_not_finalized", "out_of_scope"]) {
      expect(flat).toContain(`'${reason}'`);
    }
  });
});

/**
 * CC 2026-10-07: "0108 to_stage CHECK lacks 'out' while moveStage writes it — verify".
 * Lineage traced: the events table is 0110 (not 0108, which is catering_pipeline) and its CHECKs
 * listed five stages; 0129 added 'out' to catering_pipeline only; 0191 (APPLIED TO PROD
 * 2026-09-04) dropped and recreated BOTH event CHECKs with 'out'. No later migration touches them.
 * This pins that the LATEST definition of every stage CHECK names every PIPELINE_STAGES value, so
 * the asymmetry cannot come back silently.
 */
describe("catering stage CHECK lineage (0108 / 0110 / 0129 / 0191)", () => {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  function latest(constraint: string): { file: string; def: string } {
    let found: { file: string; def: string } | null = null;
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8").replace(/\s+/g, " ");
      const re = new RegExp(`ADD CONSTRAINT ${constraint} CHECK \\((.*?)\\);`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) found = { file, def: m[1] ?? "" };
    }
    if (!found) throw new Error(`no ADD CONSTRAINT for ${constraint}`);
    return found;
  }

  it.each(["catering_pipeline_events_to_stage_check", "catering_pipeline_events_from_stage_check", "catering_pipeline_stage_check"])(
    "%s (latest definition) allows every pipeline stage, including out",
    (constraint) => {
      const { def } = latest(constraint);
      for (const stage of PIPELINE_STAGES) expect(def, `${constraint} missing ${stage}`).toContain(`'${stage}'`);
    },
  );

  it("0191 is the migration that taught the events table 'out', and it is stamped applied", () => {
    expect(latest("catering_pipeline_events_to_stage_check").file).toBe("0191_pipeline_events_out_stage.sql");
    expect(readFileSync(join(dir, "0191_pipeline_events_out_stage.sql"), "utf8")).toMatch(/APPLIED TO PROD 2026-09-04/);
  });
});
