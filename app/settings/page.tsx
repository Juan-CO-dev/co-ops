import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function SettingsPage() {
  return (
    <PlaceholderCard
      title="Settings"
      description="Manage your app preferences and display options."
      features={[
        "Language preference",
        "Notification preferences",
        "Display options",
      ]}
      shippingIn="a follow-up build"
    />
  );
}
