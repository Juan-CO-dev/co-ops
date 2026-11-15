/**
 * Audit W07 / B053 — people promoted into a manager role could never use email + password sign-in: nothing set
 * `email_verified` for them and nothing issued a verification link. Owner decision W07-1 b: a "confirm your email"
 * message. It is a NEW outbound staff email, so the load-bearing pins here are the ones that keep it CLOSED until
 * the owner opens it: no link is issued and no provider call is made unless the staff-email switch is `live` AND
 * the allowlist names the recipient. (The SQL issuer and the backfill are proven in scripts/sql-harness-0307.mjs.)
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requestEmailConfirmation } from "@/lib/admin/email-confirm";
import {
  EMAIL_CONFIRM_EXPIRES_HOURS, emailConfirmCopy, emailConfirmEligibility, emailSignInNotice, looksLikeEmail, staffConfirmDelivery,
} from "@/lib/admin/email-confirm-shared";
import { loadActionableTarget } from "@/lib/admin/users";
import { sendEmail } from "@/lib/email";
import { renderEmailConfirmEmail } from "@/lib/email-templates/email-confirm";
import { checkAndRecord } from "@/lib/portal/rate-limit";
import { ROLES, type RoleCode } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { makeSupabaseMock, type MockAnswer } from "./helpers/supabase-mock";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "resend-1" })), teamFrom: () => "team@example.test" }));
vi.mock("@/lib/portal/rate-limit", () => ({ checkAndRecord: vi.fn(async () => true) }));
vi.mock("@/lib/admin/users", () => ({
  loadActionableTarget: vi.fn(),
  AdminUserError: class AdminUserError extends Error {
    constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
  },
}));

const USER = "11111111-1111-4111-8111-111111111111";
const EMAIL = "promoted@example.test";
const actor = { user: { id: "gm-1", role: "gm" as RoleCode }, locations: ["shop"] } as never;
const target = (over: Record<string, unknown> = {}) => ({ id: USER, role: "agm", active: true, email: EMAIL, emailVerified: false, locationIds: ["shop"], ...over });

function wire(opts: { mode?: unknown; issue?: MockAnswer; language?: string } = {}) {
  const sb = makeSupabaseMock({
    rpc: (fn) => (fn === "auth_email_confirm_issue" ? (opts.issue ?? { data: { id: "link-1", email: EMAIL, links_retired: 1 } }) : { data: null }),
    table: (table) => {
      if (table === "report_settings") return opts.mode === undefined ? { data: null } : { data: { value: opts.mode } };
      if (table === "users") return { data: { language: opts.language ?? "en" } };
      return { data: null };
    },
  });
  vi.mocked(getServiceRoleClient).mockReturnValue(sb.client as never);
  return sb;
}
const auditRows = () => vi.mocked(audit).mock.calls.map((c) => c[0] as { action: string; metadata: Record<string, unknown> });
const open = () => { vi.stubEnv("STAFF_CONFIRM_EMAIL_ALLOWLIST", "*"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ops.example.test"); };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(loadActionableTarget).mockResolvedValue(target() as never);
});

describe("the delivery switches (pure): closed unless the owner opened BOTH", () => {
  const base = { deliveryMode: "live", allowlist: "*", appUrl: "https://ops.example.test", email: EMAIL };

  it("opens only with the staff switch live, an allowlist naming the recipient, and an app URL", () => {
    expect(staffConfirmDelivery(base)).toEqual({ deliver: true });
    expect(staffConfirmDelivery({ ...base, allowlist: ` other@example.test , ${EMAIL.toUpperCase()} ` })).toEqual({ deliver: true });
  });

  it.each(["off", "preview", "", null, undefined, "LIVE", "on"])("staff switch %j → nothing is sent", (deliveryMode) => {
    expect(staffConfirmDelivery({ ...base, deliveryMode })).toEqual({ deliver: false, reason: "staff_email_off" });
  });

  it.each([undefined, "", "   "])("allowlist %j (unset or empty) is CLOSED to everyone — there is no default recipient", (allowlist) => {
    expect(staffConfirmDelivery({ ...base, allowlist })).toEqual({ deliver: false, reason: "allowlist_closed" });
  });

  it("an allowlist that does not name the recipient → not sent", () => {
    expect(staffConfirmDelivery({ ...base, allowlist: "someone-else@example.test" })).toEqual({ deliver: false, reason: "not_allowlisted" });
    // …including the portal allowlist's historical default: it is NOT inherited here
    expect(staffConfirmDelivery({ ...base, allowlist: undefined, email: "juan@complimentsonlysubs.com" }).deliver).toBe(false);
  });

  it("no app URL → no link to send", () => {
    expect(staffConfirmDelivery({ ...base, appUrl: undefined })).toEqual({ deliver: false, reason: "app_url_missing" });
  });
});

describe("who a confirmation email is for (pure)", () => {
  const t = { role: "agm" as RoleCode, active: true, email: EMAIL, emailVerified: false };

  it("an active manager-role person with an unconfirmed email", () => {
    expect(emailConfirmEligibility(t)).toBe("eligible");
    expect(emailSignInNotice(t)).toBe("unconfirmed");
  });

  it("every role follows lib/roles.ts hasEmailAuth — never a role below manager", () => {
    for (const role of Object.keys(ROLES) as RoleCode[]) {
      expect(emailConfirmEligibility({ ...t, role }), role).toBe(ROLES[role].hasEmailAuth ? "eligible" : "role_not_email_auth");
    }
    expect(emailSignInNotice({ ...t, role: "shift_lead" })).toBeNull();
  });

  it("names why not: inactive, no email, already confirmed", () => {
    expect(emailConfirmEligibility({ ...t, active: false })).toBe("inactive");
    expect(emailConfirmEligibility({ ...t, email: null })).toBe("no_email");
    expect(emailConfirmEligibility({ ...t, email: "  " })).toBe("no_email");
    expect(emailConfirmEligibility({ ...t, emailVerified: true })).toBe("already_confirmed");
    expect(emailSignInNotice({ ...t, email: null })).toBe("no_email");
    expect(emailSignInNotice({ ...t, emailVerified: true })).toBeNull();
    expect(emailSignInNotice({ ...t, active: false })).toBeNull();
  });

  it("looksLikeEmail is a shape check only", () => {
    expect(["a@b.co", "first.last+tag@shop.example"].every(looksLikeEmail)).toBe(true);
    expect(["", "a@b", "a b@c.d", "@b.co", "a@@b.co"].some(looksLikeEmail)).toBe(false);
  });
});

describe("requestEmailConfirmation — ships closed", () => {
  it("with NO env and NO setting (the shipped state): no link issued, no provider call, an audit row saying why", async () => {
    const sb = wire();
    const result = await requestEmailConfirmation(actor, USER);
    expect(result).toEqual({ outcome: "suppressed", reason: "staff_email_off" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sb.rpcCalls).toEqual([]); // no token exists anywhere
    expect(checkAndRecord).not.toHaveBeenCalled();
    expect(auditRows()).toEqual([expect.objectContaining({ action: "user.email_confirm_request", metadata: { outcome: "suppressed", reason: "staff_email_off" } })]);
  });

  it.each([
    ["staff switch off, allowlist open", "off", "*", "staff_email_off"],
    ["staff switch preview, allowlist open", "preview", "*", "staff_email_off"],
    ["staff switch live, allowlist unset", "live", undefined, "allowlist_closed"],
    ["staff switch live, allowlist empty", "live", "", "allowlist_closed"],
    ["staff switch live, recipient not listed", "live", "someone-else@example.test", "not_allowlisted"],
  ])("%s → nothing issued, nothing sent", async (_name, mode, allowlist, reason) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ops.example.test");
    if (allowlist !== undefined) vi.stubEnv("STAFF_CONFIRM_EMAIL_ALLOWLIST", allowlist);
    const sb = wire({ mode });
    expect(await requestEmailConfirmation(actor, USER)).toEqual({ outcome: "suppressed", reason });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sb.rpcCalls).toEqual([]);
  });

  it("a settings read that fails is 'off', never open", async () => {
    open();
    const sb = makeSupabaseMock({ table: () => ({ error: { message: "relation report_settings does not exist", code: "42P01" } }) });
    vi.mocked(getServiceRoleClient).mockReturnValue(sb.client as never);
    expect((await requestEmailConfirmation(actor, USER)).outcome).toBe("suppressed");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("requestEmailConfirmation — once the owner opened both switches", () => {
  it("issues ONE link by hash and mails the raw link to the address the database returned", async () => {
    open();
    const sb = wire({ mode: "live" });
    expect(await requestEmailConfirmation(actor, USER)).toEqual({ outcome: "sent" });
    const [fn, args] = sb.rpcCalls[0]!;
    expect(fn).toBe("auth_email_confirm_issue");
    expect(args).toMatchObject({ p_actor: "gm-1", p_user: USER });
    expect(String(args.p_token_hash)).toMatch(/^[0-9a-f]{64}$/);
    const hours = (new Date(String(args.p_expires_at)).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(EMAIL_CONFIRM_EXPIRES_HOURS - 0.1);
    expect(hours).toBeLessThanOrEqual(EMAIL_CONFIRM_EXPIRES_HOURS);

    expect(sendEmail).toHaveBeenCalledOnce();
    const mail = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(mail).toMatchObject({ to: EMAIL, from: "team@example.test", idempotencyKey: "email-confirm/link-1" });
    const raw = /https:\/\/ops\.example\.test\/verify\?token=([0-9a-f]{64})/.exec(mail.text)?.[1];
    expect(raw).toBeDefined();
    expect(mail.html).toContain(`/verify?token=${raw}`);
    // the database got the HASH of that token, never the token
    expect(args.p_token_hash).not.toBe(raw);
    // and neither the token nor the address reaches the audit trail
    const trail = JSON.stringify(auditRows());
    expect(trail).not.toContain(raw!);
    expect(trail).not.toContain(EMAIL);
    expect(auditRows()).toEqual([expect.objectContaining({ action: "user.email_confirm_request",
      metadata: expect.objectContaining({ outcome: "sent", verification_id: "link-1", links_retired: 1, resend_id: "resend-1" }) })]);
  });

  it("a Spanish-language manager gets the Spanish email", async () => {
    open();
    wire({ mode: "live", language: "es" });
    await requestEmailConfirmation(actor, USER);
    expect(vi.mocked(sendEmail).mock.calls[0]![0].subject).toContain("Confirma tu correo");
  });

  it("if the address changed to one the allowlist does not name, nothing is sent", async () => {
    vi.stubEnv("STAFF_CONFIRM_EMAIL_ALLOWLIST", EMAIL);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ops.example.test");
    wire({ mode: "live", issue: { data: { id: "link-2", email: "just-changed@example.test", links_retired: 0 } } });
    expect(await requestEmailConfirmation(actor, USER)).toEqual({ outcome: "suppressed", reason: "not_allowlisted" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the per-person throttle stops a fourth email before any link is issued", async () => {
    open();
    const sb = wire({ mode: "live" });
    vi.mocked(checkAndRecord).mockResolvedValueOnce(false);
    expect(await requestEmailConfirmation(actor, USER)).toEqual({ outcome: "throttled" });
    expect(checkAndRecord).toHaveBeenCalledWith(`email_confirm:${USER}`, 900, 3);
    expect(sb.rpcCalls).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("before migration 0307 is applied: not_installed, nothing sent", async () => {
    open();
    wire({ mode: "live", issue: { error: { code: "PGRST202", message: "Could not find the function" } } });
    expect(await requestEmailConfirmation(actor, USER)).toEqual({ outcome: "not_installed" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the issuer's refusals keep their names", async () => {
    open();
    wire({ mode: "live", issue: { error: { code: "P0001", message: "target_outside_shop" } } });
    await expect(requestEmailConfirmation(actor, USER)).rejects.toMatchObject({ status: 403, code: "target_outside_shop" });
    wire({ mode: "live", issue: { error: { code: "P0001", message: "email_already_confirmed" } } });
    await expect(requestEmailConfirmation(actor, USER)).rejects.toMatchObject({ status: 409, code: "email_already_confirmed" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a provider failure is reported as send_failed, never as sent", async () => {
    open();
    wire({ mode: "live" });
    vi.mocked(sendEmail).mockResolvedValueOnce({ error: "provider down" });
    expect(await requestEmailConfirmation(actor, USER)).toEqual({ outcome: "send_failed" });
  });
});

describe("requestEmailConfirmation — the friendly refusals come before anything else", () => {
  it.each([
    [{ email: null }, 400, "email_required"],
    [{ emailVerified: true }, 409, "email_already_confirmed"],
    [{ role: "shift_lead" }, 409, "email_confirm_not_available"],
    [{ active: false }, 409, "email_confirm_not_available"],
  ])("%j → %i %s", async (over, status, code) => {
    open();
    const sb = wire({ mode: "live" });
    vi.mocked(loadActionableTarget).mockResolvedValue(target(over) as never);
    await expect(requestEmailConfirmation(actor, USER)).rejects.toMatchObject({ status, code });
    expect(sb.rpcCalls).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("the email and its wiring", () => {
  it("renders a /verify link (the existing set-password page) in both languages, with no visible token elsewhere", () => {
    for (const language of ["en", "es"] as const) {
      const mail = renderEmailConfirmEmail({ rawToken: "f".repeat(64), appUrl: "https://ops.example.test/", expiresInHours: 24, language });
      expect(mail.text).toContain(`https://ops.example.test/verify?token=${"f".repeat(64)}`);
      expect(mail.subject).toBe(emailConfirmCopy({ tenantName: "Compliments Only", language, expiresInHours: 24 }).subject);
      expect(mail.html.split("f".repeat(64)).length - 1).toBe(mail.html.includes(">https://") ? 2 : 1);
    }
    expect(emailConfirmCopy({ tenantName: "X", language: "es", expiresInHours: 1 }).footer).toContain("1 hora.");
    expect(emailConfirmCopy({ tenantName: "X", language: "en", expiresInHours: 1 }).footer).toContain("1 hour.");
  });

  it("the route is same-origin first, GM floor, Tier B", () => {
    const src = readFileSync("app/api/admin/users/[id]/confirm-email/route.ts", "utf8");
    const order = ["= assertSameOrigin(req)", "await requireSession(", "< ADMIN_MIN_LEVEL", 'assertStepUp(ctx, "B")', "await requestEmailConfirmation("].map((s) => src.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the server checks the switches BEFORE it issues a link, and nothing logs the token", () => {
    const src = readFileSync("lib/admin/email-confirm.ts", "utf8");
    const body = src.slice(src.indexOf("export async function requestEmailConfirmation("));
    expect(body.indexOf("if (!first.deliver)")).toBeGreaterThan(-1);
    expect(body.indexOf("if (!first.deliver)")).toBeLessThan(body.indexOf("generateToken()"));
    expect(body.indexOf("generateToken()")).toBeLessThan(body.indexOf("sb.rpc(call.fn, call.args)"));
    expect(body).not.toMatch(/console\.(log|warn|error|info)/);
    expect(body).not.toMatch(/metadata:[^\n]*rawToken/);
  });

  it("the admin screen offers the action and Edit profile can set the email", () => {
    const actions = readFileSync("components/admin/users/UserActions.tsx", "utf8");
    expect(actions).toContain('emailSignInNotice(user) === "unconfirmed"');
    expect(actions).toContain("/confirm-email");
    expect(actions).toContain('type="email"');
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    for (const k of ["sent", "send_failed", "suppressed", "throttled", "not_installed", "not_needed"]) {
      expect(en[`admin.users.email_confirm.${k}`], k).toBeTruthy();
      expect(es[`admin.users.email_confirm.${k}`], k).toBeTruthy();
    }
  });
});
