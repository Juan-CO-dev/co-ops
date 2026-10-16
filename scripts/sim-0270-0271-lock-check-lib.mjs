/**
 * The pure pieces of scripts/sim-0270-0271-lock-check.mjs, importable by its tests (Astra chunk G review #2 / #3).
 * No database client is imported here; nothing in this file opens a connection.
 *
 * `simDatabaseTarget(raw)` — THE GUARD (BC-060). The URL is PARSED and the EFFECTIVE destination is established, never
 * searched for a substring: a sim ref in the password, in `application_name` or in a path proves nothing. Accepted:
 *   - the sim DIRECT host `db.jepgzucrvklhqpthowsc.supabase.co` as user `postgres`, or
 *   - an approved Supabase POOLER host (SIM_POOLER_HOSTS, us-east-1: the sim's region) as the sim tenant user
 *     `postgres.jepgzucrvklhqpthowsc` — on the pooler the username selects the project;
 * always port 5432 (session mode: the checks need one backend per session for pg_backend_pid / pg_locks), database
 * `postgres`, protocol postgres(ql), one host only. The ONLY query parameter allowed is `sslmode`; `options`, `host`,
 * `hostaddr` and every other override are refused. A URL naming the PROD project is refused first, by name.
 * The script then hands `pg` the explicit `config` built here — never the raw connection string — so the client can
 * only reach the destination that was checked.
 *
 * `retireLockFixture(w, fixture)` — the CLEANUP (BC-033). Retires the committed 2099 fixture the append-only way
 * (days superseded, a created criterion deactivated), counts every failed retirement, then RE-QUERIES and returns the
 * fixture ids that are still live, so the run can fail and name them.
 */
export const PROD_PROJECT = "bgcvurheqzylyfehqgzh";
export const SIM_PROJECT = "jepgzucrvklhqpthowsc";
export const SIM_DIRECT_HOST = `db.${SIM_PROJECT}.supabase.co`;
export const SIM_POOLER_USER = `postgres.${SIM_PROJECT}`;
/** The approved pooler hosts: Supabase's shared Supavisor hosts for us-east-1 (the sim's region). */
export const SIM_POOLER_HOSTS = Object.freeze(["aws-0-us-east-1.pooler.supabase.com", "aws-1-us-east-1.pooler.supabase.com"]);
const SSL_MODES = { disable: false, require: { rejectUnauthorized: false }, "no-verify": { rejectUnauthorized: false }, "verify-full": true };

/** @returns {{ ok: true, config: object, via: "direct" | "pooler" } | { ok: false, reason: string }} */
export function simDatabaseTarget(raw) {
  if (!raw) return { ok: false, reason: "SIM_DATABASE_URL is not set" };
  if (raw.includes(PROD_PROJECT)) return { ok: false, reason: "refusing: that URL names the PROD project — this check runs on the sim only" };
  const refuse = (why) => ({ ok: false, reason: `refusing: ${why} — this check runs on the sim only` });
  if (/[\s\\]/.test(raw)) return refuse("the URL holds whitespace or a backslash");
  const authority = raw.includes("//") ? raw.slice(raw.indexOf("//") + 2).split(/[/?#]/)[0] : "";
  if (authority.slice(authority.lastIndexOf("@") + 1).includes(",")) return refuse("multi-host URLs are not accepted");
  let url;
  try { url = new URL(raw); } catch { return refuse("the URL does not parse"); }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return refuse(`protocol ${url.protocol} is not postgres`);
  if (url.host.includes(",")) return refuse("multi-host URLs are not accepted");
  const host = url.hostname.toLowerCase();
  const user = decodeURIComponent(url.username);
  const port = url.port === "" ? 5432 : Number(url.port);
  let via;
  if (host === SIM_DIRECT_HOST && user === "postgres") via = "direct";
  else if (SIM_POOLER_HOSTS.includes(host) && user === SIM_POOLER_USER) via = "pooler";
  else return refuse(`host ${host || "(none)"} with user ${user || "(none)"} is not the sim (direct host as postgres, or an approved pooler host as ${SIM_POOLER_USER})`);
  if (port !== 5432) return refuse(`port ${url.port} — only 5432 (direct, or the pooler's session mode)`);
  if (url.pathname !== "/postgres") return refuse(`database ${url.pathname || "(none)"} — only /postgres`);
  if (url.hash) return refuse("a #fragment is not accepted");
  const params = [...url.searchParams.keys()];
  const extra = params.filter((k) => k !== "sslmode");
  if (extra.length) return refuse(`query override(s) ${extra.join(", ")} — only sslmode is accepted`);
  const sslmode = url.searchParams.get("sslmode");
  if (params.filter((k) => k === "sslmode").length > 1) return refuse("sslmode is given twice");
  if (sslmode !== null && !(sslmode in SSL_MODES)) return refuse(`sslmode ${sslmode} is not one of ${Object.keys(SSL_MODES).join(", ")}`);
  const config = { host, port, user, password: decodeURIComponent(url.password), database: "postgres" };
  if (sslmode !== null) config.ssl = SSL_MODES[sslmode];
  return { ok: true, config, via };
}

/**
 * Retire the fixture (never delete) and report what is still live.
 * @returns {Promise<{ failures: number, errors: string[], stillLive: { days: string[], criterion: string | null } }>}
 */
export async function retireLockFixture(w, fixture) {
  const errors = [];
  if (fixture.days.length) {
    await w.query("update public.pm_reports set superseded_at = clock_timestamp() where id = any($1::uuid[]) and superseded_at is null", [fixture.days])
      .catch((e) => errors.push(`cleanup (days): ${e.message}`));
  }
  if (fixture.criterion) {
    await w.query("update public.pm_criteria set active = false, updated_at = clock_timestamp() where id = $1 and active", [fixture.criterion])
      .catch((e) => errors.push(`cleanup (criterion): ${e.message}`));
  }
  const stillLive = { days: [], criterion: null };
  if (fixture.days.length) {
    try {
      const r = await w.query("select id from public.pm_reports where id = any($1::uuid[]) and superseded_at is null order by id", [fixture.days]);
      stillLive.days = r.rows.map((x) => x.id);
    } catch (e) { errors.push(`cleanup re-check (days): ${e.message}`); stillLive.days = [...fixture.days]; }
  }
  if (fixture.criterion) {
    try {
      const r = await w.query("select id from public.pm_criteria where id = $1 and active", [fixture.criterion]);
      stillLive.criterion = r.rows[0]?.id ?? null;
    } catch (e) { errors.push(`cleanup re-check (criterion): ${e.message}`); stillLive.criterion = fixture.criterion; }
  }
  const live = stillLive.days.length + (stillLive.criterion ? 1 : 0);
  return { failures: errors.length + (live > 0 ? 1 : 0), errors, stillLive };
}
