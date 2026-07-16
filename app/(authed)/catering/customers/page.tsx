import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function CateringCustomersPage() {
  return (
    <PlaceholderCard
      title="Catering Customers"
      description="Customer profiles with full order history and per-order satisfaction tracking."
      features={[
        "Contact + company + assigned location",
        "Complete order history with rating per order",
        "Notes on preferences and red flags",
        "Cross-location visibility for shared customers",
      ]}
      shippingIn="Module #12 (Catering)"
    />
  );
}
