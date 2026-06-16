"use client";

/**
 * NewMidDayPrepButton — "+ New mid-day prep" trigger (C.43). POSTs
 * /api/prep/mid-day to create a fresh numbered instance, then navigates to its
 * page. Multi-instance: each press creates a new instance (the route sets
 * allows_multiple_per_day so the partial unique index permits it).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { ActionButton } from "./ActionButton";

export function NewMidDayPrepButton({
  locationId,
  date,
}: {
  locationId: string;
  /** Operational (NY) date string YYYY-MM-DD, computed server-side. */
  date: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/prep/mid-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, date }),
        redirect: "manual",
      });
      if (res.ok) {
        const body = (await res.json()) as { instanceId?: string };
        if (body.instanceId) {
          router.push(`/operations/mid-day?instance=${body.instanceId}`);
          return;
        }
      }
      let msg = "Could not start mid-day prep.";
      try {
        const b = (await res.json()) as { message?: string; error?: string };
        msg = b.message ?? b.error ?? msg;
      } catch {
        // keep generic message
      }
      setError(msg);
      setCreating(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Network error.");
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <ActionButton onClick={() => void onClick()} disabled={creating} className="w-full sm:w-auto">
        {creating ? t("dashboard.mid_day_prep.creating") : t("dashboard.mid_day_prep.new_cta")}
      </ActionButton>
      {error ? <p className="px-1 text-[11px] text-co-cta">{error}</p> : null}
    </div>
  );
}
