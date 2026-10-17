"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { menuErrorKey, recipeItemHref, type MenuItemPageView, type MenuChangeRequest } from "@/lib/catalog/recipe-item-shared";
import type { MenuPreview } from "@/lib/catalog/recipe-preview-shared";
import { MenuPreviewPanel } from "@/components/catalog/MenuPreviewPanel";
import { ShareWithEveryShop } from "@/components/catalog/ShareWithEveryShop";
import { ToastLinkSection } from "@/components/catalog/ToastLinkSection";

const control = "min-h-[44px] max-w-full rounded-lg border-2 border-co-border px-3 py-2 text-sm font-bold disabled:opacity-50";

/** Own identity uses its default price; ownership is separate from the immutable edit baseline. */
export function OwnedSandwichClient({ view }: { view: MenuItemPageView }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const [baseline, setBaseline] = useState(view.item.menuPrice);
  const [price, setPrice] = useState(view.item.menuPrice === null ? "" : String(view.item.menuPrice));
  const [preview, setPreview] = useState<{ value: MenuPreview; change: MenuChangeRequest } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const alive = useRef(true), ticket = useRef(0), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const owner = view.owner;
  if (!owner) return null;
  const stale = baseline !== view.item.menuPrice;
  const url = `/api/admin/catalog/menu-item/${encodeURIComponent(view.item.id)}`;
  function rebase() {
    ticket.current++; setPreview(null); setBaseline(view.item.menuPrice);
    setPrice(view.item.menuPrice === null ? "" : String(view.item.menuPrice)); setError(null);
  }
  async function review() {
    if (!owner || pending.current || stale || !view.can.editOwned) return;
    pending.current = true; setBusy(true); setError(null); setPreview(null);
    const mine = ++ticket.current;
    const change: MenuChangeRequest = { kind: "owned_price", expectedOwner: owner.locationId, expectedPrice: baseline, price: price.trim() === "" ? null : Number(price) };
    try {
      const result = await postJson(`${url}/preview`, { change });
      if (!alive.current || mine !== ticket.current) return;
      if (!result.ok) { setError(result.code); router.refresh(); return; }
      const value = result.data.preview as MenuPreview | undefined;
      if (!value || value.kind !== "owned_price" || value.menuItemId !== view.item.id || value.shopId !== owner.locationId) { setError("invalid_payload"); return; }
      setPreview({ value, change });
    } catch { if (alive.current && mine === ticket.current) setError("generic"); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function save() {
    if (!preview || pending.current || stale || !view.can.editOwned) return;
    pending.current = true; setBusy(true); setError(null);
    const mine = ticket.current;
    try {
      if (await requestStepUp("E") !== "ok" || !alive.current || mine !== ticket.current) return;
      const result = await post(`${url}/apply`, { change: preview.change, previewToken: preview.value.token });
      if (!alive.current || mine !== ticket.current) return;
      setPreview(null);
      if (!result.ok) setError(result.code);
      // Refresh never silently replaces the captured baseline. Rebase is explicit after any committed move.
      router.refresh();
    } catch { if (alive.current) { setPreview(null); setError("generic"); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="flex min-w-0 flex-col gap-4 break-words">
    <p>{t("catalog.only_at_shop", { shop: owner.name })}</p>
    <p>{view.cost === null ? t("catalog.menu.cost_unknown") : t("catalog.menu.cost", { cost: formatCents(Math.round(view.cost * 100), language) })}</p>
    {view.recipe ? <Link className={control} href={recipeItemHref(view.recipe.id, { shopId: owner.locationId })}>{t("catalog.menu.recipe")}: {view.recipe.name}</Link> : <p>{t("catalog.menu.recipe_none")}</p>}
    {view.can.editOwned ? <section className="flex min-w-0 flex-col gap-3" aria-busy={busy}>
      <label>{t("catalog.menu.price_here")}<input aria-label={t("catalog.menu.price_here")} className={`${control} mt-1 w-full`} type="number" min="0.01" max="1000" step="0.01" value={price} disabled={busy}
        onChange={event => { ticket.current++; setPrice(event.target.value); setPreview(null); }} /></label>
      {error && <p role="alert">{t(menuErrorKey(error))}</p>}
      {stale ? <button type="button" className={control} disabled={busy} onClick={rebase}>{t("catalog.menu.edit_rebase")}</button>
        : <button type="button" className={control} disabled={busy} onClick={() => void review()}>{t("catalog.menu.preview.title")}</button>}
      {preview && !stale && <MenuPreviewPanel preview={preview.value} saveLabel={t("catalog.menu.preview.save_shop", { shop: owner.name })} busy={busy} onSave={() => void save()} onDiscard={() => { ticket.current++; setPreview(null); }} />}
      <ToastLinkSection menuItemId={view.item.id} shopId={owner.locationId} />
    </section> : <p>{t("catalog.menu.price_here")}: {view.item.menuPrice === null ? "—" : formatCents(Math.round(view.item.menuPrice * 100), language)}</p>}
    <ShareWithEveryShop kind="menu-item" id={view.item.id} canShare={view.can.share === true} />
  </div>;
}
