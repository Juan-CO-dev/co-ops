/**
 * /admin/categories (Vendor Directory v2.1) — shared taxonomy admin covering
 * BOTH registries: categories AND order types. Server gate ≥6 (mirrors the
 * vendors pages); the lists are visible to ≥6, adding to either registry is
 * MoO+ (≥8, Tier B) — enforced by the routes + reflected in the client UI.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadCategories, loadOrderTypes } from "@/lib/admin/vendors";
import { CategoryListClient } from "@/components/admin/vendors/CategoryListClient";
import { OrderTypeListClient } from "@/components/admin/vendors/OrderTypeListClient";

export default async function AdminCategoriesPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard");
  const lang = auth.user.language;
  const level = ROLES[auth.user.role].level;

  const [categories, orderTypes] = await Promise.all([loadCategories(auth), loadOrderTypes(auth)]);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.categories.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.categories.subtitle")}</p>

      <section className="mt-6">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
          {serverT(lang, "admin.categories.section.categories")}
        </h2>
        <CategoryListClient categories={categories} actorLevel={level} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
          {serverT(lang, "admin.categories.section.order_types")}
        </h2>
        <OrderTypeListClient orderTypes={orderTypes} actorLevel={level} />
      </section>
    </div>
  );
}
