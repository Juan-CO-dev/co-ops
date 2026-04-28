import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function CashDepositPage() {
  return (
    <PlaceholderCard
      title="Cash Deposit Confirmation"
      description="End-of-night deposit attestation with PIN re-entry."
      features={[
        "Drawer + tips + safe count reconciliation",
        "Deposit slip photo upload",
        "Two-person confirmation (manager + closer)",
        "Variance tracked back to shift_overlay.cash_over_short",
      ]}
      shippingIn="Module #10 (Cash Deposit)"
    />
  );
}
