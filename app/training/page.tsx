import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function TrainingPage() {
  return (
    <PlaceholderCard
      title="Training"
      description="Position-based training matrix with module sign-offs and trainee progress."
      features={[
        "Positions and module assignments",
        "Status: not_started / in_progress / completed / signed_off",
        "Sign-off requires GM+ attestation",
        "Trainer reports + observational reports from non-trainers",
      ]}
      shippingIn="Module #14 (Training)"
    />
  );
}
