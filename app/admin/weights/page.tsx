/**
 * /admin/weights — the weight & trim audit, beside the costing board.
 *
 * Juan's ruling, verbatim (spec 2026-08-20): "triggered on demand. Behaves just
 * like the regular audit to establish ground truth as needed." This page is a TOOL
 * you open, not a clock that opens you: no due dates, no overdue tone, and
 * deliberately NO AlertPill on the /admin hub card for this section — the hub's
 * pills are for readiness, and wiring weights into them would make the tool nag,
 * which is precisely what the ruling forbids.
 *
 * Server component: gate ≥ WEIGHT_READ_MIN (the C.39 pattern — app/admin/layout.tsx
 * owns the auth boundary and the ≥6 floor; this page re-gates defensively).
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadWeightBoard, WEIGHT_READ_MIN, WEIGHT_WRITE_MIN } from "@/lib/weights";
import { WeightBoardClient } from "@/components/admin/weights/WeightBoardClient";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminWeightsPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < WEIGHT_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const board = await loadWeightBoard(auth);

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.weights.title")}
        subtitle={serverT(lang, "admin.weights.subtitle")}
      />
      <WeightBoardClient board={board} canWeigh={level >= WEIGHT_WRITE_MIN} />
    </div>
  );
}
