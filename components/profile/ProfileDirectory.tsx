/**
 * Profile directory — pure presentational Server Component (no client hooks).
 * 2-col grid of linked teammate tiles. Highlights the viewer's own entry and
 * surfaces MVP-win count when present.
 */

import Link from "next/link";

import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import type { DirectoryEntry } from "@/lib/profiles";
import { ROLES } from "@/lib/roles";

export function ProfileDirectory({
  entries,
  viewerUserId,
  language,
}: {
  entries: DirectoryEntry[];
  viewerUserId: string;
  language: Language;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-co-text-muted">{serverT(language, "profile.directory_empty")}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {entries.map((e) => {
        const isSelf = e.userId === viewerUserId;
        return (
          <Link
            key={e.userId}
            href={`/profile/${e.userId}`}
            className="flex items-center gap-2 rounded-xl border border-co-border bg-co-surface p-2.5 transition hover:border-co-text"
          >
            <div
              aria-hidden="true"
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-co-gold text-sm font-bold text-co-text"
            >
              {e.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="truncate text-sm font-bold text-co-text">{e.name}</span>
                {isSelf ? (
                  <span className="rounded-full bg-co-gold/20 px-1.5 py-0.5 text-[9px] font-bold text-co-text">
                    {serverT(language, "profile.you")}
                  </span>
                ) : null}
              </div>
              <div className="text-[9px] text-co-text-dim">{ROLES[e.role].shortLabel}</div>
            </div>
            {e.mvpWins > 0 ? (
              <span className="ml-auto text-xs font-bold text-[#c47d12]">⭐ {e.mvpWins}</span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
