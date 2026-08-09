import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

// NOTE: this is the "Recipe Flash Cards" stub (Module #13, /recipes — nav.recipes),
// a training-reference feature. Distinct from the LIVE "recipes.*" i18n namespace
// used by the admin recipe builder at /admin/recipes — hence "recipe_cards.ph.*"
// rather than "recipes.ph.*", to avoid colliding with that already-shipped feature.
export default async function RecipesPage() {
  const auth = await requireSessionFromHeaders("/recipes");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "recipe_cards.ph.title")}
      description={serverT(lang, "recipe_cards.ph.description")}
      features={[
        serverT(lang, "recipe_cards.ph.feature.ingredients"),
        serverT(lang, "recipe_cards.ph.feature.steps"),
        serverT(lang, "recipe_cards.ph.feature.yield_time"),
        serverT(lang, "recipe_cards.ph.feature.linkable"),
      ]}
      shippingIn={serverT(lang, "recipe_cards.ph.shipping")}
    />
  );
}
