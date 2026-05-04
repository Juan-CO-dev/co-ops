import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function ShiftOverlayPage() {
  return (
    <PlaceholderCard
      title="Shift Overlay"
      description="Management's view of the shift — voids, comps, vendor, people, strategic, executive. Role-scoped sections per Section 7.2."
      features={[
        "Cash/voids/comps/waste at level 4+",
        "Vendor + people sections at level 5+",
        "Strategic notes at level 6+",
        "Executive directives at level 7+",
        "Forecast at level 8 (CGS only)",
        "3-hour self-edit window, then append-only corrections",
      ]}
      shippingIn="Module #1 (Daily Operations)"
    />
  );
}
