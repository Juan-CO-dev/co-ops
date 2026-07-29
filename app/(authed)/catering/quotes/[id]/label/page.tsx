/**
 * /catering/quotes/[id]/label — food label print sheet (D25).
 *
 * A SAFETY artifact. Allergen data is resolved per line; where it's absent (an ad-hoc line,
 * or a menu reference with no allergen rows authored yet) the label prints an explicit
 * "verify before serving" warning — absence is NEVER rendered as safe. Most Wave-1 lines are
 * ad-hoc (the sale/allergen layer is authored on menu day), so the warning is the norm today.
 */

import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadLabelData, QUOTE_READ_MIN, type LineAllergen } from "@/lib/catering/quotes";
import { PrintButton } from "@/components/catering/quotes/PrintButton";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function CateringQuoteLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSessionFromHeaders(`/catering/quotes/${id}/label`);
  const level = getRoleLevel(auth.user.role);
  if (level < QUOTE_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const data = await loadLabelData(auth, id);
  if (!data) notFound();

  const allergenLabel = (a: LineAllergen): string => (lang === "es" ? a.labelEs ?? a.labelEn : a.labelEn);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        className="print:hidden mb-4"
        title={serverT(lang, "catering.labels.title")}
        subtitle={serverT(lang, "catering.labels.subtitle")}
      >
        <PrintButton />
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
        {data.items.map((item) => {
          const info = data.allergensByItem[item.id];
          const contains = info?.allergens.filter((a) => a.presence === "contains") ?? [];
          const mayContain = info?.allergens.filter((a) => a.presence === "may_contain") ?? [];
          const needsVerify = !info || info.status !== "listed";
          return (
            <div
              key={item.id}
              className="break-inside-avoid rounded-xl border-2 border-co-text bg-white p-4 text-co-text"
            >
              <p className="text-base font-extrabold leading-tight">{item.description ?? serverT(lang, "catering.labels.unnamed_item")}</p>
              <p className="mt-0.5 text-sm text-co-text-muted">
                {serverT(lang, "catering.labels.qty")}: {item.quantity}
              </p>

              <div className="mt-3 border-t-2 border-co-border pt-2">
                {contains.length > 0 && (
                  <p className="text-sm font-bold text-co-cta">
                    {serverT(lang, "catering.labels.contains")}: {contains.map(allergenLabel).join(", ")}
                  </p>
                )}
                {mayContain.length > 0 && (
                  <p className="mt-1 text-sm font-semibold text-co-text">
                    {serverT(lang, "catering.labels.may_contain")}: {mayContain.map(allergenLabel).join(", ")}
                  </p>
                )}
                {needsVerify && (
                  <p className="rounded-lg border-2 border-co-cta bg-co-cta/10 px-2 py-1.5 text-xs font-bold text-co-cta">
                    ⚠ {serverT(lang, "catering.labels.unverified")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
