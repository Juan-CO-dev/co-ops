/**
 * /catering/companies — catering company accounts (the identity model).
 *
 * Server component: gates the catering read floor (>= 5) and loads the company list, then
 * hands to the client (create + per-company domain/contact management).
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadCompanies, COMPANY_READ_MIN } from "@/lib/catering/companies";
import { CompaniesClient } from "@/components/catering/companies/CompaniesClient";
import { BackLink } from "@/components/nav/BackLink";

export default async function CateringCompaniesPage() {
  const auth = await requireSessionFromHeaders("/catering/companies");
  const level = getRoleLevel(auth.user.role);
  if (level < COMPANY_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const companies = await loadCompanies(auth);

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <BackLink />
      </div>
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "catering.companies.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.companies.subtitle")}</p>
      <CompaniesClient companies={companies} actorLevel={level} />
    </main>
  );
}
