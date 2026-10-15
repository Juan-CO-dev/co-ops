import { describe, expect, it } from "vitest";
import { saveStatusStep, initialSaveStatus } from "@/lib/save-status-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { TranslationProvider } from "@/lib/i18n/provider";
import { SaveStatus, SaveStatusFrame } from "@/components/ui/SaveStatus";

describe("save status revision rule", () => {
  it("does not claim a newer edit was saved by an older acknowledgement", () => {
    const saving = saveStatusStep(initialSaveStatus, { type: "start" });
    const edited = saveStatusStep(saving, { type: "edit" });
    expect(saveStatusStep(edited, { type: "ack", revision: saving.revision }).phase).toBe("idle");
  });
  it("keeps a refusal visible until an explicit retry succeeds", () => {
    const saving = saveStatusStep(initialSaveStatus, { type: "start" });
    const failed = saveStatusStep(saving, { type: "fail", revision: saving.revision });
    expect(failed.phase).toBe("failed");
    const retry = saveStatusStep(failed, { type: "retry" });
    expect(retry.phase).toBe("saving");
    expect(saveStatusStep(retry, { type: "ack", revision: retry.revision }).phase).toBe("saved");
  });
  it("ignores stale refusals and keeps dictionary keys in parity", () => {
    const first = saveStatusStep(initialSaveStatus, { type: "start" });
    const edited = saveStatusStep(first, { type: "edit" });
    expect(saveStatusStep(edited, { type: "fail", revision: first.revision }).phase).toBe("idle");
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });
  it("renders a centered 44px retry in both languages", () => {
    for (const language of ["en", "es"] as const) {
      const html = renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: null },
        createElement(SaveStatus, { phase: "failed", onRetry: () => {} })));
      expect(html).toContain("min-h-[44px]");
      expect(html).toContain("items-center");
      expect(html).toContain(language === "en" ? "Try again" : "Toca para reintentar");
    }
    expect(renderToStaticMarkup(createElement(SaveStatusFrame, { children: "Saved" }))).toContain("min-h-[44px]");
  });
  it("failed counts stay in collapsed opening and mid-day headers", () => {
    for (const path of ["components/opening/OpeningPrepEntry.tsx", "components/MidDayPhase2Form.tsx"]) {
      const src = readFileSync(path, "utf8");
      expect(src).toContain("progressSuffix=");
      expect(src).toContain('t("save_status.failed_count"');
    }
  });
  it("opening Phase 1 uses the revision machine and mid-day consumption edits invalidate Saved", () => {
    const opening = readFileSync("app/(authed)/operations/opening/opening-client.tsx", "utf8");
    expect(opening).toContain("saveStatusStep(draftStatusRef.current, event)");
    expect(opening).toContain('stepDraft({ type: "edit" })');
    expect(opening).toContain('stepDraft({ type: "ack", revision })');
    expect(opening).toContain('stepDraft({ type: "fail", revision })');
    expect(opening).not.toContain("if (draftLatestRef.current === body) setDraftState");
    const midDay = readFileSync("components/MidDayPhase2Form.tsx", "utf8");
    expect(midDay).toContain('onChange={(rows) => patch(it.id, { confirmedConsumption: rows, status: "idle", error: null })}');
    expect(midDay).toContain('if (p.status === "idle") stepSave(id, { type: "edit" })');
  });
});
