import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { MidDayPrepDashboardState } from "@/lib/prep";

import { NewMidDayPrepButton } from "./NewMidDayPrepButton";

/**
 * MidDayPrepTile — dashboard tile for mid-day prep (C.43). Lists today's
 * numbered instances (by triggered_at) with their phase status + a "+ New
 * mid-day prep" trigger. Multi-instance, unlike the single-instance AmPrepTile.
 * Server component; the trigger button is the only client island.
 */

const STATUS_KEY: Record<string, TranslationKey> = {
  open: "dashboard.mid_day_prep.status.open",
  phase1_complete: "dashboard.mid_day_prep.status.phase1_complete",
  phase2_complete: "dashboard.mid_day_prep.status.phase2_complete",
};

export function MidDayPrepTile({
  state,
  language,
  locationId,
  date,
}: {
  state: MidDayPrepDashboardState;
  language: Language;
  locationId: string;
  /** Operational (NY) date YYYY-MM-DD, computed server-side. */
  date: string;
}) {
  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-co-text-dim">
        {serverT(language, "dashboard.mid_day_prep.tile_label")}
      </p>

      {!state.hasTemplate ? (
        <p className="mt-2 text-[11px] italic text-co-text-muted">
          {serverT(language, "dashboard.mid_day_prep.no_template")}
        </p>
      ) : (
        <>
          {state.instances.length === 0 ? (
            <p className="mt-2 text-[11px] italic text-co-text-muted">
              {serverT(language, "dashboard.mid_day_prep.none_today")}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {state.instances.map((inst) => (
                <li key={inst.instanceId}>
                  <Link
                    href={`/operations/mid-day?instance=${inst.instanceId}`}
                    className="
                      flex items-center justify-between gap-3 rounded-lg border-2
                      border-co-border-2 bg-co-surface px-3 py-2 text-sm transition
                      hover:border-co-text focus:outline-none
                      focus-visible:ring-4 focus-visible:ring-co-gold/60
                    "
                  >
                    <span className="font-semibold text-co-text">
                      {serverT(language, "dashboard.mid_day_prep.instance_label", {
                        number: inst.number,
                      })}
                    </span>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-muted">
                      {serverT(
                        language,
                        STATUS_KEY[inst.status] ?? "dashboard.mid_day_prep.status.open",
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3">
            <NewMidDayPrepButton locationId={locationId} date={date} />
          </div>
        </>
      )}
    </div>
  );
}
