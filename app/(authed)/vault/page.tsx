/**
 * /vault — the password vault (spec 2026-10-08). Server loader: session → VAULT_ENABLED (else the
 * dashboard) → the entries this viewer may see (never a secret) → the shops and, for owner-level,
 * the people list for personal-login recovery. Every reveal happens later, through the API, with
 * the actor's PIN.
 */

import { redirect } from "next/navigation";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listVaultEntries } from "@/lib/vault";
import { vaultEnabled } from "@/lib/vault-flag";
import { VAULT_OWNER_RECOVERY_LEVEL, canCreateShared, type VaultActor } from "@/lib/vault-shared";

import { VaultClient } from "./vault-client";

export default async function VaultPage() {
  const auth = await requireSessionFromHeaders("/vault");
  if (!vaultEnabled()) redirect("/dashboard");
  const lang = auth.user.language;
  const sb = getServiceRoleClient();
  const actor: VaultActor = { userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations };

  const entries = await listVaultEntries(sb, actor);
  const { data: locRows } = await sb.from("locations").select("id,code,name").eq("active", true).order("code");
  const shops = (locRows ?? []) as Array<{ id: string; code: string; name: string }>;
  const createShops = shops.filter((s) => canCreateShared(actor, { locationId: s.id, minLevel: 4, entryType: "login" })).map((s) => s.id);
  const canCreateBoth = canCreateShared(actor, { locationId: null, minLevel: 4, entryType: "login" });

  let people: Array<{ id: string; name: string; active: boolean }> = [];
  if (auth.level >= VAULT_OWNER_RECOVERY_LEVEL) {
    const { data } = await sb.from("users").select("id,name,active").neq("id", auth.user.id).order("name");
    people = (data ?? []) as Array<{ id: string; name: string; active: boolean }>;
  }

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "vault.title")}</h1>
      <p className="mb-4 text-sm text-co-text-muted">{serverT(lang, "vault.subtitle")}</p>
      <VaultClient
        initial={entries}
        shops={shops}
        createShops={createShops}
        canCreateBoth={canCreateBoth}
        canRecoverOwner={auth.level >= VAULT_OWNER_RECOVERY_LEVEL}
        people={people}
        actor={{ userId: auth.user.id, name: auth.user.name, role: auth.role, level: auth.level }}
      />
    </main>
  );
}
