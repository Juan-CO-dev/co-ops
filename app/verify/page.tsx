import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function VerifyPage() {
  return (
    <PlaceholderCard
      title="Email Verification"
      description="Click-through link from Resend onboarding email. Sets initial password for level 5+ users."
      features={[
        "Token validated against email_verifications.token_hash",
        "Single-use, expiring (24h)",
        "Sets users.email_verified = true and password_hash",
        "Redirects to /dashboard on success",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
