/** Operator-only transport. No dotenv, retries, response/error logging or connection reuse. */
export const SIM_REF = 'jepgzucrvklhqpthowsc';
export const PROD_REF = 'bgcvurheqzylyfehqgzh';
export function projectRef(args, simOnly = false) {
  if (args.length !== 1 || !/^--ref=[a-z]{20}$/.test(args[0])) throw new Error('Require --ref=<20-letter project ref>');
  const ref = args[0].slice(6);
  if (simOnly && (ref === PROD_REF || ref !== SIM_REF)) throw new Error('Lock proof requires the designated SIM project');
  return ref;
}
export const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export function managementQuery(ref, token, fetcher = fetch) {
  if (!/^[a-z]{20}$/.test(ref)) throw new Error('Invalid project ref');
  if (!token || /[\r\n]/.test(token)) throw new Error('Set SUPABASE_ACCESS_TOKEN explicitly');
  return async query => {
    try {
      const response = await fetcher(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }), signal: AbortSignal.timeout(30_000), redirect: 'error',
      });
      if (!response.ok) {
        // Only exact named SQL refusals are exposed; no arbitrary server text.
        const body = await response.text();
        const refusal = /\bP0001\b[^\n]*\b(completion_set_changed|instance_not_open)\b/.exec(body);
        const error = new Error(refusal ? refusal[1] : 'Management query failed');
        error.refusal = refusal?.[1];
        throw error;
      }
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Management query failed');
      return rows;
    } catch (error) {
      if (['completion_set_changed','instance_not_open'].includes(error?.refusal)) {
        const safe = new Error(error.refusal);
        safe.refusal = error.refusal;
        throw safe;
      }
      throw new Error('Management query failed');
    }
  };
}
