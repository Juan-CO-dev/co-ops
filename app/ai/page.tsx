import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AIInsightsPage() {
  return (
    <PlaceholderCard
      title="AI Insights"
      description="Claude-powered operational intelligence, scoped by role. GM+ only."
      features={[
        "Auto-synthesizes the day / week / month from all artifacts",
        "Threshold alerts: voids >1.5%, comps >3%, cash short >$10",
        "Channel-mix and weather/event correlation",
        "Cross-location compare (GM+) and exec summary (Owner+)",
        "Forward forecast with DC event calendar (CGS)",
      ]}
      shippingIn="Module #5 (AI Insights)"
    />
  );
}
