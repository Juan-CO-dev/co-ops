import { describe, expect, it } from "vitest";
import { classifyCateringInbox, type InboxClassifyInput } from "@/lib/catering/inbox-classify-shared";
const base: InboxClassifyInput = { sender: "guest@example.test", subject: "Hello", body: "", headers: {}, ownAddresses: new Set(), identity: "new_sender", artifact: "none" };
describe("inbox classification", () => {
  it.each([
    ["We need catering for an event", "intake", null],
    ["Necesito una cotización de catering", "intake", null],
    ["Catering November 20", "intake", null],
    ["Catering el 20 de noviembre", "intake", null],
    ["Catering", "unclassified", "insufficient_content"],
    ["We offer catering services", "noise", "solicitation"],
    ["We need catering; we offer SEO", "unclassified", "conflicting_intent"],
    ["We need catering. Unsubscribe here", "unclassified", "conflicting_intent"],
    ["We do not need catering", "unclassified", "conflicting_intent"],
    ["No necesito catering", "unclassified", "conflicting_intent"],
    ["Our services include a demo for partners", "noise", "solicitation"],
    ["https://a.test https://b.test https://c.test", "noise", "solicitation"],
    ["Necesito catering hoy", "unclassified", "urgent"],
    ["Need catering today", "unclassified", "urgent"],
    ["Allergy question", "unclassified", "urgent"],
    ["Quiero cambiar el pedido", "unclassified", "payment_or_edit"],
    ["Cancelación del pedido", "unclassified", "payment_or_edit"],
    ["Payment question", "unclassified", "payment_or_edit"],
    ["Help with my Toast order", "troubleshoot_third_party", null],
    ["Hi\n> We need catering for an event", "unclassified", "insufficient_content"],
    ["Hi\nOn Tuesday Guest wrote:\nNeed catering for an event", "unclassified", "insufficient_content"],
    ["Hi\nFrom: guest\nNeed catering", "unclassified", "quoted_history"],
    ["Thanks for reaching out. Tell us about your event through our catering portal.", "unclassified", "insufficient_content"],
    ["Gracias por escribirnos. Cuéntanos sobre tu evento en nuestro portal de catering.", "unclassified", "insufficient_content"],
  ])("%s", (body, classification, reason) => {
    expect(classifyCateringInbox({ ...base, body })).toMatchObject({ classification, reason });
  });
  it.each(["notice@ezcater.com", "notice@mail.ezcater.com", "notice@tripleseat.com"])("domain %s is notification", sender => {
    expect(classifyCateringInbox({ ...base, sender, body: "Need catering today" })).toMatchObject({ classification: "platform_notification", disposition: "notification" });
  });
  it.each(["ezCater <bad@example.test>", "bad@notezcater.com", "bad@ezcater.com.evil.test"])("spoof %s is not platform", sender => {
    expect(classifyCateringInbox({ ...base, sender })).toMatchObject({ classification: "unclassified" });
  });
  it("resolved owned artifact permits status only", () => {
    expect(classifyCateringInbox({ ...base, body: "Order status", identity: "resolved", artifact: "resolved" }).classification).toBe("troubleshoot_ours");
    expect(classifyCateringInbox({ ...base, body: "Order status", identity: "resolved", artifact: "ambiguous" }).reason).toBe("ambiguous_artifact");
  });
  it("followups always need a person, retaining classification", () => {
    expect(classifyCateringInbox({ ...base, subject: "RE: catering", body: "Need catering for event" })).toMatchObject({ classification: "intake", disposition: "needs_human", reason: "thread_followup" });
    expect(classifyCateringInbox({ ...base, sender: "a@ezcater.com", headers: { references: "<prior>" } }).reason).toBe("thread_followup");
  });
  it("own sender, auto responders and unresolved identities never draft", () => {
    expect(classifyCateringInbox({ ...base, ownAddresses: new Set([base.sender]) }).reason).toBe("own_address");
    expect(classifyCateringInbox({ ...base, headers: { "auto-submitted": "auto-replied" } }).reason).toBe("automated_message");
    for (const identity of ["masked", "missing", "ambiguous"] as const)
      expect(classifyCateringInbox({ ...base, identity, body: "Need catering" }).reason).toBe("identity_unresolved");
  });
});
