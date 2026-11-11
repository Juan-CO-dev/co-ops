import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { INBOX_CLASSIFICATIONS, INBOX_DISPOSITIONS, INBOX_GROUPS, INBOX_IDENTITIES, INBOX_REASONS } from "@/lib/catering/inbox-shared";
import { INBOX_CUSTOMER_STATUSES } from "@/lib/catering/inbox-playbooks-shared";
it("all inbox text and placeholders ship together in en/es", () => {
  const e = en as Record<string, string>, s = es as Record<string, string>;
  const keys = (dict: Record<string, string>) => Object.keys(dict).filter(k => k.startsWith("catering.inbox.")).sort();
  expect(keys(e).length).toBeGreaterThan(70); expect(keys(e)).toEqual(keys(s));
  for (const key of keys(e)) {
    expect((s[key]!.match(/\{\w+\}/g) ?? []).sort(), key).toEqual((e[key]!.match(/\{\w+\}/g) ?? []).sort());
    expect(s[key], key).not.toMatch(/\?|\ufffd/);
    expect(key).not.toMatch(/link_notice|preview_link|\.escalation\./);
  }
  for (const [prefix, values] of [["reason", INBOX_REASONS], ["group", INBOX_GROUPS], ["class", INBOX_CLASSIFICATIONS], ["identity", INBOX_IDENTITIES], ["disposition", INBOX_DISPOSITIONS], ["customer_status", INBOX_CUSTOMER_STATUSES]] as const)
    for (const value of values) expect(e[`catering.inbox.${prefix}.${value}`]).toBeTruthy();
  expect(e["catering.inbox.drafts_not_sent"]).toBe("Drafts are not being sent yet");
});
