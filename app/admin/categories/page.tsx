/**
 * /admin/categories (Vendor Directory v2, Slice A, D3) — shared category
 * registry admin. Server gate ≥6 (mirrors the vendors pages); the list is
 * visible to ≥6, adding a category is MoO+ (≥8, Tier B) — enforced by the
 * route + reflected in the client UI.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadCategories } from "@/lib/admin/vendors";
import { CategoryListClient } from "@/components/admin/vendors/CategoryListClient";

export default async function AdminCategoriesPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard");
  const lang = auth.user.language;
  const level = ROLES[auth.user.role].level;

  const categories = await loadCategories(auth);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.categories.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.categories.subtitle")}</p>
      <CategoryListClient categories={categories} actorLevel={level} />
    </div>
  );
}
