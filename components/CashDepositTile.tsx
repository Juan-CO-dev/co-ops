import { formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

import { ActionLink } from "./ActionButton";

export function CashDepositTile({
  locationId,
  report,
  language,
}: {
  locationId: string;
  report: { signedAt: string; signedByName: string | null } | null;
  language: Language;
}) {
  const statusLine = report
    ? serverT(language, "cash.status.finalized_by", {
        time: formatTime(report.signedAt, language),
        name: report.signedByName ?? "—",
      })
    : serverT(language, "cash.status.not_started");
  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-co-text-dim">
        {serverT(language, "cash.tile_label")}
      </p>
      <p className="mt-1 text-sm font-semibold text-co-text">{statusLine}</p>
      <div className="mt-3">
        <ActionLink href={`/cash?location=${locationId}`} className="w-full sm:w-auto">
          {serverT(language, report ? "cash.cta.view" : "cash.cta.start")}
        </ActionLink>
      </div>
    </div>
  );
}
