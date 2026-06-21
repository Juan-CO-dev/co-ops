import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AdminLocationsPage() {
  return (
    <PlaceholderCard
      showBackLink={false}
      title="Location Management"
      description="Foundation admin tool. Owner+ only (level 9+)."
      features={[
        "Add / edit / activate / deactivate locations",
        "Type: permanent or dark_kitchen",
        "Auto-assigns Owner + CGS to new locations",
        "All destructive operations require step-up",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
