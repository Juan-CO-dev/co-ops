"use client";
import { useState } from "react";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useTranslation } from "@/lib/i18n/provider";
import type { CustomerListParams } from "@/lib/customers/list-params-shared";
import { downloadCustomerExport } from "./customer-download";

export function MarketingListButton({ params, optedIn }: { params: CustomerListParams; optedIn: number }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  async function download() {
    setBusy(true); setError(false); setCount(null);
    try {
      const result = await downloadCustomerExport({ kind: "marketing_segment", params }, requestStepUp);
      if (result?.ok) setCount(result.count);
      else if (result) setError(true);
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="min-w-0 space-y-2" aria-busy={busy}>
    <button type="button" disabled={busy || optedIn === 0} onClick={() => void download()} className="inline-flex min-h-[44px] max-w-full items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 py-2 text-left font-bold text-co-text disabled:opacity-60">{t(optedIn === 0 ? "customers.export.noneOptedIn" : "customers.export.segment")}</button>
    <p className="text-sm text-co-text-muted">{t("customers.export.segmentHint")}</p>
    {error && <p role="alert" className="text-co-cta-text">{t("customers.error.generic")}</p>}
    {count !== null && <p role="status" className="font-bold text-co-confirm-text">{t("customers.export.done", { count })}</p>}
  </div>;
}
