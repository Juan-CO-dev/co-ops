import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";

/**
 * OpeningTile — dashboard tile for the Opening Report (C.53). Direct path to
 * /operations/opening (which owns the gate + 3-phase flow). Shown first in the
 * Reports section (opening leads the day's fill-out order).
 */

const STATUS_KEY: Record<string, TranslationKey> = {
  open: "dashboard.opening.status.in_progress",
  phase1_complete: "dashboard.opening.status.in_progress",
  phase2_complete: "dashboard.opening.status.in_progress",
  confirmed: "dashboard.opening.status.submitted",
  auto_finalized: "dashboard.opening.status.submitted",
};

export function OpeningTile({
  locationId,
  hasTemplate,
  status,
  language,
}: {
  locationId: string;
  hasTemplate: boolean;
  status: string | null;
  language: Language;
}) {
  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-co-text-dim">
        {serverT(language, "dashboard.opening.tile_label")}
      </p>

      {!hasTemplate ? (
        <p className="mt-2 text-[11px] italic text-co-text-muted">
          {serverT(language, "dashboard.opening.no_template")}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm font-semibold text-co-text">
            {status
              ? serverT(language, STATUS_KEY[status] ?? "dashboard.opening.status.in_progress")
              : serverT(language, "dashboard.opening.status.not_started")}
          </p>
          <div className="mt-3">
            <Link
              href={`/operations/opening?location=${locationId}`}
              className="
                inline-flex min-h-[48px] items-center justify-center rounded-xl
                border-2 border-co-text bg-co-gold px-4 text-sm font-bold uppercase
                tracking-[0.1em] text-co-text transition hover:bg-co-gold-deep
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
              "
            >
              {serverT(language, "dashboard.opening.cta")}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
