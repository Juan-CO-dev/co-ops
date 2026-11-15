/**
 * A tiny in-memory stand-in for the auth tables, for RACE tests of the two token routes (audit W07, fix round 1).
 *
 * It models exactly one thing faithfully: WHICH STEPS ARE ATOMIC.
 *   - a PostgREST table call (`from("users").select…`, `.insert…`, `.update…`) is ONE request: it sees and changes
 *     the state as it is when the request lands, and nothing holds between two of them;
 *   - a 0307 function (`rpc`) is ONE transaction under the person's lock: its checks and its writes cannot be
 *     separated by anyone else's write. The bodies here are line-for-line the rules of the SQL
 *     (`auth_password_reset_issue`, `auth_email_confirm_consume`); the SQL itself is proven in
 *     scripts/sql-harness-0307.mjs (cases R1 / R2).
 *   - the admin writers (`adminChangeEmail`, `adminSetRole`, `adminSetPassword`) are 0307's / 0279's functions: one
 *     step each, retiring links and revoking sessions exactly as those do.
 *
 * A test pauses the route with a controlled promise (`hold`), lets an admin write commit, then lets the route go on
 * — the interleaving a real second session would produce.
 */
import { makeSupabaseMock, type MockAnswer, type TableCall } from "./supabase-mock";

export class CredentialChangedError extends Error {
  constructor() { super("credential_changed"); this.name = "CredentialChangedError"; }
}

export interface ModelUser { id: string; email: string | null; role: string; active: boolean; email_verified: boolean; password_hash: string | null }
export interface ModelLink { id: string; user_id: string; token_hash: string; expires_at: string; consumed_at: string | null; issued_email: string | null }

/** A promise the test resolves by hand, with a signal for "the code under test got here". */
export function deferred<T = void>() {
  let release!: (v: T) => void;
  let arrive!: () => void;
  const released = new Promise<T>((r) => { release = r; });
  const reached = new Promise<void>((r) => { arrive = r; });
  return { released, reached, release, arrive };
}

const MANAGER_ROLES = new Set(["agm", "catering_mgr", "prep_mgr", "social_media_mgr", "gm", "moo", "owner", "cgs"]); // level 6+
const p0001 = (message: string): MockAnswer => ({ error: { code: "P0001", message } });
const MISSING = (fn: string): MockAnswer => ({ error: { code: "PGRST202", message: `Could not find the function public.${fn} in the schema cache` } });
const lower = (s: string | null) => (s ?? "").trim().toLowerCase();
const arg = (call: TableCall, op: string, column: string) => call.ops.find((o) => o[0] === op && o[1][0] === column)?.[1][1];

export function makeAuthRaceModel(seed: { user: ModelUser; installed?: boolean }) {
  const user: ModelUser = { ...seed.user };
  const resets: ModelLink[] = [];
  const verifications: ModelLink[] = [];
  const sessions: Array<{ id: string; revoked: boolean; minted: boolean }> = [];
  /** Every WRITE the route made, in order (`table:op` or `rpc:fn`), so a test can say "nothing was written yet". */
  const writes: string[] = [];
  let installed = seed.installed ?? true;
  let failNextCredentialWrite = false;
  let seq = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const now = () => new Date().toISOString();
  const open = (l: ModelLink) => l.consumed_at === null && new Date(l.expires_at) > new Date();
  const retire = (links: ModelLink[]) => { let n = 0; for (const l of links) if (l.consumed_at === null) { l.consumed_at = now(); n++; } return n; };
  const revokeAll = () => { let n = 0; for (const s of sessions) if (!s.revoked) { s.revoked = true; n++; } return n; };

  /** One-shot pauses, keyed `table:op` / `rpc:fn`. "after" = the answer is computed, then its delivery waits. */
  const holds = new Map<string, ReturnType<typeof deferred<void>>>();
  async function maybeHold(key: string) {
    const h = holds.get(key);
    if (!h) return;
    holds.delete(key);
    h.arrive();
    await h.released;
  }

  // ── the 0307 functions: ONE transaction each ──
  function resetIssue(a: Record<string, unknown>): MockAnswer {
    if (a.p_user !== user.id) return p0001("user_not_found");
    if (lower(user.email) !== lower(a.p_email as string)) return p0001("email_changed");
    if (!user.active) return p0001("user_inactive");
    if (!MANAGER_ROLES.has(user.role)) return p0001("role_not_email_auth");
    if (!user.email_verified) return p0001("email_not_verified");
    if (user.password_hash !== (a.p_seen_password_hash ?? null)) return p0001("credential_changed");
    const link: ModelLink = { id: nextId(), user_id: user.id, token_hash: a.p_token_hash as string, expires_at: a.p_expires_at as string, consumed_at: null, issued_email: lower(user.email) };
    resets.push(link);
    return { data: { id: link.id, email: lower(user.email), role: user.role } };
  }
  function confirmConsume(a: Record<string, unknown>): MockAnswer {
    const link = verifications.find((l) => l.token_hash === a.p_token_hash);
    if (!link) return p0001("token_invalid");
    if (link.consumed_at !== null) return p0001("token_consumed");
    if (new Date(link.expires_at) <= new Date()) return p0001("token_expired");
    if (!MANAGER_ROLES.has(user.role)) return p0001("role_not_email_auth");
    if (!user.email || (link.issued_email !== null && link.issued_email !== lower(user.email))) return p0001("email_changed");
    if (!user.active) return p0001("account_inactive");
    if (failNextCredentialWrite) { failNextCredentialWrite = false; return { error: { code: "57014", message: "canceling statement due to statement timeout" } }; }
    user.password_hash = a.p_password_hash as string;
    user.email_verified = true;
    retire(verifications);
    const resetLinksRetired = retire(resets);
    return { data: { verification_id: link.id, user_id: user.id, role: user.role, email: lower(user.email), sessions_revoked: revokeAll(), reset_links_retired: resetLinksRetired } };
  }

  const sb = makeSupabaseMock({
    rpc: async (fn, args) => {
      writes.push(`rpc:${fn}`);
      await maybeHold(`rpc:${fn}`);
      if (!installed) return MISSING(fn);
      if (fn === "auth_password_reset_issue") return resetIssue(args);
      if (fn === "auth_email_confirm_consume") return confirmConsume(args);
      return { data: null };
    },
    // ── PostgREST: each call is its own request ──
    table: async (table, ops, call) => {
      const key = `${table}:${ops.find((o) => ["insert", "update"].includes(o)) ?? "select"}`;
      if (key.endsWith(":insert") || key.endsWith(":update")) writes.push(key);
      let answer: MockAnswer = { data: null };
      if (key === "users:select") {
        const hit = arg(call, "eq", "email") !== undefined ? user.email === arg(call, "eq", "email") : arg(call, "eq", "id") === user.id;
        answer = { data: hit ? { ...user } : null };
      } else if (key === "users:update") {
        if (failNextCredentialWrite) { failNextCredentialWrite = false; answer = { error: { code: "57014", message: "canceling statement due to statement timeout" } }; }
        else {
          const patch = call.ops.find((o) => o[0] === "update")![1][0] as Partial<ModelUser>;
          if ("password_hash" in patch) user.password_hash = patch.password_hash ?? null;
          if ("email_verified" in patch) user.email_verified = Boolean(patch.email_verified);
          answer = { data: { id: user.id, role: user.role, active: user.active } };
        }
      } else if (key === "password_resets:insert") {
        const row = call.ops.find((o) => o[0] === "insert")![1][0] as { user_id: string; token_hash: string; expires_at: string };
        const link: ModelLink = { id: nextId(), ...row, consumed_at: null, issued_email: null }; // a plain insert binds nothing
        resets.push(link);
        answer = { data: { id: link.id } };
      } else if (key === "email_verifications:select") {
        const link = verifications.find((l) => l.token_hash === arg(call, "eq", "token_hash"));
        answer = { data: link ? { ...link } : null };
      } else if (key === "email_verifications:update") {
        const link = verifications.find((l) => l.id === arg(call, "eq", "id") && l.consumed_at === null);
        if (link) link.consumed_at = now();
        answer = { data: link ? [{ id: link.id }] : [] };
      }
      await maybeHold(`${key}:after`);
      return answer;
    },
  });

  return {
    client: sb.client,
    rpcCalls: sb.rpcCalls,
    user, resets, verifications, sessions, writes,
    setInstalled(v: boolean) { installed = v; },
    /** The next credential write (the function's, or the legacy `users` update) fails once, changing nothing. */
    failNextCredentialWrite() { failNextCredentialWrite = true; },
    /** Pause the route at its next `key` request until the test calls `.release()`. */
    hold(key: string) { const h = deferred<void>(); holds.set(key, h); return h; },
    seedVerification(tokenHash: string, over: Partial<ModelLink> = {}) {
      const link: ModelLink = { id: nextId(), user_id: user.id, token_hash: tokenHash, expires_at: new Date(Date.now() + 86_400_000).toISOString(), consumed_at: null, issued_email: lower(user.email), ...over };
      verifications.push(link);
      return link;
    },
    seedSession() { sessions.push({ id: nextId(), revoked: false, minted: false }); },
    // ── the other writers (each ONE committed step) ──
    /** admin_user_update_profile on an email change: the address, then every open link retired, sessions revoked. */
    adminChangeEmail(email: string) { user.email = email; retire(resets); retire(verifications); revokeAll(); },
    /** admin_user_set_role: the role, sessions revoked. It retires NO link. */
    adminSetRole(role: string) { user.role = role; revokeAll(); },
    /** admin_user_set_credential (password): the hash, open reset links retired, sessions revoked. */
    adminSetPassword(hash: string) { user.password_hash = hash; retire(resets); revokeAll(); },
    /** revokeAllUserSessions (the legacy path's own step). */
    revokeAllSessions() { return { count: revokeAll() }; },
    /** auth_create_session: mint only while the verified hash (and the looked-up email) are still the stored ones. */
    mint(credential: { kind: string; hash: string; loginEmail?: string }) {
      if (!user.active || user.password_hash !== credential.hash || (credential.loginEmail !== undefined && lower(user.email) !== lower(credential.loginEmail))) {
        throw new CredentialChangedError();
      }
      const s = { id: nextId(), revoked: false, minted: true };
      sessions.push(s);
      return { sessionId: s.id, atomic: true };
    },
    // ── what a test asserts on ──
    /** Reset links the CONSUMER would accept right now (open, unexpired, and — when bound — for the current address). */
    usableResetLinks: () => resets.filter((l) => open(l) && (l.issued_email === null || l.issued_email === lower(user.email))),
    openVerifications: () => verifications.filter(open),
    liveSessions: () => sessions.filter((s) => !s.revoked),
  };
}
