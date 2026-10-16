"use client";
/** The board's line formatter bound to the reader's language and the view's names / position labels. */
import { useCallback } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { NarrativeLine } from "@/lib/people-narrative";
import { formatLine, personName, positionLabel, type LineContext } from "@/lib/scheduling/board-format-shared";

export function useBoardLine(lookup: Pick<LineContext, "names" | "positions">) {
  const { t, language } = useTranslation();
  const ctx: LineContext = { t, language, names: lookup.names, positions: lookup.positions };
  const line = useCallback((l: NarrativeLine) => formatLine(l, { t, language, names: lookup.names, positions: lookup.positions }), [t, language, lookup.names, lookup.positions]);
  return {
    t, language, line,
    name: (id: string | null | undefined) => personName(ctx, id),
    position: (id: string | null | undefined) => positionLabel(ctx, id),
  };
}
