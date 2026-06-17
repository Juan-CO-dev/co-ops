import { formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { PmDashboardState } from "@/lib/pm-report";

import { ActionLink } from "./ActionButton";

/**
 * Dashboard tile for the PM Report (KH+ only).
 * Mirror of CashDepositTile — shows submitted provenance or a start/continue link.
 * Only rendered when state.isVisibleToActor is true.
 */
export function PmReportTile({
  locationId,
  state,
  language,
}: {
  locationId: string;
  state: PmDashboardState;
  language: Language;
}) {
  if (!state.isVisibleToActor) return null;

  const statusLine =
    state.status === "submitted"
      ? serverT(language, "pm.tile.submitted_by", {
          time: state.submittedAt ? formatTime(state.submittedAt, language) : "—",
          name: state.submittedByName ?? "—",
        })
      : serverT(language, "pm.tile.not_started");

  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-co-text-dim">
        {serverT(language, "pm.tile_label")}
      </p>
      <p className="mt-1 text-sm font-semibold text-co-text">{statusLine}</p>
      <div className="mt-3">
        <ActionLink
          href={`/pm-report?location=${locationId}`}
          className="w-full sm:w-auto"
        >
          {serverT(
            language,
            state.status === "submitted" ? "pm.tile.cta_view" : "pm.tile.cta_start",
          )}
        </ActionLink>
      </div>
    </div>
  );
}
