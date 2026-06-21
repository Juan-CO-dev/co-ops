"use client";

/**
 * UserAdminClient — top-level client surface for User Management (C.44 Task 13).
 *
 * Hosts the filter bar (navigates via query params), the user list, and the
 * "Add user" button + CreateUserForm modal. Per-row Tier-B actions render via
 * UserActions, gated by canActOn(actorRole, row.role).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { ROLES, canActOn } from "@/lib/roles";
import type { AdminUserListItem } from "@/lib/admin/users";
import type { TranslationKey } from "@/lib/i18n/types";
import { CreateUserForm } from "./CreateUserForm";
import { UserActions } from "./UserActions";
import type { UserAdminClientProps } from "./shared";

export function UserAdminClient({
  users,
  allLocations,
  accessibleLocations,
  assignableRoles,
  actorRole,
  currentFilters,
}: UserAdminClientProps) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  // Read current values from currentFilters; on change, navigate with updated
  // query params. Empty value clears the param.
  const navigate = (next: Partial<typeof currentFilters>) => {
    const merged = { ...currentFilters, ...next };
    const params = new URLSearchParams();
    if (merged.role) params.set("role", merged.role);
    if (merged.status) params.set("status", merged.status);
    if (merged.location) params.set("location", merged.location);
    if (merged.q) params.set("q", merged.q);
    const qs = params.toString();
    router.push(qs ? `/admin/users?${qs}` : "/admin/users");
  };

  const locCode = (id: string) => allLocations.find((l) => l.id === id)?.code ?? id;

  return (
    <div className="mt-5">
      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("admin.users.filter.role")}
          </span>
          <select
            value={currentFilters.role}
            onChange={(e) => navigate({ role: e.target.value })}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 sm:w-48"
          >
            <option value="">{t("admin.users.filter.role.all")}</option>
            {Object.values(ROLES).map((r) => (
              <option key={r.code} value={r.code}>
                {t(`role.${r.code}` as TranslationKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("admin.users.filter.status")}
          </span>
          <select
            value={currentFilters.status}
            onChange={(e) => navigate({ status: e.target.value })}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 sm:w-40"
          >
            <option value="">{t("admin.users.filter.status.all")}</option>
            <option value="active">{t("admin.users.filter.status.active")}</option>
            <option value="inactive">{t("admin.users.filter.status.inactive")}</option>
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("admin.users.filter.location")}
          </span>
          <select
            value={currentFilters.location}
            onChange={(e) => navigate({ location: e.target.value })}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 sm:w-48"
          >
            <option value="">{t("admin.users.filter.location.all")}</option>
            {allLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code} · {loc.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block sm:flex-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("admin.users.filter.search")}
          </span>
          <SearchInput
            initial={currentFilters.q}
            placeholder={t("admin.users.filter.search")}
            onCommit={(q) => navigate({ q })}
          />
        </label>

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        >
          {t("admin.users.create")}
        </button>
      </div>

      {/* List */}
      <ul className="mt-5 flex flex-col gap-3">
        {users.map((u) => {
          const actionable = canActOn(actorRole, u.role);
          return (
            <li
              key={u.id}
              className="rounded-xl border-2 border-co-border bg-co-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-base font-bold text-co-text">{u.name}</div>
                  <div className="mt-0.5 text-sm text-co-text-muted">
                    {t(`role.${u.role}` as TranslationKey)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-co-text-muted">
                    <span>
                      {t("admin.users.col.locations")}:{" "}
                      {u.locationIds.length > 0 ? u.locationIds.map(locCode).join(", ") : "—"}
                    </span>
                    <span>
                      {t("admin.users.col.status")}:{" "}
                      {u.active ? t("admin.users.status.active") : t("admin.users.status.inactive")}
                    </span>
                    <span>
                      {t("admin.users.col.last_login")}:{" "}
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString(language === "es" ? "es-US" : "en-US")
                        : t("admin.users.last_login.never")}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 border-t border-co-border-2 pt-3">
                {actionable ? (
                  <UserActions
                    user={u}
                    assignableRoles={assignableRoles}
                    accessibleLocations={accessibleLocations}
                  />
                ) : (
                  <p className="text-[11px] italic text-co-text-muted" title={t("admin.users.cant_act")}>
                    {t("admin.users.cant_act")}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {creating ? (
        <CreateUserForm
          assignableRoles={assignableRoles}
          accessibleLocations={accessibleLocations}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/** Search box that commits on Enter or blur — avoids a navigation per keystroke. */
function SearchInput({
  initial,
  placeholder,
  onCommit,
}: {
  initial: string;
  placeholder: string;
  onCommit: (q: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      type="search"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value.trim());
      }}
      onBlur={() => {
        if (value.trim() !== initial) onCommit(value.trim());
      }}
      className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
    />
  );
}
