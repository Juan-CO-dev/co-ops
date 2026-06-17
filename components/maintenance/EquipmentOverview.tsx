import type {
  MaintenanceOverview,
  FridgeStatus,
} from "@/lib/maintenance";
import { FRIDGE_DEFAULT_SAFE_MAX_F } from "@/lib/maintenance";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import { TempTrendChart } from "./TempTrendChart";

/**
 * Maps FridgeStatus values to their i18n keys.
 * Note: the status value "no_reading_today" maps to
 * "maintenance.status.no_reading" (key does not include "_today").
 */
const STATUS_KEY: Record<FridgeStatus, TranslationKey> = {
  ok: "maintenance.status.ok",
  out_of_range: "maintenance.status.out_of_range",
  no_reading_today: "maintenance.status.no_reading",
};

const STATUS_CLASS: Record<FridgeStatus, string> = {
  ok: "text-co-success",
  out_of_range: "text-co-cta",
  no_reading_today: "text-co-text-muted",
};

export function EquipmentOverview({
  overview,
  locationId,
  language,
}: {
  overview: MaintenanceOverview;
  locationId: string;
  language: Language;
}) {
  const isEmpty =
    overview.fridges.length === 0 && overview.equipment.length === 0;

  if (isEmpty) {
    return (
      <p className="text-sm text-co-text-muted">
        {serverT(language, "maintenance.empty.no_equipment")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {overview.fridges.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
            {serverT(language, "maintenance.overview.fridges_heading")}
          </h2>
          <ul className="flex flex-col gap-2">
            {overview.fridges.map((f) => {
              const safeMax =
                f.equip.safeMaxF ?? FRIDGE_DEFAULT_SAFE_MAX_F;
              return (
                <li key={f.equip.id}>
                  <a
                    href={`/maintenance?location=${locationId}&equipment=${f.equip.id}`}
                    className="block rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 hover:opacity-90"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-co-text">
                        {f.equip.name}
                      </span>
                      <span
                        className={`text-xs font-semibold ${STATUS_CLASS[f.status]}`}
                      >
                        {serverT(language, STATUS_KEY[f.status])}
                      </span>
                    </div>
                    {f.latest !== null && (
                      <p className="mt-0.5 text-xs text-co-text-muted">
                        {serverT(language, "maintenance.degrees", {
                          value: f.latest.valueF,
                        })}
                      </p>
                    )}
                    {f.spark.length > 0 && (
                      <div className="mt-1">
                        <TempTrendChart
                          values={f.spark}
                          safeMaxF={safeMax}
                          _language={language}
                        />
                      </div>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {overview.equipment.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
            {serverT(language, "maintenance.overview.equipment_heading")}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {overview.equipment.map(({ equip, lastNote }) => (
              <li key={equip.id}>
                <a
                  href={`/maintenance?location=${locationId}&equipment=${equip.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 hover:opacity-90"
                >
                  <span className="text-sm font-semibold text-co-text">
                    {equip.name}
                  </span>
                  <span className="text-xs text-co-text-muted">
                    {lastNote
                      ? serverT(language, "maintenance.last_note", {
                          note: lastNote.note,
                          date: formatDateLabel(
                            lastNote.at.slice(0, 10),
                            language,
                          ),
                        })
                      : serverT(language, "maintenance.no_issues")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
