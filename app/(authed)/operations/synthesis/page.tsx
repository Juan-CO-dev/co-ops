import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function SynthesisPage() {
  return (
    <PlaceholderCard
      title="Today's Synthesis"
      description="Read-only computed view that aggregates all of today's artifacts at this location. Drillable to source artifact at every level."
      features={[
        "Rolls up opening / prep / closing checklist completions",
        "Pulls latest shift overlay numbers",
        "Lists written reports + active announcements",
        "Surfaces handoff flags from closing",
        "Click any line to drill into the source record",
      ]}
      shippingIn="Module #1 (Daily Operations)"
    />
  );
}
