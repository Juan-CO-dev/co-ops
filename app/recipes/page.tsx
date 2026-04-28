import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function RecipesPage() {
  return (
    <PlaceholderCard
      title="Recipe Flash Cards"
      description="Standardized recipe reference for prep and line."
      features={[
        "Ingredient list with quantities and units",
        "Step-by-step instructions with optional photos",
        "Yield + prep time metadata",
        "Linkable from training modules",
      ]}
      shippingIn="Module #13 (Recipes)"
    />
  );
}
