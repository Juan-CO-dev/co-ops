/**
 * Dashboard — Phase 4 wires up the real shell with announcements, handoff
 * card, today's open artifacts, and the role-gated module grid. For now,
 * a placeholder so navigation has a target.
 */

import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function DashboardPage() {
  return (
    <PlaceholderCard
      title="Dashboard"
      description="Greeting, location selector, announcements, handoff flags, today's open checklists, and the role-gated module grid."
      features={[
        "Active unacknowledged announcements banner",
        "Shift handoff flag card from latest closing checklist + overlay",
        "Today's open checklist instances awaiting completion",
        "Stat cards: today / total / locations",
        "Module grid filtered by role permissions",
      ]}
      shippingIn="Phase 4"
    />
  );
}
