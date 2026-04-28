import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AdminVendorDetailPage() {
  return (
    <PlaceholderCard
      title="Vendor Detail"
      description="Per-vendor profile + item catalog management."
      features={[
        "Tab 1: Profile (trivial fields AGM+, full fields GM+)",
        "Tab 2: Items — add / edit / deactivate / delete",
        "Tab 3: Recent deliveries (read-only)",
        "Tab 4: Price history (read-only)",
        "Deactivating an item auto-deactivates referencing par_levels",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
