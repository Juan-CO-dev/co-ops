/**
 * Nav PR 4 (plan r2, 7.4 with amendment A1): the "Needs attention" line. Pure checks over today's four health reads.
 * The words are exact (Issue, Healthy, Unavailable, Not enabled); a failed read is Unavailable, never a zero or
 * Healthy; the line says "All systems OK" only when nothing is Issue or Unavailable; and the all-clear time is read
 * from the sales check alone, through the whole chain Read<CronHealth> → salesPullCheck → summarize → the line.
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import {
  STATE_KEYS, WORST_ORDER, attentionLine, checkSentence, inboxCheck, notReadyChecks, salesPullCheck, summarize, vendorMailCheck,
  type AttentionCheck, type NotReadyCounts, type Read,
} from "@/lib/admin/back-office-shared";
import type { CronHealth } from "@/lib/admin/ops-health";
import { NO_CRON_RUN_FAILURES } from "@/lib/admin/ops-health-shared";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";

const T = (lang: Language) => (key: TranslationKey, params?: TranslationParams) => serverT(lang, key, params);
const FAILED = { state: "failed" } as const;
const ok = <T,>(value: T): Read<T> => ({ state: "ok", value });
const cron = (over: Partial<CronHealth> = {}): CronHealth => ({
  hasRecentFailure: false, lastFailureAt: null, lastFailureError: null, lastSuccessAt: null, lastRunDegraded: false,
  lastRunFailures: NO_CRON_RUN_FAILURES, ...over,
});
// 2026-11-20 at 6:02 AM ET (EST, UTC-5) = 11:02Z; "now" is the same ET day, later.
const TODAY_RUN = "2026-11-20T11:02:00.000Z";
const YESTERDAY_RUN = "2026-11-19T11:02:00.000Z";
const NOW = "2026-11-20T18:30:00.000Z";
const ALL3 = new Set(["skus", "recipes", "items"] as const);
const READY: NotReadyCounts = { skus: 0, recipes: 0, items: 0, byScope: [] };

describe("the exact state words", () => {
  it("Issue, Healthy, Unavailable, Not enabled (en) and Problema, En orden, No disponible, No activado (es)", () => {
    expect(Object.values(STATE_KEYS).map((k) => en[k])).toEqual(["Issue", "Healthy", "Unavailable", "Not enabled"]);
    expect(Object.values(STATE_KEYS).map((k) => es[k])).toEqual(["Problema", "En orden", "No disponible", "No activado"]);
  });
});

describe("each check's states", () => {
  it("sales pull: failed read = Unavailable; recent failure = Issue naming the ET date; degraded = Issue; never run = Not enabled; else Healthy", () => {
    expect(salesPullCheck(FAILED).state).toBe("unavailable");
    const failed = salesPullCheck(ok(cron({ hasRecentFailure: true, lastFailureAt: "2026-11-20T03:00:00.000Z", lastSuccessAt: YESTERDAY_RUN })));
    expect(failed.state).toBe("issue");
    // 03:00Z on the 20th is 10 PM on the 19th in ET: the sentence names the 19th.
    expect(checkSentence(failed, "en", T("en"))).toBe("The sales pull failed on Thu, Nov 19.");
    const degraded = salesPullCheck(ok(cron({ lastSuccessAt: TODAY_RUN, lastRunDegraded: true })));
    expect(degraded.state).toBe("issue");
    expect(checkSentence(degraded, "en", T("en"))).toBe("The last sales pull ran with failures.");
    expect(salesPullCheck(ok(cron())).state).toBe("not_enabled");
    expect(salesPullCheck(ok(cron({ lastSuccessAt: TODAY_RUN })))).toMatchObject({ state: "healthy", lastSuccessAt: TODAY_RUN });
  });

  it("only a Healthy sales check carries a timestamp (A1)", () => {
    expect(salesPullCheck(FAILED).lastSuccessAt).toBeNull();
    expect(salesPullCheck(ok(cron({ lastSuccessAt: TODAY_RUN, lastRunDegraded: true }))).lastSuccessAt).toBeNull();
    expect(salesPullCheck(ok(cron({ hasRecentFailure: true, lastSuccessAt: TODAY_RUN }))).lastSuccessAt).toBeNull();
  });

  it("inbound mail: 0 = Healthy, 1 = Issue (singular), 3 = Issue (plural), failed = Unavailable with no count", () => {
    const h = (count: number) => ok({ count, rows: [] });
    expect(inboxCheck(h(0))).toMatchObject({ state: "healthy", count: 0, href: "#system-status" });
    expect(checkSentence(inboxCheck(h(1)), "en", T("en"))).toBe("1 inbound message needs a retry.");
    expect(checkSentence(inboxCheck(h(3)), "en", T("en"))).toBe("3 inbound messages need a retry.");
    expect(checkSentence(inboxCheck(h(3)), "es", T("es"))).toBe("3 mensajes entrantes necesitan reintento.");
    const failed = inboxCheck(FAILED);
    expect(failed.state).toBe("unavailable");
    expect(failed.count).toBeUndefined();
    expect(checkSentence(failed, "en", T("en"))).toBe("Inbound mail could not be checked.");
    expect(checkSentence(failed, "es", T("es"))).toBe("No se pudo revisar: Correo entrante.");
  });

  it("vendor mail: 0 = Healthy, stale > 0 = Issue, failed = Unavailable; the fix is today's stale link", () => {
    expect(vendorMailCheck(ok(0)).state).toBe("healthy");
    expect(vendorMailCheck(ok(2))).toMatchObject({ state: "issue", count: 2, href: "/operations/vendor-mail?stale=1" });
    expect(checkSentence(vendorMailCheck(ok(1)), "en", T("en"))).toBe("1 vendor email is waiting.");
    expect(checkSentence(vendorMailCheck(ok(2)), "en", T("en"))).toBe("2 vendor emails are waiting.");
    expect(vendorMailCheck(FAILED)).toEqual({ id: "vendor_mail", nameKey: "vendorMail.title", href: "/operations/vendor-mail?stale=1", state: "unavailable" });
  });

  it("not ready: one check per visible section, in order; the per-shop entries ride on an Issue; one failed read makes all three Unavailable with no count", () => {
    const counts: NotReadyCounts = { skus: 0, recipes: 3, items: 1, byScope: [
      { scope: null, scopeName: null, skus: 0, recipes: 1, items: 0 },
      { scope: "shop-1", scopeName: "P Street", skus: 0, recipes: 2, items: 1 },
    ] };
    const checks = notReadyChecks(ok(counts), ALL3);
    expect(checks.map((c) => [c.id, c.state, c.count])).toEqual([["not_ready_skus", "healthy", 0], ["not_ready_recipes", "issue", 3], ["not_ready_items", "issue", 1]]);
    expect(checks[1]!.where!.map((w) => w.href)).toEqual(["/admin/recipes?location=global", "/admin/recipes?location=shop-1"]);
    expect(checkSentence(checks[1]!, "en", T("en"))).toBe("Recipes: 3 not ready.");
    expect(notReadyChecks(ok(counts), new Set(["recipes"] as const)).map((c) => c.id)).toEqual(["not_ready_recipes"]);
    const failed = notReadyChecks(FAILED, ALL3);
    expect(failed.map((c) => c.state)).toEqual(["unavailable", "unavailable", "unavailable"]);
    for (const c of failed) { expect(c.count).toBeUndefined(); expect(c.where).toBeUndefined(); }
  });
});

describe("the line", () => {
  const sales = salesPullCheck(ok(cron({ lastSuccessAt: TODAY_RUN })));
  const line = (checks: AttentionCheck[], lang: Language = "en", s = sales) => attentionLine(summarize(checks, s), NOW, lang, T(lang));

  it.each([
    ["sales pull", () => [salesPullCheck(FAILED), ...notReadyChecks(ok(READY), ALL3)], "Sales pull"],
    ["inbound mail", () => [sales, inboxCheck(FAILED)], "Inbound mail"],
    ["vendor mail", () => [sales, vendorMailCheck(FAILED)], "Vendor mail"],
  ] as const)("a failed %s read alone: Needs attention: 1, and never All systems OK", (_name, make, label) => {
    const checks = make() as AttentionCheck[];
    const s = checks.find((c) => c.id === "sales_pull") as ReturnType<typeof salesPullCheck>;
    expect(line(checks, "en", s)).toBe(`Needs attention: 1. ${label} could not be checked.`);
  });

  it("the readiness read failing: three Unavailable, n = 3", () => {
    expect(line([sales, ...notReadyChecks(FAILED, ALL3)])).toBe("Needs attention: 3. SKUs could not be checked.");
  });

  it("n counts Issue and Unavailable; the worst is named by WORST_ORDER (Issues first)", () => {
    const checks = [sales, inboxCheck(ok({ count: 2, rows: [] })), vendorMailCheck(FAILED), ...notReadyChecks(ok({ ...READY, skus: 4 }), ALL3)];
    const s = summarize(checks, sales);
    expect(s).toMatchObject({ kind: "attention", n: 3 });
    expect(s.kind === "attention" && s.worst.id).toBe("inbox");
    expect(line(checks)).toBe("Needs attention: 3. 2 inbound messages need a retry.");
  });

  it("WORST_ORDER is pinned", () => {
    expect(WORST_ORDER).toEqual([
      "issue:sales_pull:failed", "issue:inbox", "issue:sales_pull:degraded", "issue:vendor_mail",
      "issue:not_ready_skus", "issue:not_ready_recipes", "issue:not_ready_items",
      "unavailable:sales_pull", "unavailable:inbox", "unavailable:vendor_mail",
      "unavailable:not_ready_skus", "unavailable:not_ready_recipes", "unavailable:not_ready_items",
    ]);
    const failedPull = salesPullCheck(ok(cron({ hasRecentFailure: true, lastFailureAt: TODAY_RUN })));
    const degraded = salesPullCheck(ok(cron({ lastSuccessAt: TODAY_RUN, lastRunDegraded: true })));
    const inbox = inboxCheck(ok({ count: 1, rows: [] }));
    const worst = (cs: AttentionCheck[]) => { const s = summarize(cs, null); return s.kind === "attention" ? s.worst : null; };
    expect(worst([inbox, failedPull])).toBe(failedPull);
    expect(worst([degraded, inbox])).toBe(inbox);
    expect(worst([vendorMailCheck(ok(1)), degraded])).toBe(degraded);
    expect(worst([inboxCheck(FAILED), ...notReadyChecks(ok({ ...READY, items: 1 }), ALL3)])!.id).toBe("not_ready_items");
  });

  it("A1, the whole chain: two successful timestamps (today ET, yesterday) through salesPullCheck and summarize to the rendered line", () => {
    const today = salesPullCheck(ok(cron({ lastSuccessAt: TODAY_RUN })));
    expect(summarize([today], today)).toEqual({ kind: "ok", lastSalesPullAt: TODAY_RUN });
    expect(attentionLine(summarize([today], today), NOW, "en", T("en"))).toBe("All systems OK. Last sales pull 6:02 AM.");
    // es-US's day period ("a.m." here; some ICU builds space it, "a. m.") is the formatter's; the time and the words are pinned.
    expect(attentionLine(summarize([today], today), NOW, "es", T("es"))).toMatch(/^Todo está en orden\. Última descarga de ventas: 6:02\sa\.\s?m\.$/u);
    // The day period already ends in a period; the sentence must not add a second one (Spanish "a.m..").
    expect(attentionLine(summarize([today], today), NOW, "es", T("es"))).not.toMatch(/\.\.$/);
    const yesterday = salesPullCheck(ok(cron({ lastSuccessAt: YESTERDAY_RUN })));
    expect(summarize([yesterday], yesterday)).toEqual({ kind: "ok", lastSalesPullAt: YESTERDAY_RUN });
    expect(attentionLine(summarize([yesterday], yesterday), NOW, "en", T("en"))).toBe("All systems OK. Last sales pull Thu, Nov 19, 6:02 AM.");
  });

  it("the ET day decides \"today\": a run at 11 PM ET is yesterday's at 1 AM ET the next day", () => {
    const late = salesPullCheck(ok(cron({ lastSuccessAt: "2026-11-20T04:00:00.000Z" }))); // 11 PM ET on the 19th
    expect(attentionLine(summarize([late], late), "2026-11-20T06:00:00.000Z", "en", T("en"))).toBe("All systems OK. Last sales pull Thu, Nov 19, 11:00 PM.");
  });

  it("Not enabled never counts against OK, and then the line has no sales clause", () => {
    const off = salesPullCheck(ok(cron()));
    expect(line([off, ...notReadyChecks(ok(READY), ALL3)], "en", off)).toBe("All systems OK.");
    expect(line([off], "es", off)).toBe("Todo está en orden.");
  });

  it("the time is read ONLY from a Healthy sales check (A1): no sales check, no time", () => {
    expect(summarize([vendorMailCheck(ok(0))], null)).toEqual({ kind: "ok", lastSalesPullAt: null });
  });
});
