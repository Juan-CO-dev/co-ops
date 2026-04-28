import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AdminAuditPage() {
  return (
    <PlaceholderCard
      title="Audit Log"
      description="Foundation admin tool. Read-only, level 7+."
      features={[
        "Filter by actor, resource_table, action, time range",
        "Highlight destructive=true entries",
        "JSON before / after diff per entry",
        "Cannot be modified or deleted — RLS enforced",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
