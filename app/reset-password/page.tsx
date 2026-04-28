import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function ResetPasswordPage() {
  return (
    <PlaceholderCard
      title="Password Reset"
      description="Click-through from Resend reset email. Level 5+ users only — level 4 and below go through admin PIN reset."
      features={[
        "Token validated against password_resets.token_hash",
        "Single-use, expiring (1h)",
        "Sets new password_hash via bcrypt cost 12",
        "Revokes existing sessions for the user",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
