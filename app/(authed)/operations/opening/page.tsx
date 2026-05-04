import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function OpeningChecklistPage() {
  return (
    <PlaceholderCard
      title="Opening Checklist"
      description="Per-item completion of opening tasks. Role-leveled visibility — KH sees KH-level items, SL sees KH+SL, AGM sees all opening items."
      features={[
        "Multi-submission, multi-submitter",
        "Per-item PIN-stamped completion",
        "Optional photo / count per item",
        "Soft-block confirmation with written reasons for unfinished required items",
        "Confirms with PIN re-entry",
      ]}
      shippingIn="Module #1 (Daily Operations)"
    />
  );
}
