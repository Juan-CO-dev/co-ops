import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function ProfilePage() {
  return (
    <PlaceholderCard
      title="Profile"
      description="View and manage your account information, including your name, role, and assigned locations."
      features={[
        "Name, role, and assigned stores",
        "Contact info",
        "PIN reset",
      ]}
      shippingIn="a follow-up build"
    />
  );
}
