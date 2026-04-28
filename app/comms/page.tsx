import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function InternalCommsPage() {
  return (
    <PlaceholderCard
      title="Internal Comms"
      description="Threaded discussion attached to artifacts and announcements."
      features={[
        "Thread per artifact or announcement",
        "@-mentions trigger notifications",
        "Read receipts",
        "Attach photos via report_photos",
      ]}
      shippingIn="Module #8 (Internal Comms)"
    />
  );
}
