"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { ActionButton } from "@/components/ActionButton";

export function AddMaintenanceNote({
  locationId,
  equipment,
  language,
  defaultEquipmentId,
}: {
  locationId: string;
  equipment: { id: string; name: string }[];
  language: Language;
  defaultEquipmentId?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  const OTHER_VALUE = "__other__";

  const [selectedId, setSelectedId] = useState<string>(
    defaultEquipmentId ?? (equipment[0]?.id ?? OTHER_VALUE),
  );
  const [otherLabel, setOtherLabel] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isOther = selectedId === OTHER_VALUE;
  const canSubmit = !submitting && note.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/maintenance/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          equipmentId: isOther ? null : selectedId,
          otherLabel: isOther ? (otherLabel.trim() || null) : null,
          note: note.trim(),
        }),
      });
      if (res.ok) {
        setNote("");
        router.refresh();
      } else {
        setErrorMsg(t("maintenance.error.generic"));
      }
    } catch {
      setErrorMsg(t("maintenance.error.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
        {t("maintenance.add_note.title")}
      </h2>

      {/* Equipment select */}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-co-text">
          {t("maintenance.add_note.equipment_label")}
        </span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="h-10 w-full rounded-md border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text focus:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        >
          {equipment.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
          <option value={OTHER_VALUE}>{t("maintenance.add_note.other")}</option>
        </select>
      </label>

      {/* Other label input */}
      {isOther && (
        <label className="flex flex-col gap-1">
          <span className="sr-only">{t("maintenance.add_note.other_placeholder")}</span>
          <input
            type="text"
            value={otherLabel}
            onChange={(e) => setOtherLabel(e.target.value)}
            placeholder={t("maintenance.add_note.other_placeholder")}
            className="h-10 w-full rounded-md border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text focus:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          />
        </label>
      )}

      {/* Note textarea */}
      <label className="flex flex-col gap-1">
        <span className="sr-only">{t("maintenance.add_note.note_placeholder")}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("maintenance.add_note.note_placeholder")}
          rows={3}
          className="w-full rounded-md border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm text-co-text focus:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        />
      </label>

      {errorMsg && (
        <p className="text-sm font-semibold text-co-cta">{errorMsg}</p>
      )}

      <ActionButton
        size="lg"
        className="w-full"
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {submitting
          ? t("maintenance.add_note.submitting")
          : t("maintenance.add_note.submit")}
      </ActionButton>
    </section>
  );
}
