"use client";

/**
 * VaultClient — the vault surface. Tabs: Shared · My logins · (owner-level) Recover a personal login.
 * Rows show name, type, username, shop — never a secret. Reveal / Recover open the PIN keypad; the
 * PIN travels once in the request body and is never kept. A successful reveal renders SecretReveal
 * (30 s auto-hide); navigating away unmounts it. Add / Edit / Remove go through VaultEntryForm and
 * the API, then the list is re-fetched (no optimistic secret state anywhere).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { ActionButton } from "@/components/ActionButton";
import { PinKeypad, type PinKeypadError } from "@/components/auth/PinKeypad";
import { SecretReveal, type RevealMode } from "@/components/vault/SecretReveal";
import { VaultEntryForm, vaultErrorKey, type VaultShop } from "@/components/vault/VaultEntryForm";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { RoleCode } from "@/lib/roles";
import type { VaultEntryKind, VaultEntryView } from "@/lib/vault-shared";

type Tab = "shared" | "personal" | "recover";
interface Pending { action: "reveal" | "previous" | "owner"; entry: VaultEntryView }
interface Revealed { entry: VaultEntryView; secret: string; version: number; mode: RevealMode; previous: boolean }
interface FormState { kind: VaultEntryKind; initial?: VaultEntryView }

export interface VaultClientProps {
  initial: { shared: VaultEntryView[]; personal: VaultEntryView[] };
  shops: VaultShop[];
  createShops: string[];
  canCreateBoth: boolean;
  canRecoverOwner: boolean;
  people: Array<{ id: string; name: string; active: boolean }>;
  actor: { userId: string; name: string; role: RoleCode; level: number };
}

const CHIP = "inline-flex min-h-[44px] items-center rounded-full border-2 px-3 text-sm font-semibold transition-[opacity,border-color,background-color] duration-150";
const SMALL = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50";

export function VaultClient({ initial, shops, createShops, canCreateBoth, canRecoverOwner, people, actor }: VaultClientProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState(initial);
  const [tab, setTab] = useState<Tab>(initial.shared.length > 0 || actor.level >= 7 ? "shared" : "personal");
  const [shopFilter, setShopFilter] = useState<string>("all");
  const [pending, setPending] = useState<Pending | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [person, setPerson] = useState<string>("");
  const [personEntries, setPersonEntries] = useState<VaultEntryView[] | null>(null);

  const shopCode = useCallback((id: string | null) => (id === null ? t("vault.shop.both") : shops.find((s) => s.id === id)?.code ?? "?"), [shops, t]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/entries", { redirect: "manual" });
      if (res.ok) setEntries((await res.json()) as VaultClientProps["initial"]);
    } catch {
      // The list simply stays as it was; the next action refreshes again.
    }
  }, []);

  // Navigation (unmount) and tab changes drop any revealed secret.
  useEffect(() => () => setRevealed(null), []);
  const hide = useCallback(() => setRevealed(null), []);

  const visibleShared = useMemo(
    () => entries.shared.filter((e) => shopFilter === "all" || e.locationId === null || e.locationId === shopFilter),
    [entries.shared, shopFilter],
  );

  const submitPin = async (pin: string): Promise<{ ok: true } | { ok: false; error: PinKeypadError }> => {
    if (!pending) return { ok: false, error: { kind: "network", message: t("vault.error.generic") } };
    const path = pending.action === "reveal" ? `/api/vault/entries/${pending.entry.id}/reveal` : `/api/vault/entries/${pending.entry.id}/recover`;
    const body = pending.action === "reveal" ? { pin } : { pin, mode: pending.action };
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "manual", body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { secret?: string; version?: number; recorded?: boolean; code?: string };
      if (!res.ok || typeof json.secret !== "string" || typeof json.version !== "number") {
        const key = vaultErrorKey(json.code);
        if (json.code === "pin_invalid") return { ok: false, error: { kind: "invalid", message: t(key) } };
        return { ok: false, error: { kind: "network", message: t(key, { field: "" }) } };
      }
      const mode: RevealMode = pending.action !== "reveal" ? "recovery" : pending.entry.kind === "personal" ? "personal" : "shared";
      setRevealed({ entry: pending.entry, secret: json.secret, version: json.version, mode, previous: pending.action === "previous" });
      setPending(null);
      return { ok: true };
    } catch {
      return { ok: false, error: { kind: "network", message: t("vault.error.generic") } };
    }
  };

  const remove = async (entry: VaultEntryView) => {
    if (!window.confirm(t("vault.action.deactivate_confirm", { name: entry.name }))) return;
    try {
      const res = await fetch(`/api/vault/entries/${entry.id}/deactivate`, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "manual", body: "{}" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { code?: string };
        setNotice(t(vaultErrorKey(json.code), { field: "" }));
      }
    } catch {
      setNotice(t("vault.error.generic"));
    }
    await refresh();
  };

  const loadPerson = async () => {
    if (!person) return;
    setPersonEntries(null);
    try {
      const res = await fetch(`/api/vault/personal/${person}`, { redirect: "manual" });
      const json = (await res.json().catch(() => ({}))) as { entries?: VaultEntryView[]; code?: string };
      if (!res.ok || !json.entries) { setNotice(t(vaultErrorKey(json.code), { field: "" })); return; }
      setPersonEntries(json.entries);
    } catch {
      setNotice(t("vault.error.generic"));
    }
  };

  const tabs: Array<{ id: Tab; key: TranslationKey }> = [
    { id: "shared", key: "vault.tab.shared" }, { id: "personal", key: "vault.tab.personal" },
    ...(canRecoverOwner ? [{ id: "recover" as Tab, key: "vault.tab.recover" as TranslationKey }] : []),
  ];

  const row = (entry: VaultEntryView, actions: "list" | "recover") => (
    <li key={entry.id} className="co-card flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-base font-bold text-co-text">{entry.name}</span>
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {t(`vault.type.${entry.entryType}`)}{entry.kind === "shared" ? ` · ${shopCode(entry.locationId)}` : ""}
        </span>
      </div>
      <p className="text-sm text-co-text-muted">
        {entry.username ?? t("vault.list.no_username")}
        {entry.kind === "shared" && entry.minLevel !== null ? ` · ${t("vault.list.floor", { floor: t(`vault.floor.${entry.minLevel}` as TranslationKey) })}` : ""}
      </p>
      {entry.notes ? <p className="text-sm text-co-text">{entry.notes}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {actions === "list" ? (
          <ActionButton type="button" variant="primary" onClick={() => { setRevealed(null); setPending({ action: "reveal", entry }); }}
            aria-label={t("vault.action.reveal_aria", { name: entry.name })} className="min-h-[44px] items-center">
            {t("vault.action.reveal")}
          </ActionButton>
        ) : (
          <ActionButton type="button" variant="primary" onClick={() => { setRevealed(null); setPending({ action: "owner", entry }); }}
            aria-label={t("vault.action.recover_owner_aria", { name: entry.name })} className="min-h-[44px] items-center">
            {t("vault.action.recover_owner")}
          </ActionButton>
        )}
        {entry.url ? (
          <a href={entry.url} target="_blank" rel="noopener noreferrer" className={SMALL} aria-label={t("vault.action.open_link_aria", { name: entry.name })}>
            {t("vault.action.open_link")}
          </a>
        ) : null}
        {actions === "list" && entry.canRecoverPrevious ? (
          <button type="button" className={SMALL} onClick={() => { setRevealed(null); setPending({ action: "previous", entry }); }}
            aria-label={t("vault.action.recover_previous_aria", { name: entry.name })}>
            {t("vault.action.recover_previous")}
          </button>
        ) : null}
        {actions === "list" && entry.canManage ? (
          <>
            <button type="button" className={SMALL} onClick={() => setForm({ kind: entry.kind, initial: entry })} aria-label={t("vault.action.edit_aria", { name: entry.name })}>
              {t("vault.action.edit")}
            </button>
            <button type="button" className={`${SMALL} border-co-cta-text text-co-cta-text`} onClick={() => remove(entry)} aria-label={t("vault.action.deactivate_aria", { name: entry.name })}>
              {t("vault.action.deactivate")}
            </button>
          </>
        ) : null}
      </div>
      {revealed && revealed.entry.id === entry.id ? (
        <SecretReveal entryName={entry.name} secret={revealed.secret} version={revealed.version} mode={revealed.mode} previous={revealed.previous} onHide={hide} />
      ) : null}
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("vault.a11y.tabs")} className="flex flex-wrap gap-2">
        {tabs.map((tb) => (
          <button key={tb.id} role="tab" type="button" aria-selected={tab === tb.id} onClick={() => { setTab(tb.id); setRevealed(null); }}
            className={`${CHIP} ${tab === tb.id ? "border-co-text bg-co-gold text-co-text" : "border-co-border bg-co-surface text-co-text"}`}>
            {t(tb.key)}
          </button>
        ))}
      </div>

      {notice ? <p role="alert" className="rounded-md bg-co-danger-surface px-3 py-2 text-sm font-semibold text-co-cta-text">{notice}</p> : null}

      {tab === "shared" ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {shops.length > 1 ? (
              <div role="group" aria-label={t("vault.a11y.shop_filter")} className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={shopFilter === "all"} onClick={() => setShopFilter("all")}
                  className={`${CHIP} ${shopFilter === "all" ? "border-co-text bg-co-surface-2" : "border-co-border bg-co-surface"} text-co-text`}>
                  {t("vault.filter.all_shops")}
                </button>
                {shops.map((s) => (
                  <button key={s.id} type="button" aria-pressed={shopFilter === s.id} onClick={() => setShopFilter(s.id)}
                    className={`${CHIP} ${shopFilter === s.id ? "border-co-text bg-co-surface-2" : "border-co-border bg-co-surface"} text-co-text`}>
                    {s.code}
                  </button>
                ))}
              </div>
            ) : null}
            {createShops.length > 0 || canCreateBoth ? (
              <ActionButton type="button" variant="secondary" onClick={() => setForm({ kind: "shared" })} className="ml-auto min-h-[44px] items-center">
                {t("vault.action.add_shared")}
              </ActionButton>
            ) : null}
          </div>
          {visibleShared.length === 0 ? (
            <p className="text-sm text-co-text-muted">{t("vault.list.empty_shared")}</p>
          ) : (
            <ul aria-label={t("vault.a11y.list")} className="flex flex-col gap-3">{visibleShared.map((e) => row(e, "list"))}</ul>
          )}
        </section>
      ) : null}

      {tab === "personal" ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center">
            <ActionButton type="button" variant="secondary" onClick={() => setForm({ kind: "personal" })} className="ml-auto min-h-[44px] items-center">
              {t("vault.action.add_personal")}
            </ActionButton>
          </div>
          {entries.personal.length === 0 ? (
            <p className="text-sm text-co-text-muted">{t("vault.list.empty_personal")}</p>
          ) : (
            <ul aria-label={t("vault.a11y.list")} className="flex flex-col gap-3">{entries.personal.map((e) => row(e, "list"))}</ul>
          )}
        </section>
      ) : null}

      {tab === "recover" && canRecoverOwner ? (
        <section className="flex flex-col gap-3">
          <p className="rounded-md bg-co-surface-inset px-3 py-2 text-sm text-co-text">{t("vault.recover.notice")}</p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("vault.recover.pick_user")}</span>
            <select aria-label={t("vault.a11y.user_select")} value={person} onChange={(e) => { setPerson(e.target.value); setPersonEntries(null); }}
              className="min-h-[44px] w-full rounded-lg border-2 border-co-gold-deep bg-co-surface px-3 text-sm text-co-text">
              <option value="">—</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : ` (${t("vault.recover.inactive_badge")})`}</option>)}
            </select>
          </label>
          <div className="flex items-center">
            <ActionButton type="button" variant="secondary" onClick={loadPerson} disabled={!person} className="min-h-[44px] items-center">
              {t("vault.recover.load")}
            </ActionButton>
          </div>
          {personEntries !== null ? (
            personEntries.length === 0 ? (
              <p className="text-sm text-co-text-muted">{t("vault.recover.empty")}</p>
            ) : (
              <ul aria-label={t("vault.a11y.list")} className="flex flex-col gap-3">{personEntries.map((e) => row(e, "recover"))}</ul>
            )
          ) : null}
        </section>
      ) : null}

      {pending ? (
        <div role="dialog" aria-modal="true" aria-label={t("vault.reveal.pin_title")} className="fixed inset-0 z-50 flex items-center justify-center bg-co-text/60 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-co-border bg-co-surface p-6 shadow-2xl">
            <p className="mb-2 text-center text-sm font-bold text-co-text">{t("vault.reveal.pin_title")}</p>
            <PinKeypad userName={actor.name} role={actor.role} onSubmit={submitPin} onBack={() => setPending(null)} />
          </div>
        </div>
      ) : null}

      {form ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-co-text/60 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-co-border bg-co-surface p-6 shadow-2xl">
            <VaultEntryForm
              kind={form.kind} initial={form.initial} shops={shops} createShops={createShops} canCreateBoth={canCreateBoth} actorLevel={actor.level}
              onSaved={async () => { setForm(null); await refresh(); }} onCancel={() => setForm(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
