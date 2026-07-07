/**
 * /admin/items (Items Central Page, 2026-07-07) — the central item registry.
 * Pipeline position: SKUs (source of truth) → recipes → ITEMS → checklists.
 * Server component: gate ≥6 (mirrors admin/skus); admin shell owns auth+chrome.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadItemsAdminView, ITEMS_READ_MIN } from "@/lib/admin/items";
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import type { Readiness } from "@/lib/readiness";
import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { ItemsClient } from "@/components/admin/items/ItemsClient";

export default async function AdminItemsPage() {
  const auth = await requireSessionFromHeaders("/admin/items");
  const level = getRoleLevel(auth.user.role);
  if (level < ITEMS_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const view = await loadItemsAdminView(auth);

  let itemReadiness: Record<string, Readiness> = {};
  try {
    const g = await loadGraphReadiness(auth);
    itemReadiness = Object.fromEntries(
      [...g.itemReadiness.entries()].filter(([, r]) => r.status !== "ready"),
    );
  } catch (e) {
    console.error("readiness load failed (rendering without badges)", e);
  }

  return (
    <div>
      <AdminBackLink />
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.items.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, "admin.items.subtitle")}
      </p>
      <ItemsClient view={view} itemReadiness={itemReadiness} />
    </div>
  );
}
