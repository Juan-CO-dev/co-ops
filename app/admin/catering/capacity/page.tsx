/**
 * /admin/catering/capacity — per-location capacity policy + blackout dates
 * editor (Catering KB, Wave 1 slice 1A, DOMAIN=capacity).
 *
 * GM+ (level >= 7, catering.kb.capacity.write). Server component: re-gate
 * >= 7 defensively per the C.39 pattern (the admin shell already gates >= 6 +
 * mounts the StepUpProvider this page's client consumes), load the
 * per-location policies + active blackouts server-side via the lib loaders,
 * hand to the client. Feeds the Wave-1B capacity gate.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadCapacityPolicies, loadBlackoutDates, CAPACITY_MIN } from "@/lib/admin/catering/capacity";
import { CapacityClient } from "@/components/admin/catering/capacity/CapacityClient";

export default async function AdminCateringCapacityPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < CAPACITY_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const [policies, blackouts] = await Promise.all([
    loadCapacityPolicies(auth),
    loadBlackoutDates(auth),
  ]);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.catering.capacity.title" as TranslationKey)}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, "admin.catering.capacity.subtitle" as TranslationKey)}
      </p>
      <CapacityClient policies={policies} blackouts={blackouts} actorLevel={level} />
    </div>
  );
}
