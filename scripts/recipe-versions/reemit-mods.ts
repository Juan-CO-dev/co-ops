/**
 * Catalog Phase 3a — the four 0258 recipe-graph writers 0262 re-emits, as `[old, new]` modifications
 * of their latest definer (0258). Shared by the generator (emit-0262-reemits.ts) and the pin
 * (tests/recipe-versions-migration.test.ts), so the SQL that ships IS the list reviewers read.
 * The helpers are 2a's (scripts/shop-versions/reemit-mods.ts): ONE spelling of extract/apply/subsequence.
 *
 * Every mod is an ADDITION after an unchanged anchor:
 *   add_recipe_input_atomic    + the journal actor (p_created_by); + the shop sweep after the global refusal
 *   update_recipe_input_atomic + the shop sweep after the global refusal (excluding the edited line)
 *   create_recipe_full         + the journal actor (p_created_by); + the output shop sweep before the return
 *   add_recipe_output          + the output shop sweep after the global refusal
 * and ONE NEW OVERLOAD (lead decision, Astra 3a r4#1 — authorship):
 *   update_recipe_input_atomic_actor  the same body as the 16-argument writer + a 17th parameter `p_actor uuid`
 *                              and the journal actor, so a legacy-builder edit's version records WHO. A different
 *                              signature, so it is a NEW function beside the old one: the 16-argument writer stays
 *                              (re-emitted, shop sweep, no actor) through the deploy window — only code deployed
 *                              before 3a calls it — and is DROPPED by the first Phase 4 migration.
 */
import { applyMods, extractFunction, isLineSubsequence, normalize, type Reemit } from "../shop-versions/reemit-mods";

export { applyMods, extractFunction, isLineSubsequence, normalize };

const LOCK = "  perform pg_advisory_xact_lock(7258025800);\n";
const LINE_REFUSAL = "    raise exception 'would_create_cycle' using errcode = 'P0001';\n  end if;\n";
const ACTOR = [
  "  -- 0262: who wrote these lines, for the global recipe journal (recipe_global_journal reads it at commit).",
  "  perform set_config('app.recipe_journal_actor', coalesce(p_created_by::text, ''), true);",
  "",
].join("\n");

export const RECIPE_REEMITS: readonly Reemit[] = [
  {
    name: "add_recipe_input_atomic",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function public.add_recipe_input_atomic(",
    startReplaced: "create or replace function public.add_recipe_input_atomic(",
    end: "\n$$;",
    mods: [
      [LOCK, LOCK + ACTOR],
      [
        LINE_REFUSAL,
        LINE_REFUSAL + [
          "  -- 0262: the same refusal in every ACTIVE SHOP that resolves this recipe through the global lines.",
          "  if p_component_item_id is not null",
          "     and public.recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, null) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
        ].join("\n"),
      ],
    ],
  },
  {
    name: "update_recipe_input_atomic",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function public.update_recipe_input_atomic(",
    startReplaced: "create or replace function public.update_recipe_input_atomic(",
    end: "\n$$;",
    mods: [
      [
        LINE_REFUSAL,
        LINE_REFUSAL + [
          "  -- 0262: the same refusal in every ACTIVE SHOP that resolves this recipe through the global lines.",
          "  if p_component_item_id is not null",
          "     and public.recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
        ].join("\n"),
      ],
    ],
  },
  {
    name: "update_recipe_input_atomic_actor",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function public.update_recipe_input_atomic(",
    // A distinct first line, so the pin can find THIS definition (the 16-argument one comes first in 0262).
    startReplaced: "create or replace function public.update_recipe_input_atomic( -- 0262 overload: + p_actor (journal authorship)",
    end: "\n$$;",
    mods: [
      [
        "create or replace function public.update_recipe_input_atomic(\n",
        "create or replace function public.update_recipe_input_atomic( -- 0262 overload: + p_actor (journal authorship)\n",
      ],
      ["  p_expected_portioned boolean\n) returns table (", "  p_expected_portioned boolean,\n  p_actor uuid\n) returns table ("],
      [
        LOCK,
        LOCK + [
          "  -- 0262: who wrote these lines, for the global recipe journal (recipe_global_journal reads it at commit).",
          "  perform set_config('app.recipe_journal_actor', coalesce(p_actor::text, ''), true);",
          "",
        ].join("\n"),
      ],
      [
        LINE_REFUSAL,
        LINE_REFUSAL + [
          "  -- 0262: the same refusal in every ACTIVE SHOP that resolves this recipe through the global lines.",
          "  if p_component_item_id is not null",
          "     and public.recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
        ].join("\n"),
      ],
    ],
  },
  {
    name: "create_recipe_full",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function create_recipe_full(",
    startReplaced: "create or replace function create_recipe_full(",
    end: "end $$;",
    mods: [
      [LOCK, LOCK + ACTOR],
      [
        "    raise exception 'would_create_cycle' using errcode = 'P0001';\n  end if;\n\n  return v_recipe_id;",
        [
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
          "  -- 0262: the same refusal in every ACTIVE SHOP's graph (outputs are global; shop recipe lines differ).",
          "  if exists (",
          "    select 1 from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value)",
          "    where nullif(value->>'output_item_id','') is not null",
          "      and public.recipe_shops_output_would_cycle(v_recipe_id, nullif(value->>'output_item_id','')::uuid)",
          "  ) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
          "  return v_recipe_id;",
        ].join("\n"),
      ],
    ],
  },
  {
    name: "add_recipe_output",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function add_recipe_output(",
    startReplaced: "create or replace function add_recipe_output(",
    end: "end $$;",
    mods: [
      [
        "  if p_output_item_id is not null and public.recipe_output_would_cycle(p_recipe_id, p_output_item_id) then\n    raise exception 'would_create_cycle' using errcode = 'P0001';\n  end if;\n",
        [
          "  if p_output_item_id is not null and public.recipe_output_would_cycle(p_recipe_id, p_output_item_id) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "  -- 0262: and in every ACTIVE SHOP's graph (outputs are global; shop recipe lines differ).",
          "  if p_output_item_id is not null and public.recipe_shops_output_would_cycle(p_recipe_id, p_output_item_id) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
        ].join("\n"),
      ],
    ],
  },
];
