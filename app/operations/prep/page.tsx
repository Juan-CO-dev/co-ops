import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function PrepSheetPage() {
  return (
    <PlaceholderCard
      title="Prep Sheet"
      description="Auto-generated prep targets from par minus on-hand. Single-submission — locks on submit."
      features={[
        "Pulls par_levels for the location + day-of-week",
        "Reads on-hand from latest opening checklist counts",
        "Computes needed = max(par − on_hand, 0)",
        "No forecasting in v1; hand-tunable adjustments only",
        "Locks the prep instance on first submit",
      ]}
      shippingIn="Module #1 (Daily Operations)"
    />
  );
}
