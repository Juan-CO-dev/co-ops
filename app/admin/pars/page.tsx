import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AdminParsPage() {
  return (
    <PlaceholderCard
      title="Par Levels"
      description="Foundation admin tool. Per-location par values referencing vendor_items."
      features={[
        "Location selector",
        "Items grouped by category (matches vendor_item categories)",
        "All-days par + day-of-week overrides",
        "Inline edit, save per row (each save = step-up)",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
