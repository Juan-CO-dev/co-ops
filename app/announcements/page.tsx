import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AnnouncementsPage() {
  return (
    <PlaceholderCard
      title="Announcements"
      description="Top-down directives with acknowledgement tracking. AGM+ can post."
      features={[
        "Priority: info / standard / urgent / critical",
        "Per-recipient acknowledgement tracking",
        "Role-band targeting — min and optional max level",
        "Location-scoped or org-wide",
        "Banner on dashboard until acknowledged",
      ]}
      shippingIn="Module #3 (Announcements)"
    />
  );
}
