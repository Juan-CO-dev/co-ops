"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { MenuCostRow } from "@/lib/menu-costing-shared";
import { isValidMenuPrice } from "@/lib/toast/in-store-prices-shared";

const button = "min-h-[44px] rounded-lg border-2 border-co-gold-deep px-3 text-sm font-bold text-co-text disabled:opacity-50";
export function MenuPriceEditor({ row }: { row: MenuCostRow }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [value, setValue] = useState(row.typedPrice?.toFixed(2) ?? "");
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  async function save(price: unknown) {
    setError(null);
    if (!isValidMenuPrice(price)) { setError("admin.menu_costing.price.invalid"); return; }
    setBusy(true);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const send = () => fetch(`/api/admin/menu-items/${row.id}/price`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuPrice: price }), redirect: "manual",
      });
      let response = await send();
      let body = await response.json().catch(() => ({})) as { code?: string; ok?: boolean };
      if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") {
        response = await send();
        body = await response.json().catch(() => ({})) as typeof body;
      }
      if (!response.ok || body.ok !== true) {
        setError(body.code === "menu_price_changed" ? "admin.menu_costing.price.changed" : "admin.menu_costing.price.error");
        return;
      }
      setValue(price === null ? "" : price.toFixed(2));
      startTransition(() => router.refresh());
    } catch { setError("admin.menu_costing.price.error"); }
    finally { setBusy(false); }
  }
  return <form className="mb-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void save(value.trim() === "" ? null : Number(value)); }}>
    <label className="block text-xs font-bold text-co-text" htmlFor={`selling-price-${row.id}`}>{t("admin.menu_costing.price.label")}</label>
    <div className="flex flex-wrap gap-2">
      <input id={`selling-price-${row.id}`} type="number" inputMode="decimal" min="0.01" max="1000" step="0.01"
        className="min-h-[44px] w-32 rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text"
        value={value} onChange={(event) => setValue(event.target.value)} disabled={busy || refreshing} />
      <button className={button} disabled={busy || refreshing} type="submit">{t("admin.menu_costing.price.save")}</button>
      {row.toastPriceCents != null && <button className={button} disabled={busy || refreshing} type="button" onClick={() => void save(null)}>{t("admin.menu_costing.price.use_toast")}</button>}
    </div>
    <p className="text-xs text-co-text-muted">{t("admin.menu_costing.price.help")}</p>
    {error && <p role="alert" className="text-xs text-co-cta-text">{t(error)}</p>}
  </form>;
}
