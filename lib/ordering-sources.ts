import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";

/** Stores are receiving sources, never ordering sources. Do not filter inventory_only:
 * existing packaging/cleaning SKUs use that flag and must remain orderable. */
export async function loadStoreVendorIds(): Promise<ReadonlySet<string>> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<{ id: string }>((from, to) => sb.from("vendors")
    .select("id").eq("source_kind", "store").order("id").range(from, to));
  return new Set(rows.map((row) => row.id));
}
