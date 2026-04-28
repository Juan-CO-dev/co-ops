import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AdminChecklistTemplatesPage() {
  return (
    <PlaceholderCard
      title="Checklist Templates"
      description="Foundation admin tool. Define opening / prep / closing templates per location."
      features={[
        "List templates with location, type, item count, active state",
        "Add template (GM+, step-up)",
        "Filter by location and type",
        "Single-submission flag system-set for type=prep",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
