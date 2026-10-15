/**
 * Catalog Phase 2a — the two SQL chain writers 0259 re-emits, as `[old, new]` modifications of
 * their latest definers. Shared by the generator (emit-0259-reemits.ts) and the pin
 * (tests/shop-versions-migration.test.ts), so the SQL that ships IS the list reviewers read.
 *
 * apply_vendor_import (0211) edits the GLOBAL lane only: it locks/reads/supersedes only
 * location_id IS NULL levels, closes the global version (valid_to) and opens the new one
 * (valid_from), and reads the GLOBAL price head as its before-state.
 *
 * receiving_create_store_item (0216) clones the chain THIS SHOP receives (its own version when it
 * has one, else the global) into the new store copy as that copy's global version — and, when the
 * shop's own version was cloned, derives the copy's flat mirror from that chain in the same
 * transaction through 0259's ONE mirror rule, sku_flat_mirror_apply (the reference's flat fields
 * describe the GLOBAL pack, not the shop's; review P3d: never a second copy of the mirror logic).
 */
export type Mod = readonly [string, string];
export interface Reemit { name: string; source: string; start: string; startReplaced: string; end: string; mods: readonly Mod[] }

export function normalize(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

export function extractFunction(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`function start not found: ${start}`);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error(`function end not found after: ${start}`);
  return src.slice(a, b + end.length);
}

export function applyMods(body: string, mods: readonly Mod[]): string {
  let out = body;
  for (const [o, n] of mods) {
    const count = out.split(o).length - 1;
    if (count !== 1) throw new Error(`mod anchor must occur exactly once (found ${count}): ${o.slice(0, 80)}`);
    out = out.replace(o, n);
  }
  return out;
}

export function isLineSubsequence(needle: string, hay: string): { ok: boolean; missing: string | null } {
  const n = needle.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const h = hay.split("\n").map((l) => l.trimEnd());
  let j = 0;
  for (const line of n) {
    while (j < h.length && h[j] !== line) j++;
    if (j >= h.length) return { ok: false, missing: line };
    j++;
  }
  return { ok: true, missing: null };
}

export const REEMITS: readonly Reemit[] = [
  {
    name: "apply_vendor_import",
    source: "0211_vendor_import.sql",
    start: "create or replace function public.apply_vendor_import(",
    startReplaced: "create or replace function public.apply_vendor_import(",
    end: "end $$;",
    mods: [
      [
        "  v_ratio numeric; v_written int; v_count int; v_now timestamptz;",
        "  v_ratio numeric; v_written int; v_count int; v_now timestamptz;\n  v_old_version uuid; v_new_version uuid;",
      ],
      [
        "    perform 1 from public.sku_pack_levels where sku_id = v_sku_id and active order by id for update;",
        "    perform 1 from public.sku_pack_levels where sku_id = v_sku_id and active and location_id is null order by id for update;",
      ],
      [
        "       from public.sku_pack_levels where sku_id = v_sku_id and active) l;",
        "       from public.sku_pack_levels where sku_id = v_sku_id and active and location_id is null) l;",
      ],
      [
        "        into v_price from public.vendor_price_history where vendor_item_id = v_sku_id\n",
        "        into v_price from public.vendor_price_history where vendor_item_id = v_sku_id and location_id is null\n",
      ],
      [
        "      update public.sku_pack_levels set active = false where sku_id = v_sku_id and active;",
        [
          "      update public.sku_pack_versions set active = false, valid_to = v_now, retired_by = p_actor",
          "        where sku_id = v_sku_id and location_id is null and active returning id into v_old_version;",
          "      v_new_version := gen_random_uuid();",
          "      insert into public.sku_pack_versions(id,sku_id,location_id,based_on_version_id,active,valid_from,created_at,created_by)",
          "        values (v_new_version,v_sku_id,null,v_old_version,true,v_now,v_now,p_actor);",
          "      update public.sku_pack_levels set active = false where sku_id = v_sku_id and active and location_id is null;",
        ].join("\n"),
      ],
      [
        "      insert into public.sku_pack_levels(id,sku_id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal,effective_from,active,created_by)",
        "      insert into public.sku_pack_levels(id,sku_id,version_id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal,effective_from,active,created_by)",
      ],
      [
        "      select (v_id_map->>(x->>'id'))::uuid,v_sku_id,x->>'label',(x->>'contains_qty')::numeric,",
        "      select (v_id_map->>(x->>'id'))::uuid,v_sku_id,v_new_version,x->>'label',(x->>'contains_qty')::numeric,",
      ],
    ],
  },
  {
    name: "receiving_create_store_item",
    source: "0216_receiving_store_runs.sql",
    start: "create function public.receiving_create_store_item(",
    startReplaced: "create or replace function public.receiving_create_store_item(",
    end: "$$;",
    mods: [
      ["create function public.receiving_create_store_item(", "create or replace function public.receiving_create_store_item("],
      [
        "declare v_ref public.vendor_items%rowtype; v_id uuid; v_product uuid; v_map jsonb; v_group jsonb;",
        "declare v_ref public.vendor_items%rowtype; v_id uuid; v_product uuid; v_map jsonb; v_group jsonb;\n  v_scope uuid; v_version uuid;",
      ],
      [
        "  perform 1 from public.sku_pack_levels where sku_id = p_reference and active order by id for update;",
        [
          "  -- 0259: clone the chain THIS SHOP receives — its own version when it has one, else the global.",
          "  v_scope := case when exists (select 1 from public.sku_pack_levels",
          "      where sku_id = p_reference and active and location_id = p_location) then p_location else null end;",
          "  perform 1 from public.sku_pack_levels where sku_id = p_reference and active",
          "    and location_id is not distinct from v_scope order by id for update;",
        ].join("\n"),
      ],
      [
        "  select jsonb_object_agg(id::text, gen_random_uuid()::text) into v_map\n    from public.sku_pack_levels where sku_id = p_reference and active;",
        "  select jsonb_object_agg(id::text, gen_random_uuid()::text) into v_map\n    from public.sku_pack_levels where sku_id = p_reference and active\n      and location_id is not distinct from v_scope;",
      ],
      [
        [
          "  insert into public.sku_pack_levels(id, sku_id, label, contains_qty, contains_level_id,",
          "    contains_measure_unit, display_ordinal, effective_from, active, created_by)",
          "  select (v_map->>id::text)::uuid, v_id, label, contains_qty,",
          "    (v_map->>contains_level_id::text)::uuid, contains_measure_unit, display_ordinal,",
          "    now(), true, p_actor from public.sku_pack_levels where sku_id = p_reference and active;",
        ].join("\n"),
        [
          "  if v_map is not null then",
          "    v_version := gen_random_uuid();",
          "    insert into public.sku_pack_versions(id, sku_id, location_id, based_on_version_id, active, valid_from, created_by)",
          "      values (v_version, v_id, null, null, true, now(), p_actor);",
          "  end if;",
          "  insert into public.sku_pack_levels(id, sku_id, version_id, label, contains_qty, contains_level_id,",
          "    contains_measure_unit, display_ordinal, effective_from, active, created_by)",
          "  select (v_map->>id::text)::uuid, v_id, v_version, label, contains_qty,",
          "    (v_map->>contains_level_id::text)::uuid, contains_measure_unit, display_ordinal,",
          "    now(), true, p_actor from public.sku_pack_levels where sku_id = p_reference and active",
          "      and location_id is not distinct from v_scope;",
          "  -- 0259: a SHOP version was cloned → the copy's flat mirror must describe THAT chain, derived",
          "  -- by the ONE mirror rule (sku_flat_mirror_apply), in this transaction.",
          "  if v_scope is not null and v_map is not null then",
          "    perform public.sku_flat_mirror_apply(v_id, v_version);",
          "  end if;",
        ].join("\n"),
      ],
    ],
  },
];
