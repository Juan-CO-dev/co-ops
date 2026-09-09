import type { Page } from "@playwright/test";
import { test, expect, login } from "../playwright.config";
import { SIM_LOCATIONS, personaByEmail, type LocationCode } from "../../personas-shared";
import { SIM_APP_ORIGIN } from "../../../../lib/sim-isolation-shared";
import en from "../../../../lib/i18n/en.json";
import es from "../../../../lib/i18n/es.json";
import {
  sessionFor, openingState, completions, live, checkHeads, assertSaved,
  phase1Body, phase2Body, readRows, type Item,
} from "../contracts/opening.spec";

type Language = "en" | "es";
type Key = keyof typeof en;
const text = (lang: Language, key: Key, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), (lang === "es" ? es : en)[key]);
const label = (item: Item, lang: Language) => lang === "es" ? item.translations?.es?.label ?? item.label : item.label;
const station = (item: Item, lang: Language) => lang === "es" ? item.translations?.es?.station ?? item.station : item.station;
const exact = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const openingUrl = (code: LocationCode) => `/operations/opening?location=${SIM_LOCATIONS[code].id}`;
const rowFor = (page: Page, item: Item, lang: Language) => page.getByRole("region", { name: text(lang, "opening.station.aria", { station: station(item, lang) }), exact: true }).locator("li").filter({ has: page.getByText(label(item, lang), { exact: true }) });
const prepInput = (page: Page, item: Item, lang: Language) => page.getByRole("textbox", { name: text(lang, "opening.phase2.input_prepped_aria", { item: label(item, lang) }), exact: true });
const prepResponse = (page: Page, itemId: string) => page.waitForResponse(response => {
  const request = response.request();
  return new URL(response.url()).pathname === "/api/opening/prep/item" && request.method() === "POST" && request.postDataJSON()?.entry?.templateItemId === itemId;
});

// Each test owns one shop's complete lifecycle. The parent restores between
// projects/repeats; tests never borrow a finalized singleton from an earlier run.
for (const [code, employeeAlias, khAlias] of [["EM", "maya", "rosa"], ["MEP", "luis", "angel"]] as const) {
  test(`opening ${code} employee handoff, prep, failure recovery and report`, async ({ page, browser, contract }, info) => {
    expect(process.env.LRA_FIXTURE).toBe("cold-empty");
    const mark = (id: string) => { if (!contract.assertionIds.includes(id)) contract.assertionIds.push(id); };
    mark("opening.phase1.status");
    const employee = personaByEmail(`${employeeAlias}@sim.co-ops`), kh = personaByEmail(`${khAlias}@sim.co-ops`);
    await login(page, employee, code);
    await page.goto(openingUrl(code));
    await expect(page.getByRole("button", { name: text(employee.language, "opening.phase.tab_phase1"), exact: true })).toBeVisible();
    const state = await openingState(code), instanceId = state.instance.id;
    expect(state.instance.status, "opening.phase1.status: cold instance").toBe("open");
    expect(await completions(instanceId), "opening.phase1.status: no borrowed history").toEqual([]);
    await contract.screenshot("start");

    mark("opening.phase1.employee-handoff");
    const spotIds = new Set(state.snapshots.map(s => s.template_item_id));
    const ordinary = state.items.filter(item => !spotIds.has(item.id) && !item.prep_meta?.openingPhase2);
    const tempItem = ordinary.find(item => item.expects_count);
    expect(tempItem, "opening.phase1.employee-handoff: temperature fixture").toBeTruthy();
    const stationItems = [tempItem!, ...ordinary].filter((item, index, all) => all.findIndex(other => other.station === item.station) === index).slice(0, 3);
    expect(stationItems, "opening.phase1.employee-handoff: three stations").toHaveLength(3);
    for (const item of stationItems) {
      await page.getByRole("button", { name: text(employee.language, "opening.station.tick_aria", { station: station(item, employee.language) }), exact: true }).click();
      const region = page.getByRole("region", { name: text(employee.language, "opening.station.aria", { station: station(item, employee.language) }), exact: true });
      const ticks = region.locator("li > div > span[aria-hidden]");
      expect(await ticks.count()).toBeGreaterThan(0);
      for (const tick of await ticks.all()) await expect(tick, "opening.phase1.employee-handoff: all station lines tick together").toHaveText("\u2713");
    }
    await rowFor(page, tempItem!, employee.language).getByRole("textbox", { name: text(employee.language, "opening.item.count_input_aria", { item: label(tempItem!, employee.language) }), exact: true }).fill("38");
    const noteItem = ordinary.find(item => !item.expects_count)!;
    expect(noteItem).toBeTruthy();
    const note = `Synthetic G1-A ${code}: station checked; tablet charging.`;
    await rowFor(page, noteItem, employee.language).getByRole("button", { name: text(employee.language, "opening.item.add_addon"), exact: true }).click();
    await rowFor(page, noteItem, employee.language).locator("textarea").fill(note);
    const handoff = page.getByRole("button", { name: text(employee.language, "opening.submit.button_label_hand_off"), exact: true });
    await expect(handoff, "opening.phase1.employee-handoff: L3 cannot submit").toBeDisabled();
    await contract.screenshot("decision");

    // A genuinely fresh KH browser context; retain the employee context for its
    // evidence. Both contexts use the harness login and network/screenshot guard.
    const context = await browser.newContext({ baseURL: SIM_APP_ORIGIN, viewport: page.viewportSize(), locale: kh.language, serviceWorkers: "block" });
    const manager = await context.newPage();
    // Playwright already traces contexts made through the `browser` fixture (trace: retain-on-failure);
    // a manual start here throws "Tracing has been already started" (CC full run, 2026-09-09).
    try { await context.tracing.start({ screenshots: true, snapshots: true, sources: false }); } catch { /* auto-traced */ }
    await contract.trackPage(manager);
    try {
      await login(manager, kh, code);
      await manager.goto(openingUrl(code));
      await expect(manager.getByRole("button", { name: text(kh.language, "opening.phase.tab_phase1"), exact: true })).toBeVisible();
      expect((await openingState(code)).instance.id).toBe(instanceId);
      mark("opening.phase1.persist-before-submit");
      const managerNote = rowFor(manager, noteItem, kh.language);
      if (await managerNote.locator("textarea").count() === 0) await managerNote.getByRole("button", { name: text(kh.language, "opening.item.add_addon"), exact: true }).click();
      const observed = {
        ticks: await Promise.all(stationItems.map(async item => manager.getByRole("region", { name: text(kh.language, "opening.station.aria", { station: station(item, kh.language) }), exact: true }).locator("header button[aria-pressed]").getAttribute("aria-pressed"))),
        temperature: await rowFor(manager, tempItem!, kh.language).getByRole("textbox", { name: text(kh.language, "opening.item.count_input_aria", { item: label(tempItem!, kh.language) }), exact: true }).inputValue(),
        comment: await managerNote.locator("textarea").inputValue(),
      };
      contract.opening.handoff = { ticksRetained: observed.ticks.every(value => value === "true"), temperatureRetained: observed.temperature === "38", commentRetained: observed.comment === note, completionRows: (await completions(instanceId)).length };
      // Soft is intentional: LRA-121 makes the test RED, while the KH can
      // redo lost work and expose independent prep/report defects in this run.
      expect.soft(observed, "opening.phase1.persist-before-submit LRA-121 STAFF-5: fresh KH must recover employee input").toEqual({ ticks: ["true", "true", "true"], temperature: "38", comment: note });
      await contract.screenshot("handoff-readback", manager);

      mark("opening.phase1.cold-attestation");
      expect(state.snapshots.length).toBeGreaterThan(0);
      for (const snapshot of state.snapshots) {
        expect(snapshot.closer_count, "opening.phase1.cold-attestation: unknown is not zero").toBeNull();
        expect(snapshot.closing_instance_id).toBeNull();
      }
      const recounts = manager.getByRole("spinbutton");
      await expect(recounts).toHaveCount(state.snapshots.length);
      const sectionButtons = manager.getByRole("button", { name: new RegExp(`^${exact(text(kh.language, "opening.section_verify.cta")).source}`) });
      for (const button of await sectionButtons.all()) await expect(button, "opening.phase1.cold-attestation: recount before section verification").toBeDisabled();
      for (const recount of await recounts.all()) await recount.fill("2");
      for (const button of await sectionButtons.all()) { await expect(button).toBeEnabled(); await button.click(); }
      const tickButtons = manager.locator('section header button[aria-pressed="false"]');
      for (const button of await tickButtons.all()) await button.click();
      const temps = manager.locator('input[type="text"][inputmode="decimal"]');
      expect(await temps.count()).toBeGreaterThan(0);
      for (const input of await temps.all()) await input.fill("38");
      await managerNote.locator("textarea").fill(note);
      const submit = manager.getByRole("button", { name: text(kh.language, "opening.submit.button_label"), exact: true });
      await expect(submit, "opening.phase1.cold-attestation: attestation required").toBeDisabled();
      await expect(manager.getByText(text(kh.language, "opening.phase1.attestation.title"), { exact: true })).toBeVisible();
      await manager.getByRole("radio", { name: text(kh.language, "opening.phase1.attestation.option.missed_or_unknown"), exact: true }).check();
      mark("opening.phase1.status");
      await temps.first().fill("");
      await expect(submit, "opening.phase1.status: missing temperature blocks submit").toBeDisabled();
      await temps.first().fill("38");
      await expect(submit).toBeEnabled();

      const api = await sessionFor(khAlias, code);
      mark("opening.cross-shop");
      const outsider = await sessionFor(code === "EM" ? "angel" : "rosa", code === "EM" ? "MEP" : "EM");
      const beforeDenial = await completions(instanceId);
      const denial = await outsider.call("POST", "/api/opening/submit/phase1", phase1Body(state));
      expect([403, 404], "opening.cross-shop").toContain(denial.status);
      expect(await completions(instanceId), "opening.cross-shop: no completion written").toEqual(beforeDenial);
      expect((await openingState(code)).instance.status, "opening.cross-shop").toBe("open");

      const submitted = manager.waitForResponse(r => new URL(r.url()).pathname === "/api/opening/submit/phase1" && r.request().method() === "POST");
      await submit.click();
      expect((await submitted).status(), "opening.phase1.status").toBe(200);
      await expect.poll(async () => (await openingState(code)).instance.status, { message: "opening.phase1.status" }).toBe("phase1_complete");
      const p1Rows = await completions(instanceId);
      mark("opening.phase2.live-head-uniqueness");
      mark("opening.phase2.phase1-preserved");
      mark("opening.phase2.saved-provenance");
      checkHeads(p1Rows);
      for (const item of state.items.filter(item => spotIds.has(item.id) || !item.prep_meta?.openingPhase2)) {
        const row = live(p1Rows).find(row => row.template_item_id === item.id && !row.prep_data?.phase2);
        expect(row, "opening.phase1.status: every verification persisted").toBeTruthy();
        expect(row!.completed_by).toBe(api.user.id);
        if (spotIds.has(item.id)) {
          expect(row!.prep_data?.phase1, "opening.phase1.cold-attestation").toMatchObject({ closer_count: null, opener_recount: 2, ground_truth_count: 2 });
          expect(row!.count_provenance).toBe("reconstructed_morning");
        } else if (item.expects_count) expect(row!.count_value).toBe(38);
        if (item.id === noteItem.id) expect(row!.notes).toBe(note);
      }
      expect((await openingState(code)).instance.opener_no_prior_data_reason).toBe("missed_or_unknown");
      await manager.getByRole("button", { name: text(kh.language, "opening.phase.tab_phase2"), exact: true }).click();
      const prepItems = state.items.filter(item => item.prep_meta?.openingPhase2);
      expect(prepItems.length, "opening.phase2.save: fixture requires at least three prep rows").toBeGreaterThanOrEqual(3);
      const need = (item: Item) => {
        const value = live(p1Rows).find(row => row.template_item_id === item.id)?.prep_data?.phase1?.prep_need;
        expect(value === null || typeof value === "number", "opening.phase2.save: resolved Phase 1 source").toBe(true);
        return value as number | null;
      };
      const saveUi = async (item: Item, value: number) => {
        const response = prepResponse(manager, item.id);
        await prepInput(manager, item, kh.language).fill(String(value));
        await prepInput(manager, item, kh.language).blur();
        expect((await response).status(), "opening.phase2.save").toBe(200);
        assertSaved(await completions(instanceId), item.id, value, api.user.id);
        const attribution = text(kh.language, "opening.phase2.save.saved_by_at", { name: kh.name, time: "" }).trim();
        await expect(prepInput(manager, item, kh.language).locator("xpath=ancestor::li[1]"), "opening.phase2.save: visible saver attribution").toContainText(attribution);
      };
      mark("opening.phase2.incomplete");
      const refused = await api.call("POST", "/api/opening/submit/phase2", { instanceId });
      expect({ status: refused.status, code: refused.code }, "opening.phase2.incomplete").toEqual({ status: 422, code: "phase2_incomplete" });
      expect((await openingState(code)).instance.status).toBe("phase1_complete");

      mark("opening.phase2.failure-retry");
      const injectedItem = prepItems[0]!, value = need(injectedItem) ?? 0;
      const beforeAbort = await completions(instanceId);
      let injected = 0;
      await manager.route("**/api/opening/prep/item", async route => {
        if (route.request().method() === "POST" && injected === 0) {
          injected++;
          contract.denied.injected = (contract.denied.injected ?? 0) + 1;
          await route.abort("failed");
        } else await route.fallback();
      });
      contract.expectedDenials++;
      await prepInput(manager, injectedItem, kh.language).fill(String(value));
      await prepInput(manager, injectedItem, kh.language).blur();
      await expect(manager.getByText(text(kh.language, "opening.phase2.save.failed"), { exact: true }), "opening.phase2.failure-retry: visible failure").toBeVisible();
      expect(injected, "opening.phase2.failure-retry: consumed once").toBe(1);
      expect(await completions(instanceId), "opening.phase2.failure-retry: no phantom row").toEqual(beforeAbort);
      expect((await openingState(code)).instance.status, "opening.phase2.failure-retry: no false finalize").toBe("phase1_complete");
      await expect(manager.getByRole("button", { name: text(kh.language, "opening.finalize.button_label_outstanding", { count: prepItems.length }), exact: true }), "opening.phase2.failure-retry: finalize stays disabled").toBeDisabled();
      await contract.screenshot("injected-failure", manager);
      const retried = prepResponse(manager, injectedItem.id);
      await manager.getByRole("button", { name: text(kh.language, "opening.phase2.save.retry_aria", { item: label(injectedItem, kh.language) }), exact: true }).click();
      expect((await retried).status(), "opening.phase2.failure-retry").toBe(200);
      assertSaved(await completions(instanceId), injectedItem.id, value, api.user.id);
      expect(injected).toBe(1);
      await expect(manager.getByText(text(kh.language, "opening.phase2.save.failed"), { exact: true })).toHaveCount(0);
      await contract.screenshot("retry-persisted", manager);

      mark("opening.phase2.save");
      for (const item of prepItems.slice(1, 3)) await saveUi(item, need(item) ?? 0);
      mark("opening.phase2.supersede");
      const beforeReplace = await completions(instanceId);
      const prior = live(beforeReplace).find(row => row.template_item_id === injectedItem.id && row.prep_data?.phase2)!;
      // Exercise the real over-prep modal on the second browser save.
      const secondValue = value + 1;
      if (need(injectedItem) !== null) {
        await prepInput(manager, injectedItem, kh.language).fill(String(secondValue));
        await prepInput(manager, injectedItem, kh.language).blur();
        await manager.getByRole("button", { name: text(kh.language, "opening.phase2.signal.over_prep", { delta: 1 }), exact: true }).click();
        const dialog = manager.getByRole("dialog");
        await dialog.locator("select").first().selectOption("other");
        await dialog.locator("textarea").fill("Synthetic G1-A second prep measurement.");
        const replacement = prepResponse(manager, injectedItem.id);
        await dialog.getByRole("button", { name: text(kh.language, "common.save"), exact: true }).click();
        expect((await replacement).status(), "opening.phase2.supersede").toBe(200);
      } else await saveUi(injectedItem, secondValue);
      const replaced = await completions(instanceId);
      expect(replaced.find(row => row.id === prior.id)?.superseded_at, "opening.phase2.supersede: prior Phase 2 retained in history").toBeTruthy();
      expect(live(replaced).filter(row => row.prep_data?.phase1), "opening.phase2.supersede: Phase 1 unchanged").toEqual(live(p1Rows).filter(row => row.prep_data?.phase1));
      assertSaved(replaced, injectedItem.id, secondValue, api.user.id);

      mark("opening.phase2.concurrent-save");
      const otherSession = await sessionFor(khAlias, code);
      const raceValues = [secondValue + 1, secondValue + 2];
      const race = await Promise.all([api, otherSession].map((session, i) => session.call("POST", "/api/opening/prep/item", phase2Body(instanceId, injectedItem.id, raceValues[i]!, need(injectedItem)))));
      contract.opening.race = race.map(result => ({ status: result.status, acknowledged: result.status === 200 }));
      const raced = await completions(instanceId);
      checkHeads(raced);
      expect(race.some(result => result.status === 200), "opening.phase2.concurrent-save: at least one acknowledged save").toBe(true);
      expect(live(raced).filter(row => row.template_item_id === injectedItem.id && row.prep_data?.phase1), "opening.phase2.concurrent-save: Phase 1 preserved").toHaveLength(1);
      expect(live(raced).filter(row => row.template_item_id === injectedItem.id && row.prep_data?.phase2).length, "opening.phase2.concurrent-save: one live head").toBeLessThanOrEqual(1);
      for (const [index, result] of race.entries()) {
        expect.soft([200, 409], "opening.phase2.concurrent-save: raw 500 is a finding, even with valid cardinality").toContain(result.status);
        if (result.status === 200) {
          const saved = raced.find(row => row.id === result.json?.completionId);
          expect(saved?.prep_data?.phase2?.opener_prepped, "opening.phase2.concurrent-save: every acknowledged value retained").toBe(raceValues[index]);
          expect(saved?.completed_by).toBe(api.user.id);
        }
      }

      // Reload the race winner before proceeding, so the UI and report oracle
      // agree on the acknowledged history rather than a stale optimistic value.
      await manager.reload();
      await manager.getByRole("button", { name: text(kh.language, "opening.phase.tab_phase2"), exact: true }).click();
      for (const item of prepItems.slice(3)) await saveUi(item, need(item) ?? 0);
      mark("opening.phase2.finalize");
      const finalize = manager.getByRole("button", { name: text(kh.language, "opening.finalize.button_label"), exact: true });
      await expect(finalize, "opening.phase2.finalize: enabled only after all saves").toBeEnabled();
      const finalResponse = manager.waitForResponse(r => new URL(r.url()).pathname === "/api/opening/submit/phase2" && r.request().method() === "POST");
      await finalize.click();
      const finalized = await finalResponse;
      expect(finalized.request().postDataJSON(), "opening.phase2.finalize: finalize takes no entries").toEqual({ instanceId });
      expect(finalized.status(), "opening.phase2.finalize").toBe(200);
      await expect.poll(async () => (await openingState(code)).instance.status, { message: "opening.phase2.finalize" }).toBe("phase2_complete");
      const submissions = await readRows<{ submitted_by: string; submitted_at: string; completion_ids: string[]; is_final_confirmation: boolean }>("checklist_submissions", "submitted_by,submitted_at,completion_ids,is_final_confirmation", { instance_id: instanceId });
      const finalIds = live(await completions(instanceId)).filter(row => row.prep_data?.phase2).map(row => row.id).sort();
      const finalSubmission = submissions.find(row => JSON.stringify([...row.completion_ids].sort()) === JSON.stringify(finalIds));
      expect(finalSubmission, "opening.phase2.finalize: persisted submission provenance").toBeTruthy();
      expect(finalSubmission!.submitted_by).toBe(api.user.id);
      expect(Number.isFinite(Date.parse(finalSubmission!.submitted_at))).toBe(true);
      expect(finalSubmission!.is_final_confirmation, "opening.phase2.finalize: not Phase 3 confirmation").toBe(false);
      await manager.reload();
      await manager.goto("/dashboard");
      const loggedOut = manager.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/logout" && r.request().method() === "POST");
      await manager.getByRole("button", { name: text(kh.language, "auth.logout.label"), exact: true }).click();
      expect((await loggedOut).ok(), "opening.report.truth: real logout before relogin").toBe(true);
      await manager.waitForURL(url => url.pathname === "/");
      await login(manager, kh, code);

      mark("opening.report.truth");
      await manager.goto(`/reports/opening/${instanceId}?location=${SIM_LOCATIONS[code].id}`);
      await expect(manager.getByText(text(kh.language, "reports.opening.no_prior_submission.title"), { exact: true }), "opening.report.truth: cold banner").toBeVisible();
      const finalRows = live(await completions(instanceId));
      checkHeads(finalRows);
      for (const item of state.items) {
        // The report currently uses canonical template labels even in Spanish.
        // Scope by the persisted label; app chrome language was asserted at login.
        const reportRow = manager.locator("section").filter({ has: manager.getByRole("heading", { name: item.station, exact: true }) }).locator("li").filter({ has: manager.getByText(item.label, { exact: true }) });
        const verified = finalRows.find(row => row.template_item_id === item.id && !row.prep_data?.phase2);
        if (verified) {
          await expect(reportRow, "opening.report.truth: verified station line").toContainText(text(kh.language, "reports.detail.done"));
          await expect(reportRow, "opening.report.truth: verification actor").toContainText(kh.name);
          if (item.expects_count) await expect(reportRow, "opening.report.truth: saved temperature").toContainText(text(kh.language, "reports.opening.temp_reading", { value: verified.count_value! }));
          if (spotIds.has(item.id)) {
            await expect(reportRow, "opening.report.truth: null baseline").toContainText(text(kh.language, "reports.opening.baseline.none"));
            await expect(reportRow, "opening.report.truth: recount").toContainText(text(kh.language, "reports.opening.recount_value", { value: 2 }));
            await expect(reportRow, "opening.report.truth: ground truth").toContainText(text(kh.language, "reports.opening.ground_truth", { value: 2 }));
            if (need(item) !== null) await expect(reportRow, "opening.report.truth: derived prep need").toContainText(text(kh.language, "reports.opening.prep_need", { value: need(item)! }));
          }
        }
        const prep = finalRows.find(row => row.template_item_id === item.id && row.prep_data?.phase2);
        if (prep) {
          // Deliberately red when the report omits Phase 2. A generic quantity
          // search could accidentally match Phase 1's recount or prep need.
          const expectedPrep = new RegExp(`${exact(text(kh.language, "opening.phase2.opener_prepped_label")).source}\\s*:?\\s*${exact(String(prep.prep_data!.phase2!.opener_prepped)).source}(?:\\D|$)`, "i");
          expect.soft(await reportRow.innerText(), "opening.report.truth: persisted Phase 2 quantity must be visible after relogin").toMatch(expectedPrep);
        }
      }
      await contract.screenshot("outcome", manager);
    } finally {
      if (info.errors.length) await contract.screenshot("failure-kh", manager);
      try { await context.tracing.stop({ path: info.outputPath("kh-private-trace.zip") }); } catch { /* the runner's own trace handling owns this context */ }
      await context.close();
    }
  });
}
