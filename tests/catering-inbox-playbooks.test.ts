import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { cateringInboxPlaybook, inboxCustomerStatus, type InboxPlaybookInput } from "@/lib/catering/inbox-playbooks-shared";
import { INBOX_CHANNELS, INBOX_CLASSIFICATIONS, INBOX_REASONS } from "@/lib/catering/inbox-shared";
const translate = (lang: "en" | "es") => (key: string, params: Record<string, string> = {}) => {
  const value = (lang === "en" ? en : es) as Record<string, string>;
  if (!value[key]) throw new Error(`Missing key ${key}`);
  return value[key]!.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
};
const base: InboxPlaybookInput = { decision: { classification: "intake", disposition: "drafted", reason: null, channel: "email", threadInitial: true }, identity: "resolved", language: "en", portalUrl: "https://tenant.example/order/start", tenantName: "Tenant", translate: translate("en") };
describe("reply-only playbook matrix", () => {
  for (const language of ["en", "es"] as const) for (const channel of INBOX_CHANNELS) for (const classification of INBOX_CLASSIFICATIONS) {
    it(`${language}/${channel}/${classification}`, () => {
      const draft = cateringInboxPlaybook({ ...base, language, translate: translate(language), decision: { ...base.decision, classification, channel } });
      const eligible = ["intake", "troubleshoot_ours", "troubleshoot_third_party"].includes(classification);
      expect(draft !== null).toBe(eligible);
      if (draft) {
        expect(draft.preview_text).not.toMatch(/\{\w+\}/);
        expect(draft.language).toBe(language);
        expect(draft.params.portalUrl).toBe(base.portalUrl);
        if (channel === "ezcater") expect(draft.preview_text).not.toMatch(/savings|ahorrar/);
      }
    });
  }
  it("all human reasons and followups preclude drafts", () => {
    for (const reason of INBOX_REASONS) expect(cateringInboxPlaybook({ ...base, decision: { ...base.decision, reason } })).toBeNull();
    expect(cateringInboxPlaybook({ ...base, decision: { ...base.decision, threadInitial: false } })).toBeNull();
    for (const disposition of ["handled", "needs_human", "notification", "noise", "recorded"] as const)
      expect(cateringInboxPlaybook({ ...base, decision: { ...base.decision, disposition } })).toBeNull();
  });
  it("requires a resolved identity for ours, allows new direct senders for intake", () => {
    expect(cateringInboxPlaybook({ ...base, identity: "new_sender" })).not.toBeNull();
    expect(cateringInboxPlaybook({ ...base, identity: "new_sender", decision: { ...base.decision, classification: "troubleshoot_ours" } })).toBeNull();
    for (const identity of ["ambiguous", "masked", "missing"] as const) expect(cateringInboxPlaybook({ ...base, identity })).toBeNull();
  });
  it.each(["https://tenant.example/order/start?token=secret", "https://tenant.example/order/start#secret", "https://user:secret@tenant.example/order/start", "http://tenant.example/order/start", "https://tenant.example/order/verify/secret", "not a url"])("refuses nonplain portal URL %s", portalUrl => expect(cateringInboxPlaybook({ ...base, portalUrl })).toBeNull());
  it("never puts internal terminal labels in customer copy", () => {
    expect(inboxCustomerStatus("lost")).toBe("closed"); expect(inboxCustomerStatus("completed")).toBe("closed");
    for (const artifactStage of ["lost", "completed"]) {
      const draft = cateringInboxPlaybook({ ...base, artifactStage, decision: { ...base.decision, classification: "troubleshoot_ours" } });
      expect(draft?.preview_text).not.toMatch(/lost|completed/);
    }
  });
});
