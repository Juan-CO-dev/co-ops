import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function DeepCleaningPage() {
  return (
    <PlaceholderCard
      title="Deep Cleaning Rotation"
      description="Frequency-based assignments with verification photos."
      features={[
        "Tasks with frequency_days and estimated_minutes",
        "Auto-schedule per location based on last completion",
        "Verification photo on completion",
        "Overdue tasks surface as handoff flags",
      ]}
      shippingIn="Module #15 (Deep Cleaning)"
    />
  );
}
