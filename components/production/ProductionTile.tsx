import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

export function ProductionTile({
  language,
  locationId,
}: {
  language: Language;
  locationId: string;
}) {
  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-co-text-dim">
        {serverT(language, "dashboard.production.tile_label")}
      </p>
      <p className="mt-2 text-[11px] italic text-co-text-muted">
        {serverT(language, "dashboard.production.hint")}
      </p>
      <div className="mt-3">
        <Link
          href={`/operations/production?location=${locationId}`}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        >
          {serverT(language, "dashboard.production.cta")}
        </Link>
      </div>
    </div>
  );
}
