import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function RollupsPage() {
  return (
    <PlaceholderCard
      title="Weekly + Monthly Rollups"
      description="Cached aggregations with forecasting. Powered by weekly_rollups + AI."
      features={[
        "Sales / labor / food cost / void+comp / waste totals",
        "Data completeness score per period",
        "Cached generation for AI snapshots",
        "Forward forecast (CGS / Owner)",
      ]}
      shippingIn="Module #18 (Rollups)"
    />
  );
}
