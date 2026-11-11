"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { InboxDetail, InboxList } from "@/lib/catering/inbox";
import { INBOX_GROUPS, type InboxGroup } from "@/lib/catering/inbox-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { etCalendarDate } from "@/lib/operational-day";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";

const control = "inline-flex min-h-11 min-w-11 items-center justify-center rounded border px-3 py-2 text-sm";
export function InboxPane({ initial }: { initial: InboxList }) {
  const { t, language } = useTranslation();
  const [inbox, setInbox] = useState(initial);
  const [openGroups, setOpenGroups] = useState<InboxGroup[]>(["needs_reply", "drafted"]);
  const [assignee, setAssignee] = useState("");
  const [detail, setDetail] = useState<InboxDetail | null>(null);
  const [assignedTo, setAssignedTo] = useState("");
  const [error, setError] = useState<"action_error" | "stale_revision" | "invalid_assignee" | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingAction = useRef<{ key: string; requestId: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (detail && !dialog.current?.open) { previousFocus.current = document.activeElement as HTMLElement; dialog.current?.showModal(); }
    else if (!detail) { dialog.current?.close(); previousFocus.current?.focus(); }
  }, [detail]);
  async function refresh() {
    const response = await fetch("/api/catering/inbox", { cache: "no-store" });
    if (!response.ok) throw new Error("load_failed");
    setInbox((await response.json()).inbox as InboxList);
  }
  async function open(id: string) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/catering/inbox/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("load_failed");
      const message = (await response.json()).message as InboxDetail;
      setDetail(message); setAssignedTo(message.assigned_to ?? "");
      return true;
    } catch { setError("action_error"); return false; } finally { setBusy(false); }
  }
  async function act(action: "handle" | "reassign") {
    if (!detail) return;
    setBusy(true); setError(null);
    const key = `${detail.id}:${detail.revision}:${action}:${assignedTo}`;
    if (pendingAction.current?.key !== key) pendingAction.current = { key, requestId: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/catering/inbox/${detail.id}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: detail.revision, requestId: pendingAction.current.requestId, ...(action === "reassign" ? { assignedTo: assignedTo || null } : {}) }),
      });
      if (!response.ok) {
        const failure = await response.json();
        if (failure.code === "stale_revision") {
          pendingAction.current = null;
          await refresh();
          if (await open(detail.id)) setError("stale_revision");
          return;
        }
        if (failure.code === "invalid_assignee") { setError("invalid_assignee"); return; }
        throw new Error("action_failed");
      }
      await refresh(); await open(detail.id); pendingAction.current = null;
    } catch { setError("action_error"); } finally { setBusy(false); }
  }
  const rows = inbox.messages.filter(m => !assignee || (assignee === "unassigned" ? !m.assigned_to : m.assigned_to === assignee));
  return <>
    <h1 className="text-xl font-bold">{t("catering.inbox.title")}</h1>
    {inbox.mode !== "live" && <p role="status" className="my-3 rounded border p-3">{t("catering.inbox.drafts_not_sent")}</p>}
    {error && <p role="alert">{t(`catering.inbox.${error}`)}</p>}
    <div className="my-4 flex flex-wrap items-center gap-2">
      <label className="flex max-w-full flex-wrap items-center gap-2">{t("catering.inbox.assignee")}
        <select aria-label={t("catering.inbox.aria.assignee")} className={`${control} max-w-full`} value={assignee} onChange={e => setAssignee(e.target.value)}>
          <option value="">{t("catering.inbox.all_assignees")}</option><option value="unassigned">{t("catering.inbox.unassigned")}</option>
          {inbox.assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <button className={control} aria-label={t("catering.inbox.aria.refresh")} disabled={busy} onClick={() => { setError(null); void refresh().catch(() => setError("action_error")); }}>{t("catering.inbox.action.retry")}</button>
    </div>
    <div role="group" aria-label={t("catering.inbox.aria.groups")}>
      {INBOX_GROUPS.map(group => {
        const messages = rows.filter(m => m.group === group);
        const expanded = openGroups.includes(group);
        if (group === "noise") return <section key={group} className="mb-3 rounded border p-3">
          <h2 className="flex min-h-11 items-center justify-between gap-2"><span>{t("catering.inbox.group.noise")}</span><span>{messages.length === 1 ? t("catering.inbox.count_one") : t("catering.inbox.count", { n: messages.length })}</span></h2>
        </section>;
        return <section key={group} className="mb-3 rounded border p-3">
          <h2><button className={`${control} w-full flex-wrap justify-between gap-2 text-left`} aria-expanded={expanded} aria-controls={expanded ? `inbox-${group}` : undefined} onClick={() => setOpenGroups(groups => expanded ? groups.filter(g => g !== group) : [...groups, group])}>
            <span>{t(`catering.inbox.group.${group}`)}</span><span>{messages.length === 1 ? t("catering.inbox.count_one") : t("catering.inbox.count", { n: messages.length })}</span>
          </button></h2>
          {expanded && <div id={`inbox-${group}`}>
            {messages.length === 0 && <p className="p-3">{t("catering.inbox.empty")}</p>}
            {messages.map(m => <button key={m.id} className="flex min-h-11 w-full flex-wrap items-center gap-2 border-b py-3 text-left" disabled={busy} aria-label={`${t("catering.inbox.action.open")}: ${m.subject || t("catering.inbox.no_subject")}`} onClick={() => void open(m.id)}>
              <span className="min-w-0 flex-1 break-words"><span className="block font-semibold">{m.subject || t("catering.inbox.no_subject")}</span><span className="block break-all">{m.sender_address}</span></span>
              <span className="text-sm">{m.reason && <span className="block">{t(`catering.inbox.reason.${m.reason}`)}</span>}{m.stale && <span className="block">{t("catering.inbox.stale")}</span>}{formatDateLabel(etCalendarDate(m.received_at), language)}</span>
            </button>)}
          </div>}
        </section>;
      })}
    </div>
    <dialog ref={dialog} aria-label={t("catering.inbox.aria.drawer")} onCancel={() => setDetail(null)} onClose={() => setDetail(null)} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded p-4 backdrop:bg-black/40">
      {detail && <>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="min-w-0 break-words font-bold">{detail.subject || t("catering.inbox.no_subject")}</h2><button autoFocus className={control} onClick={() => setDetail(null)}>{t("catering.inbox.action.close")}</button></div>
        {error && <p role="alert">{t(`catering.inbox.${error}`)}</p>}
        <p className="break-all">{detail.sender_address}</p>
        <p>{t("catering.inbox.assignee")}: {detail.assignees.find(a => a.id === detail.assigned_to)?.name ?? t("catering.inbox.unassigned")}</p>
        <p>{detail.classification && t(`catering.inbox.class.${detail.classification}`)} {detail.reason && t(`catering.inbox.reason.${detail.reason}`)}</p>
        {detail.identity_status && <p>{t(`catering.inbox.identity.${detail.identity_status}`)}</p>}
        {detail.transport_only && <p>{t("catering.inbox.fetch_pending")}</p>}
        <p className="my-4 whitespace-pre-wrap break-words">{detail.body_text || t("catering.inbox.no_body")}</p>
        {detail.body_from_html && <p>{t("catering.inbox.body_from_html")}</p>}{detail.body_truncated && <p>{t("catering.inbox.body_truncated")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {detail.catering_customer_id && <Link className={control} href={`/catering/customers#customer-${detail.catering_customer_id}`}>{t("catering.inbox.customer")}</Link>}
          {detail.lead_id && <Link className={control} href={`/catering/pipeline#lead-${detail.lead_id}`}>{t("catering.inbox.lead")}</Link>}
          {detail.quote_id && <Link className={control} href={`/catering/quotes/${detail.quote_id}`}>{t("catering.inbox.quote")}</Link>}
        </div>
        {detail.preview_text && <section className="my-4 rounded border p-3"><h3 className="font-semibold">{t("catering.inbox.draft_preview")}</h3><p className="whitespace-pre-wrap break-words">{detail.preview_text}</p></section>}
        {!detail.transport_only && detail.disposition !== "handled" && <div className="my-4 flex flex-wrap items-center gap-2">
          {detail.disposition !== "recorded" && <><label className="flex max-w-full flex-wrap items-center gap-2">{t("catering.inbox.assign_label")}<select className={`${control} max-w-full`} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}><option value="">{t("catering.inbox.unassigned")}</option>{detail.assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <button className={control} disabled={busy} onClick={() => void act("reassign")}>{t("catering.inbox.action.reassign")}</button></>}
          <button className={control} disabled={busy} onClick={() => void act("handle")}>{t("catering.inbox.action.handle")}</button>
        </div>}
        <h3 className="font-semibold">{t("catering.inbox.history")}</h3>
        <ol>{detail.events.map(event => <li key={event.id}>{t(`catering.inbox.event.${event.event_type}`)} · {formatDateLabel(etCalendarDate(event.created_at), language)} {formatTime(event.created_at, language)}</li>)}</ol>
      </>}
    </dialog>
  </>;
}
