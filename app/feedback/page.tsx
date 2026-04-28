import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function FeedbackPage() {
  return (
    <PlaceholderCard
      title="Customer Feedback"
      description="1–5 ratings with optional comments and follow-up assignment."
      features={[
        "Star rating + category + free-text comment",
        "Follow-up flag with assigned-to user",
        "Tracks response loop close-out",
        "Surfaces in handoff for negative ratings",
      ]}
      shippingIn="Module #16 (Customer Feedback)"
    />
  );
}
