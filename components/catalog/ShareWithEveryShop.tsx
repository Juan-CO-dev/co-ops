"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatCents } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { jobErrorKey } from "@/lib/catalog/jobs-shared";
import { shareConfirmation, shareProducerHref, type ShareKind, type SharePreview } from "@/lib/catalog/share-back-shared";

const control = "inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50";
type Props = { kind: ShareKind; id: string; canShare: boolean };
export function ShareWithEveryShop(props: Props) {
  return props.canShare ? <ShareBody key={`${props.kind}:${props.id}`} {...props} /> : null;
}
function ShareBody({ kind, id }: Props) {
  const { t } = useTranslation(); const router = useRouter();
  const { requestStepUp } = useStepUp(); const post = useStepUpPost();
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [skus, setSkus] = useState<string[]>([]), [items, setItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const alive = useRef(true), pending = useRef(false), version = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const url = `/api/admin/catalog/${kind}/${encodeURIComponent(id)}/share`;
  async function review() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null); setPreview(null); setSkus([]); setItems([]);
    const ticket = ++version.current;
    try {
      const result = await postJson(`${url}/preview`, {});
      if (!alive.current || ticket !== version.current) return;
      if (!result.ok) { setError(jobErrorKey(result.code)); return; }
      const p = result.data.preview as SharePreview | undefined;
      const target = p && (kind === "sku" && "skuId" in p ? p.skuId : kind === "recipe" && "recipeId" in p ? p.recipeId : kind === "menu-item" && "menuItemId" in p ? p.menuItemId : null);
      if (!p || target !== id || typeof p.ownerShopId !== "string" || typeof p.token !== "string") { setError(jobErrorKey("generic")); return; }
      setPreview(p);
    } finally { pending.current = false; if (alive.current && ticket === version.current) setBusy(false); }
  }
  async function save() {
    const body = preview && shareConfirmation(kind, preview, skus, items);
    if (!body || pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    const ticket = version.current;
    try {
      if (await requestStepUp("E") !== "ok" || !alive.current || ticket !== version.current) return;
      const result = await post(url, body);
      if (!alive.current || ticket !== version.current) return;
      // Any refusal/lost response needs a fresh review. Never replay a stale token.
      setPreview(null); setSkus([]); setItems([]);
      if (!result.ok) { setError(jobErrorKey(result.code)); return; }
      const acknowledged = kind === "sku" ? result.data.shared === true
        : Array.isArray(result.data.skuIds) && (kind === "recipe" ? Array.isArray(result.data.itemIds) : Array.isArray(result.data.recipeIds));
      if (!acknowledged) { setError(jobErrorKey("generic")); return; }
      setSaved(true); router.refresh();
    } catch { if (alive.current) { setPreview(null); setError(jobErrorKey("generic")); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const toggle = (values: string[], id: string, checked: boolean) => checked ? [...new Set([...values, id])] : values.filter(value => value !== id);
  return <section className="min-w-0 space-y-3" aria-label={t("catalog.jobs.share.title")} aria-busy={busy}>
    <h2 className="font-bold">{t("catalog.jobs.share.title")}</h2>
    {error && <p role="alert">{t(error)}</p>}
    {saved ? <p role="status">{t("catalog.jobs.share.success")}</p> : <>
      <button type="button" className={control} disabled={busy} onClick={() => void review()}>{t("catalog.jobs.share.preview")}</button>
      {preview && <>
        <SharePreviewPanel preview={preview} selectedSkus={skus} selectedItems={items} disabled={busy}
          onSku={(sku, checked) => { if (!pending.current) setSkus(toggle(skus, sku, checked)); }} onItem={(item, checked) => { if (!pending.current) setItems(toggle(items, item, checked)); }} />
        <button type="button" className={control} disabled={busy || !shareConfirmation(kind, preview, skus, items)} onClick={() => void save()}>{t("catalog.jobs.share.confirm")}</button>
      </>}
    </>}
  </section>;
}
export function SharePreviewPanel({ preview: p, selectedSkus, selectedItems, onSku, onItem, disabled }: {
  preview: SharePreview; selectedSkus: string[]; selectedItems: string[]; disabled: boolean;
  onSku: (id: string, checked: boolean) => void; onItem: (id: string, checked: boolean) => void;
}) {
  const { t, language } = useTranslation();
  return <div className="min-w-0 space-y-3 break-words">
    <p className="font-bold">{p.name}</p><p>{t("catalog.jobs.share.owner", { shop: p.ownerShopName ?? "—" })}</p>
    {"usedIn" in p ? <>
      {p.ownerKeepsOwnPack && <p>{t("catalog.jobs.share.kept_pack")}</p>}
      {p.ownerKeepsOwnPrice && <p>{t("catalog.jobs.share.kept_price")}</p>}
      <h3>{t("catalog.jobs.share.used_in")}</h3><ul>{p.usedIn.map(row => <li key={row.id}>{row.name}</li>)}</ul>
    </> : <>
      {"recipes" in p && <>
        {p.nameEs && <p>{p.nameEs}</p>}
        <p>{t("catalog.jobs.share.menu_price", { price: p.price === null ? "—" : formatCents(Math.round(p.price * 100), language) })}</p>
        <h3>{t("catalog.jobs.share.producing_recipes")}</h3><ul>{p.recipes.map(recipe => <li key={recipe.id}>{recipe.name}</li>)}</ul>
      </>}
      {"makesSandwich" in p && p.makesSandwich && <Link className={control} href={`/admin/catalog/menu-item/${encodeURIComponent(p.makesSandwich.id)}?location=${encodeURIComponent(p.ownerShopId)}`}>{t("catalog.jobs.share.open_sandwich", { name: p.makesSandwich.name })}</Link>}
      <fieldset disabled={disabled} className="min-w-0 space-y-2"><legend>{t("catalog.jobs.share.dependencies")}</legend>
        {p.shopOnlySkus.map(row => <label key={`sku:${row.id}`} className="flex min-h-[44px] items-center gap-2"><input type="checkbox" aria-label={t("catalog.jobs.share.sku_dependency", { name: row.name })} value={row.id} checked={selectedSkus.includes(row.id)} onChange={e => onSku(row.id, e.target.checked)} />{t("catalog.jobs.share.sku_dependency", { name: row.name })}</label>)}
        {p.shopOnlyItems.map(row => <label key={`item:${row.id}`} className="flex min-h-[44px] items-center gap-2"><input type="checkbox" aria-label={t("catalog.jobs.share.item_dependency", { name: row.name })} value={row.id} checked={selectedItems.includes(row.id)} onChange={e => onItem(row.id, e.target.checked)} />{t("catalog.jobs.share.item_dependency", { name: row.name })}</label>)}
      </fieldset>
      {!!p.blockedBy.length && <div><h3>{t("catalog.jobs.share.blocked")}</h3><ul>{p.blockedBy.map(row => <li key={`${row.kind}:${row.id}`}>
        <p>{row.name}{row.shopName ? ` · ${row.shopName}` : ""}</p>
        {row.producers?.map(producer => <Link key={producer.id} className={control} href={shareProducerHref(producer)}>{t("catalog.jobs.share.open_recipe", { name: producer.name })}</Link>)}
      </li>)}</ul></div>}
    </>}
  </div>;
}
