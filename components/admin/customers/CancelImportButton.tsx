"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { STEP_UP_CODES, postCustomerJson } from "./customer-post";

const dangerButton = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-4 font-bold text-co-cta-text";

/** Cancel a half-applied consent import (r1 BC-036): its pending opt-ins/opt-outs never count. Level 9+, Tier B. */
export function CancelImportButton({ importId }: { importId: string }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  async function cancel() {
    setBusy(true); setFailed(false);
    try {
      if (await requestStepUp("B") !== "ok") return;
      let r = await postCustomerJson("/api/admin/customers/confirm", { operation: "cancel_import", importId });
      if (!r.ok && STEP_UP_CODES.has(r.code ?? "") && await requestStepUp("B") === "ok") r = await postCustomerJson("/api/admin/customers/confirm", { operation: "cancel_import", importId });
      if (!r.ok) { setFailed(true); return; }
      startTransition(() => router.refresh());
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" className={dangerButton} disabled={busy || refreshing} onClick={() => void cancel()}>{t("customers.imports.cancel")}</button>
    {failed && <span role="alert" className="text-co-cta-text">{t("customers.error.generic")}</span>}
  </div>;
}
