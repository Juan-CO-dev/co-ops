import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function ReportsReviewPage() {
  return (
    <PlaceholderCard
      title="Reports Review"
      description="Browse and filter every artifact type. Read-only synthesis at week / day / individual level."
      features={[
        "Filter by location, date range, artifact type, role",
        "Drill from week → day → individual artifact",
        "Read receipts via report_views",
        "Export and bulk-correction (level 6+)",
      ]}
      shippingIn="Module #4 (Report Review)"
    />
  );
}
