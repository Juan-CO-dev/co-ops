"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { resolveErrorKey, ORDERING_METHODS } from "@/components/admin/vendors/shared";
import { PackSentenceEditor } from "@/components/catalog/PackSentenceEditor";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { SKU_CLASSES, type SkuClass } from "@/lib/admin/catalog-shared";
import { levelsFromSentence, type SentenceDraft, type SentenceError } from "@/lib/catalog/pack-sentence-shared";
import { createNewItemAttemptController, initialSetupState, jobErrorKey, setupReducer, canRetrySetupStep,
  type CreatedJobItem, type JobSetupResult, type NewItemJobView, type SetupStepState, type SetupEvent } from "@/lib/catalog/jobs-shared";
import type { SetupStep } from "@/lib/catalog/new-item-shared";
import { swapReturnHref } from "@/lib/catalog/swap-return-shared";

const field = "min-h-[44px] w-full min-w-0 rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50";
const button = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-text px-4 text-sm font-extrabold text-co-surface disabled:opacity-50";
const secondary = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50";
const label = "flex min-w-0 flex-col gap-1 text-sm font-bold text-co-text";
const asNumber = (value: string): number | null => value.trim() === "" ? null : Number(value);

export async function postNewItem(body: unknown, fetcher: typeof fetch = fetch): Promise<{ kind: "response"; data: Record<string, unknown> } | { kind: "refused"; code: string } | { kind: "uncertain" }> {
  try {
    const response = await fetcher("/api/admin/catalog/jobs/new-item", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
    if (response.status >= 500 || response.status >= 300 && response.status < 400) return { kind: "uncertain" };
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "uncertain" };
    if (response.ok) return { kind: "response", data: data as Record<string, unknown> };
    const code = (data as Record<string, unknown>).code;
    return { kind: "refused", code: typeof code === "string" ? code : "generic" };
  } catch { return { kind: "uncertain" }; }
}

/** Lock before the password dialog; state alone cannot stop two taps in the same render. */
function useJobLock() {
  const pending = useRef(false), alive = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(work: () => Promise<void>, failed: () => void) {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await work(); } catch { if (alive.current) failed(); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return { busy, run, alive };
}

export function NewItemJob({ view, readVersion, swapFrom }: { view: NewItemJobView; readVersion?: string; swapFrom?: string | null }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp, forgetStepUp } = useStepUp();
  const post = useStepUpPost();
  const lock = useJobLock();
  const [attempt] = useState(() => createNewItemAttemptController(undefined, view.scope));
  const [name, setName] = useState(""); const [itemNumber, setItemNumber] = useState("");
  const [vendorId, setVendorId] = useState(""); const [skuClass, setSkuClass] = useState<SkuClass>("raw");
  const [addedVendor, setAddedVendor] = useState<{ id: string; name: string } | null>(null);
  const vendors = addedVendor && !view.vendors.some(v => v.id === addedVendor.id) ? [...view.vendors, addedVendor] : view.vendors;
  const [pack, setPack] = useState<SentenceDraft>({ containers: [{ label: "", qty: "1" }], leafQty: "", leafUnit: "" });
  const [packError, setPackError] = useState<{ error: SentenceError; index: number } | null>(null);
  const [avgOz, setAvgOz] = useState(""); const [price, setPrice] = useState(""); const [priceDate, setPriceDate] = useState("");
  const [error, setError] = useState<TranslationKey | null>(null);
  const [created, setCreated] = useState<(CreatedJobItem & { vendorId: string }) | null>(null);
  const [showVendor, setShowVendor] = useState(false), [vendorUnknown, setVendorUnknown] = useState(false);
  const [vendorName, setVendorName] = useState(""); const [contactName, setContactName] = useState(""); const [ordering, setOrdering] = useState("");
  const [method, setMethod] = useState<string>("email");
  const [categoryId, setCategoryId] = useState(""); const [orderTypeId, setOrderTypeId] = useState("");
  const [readAtVendorFailure, setReadAtVendorFailure] = useState<string | undefined>();
  // A committed refresh clears the previous read's uncertainty before rendering controls.
  if (vendorUnknown && readVersion !== readAtVendorFailure) setVendorUnknown(false);

  async function submitCreate() {
    const built = levelsFromSentence(pack, new Set(view.measures.map(m => m.label)));
    if (!built.ok) { setPackError({ error: built.error, index: built.index }); return; }
    const fields = { scope: view.scope, vendorId: vendorId || null, name, itemNumber: itemNumber || null, levels: built.levels,
      avgOzPerEach: asNumber(avgOz), unitPrice: Number(price), priceDate, skuClass };
    await lock.run(async () => {
      if (await requestStepUp("E") !== "ok" || !lock.alive.current) return;
      setError(null); setPackError(null);
      const result = await postNewItem(attempt.request(fields));
      if (!lock.alive.current) return;
      if (result.kind === "uncertain") { attempt.uncertain(); setError("catalog.jobs.new_item.uncertain"); return; }
      if (result.kind === "refused") {
        if (result.code === "step_up_required" || result.code === "step_up_stale") forgetStepUp();
        setError(jobErrorKey(result.code)); return;
      }
      const state = attempt.readResponse(result.data);
      if (state.status !== "created") { setError("catalog.jobs.new_item.uncertain"); return; }
      setCreated({ ...state.item, vendorId: fields.vendorId ?? "" }); setError(null);
    }, () => { attempt.uncertain(); setError("catalog.jobs.new_item.uncertain"); });
  }
  async function addVendor() {
    const payload = { name: vendorName.trim(), categoryIds: [categoryId], orderTypeIds: [orderTypeId],
      firstContact: { name: contactName.trim(), email: null, phone: null }, firstOrdering: { method, value: ordering.trim(), label: null } };
    await lock.run(async () => {
      if (await requestStepUp("B") !== "ok" || !lock.alive.current) return;
      const result = await post("/api/admin/vendors", payload);
      if (!lock.alive.current) return;
      if (!result.ok || typeof result.data.id !== "string") {
        if (result.ok || result.code === "generic") { setVendorUnknown(true); setReadAtVendorFailure(readVersion); setError("catalog.jobs.new_item.vendor_uncertain"); }
        else setError(resolveErrorKey(result.code));
        return;
      }
      setAddedVendor({ id: result.data.id, name: payload.name }); setVendorId(result.data.id); setShowVendor(false); setError(null); router.refresh();
    }, () => { setVendorUnknown(true); setReadAtVendorFailure(readVersion); setError("catalog.jobs.new_item.vendor_uncertain"); });
  }
  return <div className="flex w-full min-w-0 flex-col gap-4">
    <header><h1 className="text-2xl font-black text-co-text">{t("catalog.jobs.new_item.title")}</h1><p className="text-sm text-co-text-muted">{t("catalog.jobs.new_item.intro")}</p></header>
    {!created ? <fieldset disabled={lock.busy} className="flex min-w-0 flex-col gap-4 rounded-xl border-2 border-co-border bg-co-surface p-4" aria-busy={lock.busy}>
      <label className={label}>{t("catalog.jobs.new_item.shop")}<select aria-label={t("catalog.jobs.new_item.shop")} className={field} value={view.scope ?? "global"} disabled={attempt.getState().status !== "draft"} onChange={e => router.push(`/admin/catalog/new/item?location=${encodeURIComponent(e.target.value)}`)}>{view.shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}{view.allowGlobal && <option value="global">{t("catalog.item.shop_global")}</option>}</select></label>
      <label className={label}>{t("catalog.jobs.new_item.vendor")}<select aria-label={t("catalog.jobs.new_item.vendor")} className={field} value={vendorId} onChange={e => setVendorId(e.target.value)}><option value="">{t("catalog.jobs.new_item.vendor_none")}</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <button className={secondary} type="button" onClick={() => setShowVendor(!showVendor)} aria-expanded={showVendor}>{t("catalog.jobs.new_item.vendor_add")}</button>
      {showVendor && <div className="flex min-w-0 flex-col gap-3 rounded-lg border-2 border-co-border p-3">
        <label className={label}>{t("catalog.jobs.new_item.vendor_name")}<input aria-label={t("catalog.jobs.new_item.vendor_name")} className={field} value={vendorName} onChange={e => setVendorName(e.target.value)} /></label>
        <label className={label}>{t("admin.vendors.field.categories")}<select aria-label={t("admin.vendors.field.categories")} className={field} value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">&mdash;</option>{view.categories.map(c => <option key={c.id} value={c.id}>{language === "es" ? c.labelEs ?? c.label : c.label}</option>)}</select></label>
        <label className={label}>{t("admin.vendors.field.order_types")}<select aria-label={t("admin.vendors.field.order_types")} className={field} value={orderTypeId} onChange={e => setOrderTypeId(e.target.value)}><option value="">&mdash;</option>{view.orderTypes.map(o => <option key={o.id} value={o.id}>{language === "es" ? o.labelEs ?? o.label : o.label}</option>)}</select></label>
        <label className={label}>{t("catalog.jobs.new_item.vendor_contact")}<input aria-label={t("catalog.jobs.new_item.vendor_contact")} className={field} value={contactName} onChange={e => setContactName(e.target.value)} /></label>
        <label className={label}>{t("catalog.jobs.new_item.vendor_method")}<select aria-label={t("catalog.jobs.new_item.vendor_method")} className={field} value={method} onChange={e => setMethod(e.target.value)}>{ORDERING_METHODS.map(m => <option key={m} value={m}>{t(`admin.vendors.ordering.method.${m}`)}</option>)}</select></label>
        <label className={label}>{t("catalog.jobs.new_item.vendor_ordering")}<input aria-label={t("catalog.jobs.new_item.vendor_ordering")} className={field} value={ordering} onChange={e => setOrdering(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={vendorUnknown || !vendorName.trim() || !categoryId || !orderTypeId || !contactName.trim() || !ordering.trim()} onClick={addVendor}>{t("catalog.jobs.new_item.vendor_save")}</button><button className={secondary} type="button" onClick={() => setShowVendor(false)}>{t("catalog.jobs.new_item.vendor_cancel")}</button></div>
        {vendorUnknown && <><Link className={secondary} href="/admin/vendors">{t("catalog.jobs.new_item.vendor_add")}</Link><button className={secondary} type="button" onClick={() => router.refresh()}>{t("catalog.jobs.new_item.setup.refresh")}</button></>}
      </div>}
      <label className={label}>{t("catalog.jobs.new_item.name")}<input aria-label={t("catalog.jobs.new_item.name")} className={field} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className={label}>{t("catalog.jobs.new_item.number")}<input aria-label={t("catalog.jobs.new_item.number")} className={field} value={itemNumber} onChange={e => setItemNumber(e.target.value)} /></label>
      <label className={label}>{t("catalog.jobs.new_item.class")}<select aria-label={t("catalog.jobs.new_item.class")} className={field} value={skuClass} onChange={e => setSkuClass(e.target.value as SkuClass)}>{SKU_CLASSES.map(c => <option key={c} value={c}>{t(`admin.skus.sku_class.${c}`)}</option>)}</select></label>
      <PackSentenceEditor draft={pack} onChange={setPack} units={view.measures} skuClass={skuClass} currentLeafUnit={null} avgOzPerEach={asNumber(avgOz)} error={packError} busy={lock.busy} />
      <label className={label}>{t("catalog.jobs.new_item.avg_weight")}<input aria-label={t("catalog.jobs.new_item.avg_weight")} className={field} inputMode="decimal" value={avgOz} onChange={e => setAvgOz(e.target.value)} /></label>
      <label className={label}>{t("catalog.jobs.new_item.price")}<input aria-label={t("catalog.jobs.new_item.price")} className={field} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></label>
      <label className={label}>{t("catalog.jobs.new_item.price_date")}<input aria-label={t("catalog.jobs.new_item.price_date")} className={field} type="date" value={priceDate} onChange={e => setPriceDate(e.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-co-cta-text">{t(error)}</p>}
      <section className="min-w-0 rounded-lg border-2 border-co-border p-3" aria-label={t("catalog.jobs.new_item.summary")}>
        <h2 className="font-extrabold">{t("catalog.jobs.new_item.summary")}</h2>
        <dl className="grid grid-cols-1 gap-2 break-words text-sm">
          {([
            [t("catalog.jobs.new_item.class"), t(`admin.skus.sku_class.${skuClass}`)],
            [t("catalog.jobs.new_item.vendor"), vendors.find(v => v.id === vendorId)?.name ?? t("catalog.jobs.new_item.vendor_none")],
            [t("catalog.jobs.new_item.name"), name || "\u2014"],
            [t("catalog.jobs.new_item.number"), itemNumber || "\u2014"],
            [t("catalog.jobs.new_item.arrives"), [...pack.containers.map(c => `${c.qty} ${c.label}`.trim()), `${pack.leafQty} ${pack.leafUnit}`.trim()].filter(Boolean).join(" / ") || "\u2014"],
            [t("catalog.jobs.new_item.price"), price || "\u2014"],
            [t("catalog.jobs.new_item.shop"), view.scope === null ? t("catalog.item.shop_global") : view.shops.find(shop => shop.id === view.scope)?.name ?? "\u2014"],
          ] as const).map(([heading, value]) => <div key={heading}><dt className="font-bold">{heading}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>
      <button className={button} type="button" disabled={lock.busy || !name.trim() || !price || !priceDate} onClick={submitCreate}>{t("catalog.jobs.new_item.create")}</button>
      <p className="text-sm text-co-text-muted">{t("catalog.jobs.new_item.setup.title")}: {(["par", "order_days", "guide_line", "use_in", "barcode"] as const).map(k => t(`catalog.jobs.new_item.setup.${k}`)).join(" / ")}</p>
    </fieldset> : <NewItemCreated view={view} readVersion={readVersion} created={created} swapFrom={swapFrom} />}
  </div>;
}

/** The same post-create surface is rendered by the job and the server-render tests. */
export function NewItemCreated({ view, readVersion, created, swapFrom }: { view: NewItemJobView; readVersion?: string; created: CreatedJobItem & { vendorId: string }; swapFrom?: string | null }) {
  const { t } = useTranslation();
  const [setupShopId, setSetupShopId] = useState(created.ownerLocationId ?? view.scope ?? view.shops[0]?.id ?? "");
  const shops = view.shops.filter(s => !created.ownerLocationId || s.id === created.ownerLocationId);
  return <>
      <p role="status">{t(created.replayed ? "catalog.jobs.new_item.replayed" : "catalog.jobs.new_item.created")}</p>
      {swapFrom && <Link className={secondary} href={swapReturnHref(swapFrom, view.scope, created.skuId)}>{t("catalog.jobs.swap.return")}</Link>}
      <Link className={secondary} href={`/admin/catalog/sku/${encodeURIComponent(created.skuId)}?location=${encodeURIComponent(created.ownerLocationId ?? "global")}`}>{t("catalog.jobs.new_item.open")}</Link>
      {!created.replayed && <><h2 className="text-xl font-black">{t("catalog.jobs.new_item.setup.title")}</h2><p>{t("catalog.jobs.new_item.setup.saved")} {t("catalog.jobs.new_item.setup.resume")}</p>
        <label className={label}>{t("catalog.jobs.new_item.shop")}<select aria-label={t("catalog.jobs.new_item.shop")} className={field} value={setupShopId} onChange={e => setSetupShopId(e.target.value)}>{shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {shops.map(shop => <div key={shop.id} hidden={shop.id !== setupShopId}><SetupPanel view={view} readVersion={readVersion} shopId={shop.id} item={created} /></div>)}
      </>}
  </>;
}

/** A stable component identity preserves focus while typing; each shop has its own durable outcome ledger. */
function SetupStepCard({ kind, state, disabled, busy, children, save, skip, refresh }: {
  kind: SetupStep["kind"]; state: SetupStepState; disabled: boolean; busy: boolean; children: ReactNode;
  save: () => void; skip: () => void; refresh: () => void;
}) {
  const { t } = useTranslation();
  const stateKey = state.status === "saved" ? "saved" : state.status === "skipped" ? "skipped" : state.status === "unconfirmed" ? "unconfirmed" : "incomplete";
  return <section className="min-w-0 rounded-xl border-2 border-co-border bg-co-surface p-4">
    <h3 className="font-extrabold">{t(`catalog.jobs.new_item.setup.${kind}`)}</h3>
    <p role="status">{t(`catalog.jobs.setup.${stateKey}`)}</p>
    {state.errorKey && <p role="alert">{t(state.errorKey)}</p>}
    {Object.values(state.days).map(day => day && <p key={day.orderDow} aria-label={t("catalog.jobs.setup.day_result_aria", { day: t(`catalog.jobs.new_item.setup.day.${day.orderDow}` as TranslationKey), result: t(day.ok ? "catalog.jobs.setup.saved" : "catalog.jobs.setup.incomplete") })}>
      {t(`catalog.jobs.new_item.setup.day.${day.orderDow}` as TranslationKey)}: {t(day.ok ? "catalog.jobs.setup.saved" : jobErrorKey(day.code))}
    </p>)}
    {disabled ? <p>{t("catalog.jobs.new_item.setup.vendor_needed")}</p> : children}
    <div className="mt-3 flex flex-wrap gap-2">
      {!canRetrySetupStep(state) ? <button className={secondary} type="button" disabled={busy} onClick={refresh}>{t("catalog.jobs.new_item.setup.refresh")}</button>
        : state.status !== "saved" && <button className={button} type="button" disabled={busy || disabled} onClick={save}>{t(state.status === "skipped" ? "catalog.jobs.new_item.setup.resume_step" : "catalog.jobs.new_item.setup.save")}</button>}
      {state.status !== "saved" && <button className={secondary} type="button" disabled={busy} onClick={skip}>{t("catalog.jobs.new_item.setup.skip")}</button>}
    </div>
  </section>;
}

function SetupPanel({ view, readVersion, shopId, item }: { view: NewItemJobView; readVersion?: string; shopId: string; item: CreatedJobItem & { vendorId: string } }) {
  const { t } = useTranslation(); const router = useRouter();
  const { requestStepUp } = useStepUp(); const post = useStepUpPost(); const lock = useJobLock();
  const [setup, setSetup] = useState(initialSetupState);
  const dispatch = (event: SetupEvent) => setSetup(previous => setupReducer(previous, event));
  const refreshing = useRef<{ kind: SetupStep["kind"]; version: string | undefined } | null>(null);
  useEffect(() => {
    const request = refreshing.current;
    if (request && readVersion !== request.version) {
      dispatch({ kind: "refreshed", step: request.kind });
      if (request.kind === "order_days") {
        const rhythm = view.setupShops.find(s => s.shopId === shopId)?.rhythm ?? [];
        const outcomes = Object.values(setup.order_days.days).flatMap(day => {
          if (!day || day.ok) return [];
          const pair = rhythm.find(r => r.vendorId === item.vendorId && r.orderDow === day.orderDow && r.leadDays === day.leadDays);
          return pair ? [{ orderDow: day.orderDow, leadDays: day.leadDays, ok: true, pairId: pair.id }] : [];
        });
        if (outcomes.length) dispatch({ kind: "result", result: { step: "order_days", ok: true, detail: { outcomes } } });
      }
      refreshing.current = null;
    }
  }, [readVersion, item.vendorId, setup.order_days.days, shopId, view.setupShops]);
  const [weekdayPar, setWeekdayPar] = useState(""); const [weekendPar, setWeekendPar] = useState("");
  const [days, setDays] = useState<number[]>([]); const [leadDays, setLeadDays] = useState("1");
  const [sectionId, setSectionId] = useState(""); const [newSection, setNewSection] = useState("");
  const [recipeId, setRecipeId] = useState(""); const [quantity, setQuantity] = useState("1"); const [unit, setUnit] = useState(view.measures[0]?.label ?? "");
  const [barcode, setBarcode] = useState(""); const [barcodeLevel, setBarcodeLevel] = useState<"case" | "inner">("case");
  const recipes = view.setupShops.find(s => s.shopId === shopId)?.recipes ?? [];
  const sections = view.guides.filter(g => g.vendorId === item.vendorId).flatMap(g => g.sections);
  async function save(step: SetupStep) {
    if (step.kind === "barcode" && step.code.trim().length < 6) { dispatch({ kind: "failed", step: "barcode", code: "invalid_barcode", uncertain: false }); return; }
    if (!canRetrySetupStep(setup[step.kind]) || setup[step.kind].status === "saved") return;
    await lock.run(async () => {
      if (await requestStepUp("E") !== "ok" || !lock.alive.current) return;
      const result = await post(`/api/admin/catalog/sku/${encodeURIComponent(item.skuId)}/setup`, { shopId, step });
      if (!lock.alive.current) return;
      if (!result.ok) {
        dispatch({ kind: "failed", step: step.kind, code: result.code,
          uncertain: result.code === "generic" || ["version_changed", "snapshot_changed", "guide_stale", "section_not_found", "foreign_section"].includes(result.code) }); return;
      }
      const data = result.data as unknown as JobSetupResult;
      if (data.step !== step.kind || typeof data.ok !== "boolean" || !data.detail || typeof data.detail !== "object" || Array.isArray(data.detail)) {
        dispatch({ kind: "failed", step: step.kind, code: "generic", uncertain: true }); return;
      }
      dispatch({ kind: "result", result: data });
    }, () => dispatch({ kind: "failed", step: step.kind, code: "generic", uncertain: true }));
  }
  const card = (kind: SetupStep["kind"], children: ReactNode, action: () => void, vendorNeeded = false) =>
    <SetupStepCard kind={kind} state={setup[kind]} disabled={vendorNeeded && !item.vendorId} busy={lock.busy} save={action}
      skip={() => dispatch({ kind: "skip", step: kind })}
      refresh={() => { refreshing.current = { kind, version: readVersion }; router.refresh(); }}>{children}</SetupStepCard>;
  return <fieldset disabled={lock.busy} className="flex min-w-0 flex-col gap-4" aria-busy={lock.busy}>
    {card("par", <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><label className={label}>{t("catalog.jobs.new_item.setup.weekday_par")}<input aria-label={t("catalog.jobs.new_item.setup.weekday_par")} className={field} inputMode="decimal" value={weekdayPar} onChange={e => setWeekdayPar(e.target.value)} /></label><label className={label}>{t("catalog.jobs.new_item.setup.weekend_par")}<input aria-label={t("catalog.jobs.new_item.setup.weekend_par")} className={field} inputMode="decimal" value={weekendPar} onChange={e => setWeekendPar(e.target.value)} /></label></div>, () => void save({ kind: "par", weekdayPar: asNumber(weekdayPar), weekendPar: asNumber(weekendPar) }))}
    {card("order_days", <><div className="flex flex-wrap gap-2">{[0,1,2,3,4,5,6].map(day => <label key={day} className="inline-flex min-h-[44px] items-center gap-2"><input aria-label={t(`catalog.jobs.new_item.setup.day.${day}` as TranslationKey)} type="checkbox" className="h-5 w-5" checked={days.includes(day)} onChange={e => setDays(previous => e.target.checked ? [...previous, day] : previous.filter(d => d !== day))} />{t(`catalog.jobs.new_item.setup.day.${day}` as TranslationKey)}</label>)}</div><label className={label}>{t("catalog.jobs.new_item.setup.lead")}<input aria-label={t("catalog.jobs.new_item.setup.lead")} className={field} inputMode="numeric" value={leadDays} onChange={e => setLeadDays(e.target.value)} /></label></>, () => void save({ kind: "order_days", days: days.filter(day => !setup.order_days.days[day]?.ok).map(day => ({ orderDow: day, leadDays: Number(leadDays) })) }), true)}
    {card("guide_line", <><label className={label}>{t("catalog.jobs.new_item.setup.section")}<select aria-label={t("catalog.jobs.new_item.setup.section")} className={field} value={sectionId} onChange={e => { setSectionId(e.target.value); setNewSection(""); }}><option value="">&mdash;</option>{sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className={label}>{t("catalog.jobs.new_item.setup.new_section")}<input aria-label={t("catalog.jobs.new_item.setup.new_section")} className={field} value={newSection} onChange={e => { setNewSection(e.target.value); setSectionId(""); }} /></label></>, () => void save({ kind: "guide_line", sectionId: sectionId || null, newSectionName: newSection.trim() || null }), true)}
    {card("use_in", <><label className={label}>{t("catalog.jobs.new_item.setup.recipe")}<select aria-label={t("catalog.jobs.new_item.setup.recipe")} className={field} value={recipeId} onChange={e => setRecipeId(e.target.value)}><option value="">&mdash;</option>{recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label className={label}>{t("catalog.jobs.new_item.setup.quantity")}<input aria-label={t("catalog.jobs.new_item.setup.quantity")} className={field} inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} /></label><label className={label}>{t("catalog.jobs.new_item.setup.unit")}<select aria-label={t("catalog.jobs.new_item.setup.unit")} className={field} value={unit} onChange={e => setUnit(e.target.value)}>{view.measures.map(m => <option key={m.label} value={m.label}>{m.label}</option>)}</select></label></>, () => { const r = recipes.find(r => r.id === recipeId); if (r) void save({ kind: "use_in", recipeId, quantity: Number(quantity), unit, expectedVersionId: r.activeVersionId, basedOnVersionId: r.basedOnVersionId }); })}
    {card("barcode", <><label className={label}>{t("catalog.jobs.new_item.setup.code")}<input aria-label={t("catalog.jobs.new_item.setup.code")} className={field} inputMode="numeric" minLength={6} value={barcode} onChange={e => setBarcode(e.target.value)} /></label><label className={label}>{t("catalog.jobs.new_item.setup.level")}<select aria-label={t("catalog.jobs.new_item.setup.level")} className={field} value={barcodeLevel} onChange={e => setBarcodeLevel(e.target.value as "case" | "inner")}><option value="case">{t("catalog.jobs.new_item.setup.case")}</option><option value="inner">{t("catalog.jobs.new_item.setup.inner")}</option></select></label></>, () => void save({ kind: "barcode", code: barcode, level: barcodeLevel }), true)}
    <Link className={secondary} href={`/admin/catalog/sku/${encodeURIComponent(item.skuId)}?location=${encodeURIComponent(shopId)}#ordering`}>{t("catalog.jobs.new_item.setup.ordering")}</Link>
  </fieldset>;
}
