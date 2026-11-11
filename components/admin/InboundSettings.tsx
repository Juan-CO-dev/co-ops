"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import type { InboundShop, InboundAlias, VendorShopAccount } from "@/lib/admin/inbound-settings-shared";
import type { InboundHealth } from "@/lib/admin/ops-health";

const button = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep px-3 text-sm font-bold text-co-text disabled:opacity-50";
const field = "flex min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";

export function InboundHealthPanel({ health }: { health: InboundHealth }) {
  const { t } = useTranslation();
  const { save, message } = useSettingsSave();
  const [busy, setBusy] = useState(false);
  const panelId = useId();
  if (!health.count) return null;
  return <section className="co-card mt-5 space-y-3 p-4">
    <h2 className="font-bold text-co-danger-text">{t("admin.inbound.health")}</h2>
    <p>{t("admin.inbound.health_count", { n: health.count })}</p>
    {message ? <p role="status">{message}</p> : null}
    {busy ? <p role="status">{t("admin.inbound.retrying")}</p> : null}
    <CollapsibleSection idBase={panelId} title={t("admin.inbound.health_details")} count={t("admin.inbound.health_shown", { n: health.rows.length })}>
    <ul>{health.rows.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span>{t(row.content_state === "skipped" ? "admin.inbound.catering_backlog" : row.content_state === "blocked_config" ? "admin.inbound.blocked_config" : "admin.inbound.failed")} <span className="break-words text-sm">{row.subject?.trim() || t("admin.inbound.no_subject")}</span></span>
      <button type="button" className={button} disabled={busy} onClick={async () => {
        setBusy(true); try { await save("/api/admin/inbound/redrive", { id: row.id }); } finally { setBusy(false); }
      }}>{t("admin.inbound.retry")}</button>
    </li>)}</ul>
    </CollapsibleSection>
  </section>;
}

/** Forms are triggered; errors remain outside disclosure; an editing drawer cannot collapse. */
function SettingEditor({ title, count, description, initialValue, email, onSave, children, visible = true }: {
  title: string; count: number; description?: string; initialValue: string; email?: boolean;
  onSave: (value: string) => Promise<boolean>; children?: React.ReactNode; visible?: boolean;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  if (!visible && !editing) return null;
  return <CollapsibleSection title={title} count={t("admin.inbound.count", { n: count })}
    badge={description ? <span className="w-full break-all text-sm font-normal text-co-text-muted">{description}</span> : null}
    idBase={panelId} open={open} onToggle={() => { if (!editing) setOpen(!open); }}>
    {children}
    {editing ? <form className="mt-3 space-y-3" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true);
      try { if (await onSave(value)) setEditing(false); } finally { setBusy(false); }
    }}>
      <label className="block text-sm text-co-text">{t(email ? "admin.inbound.address" : "admin.inbound.account")}
        <input className={field} type={email ? "email" : "text"} required maxLength={email ? 254 : 200} value={value} onChange={event => setValue(event.target.value)} disabled={busy} />
      </label>
      <p className="text-sm text-co-text-muted">{t("admin.inbound.unsaved")}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} type="submit">{t("admin.inbound.save")}</button>
        <button className={button} disabled={busy} type="button" onClick={() => setEditing(false)}>{t("admin.inbound.cancel")}</button>
      </div>
    </form> : <button className={`${button} mt-3`} type="button" onClick={() => { setValue(initialValue); setEditing(true); }}>{t(email ? "admin.inbound.add" : "admin.inbound.edit")}</button>}
  </CollapsibleSection>;
}

function useSettingsSave() {
  const { t } = useTranslation();
  const router = useRouter();
  const post = useStepUpPost();
  const { requestStepUp } = useStepUp();
  const [message, setMessage] = useState<string | null>(null);
  const save = async (url: string, body: unknown): Promise<boolean> => {
    setMessage(null);
    try {
      if (await requestStepUp("A") !== "ok") return false;
      const result = await post(url, body);
      if (!result.ok) {
        setMessage(t(result.code === "conflict" ? "admin.inbound.conflict" : "admin.inbound.error"));
        return false;
      }
      setMessage(t("admin.inbound.saved")); router.refresh(); return true;
    } catch {
      setMessage(t("admin.inbound.error"));
      return false;
    }
  };
  return { save, message };
}

export function VendorAccountsPanel({ vendorId, shops, accounts }: { vendorId: string; shops: InboundShop[]; accounts: VendorShopAccount[] }) {
  const { t } = useTranslation();
  const { save, message } = useSettingsSave();
  const [search, setSearch] = useState("");
  return <section className="mt-4 space-y-3">
    <h2 className="text-base font-bold text-co-text">{t("admin.inbound.accounts")}</h2>
    {message ? <p role="status" className="text-sm text-co-text">{message}</p> : null}
    {shops.length >= 10 ? <label className="block text-sm text-co-text">{t("admin.inbound.search")}
      <input type="search" className={field} value={search} onChange={event => setSearch(event.target.value)} />
    </label> : null}
    {shops.map(shop => {
      const account = accounts.find(row => row.location_id === shop.id);
      return <SettingEditor key={shop.id} title={shop.name} count={account ? 1 : 0} description={account?.account_number ?? t("admin.inbound.none")}
        visible={shop.name.toLowerCase().includes(search.toLowerCase())}
        initialValue={account?.account_number ?? ""} onSave={accountNumber => save("/api/admin/inbound/vendor-accounts", { vendorId, locationId: shop.id, accountNumber })}>
        {account ? <button className={button} type="button" onClick={() => save("/api/admin/inbound/vendor-accounts", { vendorId, locationId: shop.id, remove: true })}>{t("admin.inbound.remove_account")}</button> : null}
      </SettingEditor>;
    })}
  </section>;
}

export function InboundAliasesPanel({ shops, aliases }: { shops: InboundShop[]; aliases: InboundAlias[] }) {
  const { t } = useTranslation();
  const { save, message } = useSettingsSave();
  const [removing, setRemoving] = useState(false);
  const [search, setSearch] = useState("");
  const groups = [...shops.map(shop => ({ id: shop.id as string | null, name: shop.name, receiving: shop.receipt_email_address })), { id: null, name: t("admin.inbound.catering"), receiving: null }];
  return <div className="mt-4 space-y-3">
    {message ? <p role="status" className="text-sm text-co-text">{message}</p> : null}
    {aliases.length >= 10 || shops.length >= 10 ? <label className="block text-sm text-co-text">{t("admin.inbound.search")}
      <input type="search" className={field} value={search} onChange={event => setSearch(event.target.value)} />
    </label> : null}
    {groups.map(group => {
      const rows = aliases.filter(alias => alias.location_id === group.id);
      return <SettingEditor key={group.id ?? "catering"} title={group.name} count={rows.length} email initialValue=""
        description={group.id ? t("admin.inbound.receiving", { address: group.receiving ?? t("admin.inbound.none") }) : t("admin.inbound.catering_note")}
        onSave={address => save("/api/admin/inbound/aliases", { address, lane: group.id ? "vendor_receipt" : "catering", locationId: group.id })}>
        <ul className="space-y-2">{rows.filter(alias => `${group.name} ${alias.address}`.toLowerCase().includes(search.toLowerCase())).map(alias => <li key={alias.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-all text-sm text-co-text">{alias.address}</span>
          <button className={button} type="button" disabled={removing} onClick={async () => {
            setRemoving(true); try { await save("/api/admin/inbound/aliases", { id: alias.id, remove: true }); } finally { setRemoving(false); }
          }}>{t("admin.inbound.remove")}</button>
        </li>)}</ul>
      </SettingEditor>;
    })}
  </div>;
}
