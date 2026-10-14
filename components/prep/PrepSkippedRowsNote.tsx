/**
 * D-66 (Juan 2026-10-13) — the note a prep page shows when its loader left rows out because
 * their stored shape is bad (PrepShapeError, e.g. a text par). The rest of the page renders and
 * saves: the submit / save / finalize paths skip the same rows (not included, not required) and
 * refuse only a write that targets one. This names the item(s) so a manager can fix them in
 * Admin. Server-rendered.
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
