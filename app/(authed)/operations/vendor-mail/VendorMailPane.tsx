"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { getVendorMailMessage, listVendorMail } from "@/lib/vendor-mail";
import type { vendorMailOptions } from "@/lib/vendor-mail-options";
import { VENDOR_MAIL_STATUSES, vendorMailForwardAcknowledged, vendorMailHasUnknownForward } from "@/lib/vendor-mail-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatDateLabel, formatTime, formatCents, formatQuantity } from "@/lib/i18n/format";
import { etDisplayDate } from "@/lib/operational-day";
import type { TranslationKey } from "@/lib/i18n/types";

type Detail = Awaited<ReturnType<typeof getVendorMailMessage>>;
type Options = Awaited<ReturnType<typeof vendorMailOptions>>;
type Filters = { location: string; vendor: string; status: string; from: string; to: string; search: string; stale: boolean };
/** A confirmed refusal has no committed mutation. Uncertain failures retain the original key. */
export function releaseRefusedVendorMailRequest<T>(requests: Map<string, T>, identity: string, _action: string, code: unknown): void {
  if (code === "stale_revision") requests.delete(identity);
}
const control = "flex min-h-[44px] items-center rounded border border-co-border bg-co-surface px-3 py-2 max-w-full";
const field = "flex min-w-0 flex-col gap-1 text-sm";

export function VendorMailPane({ initial, options, filters, forwardEnabled, level }: { initial: Awaited<ReturnType<typeof listVendorMail>>; options: Options; filters: Filters; forwardEnabled: boolean; level: number }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("");
  const drafts = useRef(new Map<string, { reason: string; location: string; vendor: string; recipient: string; staff: string; note: string }>());
  const emptyDraft = { reason: "", location: "", vendor: "", recipient: "", staff: "", note: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const requests = useRef(new Map<string, { requestId: string; revision: number }>());
  const [isOpen, setIsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const date = (iso: string) => `${formatDateLabel(etDisplayDate(iso), language)} · ${formatTime(iso, language)}`;
  const name = (items: { id: string; name: string }[], id: string | null) => items.find(item => item.id === id)?.name ?? t("vendorMail.unknown");
  const label = (key: string) => t(`vendorMail.${key}` as TranslationKey);
  function showError(code: string) {
    const key = `vendorMail.error.${code}` as TranslationKey;
    const translated = t(key);
    setError(translated === key ? t("vendorMail.error.internal_error") : translated);
  }
  async function read(id: string) {
    const response = await fetch(`/api/operations/vendor-mail/${id}`, { cache: "no-store", redirect: "error" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.code ?? "read_failed");
    return data.message as Detail;
  }
  async function open(id: string, target: HTMLElement) {
    opener.current = target;
    setError(""); setNotice(""); setAction(""); setBusy(true);
    try {
      const message = await read(id);
      setDetail(message);
      setDraft(drafts.current.get(id) ?? { ...emptyDraft, location: message.location_id ?? "", vendor: message.vendor_id ?? "" });
      dialog.current?.showModal(); setIsOpen(true);
    } catch (e) { showError(e instanceof Error ? e.message : "read_failed"); }
    finally { setBusy(false); }
  }
  function edit(key: keyof typeof draft, value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (detail) drafts.current.set(detail.id, next);
  }
  async function submit() {
    if (!detail || busy) return;
    const payload = action === "handle" ? { reason: draft.reason } : action === "assign" ? { location_id: draft.location || null, vendor_id: draft.vendor || null } : action === "forward" ? { ...(draft.staff ? { staff_id: draft.staff } : { recipient: draft.recipient }), note: draft.note } : {};
    // A failed/ambiguous network request retains its identity for an identical retry.
    const identity = JSON.stringify([detail.id, action, payload]);
    let request = requests.current.get(identity);
    if (action === "forward" && request && vendorMailForwardAcknowledged(detail.events, request.requestId)) {
      requests.current.delete(identity); request = undefined;
    }
    if (!request) { request = { requestId: crypto.randomUUID(), revision: detail.revision }; requests.current.set(identity, request); }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/operations/vendor-mail/${detail.id}/${action}`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: request.revision, request_id: request.requestId, ...payload }) });
      const data = await response.json();
      if (!response.ok) { releaseRefusedVendorMailRequest(requests.current, identity, action, data.code); throw new Error(data.code ?? "internal_error"); }
      setNotice(action === "forward" ? label(`forward.${["accepted", "failed", "unknown"].includes(data.result?.outcome) ? data.result.outcome : "unknown"}`) : t(data.result?.replayed ? "vendorMail.replayed" : "vendorMail.saved"));
      if (action !== "forward") requests.current.delete(identity);
      setDetail(await read(detail.id));
      router.refresh();
    } catch (e) { showError(e instanceof Error ? e.message : "internal_error"); }
    finally { setBusy(false); }
  }
  async function attachment(assetId: string) {
    if (!detail) return;
    setError("");
    try {
      const response = await fetch(`/api/operations/vendor-mail/${detail.id}/attachments/${assetId}`, { redirect: "error", cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code ?? "asset_unavailable");
      window.location.assign(data.asset.signed_url);
    } catch (e) { showError(e instanceof Error ? e.message : "asset_unavailable"); }
  }
  const picker = (items: { id: string; name: string }[]) => items.map(item => <option key={item.id} value={item.id}>{item.name}</option>);
  const parsedRoot = detail?.parsed_json && typeof detail.parsed_json === "object" ? detail.parsed_json as Record<string, unknown> : {};
  const parsed = parsedRoot.extraction && typeof parsedRoot.extraction === "object" ? parsedRoot.extraction as Record<string, unknown> : {};
  const parsedKeys = ["docKind", "poCode", "invoiceNumber", "shipTo", "vendorName", "accountNumber", "totalCents"].filter(key => parsed[key] !== undefined);
  const parsedLines = Array.isArray(parsed.lines) ? parsed.lines.filter((line): line is Record<string, unknown> => !!line && typeof line === "object") : [];
  const staffRecipient = options.staff.find(person => person.id === draft.staff);
  const eventData = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
  const unresolvedForward = detail ? vendorMailHasUnknownForward(detail.events) : false;
  function historyExtra(event: Detail["events"][number]) {
    const data = eventData(event.data);
    if (event.event_type === "forward_claim") return typeof data.recipient === "string" ? data.recipient : "";
    if (event.event_type !== "forward_result") return "";
    const claim = detail?.events.find(item => item.request_id === data.claim_request_id);
    const recipient = eventData(claim?.data).recipient;
    const outcome = ["accepted", "failed", "unknown"].includes(String(data.outcome)) ? String(data.outcome) : "unknown";
    return `${typeof recipient === "string" ? recipient : ""} — ${label(`forward.${outcome}`)}`;
  }
  return <>
    <h1 className="text-xl font-bold">{t("vendorMail.title")}</h1>
    <section className="my-4 rounded border border-co-border p-3" aria-label={t("vendorMail.breakdown")}>
      <h2 className="font-bold">{t("vendorMail.breakdown")}</h2>
      <p>{t("vendorMail.scope")}</p>
      <p>{t("vendorMail.total", { count: initial.reconciliation.total })} · <strong className={initial.reconciliation.stale_count ? "text-red-700" : ""}>{t("vendorMail.stale_count", { count: initial.reconciliation.stale_count })}</strong></p>
      <div className="flex flex-wrap gap-x-4">{Object.entries(initial.reconciliation.content_states).map(([state, count]) => <span key={state}>{label(`content.${state}`)}: {count}</span>)}</div>
    </section>
    <form className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={t("vendorMail.filters")}>
      <label className={field}>{t("vendorMail.shop")}<select aria-label={t("vendorMail.shop")} name="location" defaultValue={filters.location} className={control}><option value="all">{t("vendorMail.all_shops")}</option>{level >= 8 && <option value="unassigned">{t("vendorMail.unassigned")}</option>}{picker(options.shops)}</select></label>
      <label className={field}>{t("vendorMail.vendor")}<select aria-label={t("vendorMail.vendor")} name="vendor" defaultValue={filters.vendor} className={control}><option value="">{t("vendorMail.all")}</option>{picker(options.vendors)}</select></label>
      <label className={field}>{t("vendorMail.status")}<select aria-label={t("vendorMail.status")} name="status" defaultValue={filters.status} className={control}><option value="">{t("vendorMail.all")}</option>{VENDOR_MAIL_STATUSES.map(status => <option key={status} value={status}>{label(`status.${status}`)}</option>)}</select></label>
      <label className={field}>{t("vendorMail.from_date")}<input aria-label={t("vendorMail.from_date")} className={control} type="date" name="from" defaultValue={filters.from} /></label>
      <label className={field}>{t("vendorMail.to_date")}<input aria-label={t("vendorMail.to_date")} className={control} type="date" name="to" defaultValue={filters.to} /></label>
      <label className={field}>{t("vendorMail.search")}<input aria-label={t("vendorMail.search")} className={control} name="search" maxLength={200} defaultValue={filters.search} /></label>
      <label className={control}><input aria-label={t("vendorMail.stale_only")} type="checkbox" name="stale" value="1" defaultChecked={filters.stale} className="mr-2" />{t("vendorMail.stale_only")}</label>
      <button className={control} type="submit">{t("vendorMail.apply")}</button><a className={control} href="/operations/vendor-mail">{t("vendorMail.clear")}</a>
    </form>
    {!isOpen && error && <p role="alert" className="my-3 text-red-700">{error}</p>}
    <p className="my-3 text-sm">{t("vendorMail.sort")}</p>
    {initial.messages.length === 0 && <p>{t("vendorMail.empty")}</p>}
    <ul className="space-y-3">{initial.messages.map(message => <li key={message.id}><button type="button" disabled={busy} onClick={event => void open(message.id, event.currentTarget)} className="flex min-h-[44px] w-full flex-col items-center rounded border border-co-border p-3 text-left disabled:opacity-60">
      <span className="flex w-full flex-wrap items-center justify-between gap-2"><strong>{message.reference_code}</strong><span className="rounded bg-co-surface-inset px-2 py-1">{label(`status.${message.status}`)}</span></span>
      <span className="w-full break-words font-semibold">{message.subject || t("vendorMail.no_subject")}</span>
      <span className="w-full break-all">{t("vendorMail.from")}: {message.from_address || t("vendorMail.unknown")}</span>
      <span className="w-full">{date(message.received_at)}</span>
      <span className="w-full">{name(options.shops, message.location_id)} · {name(options.vendors, message.vendor_id)}</span>
      <span className="w-full">{message.attachment_count === null ? t("vendorMail.attachments_unknown") : t("vendorMail.attachments_count", { count: message.attachment_count })}</span>
      {message.stale && <strong className="w-full text-red-700">{t("vendorMail.stale")}</strong>}
      {message.failure_code && <span className="w-full text-red-700">{label(`failure.${message.failure_code}`)}</span>}
      {message.archive_state === "incomplete" && <span className="w-full text-red-700">{t("vendorMail.archive_incomplete")}</span>}
    </button></li>)}</ul>
    <dialog ref={dialog} aria-labelledby="vendor-mail-title" onClose={() => { setIsOpen(false); opener.current?.focus(); }} className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-xl overflow-y-auto bg-co-surface p-4 text-co-text backdrop:bg-black/40">
      {detail && <><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="vendor-mail-title" className="font-bold">{detail.reference_code}</h2><button type="button" className={control} onClick={() => dialog.current?.close()}>{t("vendorMail.close")}</button></div>
        <h3 className="my-2 break-words font-semibold">{detail.subject || t("vendorMail.no_subject")}</h3>
        {detail.stale && <p className="font-bold text-red-700">{t("vendorMail.stale")}</p>}
        {detail.failure_code && <p className="text-red-700">{label(`failure.${detail.failure_code}`)}</p>}
        {detail.archive_state !== "complete" && <p className="text-red-700">{t("vendorMail.archive_incomplete")}</p>}
        {unresolvedForward && <p role="alert" className="text-red-700">{t("vendorMail.forward.unknown")}</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}{notice && <p role="status">{notice}</p>}
        <p className="break-all">{detail.from_address} · {date(detail.received_at)}</p>
        <p>{t("vendorMail.disclosure")}</p>
        <CollapsibleSection idBase="vm-body" title={t("vendorMail.body")} count={t("vendorMail.count", { count: detail.body_state === "available" ? 1 : 0 })} defaultOpen>{detail.body_state === "available" ? <pre className="whitespace-pre-wrap break-words font-sans">{detail.body_text}</pre> : <p>{label(`body.${detail.body_state}`)}</p>}{detail.body_from_html && <p>{t("vendorMail.body.from_html")}</p>}{detail.body_truncated && <p>{t("vendorMail.body.truncated")}</p>}</CollapsibleSection>
        <CollapsibleSection idBase="vm-assets" title={t("vendorMail.attachments")} count={t("vendorMail.count", { count: detail.assets.length })}><ul>{detail.assets.map(asset => <li key={asset.id} className="flex flex-wrap items-center gap-2 break-all"><button type="button" className={control} disabled={!asset.available} onClick={() => void attachment(asset.id)}>{asset.filename}</button>{!asset.available && <span>{t("vendorMail.asset_missing")}</span>}</li>)}</ul><p>{t("vendorMail.asset_expiry")}</p></CollapsibleSection>
        <CollapsibleSection idBase="vm-parsed" title={t("vendorMail.parsed")} count={t("vendorMail.count", { count: parsedKeys.length })}><p>{t("vendorMail.extracted")}</p><dl>{parsedKeys.map(key => <div key={key}><dt className="font-bold">{label(`parsed.${key}`)}</dt><dd className="break-words">{typeof parsed[key] === "string" || typeof parsed[key] === "number" ? key === "totalCents" && typeof parsed[key] === "number" ? formatCents(parsed[key], language) : String(parsed[key]) : t("vendorMail.unknown")}</dd></div>)}</dl></CollapsibleSection>
        <CollapsibleSection idBase="vm-lines" title={t("vendorMail.lines")} count={t("vendorMail.count", { count: parsedLines.length })}>
          <ol className="space-y-3">{parsedLines.map((line, index) => <li key={index} className="break-words border-b border-co-border pb-2"><dl>{["description", "qty", "unit", "unitPriceCents", "extendedCents"].map(key => line[key] !== undefined && <div key={key}><dt className="font-semibold">{label(`line.${key}`)}</dt><dd>{typeof line[key] === "number" ? key.endsWith("Cents") ? formatCents(line[key], language) : formatQuantity(line[key], language) : typeof line[key] === "string" ? line[key] : t("vendorMail.unknown")}</dd></div>)}</dl></li>)}</ol>
        </CollapsibleSection>
        <div className="flex flex-wrap gap-2">{detail.linked_po_id && <a className={control} href={`/ordering?po=${detail.linked_po_id}&location=${detail.location_id ?? ""}`}>{t("vendorMail.po")}</a>}{detail.linked_delivery_id && <a className={control} href={`/operations/receiving/${detail.linked_delivery_id}`}>{t("vendorMail.delivery")}</a>}</div>
        <CollapsibleSection idBase="vm-history" title={t("vendorMail.history")} count={t("vendorMail.count", { count: detail.events.length })}><ol>{detail.events.map(event => <li key={event.id} className="my-2 break-words">{label(`event.${event.event_type}`)} · {event.actor_id ? name(options.staff, event.actor_id) : t("vendorMail.system")} · {date(event.created_at)} · {historyExtra(event)}</li>)}</ol></CollapsibleSection>
        <div className="flex flex-wrap gap-2">{["handle", "assign", "redrive"].map(kind => <button key={kind} type="button" className={control} onClick={() => { setAction(kind); setNotice(""); }}>{label(`action.${kind}`)}</button>)}{forwardEnabled ? <button type="button" className={control} onClick={() => setAction("forward")}>{t("vendorMail.action.forward")}</button> : level >= 8 && <button type="button" disabled className={control}>{t("vendorMail.forward.disabled")}</button>}</div>
        {action && <form className="mt-4 flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <h3 className="font-bold">{label(`action.${action}`)}</h3>
          {action === "handle" && <label className={field}>{t("vendorMail.reason")}<textarea aria-label={t("vendorMail.reason")} required maxLength={2000} className={control} value={draft.reason} onChange={event => edit("reason", event.target.value)} /></label>}
          {action === "assign" && <><label className={field}>{t("vendorMail.shop")}<select aria-label={t("vendorMail.shop")} className={control} value={draft.location} onChange={event => edit("location", event.target.value)}>{level >= 8 && <option value="">{t("vendorMail.unassigned")}</option>}{picker(options.shops)}</select></label><label className={field}>{t("vendorMail.vendor")}<select aria-label={t("vendorMail.vendor")} className={control} value={draft.vendor} onChange={event => edit("vendor", event.target.value)}><option value="">{t("vendorMail.unassigned")}</option>{picker(options.vendors)}</select></label></>}
          {action === "forward" && <><label className={field}>{t("vendorMail.forward.staff")}<select aria-label={t("vendorMail.forward.staff")} className={control} value={draft.staff} onChange={event => edit("staff", event.target.value)}><option value="">{t("vendorMail.forward.typed")}</option>{picker(options.staff.filter(person => person.active && person.email && (!detail.location_id || person.locations.includes(detail.location_id))))}</select></label>{!draft.staff && <label className={field}>{t("vendorMail.forward.recipient")}<input aria-label={t("vendorMail.forward.recipient")} className={control} type="email" required value={draft.recipient} onChange={event => edit("recipient", event.target.value)} /></label>}<label className={field}>{t("vendorMail.forward.note")}<textarea aria-label={t("vendorMail.forward.note")} className={control} maxLength={4000} value={draft.note} onChange={event => edit("note", event.target.value)} /></label><p>{t("vendorMail.forward.confirm", { recipient: draft.staff ? `${staffRecipient?.name ?? ""} <${staffRecipient?.email ?? ""}>` : draft.recipient })}</p><ul>{detail.assets.filter(asset => !asset.kind || asset.kind === "attachment").map(asset => <li key={asset.id} className="break-all">{asset.filename}{!asset.available ? ` · ${t("vendorMail.asset_missing")}` : ""}</li>)}</ul><p>{t("vendorMail.forward.cap")}</p></>}
          {action === "redrive" && <p>{t("vendorMail.redrive_note")}</p>}
          <button className={control} disabled={busy || (action === "forward" && unresolvedForward)} type="submit">{busy ? t("vendorMail.saving") : t(action === "forward" ? "vendorMail.forward.send" : "vendorMail.save")}</button>
        </form>}
      </>}
    </dialog>
  </>;
}
