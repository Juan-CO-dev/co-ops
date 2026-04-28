import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function AdminUsersPage() {
  return (
    <PlaceholderCard
      title="User Management"
      description="Foundation admin tool. Full CRUD on users with role-aware constraints."
      features={[
        "List + filter active / inactive users",
        "Add user — role determines required fields (level 5+ needs email)",
        "Edit user — admins cannot edit users at or above their own level",
        "Reset PIN (step-up required)",
        "Activate / deactivate (step-up required)",
        "Change role / locations (step-up required)",
      ]}
      shippingIn="Phase 5 (Foundation Admin Tools)"
    />
  );
}
