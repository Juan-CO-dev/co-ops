import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function CateringPipelinePage() {
  return (
    <PlaceholderCard
      title="Catering Pipeline"
      description="Inquiry → quote sent → confirmed → completed pipeline with revenue estimates."
      features={[
        "Stage progression: inquiry / quote_sent / confirmed / completed / lost",
        "Auto-fill from existing customer profiles",
        "Lead source tracking — phone / EzCater / referral",
        "Follow-up reminders",
      ]}
      shippingIn="Module #12 (Catering)"
    />
  );
}
