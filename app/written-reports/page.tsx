import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function WrittenReportsPage() {
  return (
    <PlaceholderCard
      title="Written Reports"
      description="Free-form posts for anything that doesn't fit a structured artifact. Any level 3+ user can write."
      features={[
        "Categories: incident / observation / request / feedback / other",
        "Visibility floor — author can scope to AGM+, GM+, etc.",
        "3-hour self-edit window, then append-only",
        "Cross-link to other artifacts via related_table + related_id",
      ]}
      shippingIn="Module #2 (Written Reports)"
    />
  );
}
