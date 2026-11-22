/**
 * "My shift | Shop pulse" (nav PR 8, plan r2 2.7, 2.19; spec r5 3.6 last paragraph; lead rulings r1 Q9). Server
 * component, on `/dashboard` and on both `/mid-shift` versions. Shown only to someone who can open the pulse here
 * (`pulseToggleFor`: the `mid-shift` shortcut's own gate and the `ops` surface); never to the social media manager, by
 * role. Each side keeps the shop in its route's own parameter (`?loc=` / `?location=`).
 */
import Link from "next/link";
import { pulseToggleFor, toggleHrefs } from "@/lib/dashboard-blocks-shared";
import type { DayViewer } from "@/lib/day-plan-shared";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

const SIDE = "inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg px-3 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

export function MyShiftPulseToggle({ viewer, shopId, current, language }: {
  viewer: Pick<DayViewer, "role" | "level" | "surfaces" | "switches">;
  shopId: string | null;
  current: "my_shift" | "pulse";
  language: Language;
}) {
  if (!pulseToggleFor(viewer)) return null;
  const href = toggleHrefs(shopId);
  const side = (which: "my_shift" | "pulse", to: string, label: string) => (
    <Link
      href={to}
      data-toggle={which}
      aria-current={current === which ? "page" : undefined}
      className={[SIDE, current === which ? "border-2 border-co-text bg-co-gold text-co-text" : "border-2 border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text"].join(" ")}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label={serverT(language, "dashboard.toggle.aria")} data-pulse-toggle className="flex w-full max-w-md gap-2">
      {side("my_shift", href.myShift, serverT(language, "dashboard.toggle.my_shift"))}
      {side("pulse", href.pulse, serverT(language, "nav.mid_shift"))}
    </nav>
  );
}
