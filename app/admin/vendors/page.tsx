import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AdminVendorsPage() {
  return (
    <PlaceholderCard
      title="Vendor Management"
      description="Foundation admin tool. Tiered edit permissions: AGM+ for trivial / item catalog, GM+ for lifecycle."
      features={[
        "List vendors with category, active, item count, last delivery",
        "Add vendor (GM+, step-up)",
        "Filter by category and active status",
        "Drill into vendor detail for catalog management",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
