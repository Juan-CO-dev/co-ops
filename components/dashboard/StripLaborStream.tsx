/**
 * The numbers strip's labor cell, STREAMED (nav PR 8, lead rulings r3, P1). An async server component, rendered by
 * NumbersStrip inside its own `<Suspense>` boundary, so the page shell and the other strip cells never wait for the
 * labor read (its net-sales denominator read costs ~1.2 s whatever the window).
 *
 * It awaits the read `loadStrip` STARTED with the other cells (same role gate, same switch, same absolute page
 * deadline and abort, `settle` never rejects) and draws exactly what StripLaborCell drew before: the figures when the
 * read settled ok, "Couldn't load right now" when it failed or timed out, never $0. It holds no figure itself.
 */
import type { Settled } from "@/lib/dashboard-day";
import type { LaborStripDay } from "@/lib/dashboard-blocks-shared";
import type { Language } from "@/lib/i18n/types";
import { StripLaborCell } from "./StripLaborCell";

export async function StripLaborStream({ labor, shopId, shopLabel, language }: {
  labor: Promise<Settled<readonly LaborStripDay[]>>;
  shopId: string;
  shopLabel: string;
  language: Language;
}) {
  const settled = await labor;
  return <StripLaborCell days={settled.kind === "ok" ? settled.value : "failed"} shopId={shopId} shopLabel={shopLabel} language={language} />;
}
