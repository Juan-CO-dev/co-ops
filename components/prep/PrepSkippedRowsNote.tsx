/**
 * D-66 (Juan 2026-10-13) — the note a prep page shows when its loader left rows out because
 * their stored shape is bad (PrepShapeError, e.g. a text par). The rest of the page renders;
 * this names the item(s) so a manager can fix the prep settings in Admin. Server-rendered.
 *
 * Saving still runs the STRICT check (writers never read a bad row leniently), so the note says
 * plainly that saving may not work until the item is fixed.
 */
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { SkippedPrepRow } from "@/lib/prep";
import { skippedRowNames } from "@/lib/prep-display-shared";

export function PrepSkippedRowsNote({ rows, language }: { rows: SkippedPrepRow[]; language: Language }) {
  if (rows.length === 0) return null;
  return (
    <div role="status" className="mt-4 rounded-2xl border-2 border-co-warning bg-co-warning-surface p-4">
      <p className="text-sm font-bold text-co-text">{serverT(language, "prep.skipped_rows.heading")}</p>
      <p className="mt-1 text-sm text-co-text">
        {serverT(language, "prep.skipped_rows.body", { items: skippedRowNames(rows, language) })}
      </p>
    </div>
  );
}
