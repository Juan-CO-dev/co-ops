import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function ClosingChecklistPage() {
  return (
    <PlaceholderCard
      title="Closing Checklist"
      description="End-of-day completion + closing inventory counts. Generates par-breach handoff flags for next shift."
      features={[
        "Multi-submission, multi-submitter",
        "Closing counts auto-feed next morning's prep math",
        "Photo verification for cleanliness / equipment items",
        "Confirms with PIN; status = confirmed or incomplete_confirmed",
        "Triggers handoff flag generation",
      ]}
      shippingIn="Module #1 (Daily Operations)"
    />
  );
}
