"use client";

/**
 * W23/B126 — "Reopen" for a LOST ezCater lead whose order ezCater un-cancelled. Shown only when
 * the lead's GET says so (`reopen.target`); the server decides the stage again (owner decision
 * W23-1 a: Confirmed when ezCater says accepted, else Inquiry). One tap, no password (a stage
 * move takes none); refusals are named.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey } from "./shared";

export function ReopenLead({ leadId, target, onReopened }: {
  leadId: string;
  target: "confirmed" | "inquiry";
  onReopened: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson(`/api/catering/pipeline/${leadId}/reopen`, {});
      if (!result.ok) { setError(t(resolveErrorKey(result.code))); return; }
      router.refresh();
      onReopened();
    } finally { setBusy(false); }
  }

  return (
    <section className="mt-3 rounded-xl border border-co-warning bg-co-warning-surface p-3">
      <p className="text-xs text-co-warning-text">{t("catering.pipeline.reopen.hint")}</p>
      <button type="button" disabled={busy} onClick={() => void reopen()}
        className="mt-2 inline-flex min-h-[44px] items-center rounded-xl bg-co-text px-4 py-2 text-sm font-semibold tracking-[0.12em] text-co-bg disabled:opacity-50">
        {t(`catering.pipeline.reopen.button_${target}` as TranslationKey)}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-co-cta-text">{error}</p>}
    </section>
  );
}
