import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function ShiftOverlayPage() {
  return (
    <PlaceholderCard
      title="Shift Overlay"
      description="Management's view of the shift — voids, comps, vendor, people, strategic, executive. Role-scoped sections per Section 7.2."
      features={[
        "Cash/voids/comps/waste at level 5+",
        "Vendor + people sections at level 6+",
        "Strategic notes at level 7+",
        "Executive directives at level 9+",
        "Forecast at level 10 (CGS only)",
        "3-hour self-edit window, then append-only corrections",
      ]}
      shippingIn="Module #1 (Daily Operations)"
    />
  );
}
