/** SQL contract checks for 0240 (authored only); they complement, never replace, a sim apply. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESTRUCTIVE_ACTIONS } from "@/lib/destructive-actions";

const sql = readFileSync("supabase/migrations/0240_pulse_v2.sql", "utf8").replace(/\r\n/g, "\n");
const TABLES = ["pulse_handoff_notes", "pulse_handoff_acks", "pulse_station_layouts"] as const;

describe("0240 pulse v2: migration discipline", () => {
  it("is numbered 0240, stamped applied, one transaction, and leaves 0238/0239 alone", () => {
    expect(sql.split("\n")[0]).toBe("-- Migration 0240_pulse_v2");
    expect(sql).toMatch(/AUTHORED 2026-10-09.*APPLIED TO PROD/);
    expect(sql).not.toMatch(/APPLIED TO PROD/);
    expect(sql).toMatch(/\nbegin;\n/);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql.match(/\b0238\b/g)).toHaveLength(1);
    expect(sql.match(/\b0239\b/g)).toHaveLength(1);
    expect(sql).toContain("'0240: already applied'");
  });

  it.each(TABLES)("%s: deny-all RLS with SPLIT policies (never FOR ALL) and no delete grant", (tab) => {
    expect(sql).toContain(`create table public.${tab} (`);
    expect(sql).toContain(`alter table public.${tab} enable row level security;`);
    for (const op of ["select", "insert", "update", "delete"]) {
      const clause = op === "insert" ? "with check (false)" : "using (false)";
      expect(sql).toContain(`create policy ${tab}_no_user_${op} on public.${tab} for ${op} ${clause};`);
    }
    expect(sql).toContain(`revoke all on public.${tab} from public, anon, authenticated, service_role;`);
    expect(sql).toContain(`grant select, insert on public.${tab} to service_role;`);
    expect(sql).not.toMatch(new RegExp(`grant[^;]*delete[^;]*on public\\.${tab}`));
  });

  it("never uses FOR ALL anywhere", () => {
    expect(sql.toLowerCase()).not.toMatch(/for all/);
  });

  it("notes: audience is closed, body bounded, supersede pair moves together, update grant is column-scoped", () => {
    expect(sql).toContain("audience text not null check (audience in ('crew','managers','all'))");
    expect(sql).toContain("body text not null check (length(btrim(body)) between 1 and 1000)");
    expect(sql).toContain("check ((superseded_at is null) = (superseded_by is null))");
    expect(sql).toContain("grant update (superseded_at, superseded_by) on public.pulse_handoff_notes to service_role;");
    expect(sql).toContain("create index pulse_handoff_notes_day on public.pulse_handoff_notes (location_id, business_date, created_at desc);");
  });

  it("acks: one per (note, user), insert-only (no update grant at all)", () => {
    expect(sql).toContain("unique (note_id, user_id)");
    expect(sql).not.toMatch(/grant update[^;]*pulse_handoff_acks/);
  });

  it("layouts: one row per (location, station), station bound to its shop, bounded coordinates, column-scoped update", () => {
    expect(sql).toContain("primary key (location_id, station_id)");
    expect(sql).toContain("foreign key (station_id, location_id) references public.stations(id, location_id)");
    expect(sql).toContain("x numeric(5,2) not null check (x >= 0 and x <= 12)");
    expect(sql).toContain("y numeric(5,2) not null check (y >= 0 and y <= 12)");
    expect(sql).toContain("grant update (x, y, updated_by, updated_at) on public.pulse_station_layouts to service_role;");
  });

  it("proves its grants in SQL (the 0233/0237 idiom)", () => {
    expect(sql).toContain("grant escaped");
    expect(sql).toContain("has_column_privilege('service_role','public.pulse_handoff_notes','body','UPDATE')");
  });

  it("Astra #6: a BEFORE UPDATE trigger allows a supersede only by the author or a HIGHER level, keeps content immutable, and reuses 0228's oracle", () => {
    expect(sql).toContain("to_regprocedure('public.assignment_author_level(uuid)') is null");
    expect(sql).toContain("create function public.pulse_handoff_notes_supersede_guard() returns trigger");
    expect(sql).not.toMatch(/pulse_handoff_notes_supersede_guard\(\) returns trigger[\s\S]{0,120}security definer/);
    expect(sql).toContain("raise exception 'supersede_forbidden'");
    expect(sql).toContain("raise exception 'handoff_note_immutable'");
    expect(sql).toContain("new.superseded_by <> old.author_id");
    expect(sql).toContain("coalesce(public.assignment_author_level(new.superseded_by), -1) <= coalesce(public.assignment_author_level(old.author_id), 1000)");
    expect(sql).toContain("create trigger pulse_handoff_notes_supersede_guard before update on public.pulse_handoff_notes");
    expect(sql).toContain("revoke all on function public.pulse_handoff_notes_supersede_guard() from public, anon, authenticated;");
  });
  it("the human acts it records are registered destructive audit actions", () => {
    for (const action of ["station.layout_update", "handoff.note_create", "handoff.note_supersede", "handoff.note_ack"]) {
      expect(DESTRUCTIVE_ACTIONS as readonly string[]).toContain(action);
    }
  });
});
