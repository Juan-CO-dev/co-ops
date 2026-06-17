import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import type { ActiveStaff } from "@/lib/midshift";

export function ActiveToday({
  staff,
  language,
}: {
  staff: ActiveStaff[];
  language: Language;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
        {serverT(language, "midshift.active.heading")}
      </h2>

      {staff.length === 0 ? (
        <p className="text-sm text-co-text-muted">
          {serverT(language, "midshift.active.none")}
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            {staff.map((member) => (
              <span
                key={member.userId}
                className="rounded-md border border-co-border bg-co-surface px-2 py-1 text-xs font-semibold text-co-text"
              >
                {member.name}
              </span>
            ))}
          </div>
          <p className="text-xs text-co-text-muted">
            {serverT(language, "midshift.active.proxy_note")}
          </p>
        </>
      )}
    </section>
  );
}
