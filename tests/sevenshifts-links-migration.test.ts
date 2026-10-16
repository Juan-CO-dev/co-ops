/** Scheduling Phase 1 — migration 0269 pinned: header, the executable PGlite proof, every RPC definer + pinned + revoked, no name match. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";

const src = normalize(readFileSync("supabase/migrations/0269_sevenshifts_links.sql", "utf8"));
const FNS = [
  ["link_sevenshifts_location", "uuid, uuid, bigint", "p_actor uuid, p_location uuid, p_remote bigint"],
  ["unlink_sevenshifts_location", "uuid, uuid", "p_actor uuid, p_link uuid"],
  ["link_sevenshifts_user", "uuid, uuid, bigint, uuid", "p_actor uuid, p_location uuid, p_remote_user bigint, p_user uuid"],
  ["unlink_sevenshifts_user", "uuid, uuid, uuid", "p_actor uuid, p_location uuid, p_link uuid"],
] as const;

describe("0269_sevenshifts_links", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0269_sevenshifts_links"
        && /^-- AUTHORED 2026-10-15\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, AFTER 0268 and BEFORE SEVENSHIFTS_SYNC=1\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO PROD 2026-10-20 (schema_migrations version 20261020000002, name 'sevenshifts_links')", ...rest].join("\n"))).toBe(true);
  });

  it("the executable proof (PGlite: the REAL helpers + 0243 + 0268 + 0269 on synthetic rows) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0269.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0269:");
  }, 260_000);

  it("every RPC is SECURITY DEFINER with a pinned search_path, takes the one link lock, and is service_role only", () => {
    for (const [name, types, params] of FNS) {
      const fn = extractFunction(src, `create function public.${name}(${params})`, "end $$;");
      expect(fn, name).toContain("returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$");
      expect(fn, name).toContain("perform pg_advisory_xact_lock(hashtextextended('sevenshifts-link', 0));");
      expect(src).toContain(`revoke all on function public.${name}(${types}) from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function public.${name}(${types}) to service_role;`);
    }
  });

  it("append-only by grant: both tables RLS on and SELECT-only for service_role; linked_by NOT NULL; no source column", () => {
    expect(src).toContain("revoke all on public.sevenshifts_location_links, public.sevenshifts_user_links from public, anon, authenticated, service_role;");
    expect(src).toContain("grant select on public.sevenshifts_location_links, public.sevenshifts_user_links to service_role;");
    for (const t of ["sevenshifts_location_links", "sevenshifts_user_links"]) {
      const table = extractFunction(src, `create table public.${t} (`, "\n);");
      expect(table).toMatch(/\n  linked_by\s+uuid\s+not null references public\.users\(id\)/);
      expect(table).not.toMatch(/\n  source\s/);
      expect(src).toContain(`alter table public.${t} enable row level security;`);
    }
    expect(src).toContain("create unique index sevenshifts_user_links_one_live_remote on public.sevenshifts_user_links (sevenshifts_user_id) where active;");
    expect(src).toContain("create unique index sevenshifts_user_links_one_live_user on public.sevenshifts_user_links (user_id) where active;");
    expect(src).toContain("create unique index sevenshifts_location_links_one_live_shop on public.sevenshifts_location_links (location_id) where active;");
    expect(src).toContain("create unique index sevenshifts_location_links_one_live_remote on public.sevenshifts_location_links (sevenshifts_location_id) where active;");
  });

  it("the person-link actor and subject rules REUSE the 0233 / 0217 helpers (never a copy); shop links need level 8", () => {
    const link = extractFunction(src, "create function public.link_sevenshifts_user(", "end $$;");
    expect(link).toContain("v_actor := public.toast_link_actor_level(p_actor, p_location);");
    expect(link).toContain("v_subject := public.assignment_user_level(p_user, p_location);");
    expect(link).toContain("if v_subject > v_actor then raise exception 'role_insufficient'; end if;");
    const unlink = extractFunction(src, "create function public.unlink_sevenshifts_user(", "end $$;");
    expect(unlink).toContain("v_actor := public.toast_link_actor_level(p_actor, p_location);");
    for (const name of ["link_sevenshifts_location", "unlink_sevenshifts_location"]) {
      const fn = extractFunction(src, `create function public.${name}(`, "end $$;");
      expect(fn).toContain("if v_level is null or v_level < 8 then raise exception 'role_insufficient'; end if;");
    }
    expect(src).not.toMatch(/create (or replace )?function public\.(toast_link_actor_level|assignment_user_level|assignment_author_level)/);
  });

  it("ruling (a): below level 8 the 7shifts person needs a LIVE assignment at the shop's LIVE 7shifts location", () => {
    const link = extractFunction(src, "create function public.link_sevenshifts_user(", "end $$;");
    expect(link).toContain("if v_actor < 8 and not exists (");
    expect(link).toContain("join public.sevenshifts_user_assignments a on a.location_id = l.sevenshifts_location_id");
    expect(link).toContain("where l.location_id = p_location and l.active and a.user_id = p_remote_user and a.active) then");
    expect(link).toContain("raise exception 'remote_not_at_shop';");
  });

  it("no function body compares (or even mentions) a name — identity is ids only", () => {
    const bodies = [...src.matchAll(/as \$\$([\s\S]*?)end \$\$;/g)].map((m) => m[1]!);
    expect(bodies).toHaveLength(4);
    for (const body of bodies) expect(body).not.toMatch(/name/i);
  });
});
