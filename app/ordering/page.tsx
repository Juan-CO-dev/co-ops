import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function OrderingPage() {
  return (
    <PlaceholderCard
      title="Inventory Ordering"
      description="Per-vendor order workflow that consumes the vendor catalog and current inventory."
      features={[
        "Suggested order from par − on-hand − pending deliveries",
        "Per-vendor order draft → sent → confirmed → delivered",
        "Email-out via Resend or external portal link",
        "Invoice capture against vendor_deliveries",
      ]}
      shippingIn="Module #7 (Inventory Ordering)"
    />
  );
}
