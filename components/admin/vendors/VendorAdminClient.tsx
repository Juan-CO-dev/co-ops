"use client";

/**
 * VendorAdminClient — top-level client surface for the Vendor Directory list.
 *
 * Renders the vendor list (name + category + active badge, link to detail) and,
 * for GM+, an "Add vendor" button + CreateVendorForm modal. Inactive vendors
 * render muted. Edit happens on the detail page (/admin/vendors/[id]).
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { CreateVendorForm } from "./CreateVendorForm";
import type { VendorAdminClientProps } from "./shared";

export function VendorAdminClient({ vendors, canManageFull }: VendorAdminClientProps) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mt-5">
      {canManageFull ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {t("admin.vendors.create")}
          </button>
        </div>
      ) : null}

      {vendors.length === 0 ? (
        <p className="mt-5 text-sm text-co-text-muted">{t("admin.vendors.empty")}</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-3">
          {vendors.map((v) => (
            <li key={v.id} className={v.active ? "" : "opacity-60"}>
              <a
                href={`/admin/vendors/${v.id}`}
                className="block rounded-xl border-2 border-co-border bg-co-surface p-4 transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-bold text-co-text">{v.name}</div>
                    <div className="mt-0.5 text-sm text-co-text-muted">
                      {v.category ?? t("admin.vendors.no_category")}
                    </div>
                  </div>
                  <span
                    className={
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] " +
                      (v.active
                        ? "bg-co-success/15 text-co-success"
                        : "bg-co-text/10 text-co-text-muted")
                    }
                  >
                    {v.active ? t("admin.vendors.badge.active") : t("admin.vendors.badge.inactive")}
                  </span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      {creating ? <CreateVendorForm onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
