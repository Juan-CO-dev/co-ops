"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";

export function ParsTabs({ tab, locationId, children }: { tab: "vendor" | "prep"; locationId: string; children: ReactNode }) {
  const router = useRouter();
  const { t } = useTranslation();
  const select = (next: "vendor" | "prep") => router.push(`/admin/pars?location=${encodeURIComponent(locationId)}${next === "prep" ? "&tab=prep" : ""}`, { scroll: false });
  return <div className="min-w-0 space-y-4">
    <div role="tablist" aria-label={t("admin.pars.title")} className="grid grid-cols-2 gap-2">
      {(["vendor", "prep"] as const).map((value, index) => <button key={value} type="button" role="tab"
        id={`pars-tab-${value}`} aria-selected={tab === value} aria-controls={tab === value ? `pars-panel-${value}` : undefined}
        tabIndex={tab === value ? 0 : -1}
        className={`min-h-[44px] min-w-0 rounded-lg border-2 px-3 font-bold ${tab === value ? "border-co-gold-deep bg-co-surface-2" : "border-co-border bg-co-surface"}`}
        onClick={() => select(value)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
          (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
          select(next === 0 ? "vendor" : "prep");
        }}>{t(`admin.pars.tab.${value}`)}</button>)}
    </div>
    <div role="tabpanel" id={`pars-panel-${tab}`} aria-labelledby={`pars-tab-${tab}`} tabIndex={0}>{children}</div>
  </div>;
}
