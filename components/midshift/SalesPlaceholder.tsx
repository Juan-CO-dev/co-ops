import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";

export function SalesPlaceholder({ language }: { language: Language }) {
  return (
    <section className="rounded-lg border-2 border-dashed border-co-border px-4 py-3 opacity-70">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted">
        {serverT(language, "midshift.sales.heading")}
      </h2>
      <p className="text-sm text-co-text-muted">
        {serverT(language, "midshift.sales.placeholder")}
      </p>
    </section>
  );
}
