"use client";

/**
 * VaultEntryForm — add or edit a vault entry (shared or personal). Admin-form grammar (rounded-lg,
 * 44 px controls, gold-deep borders). The secret field is a password input with a show toggle; on
 * an edit it may be left blank to keep the current secret. The form posts the secret ONCE to the
 * create/edit route and keeps nothing: no draft, no storage, no echo (the response is the view).
 */

import { useState, type FormEvent } from "react";

import { ActionButton } from "@/components/ActionButton";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  VAULT_AI_KEY_DEFAULT_FLOOR, VAULT_ENTRY_TYPES, VAULT_LIMITS, VAULT_MANAGE_ALL_LEVEL, VAULT_ROLE_FLOORS,
  type VaultEntryKind, type VaultEntryType, type VaultEntryView, type VaultRoleFloor,
} from "@/lib/vault-shared";

export interface VaultShop {
  id: string;
  code: string;
  name: string;
}

export interface VaultEntryFormProps {
  kind: VaultEntryKind;
  /** Present on an edit. */
  initial?: VaultEntryView;
  shops: VaultShop[];
  /** Shop ids the actor may author shared entries for. */
  createShops: string[];
  canCreateBoth: boolean;
  actorLevel: number;
  onSaved: (view: VaultEntryView) => void;
  onCancel: () => void;
}

const INPUT = "min-h-[44px] w-full rounded-lg border-2 border-co-gold-deep bg-co-surface px-3 text-sm text-co-text focus:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";
const LABEL = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";

export function vaultErrorKey(code: string | undefined): TranslationKey {
  switch (code) {
    case "pin_invalid": return "vault.error.pin_invalid";
    case "reveal_cap": return "vault.error.reveal_cap";
    case "forbidden": case "location_access_denied": return "vault.error.forbidden";
    case "entry_not_found": return "vault.error.not_found";
    case "no_previous_secret": return "vault.error.no_previous_secret";
    case "vault_unavailable": return "vault.error.vault_unavailable";
    case "invalid_payload": return "vault.error.invalid_payload";
    default: return "vault.error.generic";
  }
}

export function VaultEntryForm({ kind, initial, shops, createShops, canCreateBoth, actorLevel, onSaved, onCancel }: VaultEntryFormProps) {
  const { t } = useTranslation();
  const isEdit = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [entryType, setEntryType] = useState<VaultEntryType>(initial?.entryType ?? "login");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [url, setUrl] = useState(initial?.url ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [shop, setShop] = useState<string>(initial?.locationId ?? (createShops[0] ?? (canCreateBoth ? "both" : "")));
  const [floor, setFloor] = useState<VaultRoleFloor>((initial?.minLevel as VaultRoleFloor | undefined) ?? 4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowedTypes = VAULT_ENTRY_TYPES.filter((ty) => ty !== "ai_key" || actorLevel >= VAULT_MANAGE_ALL_LEVEL);
  const allowedFloors = VAULT_ROLE_FLOORS.filter((f) => f <= actorLevel);
  const shopOptions = shops.filter((s) => createShops.includes(s.id));

  const onTypeChange = (next: VaultEntryType) => {
    setEntryType(next);
    if (next === "ai_key" && !isEdit && VAULT_AI_KEY_DEFAULT_FLOOR <= actorLevel) setFloor(VAULT_AI_KEY_DEFAULT_FLOOR);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      ...(initial ? { expectedRevision: initial.revision } : {}),
      kind, name: name.trim(), entryType, username: username.trim() || null, url: url.trim() || null, notes: notes.trim() || null,
      secret: secret.length > 0 ? secret : undefined,
    };
    if (kind === "shared") {
      body.locationId = shop === "both" ? null : shop;
      body.minLevel = floor;
    }
    try {
      const res = await fetch(initial ? `/api/vault/entries/${initial.id}` : "/api/vault/entries", {
        method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, redirect: "manual", body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { entry?: VaultEntryView; code?: string; field?: string };
      if (!res.ok || !json.entry) {
        setError(t(vaultErrorKey(json.code), { field: json.field ?? "" }));
        return;
      }
      setSecret("");
      onSaved(json.entry);
    } catch {
      setError(t("vault.error.generic"));
    } finally {
      setSaving(false);
    }
  };

  const titleKey: TranslationKey = isEdit ? "vault.form.title_edit" : kind === "shared" ? "vault.form.title_add_shared" : "vault.form.title_add_personal";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-labelledby="vault-form-title">
      <h2 id="vault-form-title" className="text-base font-bold text-co-text">{t(titleKey)}</h2>
      {kind === "shared" ? <p className="rounded-md bg-co-surface-inset px-3 py-2 text-sm text-co-text">{t("vault.form.shared_notice")}</p> : null}

      <label className="flex flex-col gap-1">
        <span className={LABEL}>{t("vault.form.name")}</span>
        <input className={INPUT} value={name} maxLength={VAULT_LIMITS.name} required onChange={(e) => setName(e.target.value)} autoComplete="off" aria-label={t("vault.form.name")} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>{t("vault.form.type")}</span>
        <select className={INPUT} value={entryType} onChange={(e) => onTypeChange(e.target.value as VaultEntryType)} aria-label={t("vault.form.type")}>
          {allowedTypes.map((ty) => <option key={ty} value={ty}>{t(`vault.type.${ty}`)}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>{t("vault.form.username")}</span>
        <input className={INPUT} value={username} maxLength={VAULT_LIMITS.username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" aria-label={t("vault.form.username")} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>{t("vault.form.secret")}</span>
        <input
          className={INPUT} type={showSecret ? "text" : "password"} value={secret} maxLength={VAULT_LIMITS.secret} required={!isEdit}
          onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" spellCheck={false} aria-label={t("vault.form.secret")}
          placeholder={isEdit ? t("vault.form.secret_keep") : undefined}
        />
      </label>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-co-text">
        <input type="checkbox" className="h-5 w-5" checked={showSecret} onChange={(e) => setShowSecret(e.target.checked)} aria-label={t("vault.form.secret_show")} />
        {t("vault.form.secret_show")}
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>{t("vault.form.url")}</span>
        <input className={INPUT} type="url" value={url} maxLength={VAULT_LIMITS.url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoComplete="off" aria-label={t("vault.form.url")} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>{t("vault.form.notes")}</span>
        <textarea className={`${INPUT} min-h-[88px] py-2`} value={notes} maxLength={VAULT_LIMITS.notes} onChange={(e) => setNotes(e.target.value)} aria-label={t("vault.form.notes")} />
      </label>

      {kind === "shared" ? (
        <>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{t("vault.form.shop")}</span>
            <select className={INPUT} value={shop} onChange={(e) => setShop(e.target.value)} required aria-label={t("vault.form.shop")}>
              {shopOptions.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              {canCreateBoth ? <option value="both">{t("vault.shop.both")}</option> : null}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{t("vault.form.floor")}</span>
            <select className={INPUT} value={floor} onChange={(e) => setFloor(Number(e.target.value) as VaultRoleFloor)} aria-label={t("vault.form.floor")}>
              {allowedFloors.map((f) => <option key={f} value={f}>{t(`vault.floor.${f}`)}</option>)}
            </select>
          </label>
        </>
      ) : null}

      {error ? <p role="alert" className="rounded-md bg-co-danger-surface px-3 py-2 text-sm font-semibold text-co-cta-text">{error}</p> : null}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <ActionButton type="submit" variant="primary" disabled={saving} className="min-h-[44px] items-center">
          {saving ? t("vault.form.saving") : t("vault.form.save")}
        </ActionButton>
        <ActionButton type="button" variant="secondary" onClick={onCancel} disabled={saving} className="min-h-[44px] items-center">
          {t("vault.form.cancel")}
        </ActionButton>
      </div>
    </form>
  );
}
