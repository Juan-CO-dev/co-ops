import { PlannedPage } from "@/components/PlannedPage";
import { requireSessionFromHeaders } from "@/lib/session";

// Held for a planned feature that is not built yet (nav spec r5 §7.2). Not in any menu or search.
export default async function TipPoolPage() {
  const auth = await requireSessionFromHeaders("/tips");
  return <PlannedPage lang={auth.user.language} titleKey="planned.name.tips" frame={auth} />;
}
