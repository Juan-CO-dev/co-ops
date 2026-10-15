import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHOP_OWNED_ERROR_CODES, shopOwnedErrorFromRpc, ShopOwnedError } from "../lib/catalog/shop-owned-shared";

const sql = readFileSync("supabase/migrations/0264_catalog_shop_owned.sql", "utf8").replace(/\r\n/g, "\n");

describe("0264 ownership migration contracts", () => {
  it("keeps its authored gate while allowing later deployment stamps", () => {
    const valid = (source: string) => {
      const lines = source.split("\n");
      return lines[0] === "-- Migration 0264_catalog_shop_owned"
        && lines[1] === "-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review"
        && lines.slice(2, 8).filter(line => line.startsWith("-- APPLIED ")).every(line => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(line));
    };
    expect(valid(sql)).toBe(true);
    const [head, gate, ...rest] = sql.split("\n");
    expect(valid([head, gate, "-- APPLIED TO SIM 2026-10-16", ...rest].join("\n"))).toBe(true);
    expect(valid(sql.replace("NOT YET APPLIED", "READY"))).toBe(false);
    expect(valid([head, gate, "-- APPLIED TO SIM yesterday", ...rest].join("\n"))).toBe(false);
  });

  it("maps every actual literal ownership refusal, including dynamic positional lines", () => {
    const codes = [...new Set([...sql.matchAll(/shop_owned:([a-z_]+)/g)].map(match => match[1]!))];
    expect(codes.length).toBeGreaterThan(10);
    for (const code of codes) {
      expect(SHOP_OWNED_ERROR_CODES, code).toContain(code);
      try { shopOwnedErrorFromRpc(`shop_owned:${code}`); }
      catch (error) {
        expect(error).toBeInstanceOf(ShopOwnedError);
        expect(error).toMatchObject({ code, status: expect.any(Number) });
      }
    }
    for (const code of ["items_changed", "share_the_recipe", "line_other_shop"]) expect(codes).toContain(code);
    expect(() => shopOwnedErrorFromRpc("shop_owned:line_other_shop:2"))
      .toThrow(expect.objectContaining({ code: "line_other_shop", line: { position: 2, reason: "line_other_shop" } }));
  });

  it("leaves the compatibility overload for the separately gated post-READY/drain 0266", () => {
    expect(sql).not.toMatch(/drop\s+function\s+(?:if\s+exists\s+)?public\.update_recipe_input_atomic/i);
    const plan = readFileSync("docs/superpowers/plans/2026-10-15-catalog-phase4a-BUILD.md", "utf8");
    expect(plan).toContain("0266_drop_recipe_input_16arg.sql");
    expect(plan).toContain("READY");
    expect(plan).toContain("drain");
  });

  it("preserves the reviewed full-recipe writer except owner-at-insert", () => {
    const prior = readFileSync("supabase/migrations/0262_recipe_shop_versions.sql", "utf8").replace(/\r\n/g, "\n");
    const body = (source: string, name: string) => {
      const start = source.search(new RegExp(`create or replace function (?:public\\.)?${name}\\(`));
      expect(start).toBeGreaterThan(-1);
      const open = source.indexOf("as $$", start) + 5;
      const end = source.indexOf("$$;", open);
      return source.slice(open, end).replace(/\s+/g, " ").trim();
    };
    const owned = body(sql, "shop_owned_create_recipe_full")
      .replace("shelf_life_days, location_id)", "shelf_life_days)")
      .replace("shelf_life_days,location_id)", "shelf_life_days)")
      .replace("coalesce((p_header->>'shelf_life_days')::integer, 5), p_location_id", "coalesce((p_header->>'shelf_life_days')::integer, 5)");
    expect(owned).toBe(body(prior, "create_recipe_full"));
  });

  it("uses the Phase-3 non-key target lock for owned recipe edits and sharing", () => {
    for (const name of ["save_owned_recipe_version", "share_shop_recipe"]) {
      const start = sql.indexOf(`create or replace function public.${name}(`);
      const body = sql.slice(start, sql.indexOf("end $$;", start));
      expect(body).toMatch(/from public\.recipes where id=p_\w+ for no key update;/);
      expect(body).not.toMatch(/from public\.recipes where id=p_\w+ for update;/);
    }
  });
});
