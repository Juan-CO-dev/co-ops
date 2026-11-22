import { PlannedPage } from "@/components/PlannedPage";
import { requireSessionFromHeaders } from "@/lib/session";

// Held for a planned feature that is not built yet (nav spec r5 §7.2). Not in any menu or search.
// Crew recipe cards — NOT the live /admin/recipes recipe builder.
export default async function RecipesPage() {
  const auth = await requireSessionFromHeaders("/recipes");
  return <PlannedPage lang={auth.user.language} titleKey="planned.name.recipes" />;
}
