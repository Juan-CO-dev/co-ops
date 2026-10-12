"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useTranslation } from "@/lib/i18n/provider";
import { postCustomerJson, STEP_UP_CODES } from "./customer-post";

export function RevokeLinkButton({ linkId }: { linkId: string }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState(false);
  async function revoke() {
    setBusy(true); setError(false);
    try {
      if (await requestStepUp("A") !== "ok") return;
      const post = () => postCustomerJson("/api/admin/customers", { operation: "revoke_link", linkId });
      let r = await post();
      if (!r.ok && STEP_UP_CODES.has(r.code ?? "") && await requestStepUp("A") === "ok") r = await post();
      if (!r.ok) { setError(true); return; }
      startTransition(() => router.refresh());
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="min-w-0">
    <button type="button" disabled={busy || refreshing} onClick={() => void revoke()}
      className="min-h-[44px] max-w-full rounded-lg border-2 border-co-border px-3 font-bold text-co-text disabled:opacity-50">{t("customers.link.revoke")}</button>
    {error && <p role="alert" className="text-co-cta-text">{t("customers.error.generic")}</p>}
  </div>;
}
