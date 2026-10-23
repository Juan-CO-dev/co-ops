"use client";
import type { PositionLabel, ShortStretchView } from "@/lib/scheduling/board-view-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { useBoardLine } from "./use-board-line";

export function ShortStretchList({ items, positions }: { items: ShortStretchView[]; positions: Record<string, PositionLabel> }) {
  const { t, language, position } = useBoardLine({ names: {}, positions });
  if (!items.length) return null;
  const ids = [...new Set(items.map((item) => item.positionId))];
  return <section className="grid min-w-0 gap-2" data-section="crew-short-stretches" aria-label={t("schedule.crew.short_stretches")}>
    <h3 className="font-bold">{t("schedule.crew.short_stretches")}</h3>
    {ids.map((id) => <div key={id} className="grid min-w-0 gap-1 rounded-lg border-2 border-co-cta-text p-3" data-station={id}>
      <h4 className="break-words font-bold">{position(id)}</h4>
      <ul>{items.filter((item) => item.positionId === id).map((item, i) => <li key={i} className="break-words text-sm">
        {t("schedule.crew.short_stretch", { count: item.missing, from: formatQ(item.fromQ, language), to: formatQ(item.toQ, language) })}
      </li>)}</ul>
    </div>)}
  </section>;
}
