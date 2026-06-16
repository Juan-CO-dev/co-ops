import { formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

import { ActionLink } from "./ActionButton";

/**
 * OpeningTile — dashboard tile for the Opening Report (C.53). Direct path to
 * /operations/opening (which owns the gate + 3-phase flow). Shown first in the
 * Reports section (opening leads the day's fill-out order).
 *
 * "Done" = phase2_complete | confirmed | auto_finalized. phase2_complete is the
 * de-facto terminal for the live per-phase flow (Phase 3 / submit_phase3_atomic
 * is an unwired stub), so it counts as finalized here — otherwise a finished
 * opening reads "in progress" forever. Finalize provenance (confirmed_at/by,
 * stamped by submit_phase2_atomic per migration 0066) renders as
 * "Finalized at {time} by {name}".
 */

const TERMINAL_STATUSES = new Set(["phase2_complete", "confirmed", "auto_finalized"]);

export function OpeningTile({
  locationId,
  hasTemplate,
  status,
  finalizedAt,
  finalizedByName,
  language,
}: {
  locationId: string;
  hasTemplate: boolean;
  status: string | null;
  /** confirmed_at of today's opening when terminal; null otherwise. */
  finalizedAt: string | null;
  /** Resolved confirmed_by name when terminal; null otherwise. */
  finalizedByName: string | null;
  language: Language;
}) {
  const statusLine: string = (() => {
    if (!status) return serverT(language, "dashboard.opening.status.not_started");
    if (TERMINAL_STATUSES.has(status)) {
      if (finalizedAt) {
        return serverT(language, "dashboard.opening.status.finalized_by", {
          time: formatTime(finalizedAt, language),
          name: finalizedByName ?? "—",
        });
      }
      return serverT(language, "dashboard.opening.status.submitted");
    }
    return serverT(language, "dashboard.opening.status.in_progress");
  })();

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
          <p className="mt-1 text-sm font-semibold text-co-text">{statusLine}</p>
          <div className="mt-3">
            <ActionLink href={`/operations/opening?location=${locationId}`} className="w-full sm:w-auto">
              {serverT(language, "dashboard.opening.cta")}
            </ActionLink>
          </div>
        </>
      )}
    </div>
  );
}
