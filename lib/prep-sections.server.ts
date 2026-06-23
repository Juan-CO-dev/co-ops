/**
 * Server-only prep-section loader (Item/Inventory Spine sub-slice A).
 *
 * SERVER-ONLY. Keeps the pure, client-safe lib/prep-sections.ts free of DB
 * access. Reads migration 0082's `prep_sections` table — the first-class
 * source for section display labels + the per-section PrepColumn convention.
 * Lines still reference the slug; this loader surfaces the editable labels
 * (and columns) keyed by slug.
 *
 * NOTE: the brief specified `import "server-only";` here, but that package is
 * NOT a dependency in this repo — the convention is enforced by review
 * (matching lib/supabase-server.ts: "no `server-only` dep yet; the convention
 * is enforced by review"). Importing it would break tsc/build. The `.server.ts`
 * suffix + this header are the boundary marker. Add the `import` only after
 * `server-only` is added to package.json.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrepColumn, PrepSectionDefn } from "@/lib/types";

interface PrepSectionRow {
  slug: string;
  label_en: string;
  label_es: string | null;
  columns: PrepColumn[];
  display_order: number;
}

/**
 * Load active prep-section definitions keyed by slug, ordered by display_order.
 * Service-role client (admin authorization is enforced by the calling routes;
 * `prep_sections` denies all end-user DML so reads go through service-role).
 * Throws on error.
 */
export async function loadPrepSections(
  service: SupabaseClient,
): Promise<Map<string, PrepSectionDefn>> {
  const { data, error } = await service
    .from("prep_sections")
    .select("slug, label_en, label_es, columns, display_order")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<PrepSectionRow[]>();
  if (error) throw new Error(`loadPrepSections failed: ${error.message}`);

  const out = new Map<string, PrepSectionDefn>();
  for (const r of data ?? []) {
    out.set(r.slug, {
      slug: r.slug,
      labelEn: r.label_en,
      labelEs: r.label_es,
      columns: r.columns,
      displayOrder: r.display_order,
    });
  }
  return out;
}
