/**
 * Catering companies + identity attribution — the company-account model.
 *
 * SERVER-ONLY. Service-role + app-layer authz (read L5 / write L6), consistent with the
 * other catering libs. A catering_company is a CROSS-LOCATION account; catering_customers is
 * the CONTACT (a person + email). Email is the contact identifier.
 *
 * Attribution (Juan-approved 2026-07-16):
 *   - A corporate email domain registered in catering_company_domains auto-links a new contact
 *     to that company.
 *   - Personal domains (gmail/outlook/icloud/...) NEVER auto-link and can never be registered as
 *     an auto-attribution domain — a catering team member hand-attaches such contacts instead.
 *   - Manual attach (setContactCompany) always wins.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export const COMPANY_READ_MIN = 5;
export const COMPANY_WRITE_MIN = 6;

/** Consumer/personal email domains that must never auto-attribute to a single company. */
export const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "yahoo.co.uk",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "gmx.com", "gmx.net",
  "proton.me", "protonmail.com", "pm.me",
  "fastmail.com", "zoho.com", "hey.com",
]);

export class CateringCompanyError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CateringCompanyError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new CateringCompanyError(403, "forbidden", "Insufficient role level");
  }
}

/** The domain part of an email, lowercased, or null if unparseable. */
export function extractDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.length > 0 && domain.includes(".") ? domain : null;
}
export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}
/** Normalize an email for storage + identity matching (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Escape LIKE/ILIKE metacharacters (\ % _) so an email is matched LITERALLY. Email lookups
 * use ILIKE for case-insensitive identity matching against possibly mixed-case legacy rows;
 * without escaping, a "%"/"_" in the address (e.g. john_doe@x.com) would act as a wildcard
 * and resolve to the WRONG contact — a wildcard-injection break of the email identifier.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CateringCompany {
  id: string;
  name: string;
  notes: string | null;
  claimedByCustomerId: string | null;
  claimedAt: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
}
export interface CompanyDomain {
  id: string;
  domain: string;
  active: boolean;
}
export interface CompanyContact {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
}
export interface CompanyDetail {
  company: CateringCompany;
  domains: CompanyDomain[];
  contacts: CompanyContact[];
}

interface DbCompanyRow {
  id: string;
  name: string;
  notes: string | null;
  claimed_by_customer_id: string | null;
  claimed_at: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
}
const COMPANY_COLS = "id, name, notes, claimed_by_customer_id, claimed_at, active, created_at, created_by";
function mapCompany(r: DbCompanyRow): CateringCompany {
  return {
    id: r.id,
    name: r.name,
    notes: r.notes,
    claimedByCustomerId: r.claimed_by_customer_id,
    claimedAt: r.claimed_at,
    active: r.active,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────────
export async function loadCompanies(actor: AuthContext): Promise<CateringCompany[]> {
  requireLevel(actor, COMPANY_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_companies")
    .select(COMPANY_COLS)
    .order("name", { ascending: true })
    .returns<DbCompanyRow[]>();
  if (error) throw new Error(`loadCompanies: ${error.message}`);
  return (data ?? []).map(mapCompany);
}

export async function loadCompany(actor: AuthContext, id: string): Promise<CompanyDetail | null> {
  requireLevel(actor, COMPANY_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb.from("catering_companies").select(COMPANY_COLS).eq("id", id).maybeSingle<DbCompanyRow>();
  if (error) throw new Error(`loadCompany: ${error.message}`);
  if (!row) return null;

  const [{ data: domains }, { data: contacts }] = await Promise.all([
    sb.from("catering_company_domains").select("id, domain, active").eq("company_id", id).eq("active", true).order("domain", { ascending: true }).returns<CompanyDomain[]>(),
    sb.from("catering_customers").select("id, name, email, active").eq("company_id", id).order("name", { ascending: true }).returns<CompanyContact[]>(),
  ]);
  return { company: mapCompany(row), domains: domains ?? [], contacts: contacts ?? [] };
}

// ── Attribution ────────────────────────────────────────────────────────────────
/** The company id an email's (corporate) domain maps to, or null (personal / unregistered). */
export async function resolveCompanyForEmail(email: string): Promise<string | null> {
  const domain = extractDomain(email);
  if (!domain || isPersonalDomain(domain)) return null;
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_company_domains")
    .select("company_id")
    .eq("domain", domain)
    .eq("active", true)
    .maybeSingle<{ company_id: string }>();
  if (error) throw new Error(`resolveCompanyForEmail: ${error.message}`);
  return data?.company_id ?? null;
}

// ── Mutations: companies ────────────────────────────────────────────────────────
export interface CreateCompanyInput {
  name: string;
  domains?: string[];
  notes?: string | null;
}
export async function createCompany(actor: AuthContext, input: CreateCompanyInput): Promise<{ id: string }> {
  requireLevel(actor, COMPANY_WRITE_MIN);
  if (!input.name || input.name.trim().length === 0) {
    throw new CateringCompanyError(400, "invalid_payload", "name is required");
  }
  const sb = getServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("catering_companies")
    .insert({ name: input.name.trim(), notes: input.notes ?? null, created_by: actor.user.id })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`createCompany: ${error.message}`);

  for (const d of input.domains ?? []) {
    await addDomain(actor, inserted.id, d);
  }
  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.company.create",
    resourceTable: "catering_companies",
    resourceId: inserted.id,
    metadata: { name: input.name.trim(), domains: input.domains ?? [] },
    ipAddress: null,
    userAgent: null,
  });
  return { id: inserted.id };
}

export async function editCompany(actor: AuthContext, id: string, patch: { name?: string; notes?: string | null }): Promise<void> {
  requireLevel(actor, COMPANY_WRITE_MIN);
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.user.id };
  if (patch.name !== undefined) {
    if (!patch.name || patch.name.trim().length === 0) throw new CateringCompanyError(400, "invalid_payload", "name cannot be empty");
    fields.name = patch.name.trim();
  }
  if (patch.notes !== undefined) fields.notes = patch.notes;
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("catering_companies").update(fields, { count: "exact" }).eq("id", id);
  if (error) throw new Error(`editCompany: ${error.message}`);
  if (count === 0) throw new CateringCompanyError(404, "not_found", "Company not found");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "catering.company.edit",
    resourceTable: "catering_companies", resourceId: id, metadata: { fields: Object.keys(fields).filter((k) => k !== "updated_at" && k !== "updated_by") },
    ipAddress: null, userAgent: null,
  });
}

/** Register a corporate auto-attribution domain. Personal domains are rejected. */
export async function addDomain(actor: AuthContext, companyId: string, domainRaw: string): Promise<{ id: string }> {
  requireLevel(actor, COMPANY_WRITE_MIN);
  const domain = domainRaw.trim().toLowerCase().replace(/^@/, "");
  if (!domain || !domain.includes(".")) throw new CateringCompanyError(400, "invalid_payload", "Enter a valid domain (e.g. acme.com)");
  if (isPersonalDomain(domain)) {
    throw new CateringCompanyError(400, "personal_domain", "Personal email domains can't auto-attribute — attach those contacts by hand instead");
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_company_domains")
    .insert({ company_id: companyId, domain, created_by: actor.user.id })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    if (error.code === "23505") throw new CateringCompanyError(409, "domain_taken", "That domain is already registered to a company");
    throw new Error(`addDomain: ${error.message}`);
  }
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "catering.company.add_domain",
    resourceTable: "catering_company_domains", resourceId: data.id, metadata: { company_id: companyId, domain },
    ipAddress: null, userAgent: null,
  });
  return { id: data.id };
}

export async function removeDomain(actor: AuthContext, domainId: string): Promise<void> {
  requireLevel(actor, COMPANY_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("catering_company_domains").update({ active: false }, { count: "exact" }).eq("id", domainId).eq("active", true);
  if (error) throw new Error(`removeDomain: ${error.message}`);
  if (count === 0) throw new CateringCompanyError(404, "not_found", "Domain not found");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "catering.company.remove_domain",
    resourceTable: "catering_company_domains", resourceId: domainId, metadata: {},
    ipAddress: null, userAgent: null,
  });
}

/** Manually attach (or detach — null) a contact to a company account. Overrides auto-attribution. */
export async function setContactCompany(actor: AuthContext, contactId: string, companyId: string | null): Promise<void> {
  requireLevel(actor, COMPANY_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("catering_customers").update({ company_id: companyId }, { count: "exact" }).eq("id", contactId);
  if (error) throw new Error(`setContactCompany: ${error.message}`);
  if (count === 0) throw new CateringCompanyError(404, "not_found", "Contact not found");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "catering.company.attach_contact",
    resourceTable: "catering_customers", resourceId: contactId, metadata: { company_id: companyId },
    ipAddress: null, userAgent: null,
  });
}

/** Attach an EXISTING contact (found by email) to a company account. For hand-attaching
 *  personal-email contacts that can't auto-attribute. Errors if no such contact. */
export async function attachContactByEmail(actor: AuthContext, companyId: string, emailRaw: string): Promise<{ contactId: string }> {
  requireLevel(actor, COMPANY_WRITE_MIN);
  const email = normalizeEmail(emailRaw);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("catering_customers").select("id").eq("active", true).ilike("email", escapeLike(email)).maybeSingle<{ id: string }>();
  if (error) throw new Error(`attachContactByEmail lookup: ${error.message}`);
  if (!data) throw new CateringCompanyError(404, "contact_not_found", "No active contact with that email");
  await setContactCompany(actor, data.id, companyId);
  return { contactId: data.id };
}

// ── Resolve-or-create contact (the quote email-capture path) ─────────────────────
export interface ResolveContactInput {
  email: string;
  name?: string | null;
  company?: string | null;
  primaryLocationId?: string | null;
}
export interface ResolvedContact {
  id: string;
  companyId: string | null;
  created: boolean;
}

/**
 * Resolve a contact by email (the identifier), creating one if new. A new contact is
 * auto-attributed to a company when its corporate domain is registered. Email is normalized
 * (trim+lowercase) so the unique index and lookups agree.
 */
export async function resolveOrCreateContact(actor: AuthContext, input: ResolveContactInput): Promise<ResolvedContact> {
  requireLevel(actor, COMPANY_WRITE_MIN);
  const email = normalizeEmail(input.email);
  if (!email || extractDomain(email) === null) {
    throw new CateringCompanyError(400, "invalid_payload", "A valid email is required");
  }
  const sb = getServiceRoleClient();

  const { data: existing, error: lErr } = await sb
    .from("catering_customers")
    .select("id, company_id")
    .eq("active", true)
    .ilike("email", escapeLike(email))
    .maybeSingle<{ id: string; company_id: string | null }>();
  if (lErr) throw new Error(`resolveOrCreateContact lookup: ${lErr.message}`);
  if (existing) return { id: existing.id, companyId: existing.company_id, created: false };

  const companyId = await resolveCompanyForEmail(email);
  const { data: inserted, error: iErr } = await sb
    .from("catering_customers")
    .insert({
      name: (input.name && input.name.trim().length > 0 ? input.name.trim() : email),
      company: input.company ?? null,
      company_id: companyId,
      email,
      primary_location_id: input.primaryLocationId ?? null,
      active: true,
      created_by: actor.user.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (iErr) {
    if (iErr.code === "23505") {
      // Raced against a concurrent create — re-read by email.
      const { data: raced } = await sb.from("catering_customers").select("id, company_id").eq("active", true).ilike("email", escapeLike(email)).maybeSingle<{ id: string; company_id: string | null }>();
      if (raced) return { id: raced.id, companyId: raced.company_id, created: false };
    }
    throw new Error(`resolveOrCreateContact insert: ${iErr.message}`);
  }
  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.customer.create",
    resourceTable: "catering_customers",
    resourceId: inserted.id,
    metadata: { via: "quote_capture", email, auto_company_id: companyId },
    ipAddress: null,
    userAgent: null,
  });
  return { id: inserted.id, companyId, created: true };
}
