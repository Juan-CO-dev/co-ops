import { notFound, redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { shopParamFor, searchParamValues } from "@/lib/shop-context-shared";
import { loadNewItemJobView, loadSwapVendorJobView } from "@/lib/catalog/jobs";
import { swapReturnContext } from "@/lib/catalog/swap-return-shared";
import { ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { NewItemJob } from "@/components/catalog/jobs/NewItemJob";

/** The loader resolves the remembered shop within the actor's authorized choices. */
export default async function NewItemPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireSessionFromHeaders("/admin/catalog/new/item");
  if (auth.level < 7 || auth.user.role === "social_media_mgr") redirect("/dashboard");
  const sp = await searchParams;
  const requested = shopParamFor("/admin/catalog/new/item", searchParamValues(sp));
  const swapFrom = swapReturnContext(sp.swapFrom);
  let view;
  try {
    view = await loadNewItemJobView(auth, requested === "global" ? null : requested);
    if (swapFrom) await loadSwapVendorJobView(auth, swapFrom, view.scope);
  } catch (error) {
    if (error instanceof ShopOwnedError && error.status === 403) redirect("/dashboard");
    if (error instanceof ShopOwnedError && (error.status === 400 || error.status === 404)) notFound();
    throw error;
  }
  return <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 px-4">
    <NewItemJob key={`new-item:${view.scope ?? "global"}:${swapFrom ?? ""}`} view={view} swapFrom={swapFrom} readVersion={crypto.randomUUID()} />
  </div>;
}
