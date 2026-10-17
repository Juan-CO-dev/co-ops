import { notFound, redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { shopParamFor, searchParamValues } from "@/lib/shop-context-shared";
import { loadSwapVendorJobView } from "@/lib/catalog/jobs";
import { ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { SwapVendorJob } from "@/components/catalog/jobs/SwapVendorJob";

export default async function SwapVendorPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const auth = await requireSessionFromHeaders(`/admin/catalog/sku/${id}/swap`);
  if (auth.level < 7 || auth.user.role === "social_media_mgr") redirect("/dashboard");
  const sp = await searchParams;
  const requested = shopParamFor(`/admin/catalog/sku/${id}/swap`, searchParamValues(sp));
  let view;
  try {
    view = await loadSwapVendorJobView(auth, id, requested === "global" ? null : requested);
  } catch (error) {
    if (error instanceof ShopOwnedError && error.status === 403) redirect("/dashboard");
    if (error instanceof ShopOwnedError && (error.status === 400 || error.status === 404)) notFound();
    throw error;
  }
  if (!view.jobs.canSwap) notFound();
  const replacementId = typeof sp.replacement === "string" && view.replacements.some(row => row.id === sp.replacement) ? sp.replacement : undefined;
  return <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 px-4">
    <SwapVendorJob key={`swap:${id}:${view.scope ?? "global"}:${replacementId ?? ""}`} view={view} replacementId={replacementId} />
  </div>;
}
