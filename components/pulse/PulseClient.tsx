"use client";

/**
 * Mid-shift Pulse v2 home — one scroll, visuals first: Needs attention, the live shop floor, then
 * the section cards. Every card owns its data and its 60 s clock (useSectionPoll); the attention list
 * refreshes first, the floor next, the rest staggered. 8+ get the two shops side by side (one panel
 * each). Fluid 360–1440 px: a single column on phones, two at md, three at xl.
 */
import { useTranslation } from "@/lib/i18n/provider";
import type { PulseSection } from "@/lib/pulse/scope-shared";
import type { SectionStates } from "@/lib/pulse/types";
import { SectionBody } from "@/components/pulse/SectionBody";
import { SectionCard } from "@/components/pulse/SectionCard";

export interface PulsePanel { locationId: string; locationName: string; sections: PulseSection[]; initial: SectionStates }

const DELAY: Record<PulseSection, number> = { attention: 0, floor: 400, stations: 800, people: 1000, food_safety: 1200, catering: 1400, inventory: 1600, sales: 1800, handoff: 2000 };
const SPAN: Partial<Record<PulseSection, string>> = { attention: "md:col-span-2 xl:col-span-3", floor: "md:col-span-2 xl:col-span-3", sales: "md:col-span-2" };

export function PulseClient({ panels, date, viewerLevel }: { panels: PulsePanel[]; date: string; viewerLevel: number }) {
  const { t } = useTranslation();
  const both = panels.length > 1;
  return (
    <div className={both ? "grid gap-6 lg:grid-cols-2" : ""}>
      {panels.map((panel) => (
        <div key={panel.locationId} className="min-w-0">
          {both && <h2 className="mb-2 text-base font-bold text-co-text">{panel.locationName}</h2>}
          <p className="sr-only">{t("pulse.page.refresh_note")}</p>
          <div className={`grid gap-4 ${both ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}>
            {panel.sections.map((section) => (
              <SectionCard key={section} section={section} locationId={panel.locationId} initial={panel.initial[section]} delayMs={DELAY[section]} className={both ? "" : SPAN[section] ?? ""}>
                {(data, ctx) => <SectionBody section={section} data={data} mode="card" locationId={panel.locationId} date={date} viewerLevel={viewerLevel} refresh={ctx.refresh} />}
              </SectionCard>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A section's own page: the same card in detail mode, same clock. */
export function PulseSectionDetailClient({ section, locationId, initial, date, viewerLevel }: { section: PulseSection; locationId: string; initial: SectionStates[PulseSection]; date: string; viewerLevel: number }) {
  return (
    <SectionCard section={section} locationId={locationId} initial={initial} mode="detail">
      {(data, ctx) => <SectionBody section={section} data={data} mode="detail" locationId={locationId} date={date} viewerLevel={viewerLevel} refresh={ctx.refresh} />}
    </SectionCard>
  );
}
