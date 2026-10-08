"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useTranslation } from "@/lib/i18n/provider";
import { TRANSFER_REASONS } from "@/lib/catering/transfers-shared";
import { postJson, resolveErrorKey } from "./shared";

export function TransferLead({ leadId, locationId, locations, onMoved }: {
  leadId: string;
  locationId: string | null;
  locations: Array<{ id: string; name: string }>;
  onMoved: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof TRANSFER_REASONS)[number]>("capacity");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destinations = locations.filter((l) => l.id !== locationId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const result = await postJson(`/api/catering/pipeline/${leadId}/transfer`, {
        locationId: data.get("locationId"), reason, note: String(data.get("note") ?? "").trim(),
      });
      if (!result.ok) { setError(t(resolveErrorKey(result.code))); return; }
      router.refresh();
      onMoved();
    } finally { setBusy(false); }
  }

  if (!destinations.length) return null;
  return (
    <section className="mt-3 border-t border-co-border pt-3">
      <button type="button" aria-expanded={open} aria-controls={formId} disabled={busy} onClick={() => setOpen(!open)}
        className="min-h-[44px] w-full rounded-xl border border-co-border px-3 py-2 text-left text-sm text-co-text disabled:opacity-50">
        {t("catering.pipeline.transfer.title")}
      </button>
      {open && <form id={formId} onSubmit={(event) => void submit(event)} className="mt-2 space-y-3">
        <p className="text-xs text-co-text-muted">{t("catering.pipeline.transfer.prep_stays")}</p>
        <label className="block text-sm text-co-text-muted">
          {t("catering.pipeline.transfer.destination")}
          <select name="locationId" required disabled={busy} className="mt-1 min-h-[44px] w-full rounded-xl border border-co-border bg-co-surface p-2 text-co-text">
            {destinations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="block text-sm text-co-text-muted">
          {t("catering.pipeline.transfer.reason")}
          <select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value as typeof reason)}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-co-border bg-co-surface p-2 text-co-text">
            {TRANSFER_REASONS.map((r) => <option key={r} value={r}>{t(`catering.pipeline.transfer.reason.${r}`)}</option>)}
          </select>
        </label>
        <label className="block text-sm text-co-text-muted">
          {t(reason === "other" ? "catering.pipeline.transfer.note_required" : "catering.pipeline.transfer.note")}
          <textarea name="note" required={reason === "other"} maxLength={1000} disabled={busy} rows={2}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-co-border bg-co-surface p-2 text-co-text" />
        </label>
        {error && <p role="alert" className="text-xs text-co-cta-text">{error}</p>}
        <button type="submit" disabled={busy} className="min-h-[44px] rounded-xl bg-co-text px-4 py-2 text-sm font-semibold tracking-[0.12em] text-co-bg disabled:opacity-50">
          {t("catering.pipeline.transfer.confirm")}
        </button>
      </form>}
    </section>
  );
}
