import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function TipPoolPage() {
  return (
    <PlaceholderCard
      title="Tip Pool"
      description="Period-based tip pool calculation and distribution log."
      features={[
        "Hours from 7shifts adapter (when activated) or manual entry",
        "Rate-per-hour computed from pool ÷ total hours",
        "Per-employee distribution rows",
        "Status: draft / calculated / distributed",
      ]}
      shippingIn="Module #11 (Tip Pool)"
    />
  );
}
