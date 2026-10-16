"use client";
/**
 * /admin/sevenshifts (Scheduling Phase 1, Task 10). Phone-first (375 px, 44 px controls), disclosure
 * doctrine: the status line, the errors and the people summary always show; "Waiting to link", "Linked"
 * and "Recent syncs" are collapsed (useState only, via CollapsibleSection).
 *
 * R4: every 7shifts person shows with their employee id and roles; the manager PICKS the CO-OPS person
 * (nothing is suggested or pre-selected) and confirms in a sheet before anything is written. Link acts ask
 * for Tier B first (the /admin/toast-employees precedent); Sync now takes none. Sync health is shown here
 * only; nothing emails (R6). No wage figure is ever rendered — the line carries a COUNT.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { SEVENSHIFTS_LINK_ERROR_CODES, type RunSummary, type SyncPart, type WaitingPerson } from "@/lib/sevenshifts/links-shared";
import type { LinkScreen } from "@/lib/sevenshifts/links";

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text";
const quietButton = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 font-bold text-co-text";
const dangerButton = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-4 font-bold text-co-cta-text";
const control = "min-h-[44px] min-w-0 max-w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const fieldLabel = "grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";

type Pending =
  | { kind: "link_user"; person: WaitingPerson; userId: string; userName: string }
  | { kind: "unlink_user"; linkId: string; remote: string; person: string }
  | { kind: "unlink_shop"; linkId: string; shop: string; remote: string };

function errorKey(code: string | undefined): TranslationKey {
  return (SEVENSHIFTS_LINK_ERROR_CODES as readonly string[]).includes(code ?? "")
    ? (`sevenshifts.error.${code}` as TranslationKey) : "sevenshifts.error.generic";
}

export function SevenShiftsScreen({ screen }: { screen: LinkScreen }) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [shopPicks, setShopPicks] = useState<Record<string, string>>({});
  const disabled = busy || syncing || refreshing;

  async function send(payload: Record<string, string>, stepUp: boolean) {
    setBusy(true); setError(null);
    try {
      if (stepUp && await requestStepUp("B") !== "ok") return;
      const post = () => fetch("/api/admin/sevenshifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let response = await post();
      let body: { code?: string } = {};
      if (!response.ok) {
        body = await response.json().catch(() => ({})) as { code?: string };
        if (stepUp && (body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") {
          response = await post();
          if (!response.ok) body = await response.json().catch(() => ({})) as { code?: string };
        }
      }
      if (!response.ok || response.redirected) { setError(errorKey(body.code)); return; }
      setPending(null);
      startTransition(() => router.refresh());
    } catch { setError("sevenshifts.error.generic"); } finally { setBusy(false); }
  }
  async function syncNow() {
    setSyncing(true);
    try { await send({ action: "sync_now" }, false); } finally { setSyncing(false); }
  }

  const partNames = (parts: readonly SyncPart[]) => parts.map((p) => t(`sevenshifts.part.${p}` as TranslationKey)).join(", ");
  const at = (iso: string) => formatTime(iso, language);
  const runLine = (r: RunSummary) => {
    const trigger = t(r.trigger === "manual" ? "sevenshifts.trigger.manual" : "sevenshifts.trigger.cron");
    if (r.state === "running") return t("sevenshifts.recent.rowRunning", { time: at(r.startedAt), trigger });
    if (r.state === "interrupted") return t("sevenshifts.recent.rowInterrupted", { time: at(r.startedAt), trigger });
    const vars = { time: at(r.finishedAt ?? r.startedAt), trigger, ok: r.okParts, total: r.totalParts };
    return t(r.state === "failed" ? "sevenshifts.recent.rowFailed" : "sevenshifts.recent.row", vars);
  };

  // ── 1. the status line (always) ──
  const status: string[] = [];
  if (screen.state === "not_connected") status.push(t("sevenshifts.status.notConnected"));
  else if (screen.state === "sync_off") status.push(t("sevenshifts.status.syncOff"));
  else if (screen.state === "not_supported") status.push(t("sevenshifts.status.notSupported"));
  else {
    const latest = screen.recentRuns[0];
    const finished = screen.recentRuns.find((r) => r.finishedAt !== null);
    if (!latest) status.push(t("sevenshifts.status.neverRun"));
    else if (latest.state === "running") status.push(t("sevenshifts.status.running", { time: at(latest.startedAt) }));
    else if (latest.state === "interrupted") status.push(t("sevenshifts.status.interrupted", { time: at(latest.startedAt) }));
    if (finished) {
      const vars = { time: at(finished.finishedAt!), ok: finished.okParts, total: finished.totalParts };
      status.push(t(finished.state === "failed" ? "sevenshifts.status.lastRunFailed" : "sevenshifts.status.lastRun", vars));
      if (finished.planForbidden.length > 0) status.push(t("sevenshifts.status.planForbidden", { parts: partNames(finished.planForbidden) }));
    }
    status.push(t("sevenshifts.status.wages", { n: screen.wagesCount }));
  }
  const statusBlock = <section className="co-card min-w-0 space-y-1 p-4" role="status">
    {status.map((line, i) => <p key={i} className={i === 0 ? "font-bold text-co-text" : "text-sm text-co-text-muted"}>{line}</p>)}
  </section>;
  if (screen.state !== "ready") return <div className="space-y-4">{statusBlock}</div>;

  const remoteLabel = (p: { employeeId: string | null; remoteUserId: string }) => p.employeeId
    ? t("sevenshifts.people.employeeId", { id: p.employeeId }) : t("sevenshifts.people.noEmployeeId", { id: p.remoteUserId });
  const memberName = new Map(screen.members.map((m) => [m.id, m.name]));

  return <div className="space-y-4" aria-busy={disabled}>
    {statusBlock}
    {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}

    {pending && <section role="alertdialog" aria-labelledby="sevenshifts-confirm" className="co-card min-w-0 space-y-3 border-2 border-co-text p-4">
      <p id="sevenshifts-confirm" className="font-bold text-co-text">{pending.kind === "link_user"
        ? t("sevenshifts.people.confirm", { remote: pending.person.displayName, remoteId: remoteLabel(pending.person), person: pending.userName })
        : pending.kind === "unlink_user"
          ? t("sevenshifts.people.unlinkConfirm", { remote: pending.remote, person: pending.person })
          : t("sevenshifts.shops.unlinkConfirm", { shop: pending.shop, remote: pending.remote })}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={pending.kind === "link_user" ? button : dangerButton} disabled={disabled} onClick={() => void send(
          pending.kind === "link_user" ? { action: "link_user", locationId: screen.locationId, remoteUserId: pending.person.remoteUserId, userId: pending.userId }
            : pending.kind === "unlink_user" ? { action: "unlink_user", locationId: screen.locationId, linkId: pending.linkId }
              : { action: "unlink_shop", linkId: pending.linkId }, true)}>
          {t(pending.kind === "link_user" ? "sevenshifts.people.confirmYes" : "sevenshifts.people.unlinkYes")}
        </button>
        <button type="button" className={quietButton} disabled={disabled} onClick={() => setPending(null)}>{t("sevenshifts.cancel")}</button>
      </div>
    </section>}

    {/* ── 2. Shops (MoO+) ── */}
    {screen.can.manageShops && <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("sevenshifts.shops.title")}</h2>
      <p className="text-sm text-co-text-muted">{t("sevenshifts.shops.hint")}</p>
      <ul className="space-y-2">{screen.shops.map((shop) => <li key={shop.locationId} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-co-border p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-co-text">{shop.name}</p>
          <p className="text-sm text-co-text-muted">{shop.link ? t("sevenshifts.shops.linkedTo", { remote: shop.link.remoteName }) : t("sevenshifts.shops.notLinked")}</p>
        </div>
        {shop.link ? <button type="button" className={dangerButton} disabled={disabled}
          onClick={() => setPending({ kind: "unlink_shop", linkId: shop.link!.id, shop: shop.name, remote: shop.link!.remoteName })}>{t("sevenshifts.unlink")}</button>
          : screen.remoteLocations.length === 0 ? <p className="text-sm text-co-text-muted">{t("sevenshifts.shops.noneLeft")}</p>
            : <div className="flex min-w-0 flex-wrap items-end gap-2">
              <label className={fieldLabel}>{t("sevenshifts.shops.pick")}
                <select className={control} value={shopPicks[shop.locationId] ?? ""} disabled={disabled}
                  onChange={(e) => setShopPicks((p) => ({ ...p, [shop.locationId]: e.target.value }))}>
                  <option value="" disabled>{t("sevenshifts.shops.pick")}</option>
                  {screen.remoteLocations.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <button type="button" className={button} disabled={disabled || !shopPicks[shop.locationId]}
                onClick={() => void send({ action: "link_shop", locationId: shop.locationId, remoteLocationId: shopPicks[shop.locationId]! }, true)}>{t("sevenshifts.link")}</button>
            </div>}
      </li>)}</ul>
    </section>}

    {/* ── 3–4. People ── */}
    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("sevenshifts.people.title")}</h2>
      <p className="font-bold text-co-text">{t("sevenshifts.people.summary", { linked: screen.linked.length, waiting: screen.waiting.length })}</p>
      {!screen.shopLink && <p className="text-sm text-co-text-muted">{t("sevenshifts.people.needShopLink")}</p>}
    </section>
    {screen.shopLink && <CollapsibleSection idBase="sevenshifts-waiting" title={t("sevenshifts.people.waitingTitle")} count={String(screen.waiting.length)}>
      <div className="space-y-3 p-4">
        {screen.waiting.length === 0 && <p className="text-sm text-co-text-muted">{t("sevenshifts.people.allLinked")}</p>}
        {screen.waiting.length > 0 && screen.can.linkPeople && screen.members.length === 0 && <p className="text-sm text-co-text-muted">{t("sevenshifts.people.noMembers")}</p>}
        <ul className="space-y-3">{screen.waiting.map((person) => <li key={person.remoteUserId} className="min-w-0 space-y-2 rounded-xl border border-co-border p-3">
          <p className="font-bold text-co-text">{[person.displayName, remoteLabel(person), person.roles.join(", ")].filter(Boolean).join(" · ")}</p>
          {screen.can.linkPeople && screen.members.length > 0 && <div className="flex min-w-0 flex-wrap items-end gap-2">
            <label className={fieldLabel}>{t("sevenshifts.people.pick")}
              <select className={control} value={picks[person.remoteUserId] ?? ""} disabled={disabled}
                onChange={(e) => setPicks((p) => ({ ...p, [person.remoteUserId]: e.target.value }))}>
                <option value="" disabled>{t("sevenshifts.people.pick")}</option>
                {screen.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <button type="button" className={button} disabled={disabled || !picks[person.remoteUserId]} onClick={() => {
              const userId = picks[person.remoteUserId]!;
              setPending({ kind: "link_user", person, userId, userName: memberName.get(userId) ?? "" });
            }}>{t("sevenshifts.link")}</button>
          </div>}
        </li>)}</ul>
      </div>
    </CollapsibleSection>}
    <CollapsibleSection idBase="sevenshifts-linked" title={t("sevenshifts.people.linkedTitle")} count={String(screen.linked.length)}>
      <div className="space-y-3 p-4">
        {screen.linked.length === 0 && <p className="text-sm text-co-text-muted">{t("sevenshifts.people.noneLinked")}</p>}
        <ul className="space-y-2">{screen.linked.map((l) => <li key={l.linkId} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-co-border p-3">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-co-text">{t("sevenshifts.people.linkedRow", { remote: `${l.displayName} · ${remoteLabel(l)}`, person: l.userName })}</p>
            {!l.linkedHere && <p className="text-sm text-co-text-muted">{t("sevenshifts.people.linkedElsewhere")}</p>}
          </div>
          {screen.can.linkPeople && (l.linkedHere || screen.can.manageShops) && <button type="button" className={dangerButton} disabled={disabled}
            onClick={() => setPending({ kind: "unlink_user", linkId: l.linkId, remote: l.displayName, person: l.userName })}>{t("sevenshifts.unlink")}</button>}
        </li>)}</ul>
      </div>
    </CollapsibleSection>

    {/* ── 5. Recent syncs ── */}
    <CollapsibleSection idBase="sevenshifts-recent" title={t("sevenshifts.recent.title")} count={String(screen.recentRuns.length)}>
      <div className="p-4">
        {screen.recentRuns.length === 0 ? <p className="text-sm text-co-text-muted">{t("sevenshifts.recent.none")}</p>
          : <ul className="space-y-1">{screen.recentRuns.map((r) => <li key={r.id} className="text-sm text-co-text">{runLine(r)}</li>)}</ul>}
      </div>
    </CollapsibleSection>

    {/* ── 6. Sync now (MoO+) ── */}
    {screen.can.syncNow && <section className="co-card min-w-0 space-y-2 p-4">
      <p className="text-sm text-co-text-muted">{t("sevenshifts.sync.hint")}</p>
      <button type="button" className={button} disabled={disabled} onClick={() => void syncNow()}>{t(syncing ? "sevenshifts.sync.running" : "sevenshifts.sync.now")}</button>
    </section>}
  </div>;
}
