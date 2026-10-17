import { notFound, redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { shopParamFor, searchParamValues } from "@/lib/shop-context-shared";
import { loadNewSandwichJobView } from "@/lib/catalog/jobs";
import { ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { NewSandwichJob } from "@/components/catalog/jobs/NewSandwichJob";

/** The loader resolves the remembered shop within the actor's authorized choices. */
export default async function NewSandwichPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireSessionFromHeaders("/admin/catalog/new/sandwich");
  if (auth.level < 7 || auth.user.role === "social_media_mgr") redirect("/dashboard");
  const sp = await searchParams;
  const requested = shopParamFor("/admin/catalog/new/sandwich", searchParamValues(sp));
  let view;
  try {
    view = await loadNewSandwichJobView(auth, requested === "global" ? null : requested);
  } catch (error) {
    if (error instanceof ShopOwnedError && error.status === 403) redirect("/dashboard");
    if (error instanceof ShopOwnedError && (error.status === 400 || error.status === 404)) notFound();
    throw error;
  }
  return <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 px-4">
    <NewSandwichJob key={`new-sandwich:${view.scope ?? "global"}`} view={view} />
  </div>;
}
