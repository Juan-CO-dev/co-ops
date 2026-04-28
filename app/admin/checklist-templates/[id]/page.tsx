import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AdminChecklistTemplateDetailPage() {
  return (
    <PlaceholderCard
      title="Checklist Template Detail"
      description="Edit metadata, manage items, drag-to-reorder, set role-level and required flags."
      features={[
        "Header: location, type, name, description, active toggle",
        "Items table with station, label, min_role_level, required, expects_count, expects_photo",
        "Add / edit / reorder items (GM+)",
        "Delete item (GM+, step-up)",
        "Clone template to another location",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
