/**
 * Item 21 PR 3: the link panel as people see it, en + es. A decider gets Link / Not a match on an open check, Relink on
 * a tombstoned one, Unlink on a linked one and the "no Toast ring expected" control; a dual-code check says what
 * linking it means; an ezCater-held check offers "Not a match" only. A reader (not the catering manager / a GM / 8+) gets the
 * same facts and no control. Pins that the not-rung list mounts the panel only for house rows, on request.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { HouseToastPanel } from "@/components/catering/pipeline/HouseToastPanel";
import type { HouseToastPanel as Panel, ToastCandidate } from "@/lib/catering/catering-toast-links-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const SHOP = "00000000-0000-4000-8000-000000000002";
const cand = (o: Partial<ToastCandidate>): ToastCandidate => ({ orderGuid: "o", checkGuid: "c", businessDate: "2026-11-20", evidence: "amount_date",
  checkTotalCents: 30000, amountDiffCents: 0, amountMismatch: false, state: "open", blockedBy: null, headId: null, owner: null, ...o });
const panel = (o: Partial<Panel> = {}): Panel => ({
  leadId: "lead", locationId: SHOP, eventDate: "2026-11-20", ringCode: null, valueCents: 30000, status: "not_rung_in_toast", canDecide: true,
  linkStep: "ready", ended: [], leadHead: null, links: [], candidates: [
    cand({ orderGuid: "a", evidence: "ring_code" }),
    cand({ orderGuid: "b", state: "dual_code" }),
    cand({ orderGuid: "c", state: "owned_ezcater", owner: "ezcater" }),
    cand({ orderGuid: "d", state: "blocked", blockedBy: "unlink", headId: "h" }),
  ], ...o,
});
// eslint-disable-next-line react/no-children-prop -- TranslationProvider requires children in its props type.
const render = (p: Panel, language: "en" | "es") => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language,
  children: createElement(HouseToastPanel, { leadId: "lead", startOpen: true, initial: p }) }))
  .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const count = (text: string, word: string) => text.split(word).length - 1;

describe("the link panel, en + es", () => {
  it("a decider sees the decisions where they apply", () => {
    const en = render(panel(), "en");
    expect(en).toContain("Not rung in Toast yet");
    expect(count(en, "Link this check")).toBe(2); // open + dual code, never the ezCater-held one
    expect(count(en, "Not a match")).toBe(3); // fix round 3: the ezCater-held check can be dismissed (never linked)
    expect(en).toContain("Relink");
    expect(en).toContain("Unlinked by a manager.");
    expect(en).toContain("also carries an ezCater order number");
    expect(en).toContain("Linked to an ezCater order. To free it, fix the ring in Toast.");
    expect(en).toContain("No Toast ring expected");
    const es = render(panel(), "es");
    expect(count(es, "Vincular esta cuenta")).toBe(2);
    expect(es).toContain("Volver a vincular");
    expect(es).toContain("Todavía no está en Toast");
  });
  it("a linked order shows its check with Unlink and no 'no ring' control", () => {
    const linked = panel({ status: "matched", candidates: [], links: [{ locationId: SHOP, orderGuid: "o", checkGuid: "c", evidence: "manual",
      totalCents: 30500, businessDate: "2026-11-20", live: false, headId: "h" }] });
    const en = render(linked, "en");
    expect(en).toContain("Rung in Toast");
    expect(en).toContain("Unlink");
    expect(en).toContain("linked by a manager");
    expect(en).toContain("no longer live in Toast");
    expect(en).not.toContain("No Toast ring expected");
    expect(render(linked, "es")).toContain("Desvincular");
  });
  it("a reader sees the same facts and no control", () => {
    const en = render(panel({ canDecide: false }), "en");
    expect(en).toContain("View only");
    for (const control of ["Link this check", "Not a match", "Relink", "No Toast ring expected"]) expect(en).not.toContain(control);
    expect(render(panel({ canDecide: false }), "es")).toContain("Solo lectura");
  });
  it("fix round 1: without migration 0347 the panel is read-only and says why (never a control that can only fail)", () => {
    // What buildHouseToastPanel returns for a decider at a shop with 0344 only: canDecide false, linkStep not_installed.
    const en = render(panel({ canDecide: false, linkStep: "not_installed" }), "en");
    expect(en).toContain("Linking Toast checks is not installed yet.");
    expect(en).not.toContain("View only");
    for (const control of ["Link this check", "Not a match", "Relink", "No Toast ring expected"]) expect(en).not.toContain(control);
    expect(en).toContain("Possible Toast checks"); // the facts stay
    const es = render(panel({ canDecide: false, linkStep: "not_installed" }), "es");
    expect(es).toContain("Vincular cuentas de Toast aún no está instalado.");
    expect(es).not.toContain("Vincular esta cuenta");
  });
  it("fix round 1: a link the system ended shows who holds the check now: a conflict, never ownership", () => {
    const ended = (o: Partial<Panel["ended"][number]>): Panel["ended"][number] => ({ orderGuid: "o", checkGuid: "c", evidence: "manual", reason: "lead_moved",
      owner: "ezcater", totalCents: 40000, businessDate: "2026-11-20", live: true, headId: "h", ...o });
    const taken = render(panel({ candidates: [], ended: [ended({})] }), "en");
    expect(taken).toContain("Not rung in Toast yet");
    expect(taken).toContain("Links that ended");
    expect(taken).toContain("until the order moved to another shop");
    expect(taken).toContain("An ezCater order holds this check now.");
    expect(taken).not.toContain("Linked Toast checks"); // it is not shown as this order's link
    expect(taken).not.toContain("Relink");
    expect(count(taken, "Not a match")).toBe(1); // fix round 3: the conflict can be dismissed
    const free = render(panel({ candidates: [], ended: [ended({ owner: null, reason: "lead_lost" })] }), "en");
    expect(free).toContain("until the order was marked lost");
    expect(free).toContain("Nobody holds this check now.");
    expect(count(free, "Relink")).toBe(2); // the sentence and the button
    expect(count(render(panel({ candidates: [], ended: [ended({ owner: null, live: false })] }), "en"), "Relink")).toBe(1); // no button: the check is gone
    expect(count(render(panel({ candidates: [], canDecide: false, ended: [ended({ owner: null })] }), "en"), "Relink")).toBe(1); // no button for a reader
    const es = render(panel({ candidates: [], ended: [ended({ owner: "house", reason: "lead_ezcater" })] }), "es");
    expect(es).toContain("Vínculos que terminaron");
    expect(es).toContain("pasó a ser de ezCater");
    expect(es).toContain("Ahora esta cuenta es de otro pedido de catering.");
  });
  it("a 'no ring expected' order says why and offers the undo", () => {
    const en = render(panel({ status: "no_ring_expected", leadHead: { id: "h", kind: "no_ring_expected", reasonCode: "paid_outside_toast" } }), "en");
    expect(en).toContain("Marked: no Toast ring expected (Paid outside Toast).");
    expect(en).toContain("A Toast ring is expected after all");
    expect(en).not.toContain("Link this check");
  });

  it("item 21 PR 4: the order's ring code is shown with where to type it, never for a no-ring order, never when there is none", () => {
    expect(render(panel({ ringCode: "CO-ACD34" }), "en")).toContain("Ring code: CO-ACD34. Type it on the Toast check (as an item name or a special request)");
    expect(render(panel({ ringCode: "CO-ACD34" }), "es")).toContain("Código para Toast: CO-ACD34. Escríbelo en la cuenta de Toast");
    expect(render(panel(), "en")).not.toContain("Ring code:");
    expect(render(panel({ ringCode: "CO-ACD34", status: "no_ring_expected", leadHead: { id: "h", kind: "no_ring_expected", reasonCode: "comped" } }), "en")).not.toContain("Ring code:");
  });
});

describe("where the panel is mounted", () => {
  it("only on house rows of the not-rung list, on request; on non-ezCater leads in the drawer", () => {
    const list = readFileSync("components/catering/pipeline/NotInToast.tsx", "utf8");
    expect(list).toContain("{house && row.lead_id && <HouseReview leadId={row.lead_id} />}");
    expect(list).toMatch(/if \(open\) return <HouseToastPanel leadId=\{leadId\} startOpen \/>;/);
    const drawer = readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8");
    expect(drawer).toContain('{lead.leadSource !== "ezcater" && <HouseToastPanel leadId={lead.id} />}');
  });
  it("every POST names the head the person saw", () => {
    const src = readFileSync("components/catering/pipeline/HouseToastPanel.tsx", "utf8");
    expect(src).toContain("expectedHeadId: c.headId");
    expect(src).toContain('{ kind: "ring_expected", expectedHeadId: panel.leadHead!.id }');
    expect(src).toContain('{ kind: "no_ring_expected", reasonCode: noRing, expectedHeadId: panel.leadHead?.id ?? null }');
  });
});
