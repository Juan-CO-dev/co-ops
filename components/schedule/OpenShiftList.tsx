"use client";
import type { OpenShiftView } from "@/lib/scheduling/board-view-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { useBoardLine } from "./use-board-line";

export function OpenShiftList({ items }: { items: OpenShiftView[] }) {
  const { t, language, line } = useBoardLine({ names: {}, positions: {} });
  if (!items.length) return null;
  return <section className="grid min-w-0 gap-2" data-section="crew-open-shifts" aria-label={t("schedule.crew.open_shifts")}>
    <h3 className="font-bold">{t("schedule.crew.open_shifts")}</h3>
    <ul className="grid min-w-0 gap-2">{items.map((item, i) => <li key={`${item.typeId}-${i}`} className="grid min-w-0 gap-1 break-words rounded-lg border-2 border-co-warning bg-co-warning-surface p-3">
      <strong>{t("schedule.crew.open_shift", { name: item.name, count: item.missing })}</strong>
      <span>{formatQ(item.fromQ, language)}–{formatQ(item.toQ, language)}</span>
      {item.reasons.map((reason) => <span key={reason.key} className="text-sm">{line(reason)}</span>)}
    </li>)}</ul>
  </section>;
}
