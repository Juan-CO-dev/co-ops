/**
 * /admin/products — the product registry (product identity above SKUs, 0179).
 *
 * Server component: gate ≥ PRODUCT_READ_MIN (the C.39 pattern — the admin shell
 * in app/admin/layout.tsx owns the auth boundary and the ≥6 floor; this page
 * re-gates defensively). Loads the registry + the SKU catalog (the attach picker)
 * + active locations (the per-location primary picker) in parallel.
 *
 * MIGRATION GATE (M1): migration 0179_product_identity.sql is authored but not
 * applied. Until the lead applies it, listProducts raises the named
 * `products_schema_pending` and this page renders an HONEST pending panel rather
 * than a 500 — the registry is the only surface in this phase that changes at all.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listProducts, PRODUCT_READ_MIN, ProductError, type ProductView } from "@/lib/products";
import { loadSkus } from "@/lib/admin/skus";
import { ProductsClient } from "@/components/admin/products/ProductsClient";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminProductsPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < PRODUCT_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  let products: ProductView[] = [];
  let schemaPending = false;
  try {
    products = await listProducts(auth);
  } catch (e) {
    if (e instanceof ProductError && e.code === "products_schema_pending") schemaPending = true;
    else throw e;
  }

  const sb = getServiceRoleClient();
  const [skus, locRes] = await Promise.all([
    loadSkus(auth),
    sb.from("locations").select("id, name").eq("active", true).order("name"),
  ]);

  const skuOptions = skus
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name, vendorName: s.vendorName, active: s.active }));
  const locations = (locRes.data ?? []).map((r) => ({
    id: (r as { id: string }).id,
    name: (r as { name: string }).name,
  }));

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.products.title")}
        subtitle={serverT(lang, "admin.products.subtitle")}
      />
      {schemaPending ? (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {serverT(lang, "admin.products.schema_pending")}
        </div>
      ) : (
        <ProductsClient
          products={products}
          skus={skuOptions}
          locations={locations}
          actorLevel={level}
        />
      )}
    </div>
  );
}
