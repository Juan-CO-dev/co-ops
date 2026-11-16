import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Audit W11 (B066a, B067, B068, B168): 0311 re-emits two 0298 functions. The harness runs the REAL 0296 + 0298 + 0311.
const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8").replace(/\r\n/g, "\n");
const body = (sql: string, name: string) => {
  const match = sql.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;\\n`));
  expect(match, name).toBeTruthy();
  return match![0].split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("--"));
};
/** Every line of `from` appears in `to`, in order. */
const subsequence = (from: string[], to: string[]) => {
  let at = 0;
  for (const line of from) {
    while (at < to.length && to[at] !== line) at++;
    if (at === to.length) return line;
    at++;
  }
  return null;
};

it("0311 re-emits the 0298 claim and queue verbatim except the marked lines", () => {
  const old = read("0298_catering_inbox_delivery.sql"), next = read("0311_catering_inbox_delivery_fixes.sql");
  const oldClaim = body(old, "claim_catering_inbox_delivery"), newClaim = body(next, "claim_catering_inbox_delivery");
  const guard = oldClaim.slice(oldClaim.findIndex(l => l.startsWith("if (m.headers->>'auto-submitted')")), oldClaim.indexOf("if p_kind = 'reply' then"));
  expect(guard).toHaveLength(4);
  const replaced = new Map([
    ["create function public.claim_catering_inbox_delivery(", "create or replace function public.claim_catering_inbox_delivery("],
    ["if sqlerrm not in ('invalid_recipient','revalidation_failed','quote_revalidation_failed','own_address') then raise; end if;",
      "if sqlerrm not in ('invalid_recipient','revalidation_failed','quote_revalidation_failed','own_address','unsafe_preview') then raise; end if;"],
  ]);
  const preview = "or (p_escalation->>'preview_text') ~ '(https?://[^\\s]*[?#]|token=)'";
  const expected = oldClaim.filter(l => !guard.includes(l) && l !== preview).map(l => replaced.get(l) ?? l.replace(/v_reserved integer;$/, "v_reserved integer; v_recipient_reserved integer;"));
  expect(subsequence(expected, newClaim)).toBeNull();
  // The loop guard moved INSIDE the reply branch (B067), before the recipient checks.
  const reply = newClaim.indexOf("if p_kind = 'reply' then");
  expect(newClaim.slice(reply + 1, reply + 5)).toEqual(guard);
  expect(newClaim).toContain("if (p_escalation->>'preview_text') ~ '(https?://[^\\s]*[?#]|token=)' then raise exception 'unsafe_preview'; end if;");
  expect(newClaim).toContain("if v_recipient_reserved is null then raise exception 'recipient_cap'; end if;");
  expect(newClaim.filter(l => !expected.includes(l))).toHaveLength(4 + 5 + 1);
  const oldDue = body(old, "catering_inbox_delivery_due"), newDue = body(next, "catering_inbox_delivery_due");
  expect(subsequence(oldDue.map(l => l.replace("create function", "create or replace function").replace(/(on m\.id = d\.message_id), s$/, "$1, s, today")), newDue)).toBeNull();
  expect(newDue.filter(l => !oldDue.includes(l)).join("\n")).toMatch(/catering_inbox_thread_limits[\s\S]*catering_inbox_recipient_limits/);
});

it("0311 real-DDL proof: bugs reproduced on 0298, fixed by 0311, 0298 guarantees re-checked", () => {
  const output = execFileSync(process.execPath, ["scripts/sql-harness-0311.mjs"], { encoding: "utf8", timeout: 300_000 });
  expect(output).toContain("PASS 0311:");
  for (const line of [
    "without 0298: refused, no partial schema", "a claim body drifted from 0298 is refused before any DDL", "second application refused",
    "0298 reproduces B067: an urgent automated-header escalation is tombstoned invalid_recipient",
    "0298 reproduces B068: an unsafe preview raises invalid_escalation", "0298 reproduces B068: no tombstone, the message is still due",
    "0298 reproduces B168: capped drafts fill the page ahead of a newer reply",
    "0298 reproduces B066: four replies to one address on four forged threads in one day",
    "catering_inbox_recipient_limits: complete table/column ACL and RLS", "claim_catering_inbox_delivery: definer/search_path/execution ceiling, no artifact writes",
    "catering_inbox_delivery_due: definer/search_path/execution ceiling, no artifact writes",
    "service_role cannot write the recipient cap directly", "backfill counts today's reply attempts",
    "fourth reply to one recipient across fresh threads in a UTC day refused (recipient_cap)",
    "a recipient_cap refusal rolls back: no thread slot, no state, no revision", "the recipient cap binds a staff Send too",
    "a same-day retry reuses both reservations", "the backfilled address is then capped", "a recipient-capped draft is not due",
    "the recipient-capped draft is due again the next UTC day",
    "an escalation of an auto-submitted ezCater message is claimed for the assignee", "a reply to the same headers is still refused invalid_recipient",
    "every automated header still refuses a reply", "B067 tombstones made before 0311 are left as they are",
    "an unsafe preview tombstones once (needs_review / unsafe_preview, no attempt)", "the tombstoned escalation leaves the queue",
    "a tombstoned escalation is never re-claimed", "other envelope mismatches stay transient invalid_escalation",
    "an unsafe preview tombstones once; a newer escalation is claimed within two ticks behind 30 of them",
    "30 drafts on one capped thread: a newer legitimate reply is due on the first tick", "a draft holding today's reservation on a full thread stays due",
    "the capped drafts become due again the next UTC day",
    "fourth reply to one thread in a UTC day refused", "the thread cap binds humans too", "cron stops after three attempts", "own address still terminalizes",
    "a new eligible reply is due behind 60 handled / sent predecessors", "nothing is due unless live", "a new live window never bulk-sends an old draft (not_new)",
  ]) expect(output).toContain(line);
}, 320_000);
