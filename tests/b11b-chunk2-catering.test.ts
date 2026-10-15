import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { cateringStageOverlay, projectedCateringStage, type CateringStageOverlay } from "@/lib/catering/pipeline-shared";
import { postJson, resolveErrorKey } from "@/components/catering/pipeline/shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const props = { lead: "inquiry" as const };
const start = { type: "start" as const, id: "lead", from: "inquiry" as const, to: "confirmed" as const, request: 1 };

describe("cateringStageOverlay", () => {
  it("moves immediately, survives stale props, and clears only on matching authoritative props", () => {
    const saving = cateringStageOverlay({}, props, { ...start, version: "2026-10-15T12:00:00.000Z" });
    expect(projectedCateringStage(props.lead, saving.lead)).toBe("confirmed");
    expect(cateringStageOverlay(saving, props, { type: "props" })).toBe(saving);
    const saved = cateringStageOverlay(saving, props, { type: "resolve", id: "lead", request: 1, result: { ok: true } });
    expect(saved.lead?.phase).toBe("saved");
    expect(cateringStageOverlay(saved, props, { type: "props", versions: { lead: "2026-10-15T12:00:00.000Z" } })).toBe(saved);
    expect(cateringStageOverlay(saved, { lead: "confirmed" }, { type: "props" })).toEqual({});
  });
  it("keeps a stale refresh, then shows a newer move by another manager", () => {
    const version = "2026-10-15T12:00:00.000Z";
    const saving = cateringStageOverlay({}, props, { ...start, version });
    const saved = cateringStageOverlay(saving, props, { type: "resolve", id: "lead", request: 1, result: { ok: true } });
    expect(cateringStageOverlay(saved, props, { type: "props", versions: { lead: version } })).toBe(saved);
    const newerProps = { lead: "quote_sent" as const };
    const cleared = cateringStageOverlay(saved, newerProps, { type: "props", versions: { lead: "2026-10-15T12:01:00.000Z" } });
    expect(cleared).toEqual({});
    expect(projectedCateringStage(newerProps.lead, cleared.lead)).toBe("quote_sent");
    const source = readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8");
    expect(source).toContain("serverVersions[lead.id] = lead.updatedAt");
    expect(source).toContain('type: "props", versions: serverVersions');
  });
  it("drops a saved overlay on the first refresh when the board has no version", () => {
    const saving = cateringStageOverlay({}, props, start);
    const saved = cateringStageOverlay(saving, props, { type: "resolve", id: "lead", request: 1, result: { ok: true } });
    expect(cateringStageOverlay(saved, props, { type: "props" })).toEqual({});
  });

  it("rolls back with the exact refusal and permits a retry", () => {
    const saving = cateringStageOverlay({}, props, start);
    const failed = cateringStageOverlay(saving, props, { type: "resolve", id: "lead", request: 1, result: { ok: false, code: "illegal_transition" } });
    expect(projectedCateringStage(props.lead, failed.lead)).toBe("inquiry");
    expect(failed.lead).toMatchObject({ phase: "failed", errorCode: "illegal_transition" });
    expect(cateringStageOverlay(failed, props, { ...start, request: 2 }).lead).toMatchObject({ phase: "saving", request: 2 });
  });

  it("locks duplicate moves and ignores out-of-order responses", () => {
    const saving = cateringStageOverlay({}, props, start);
    expect(cateringStageOverlay(saving, props, { ...start, to: "lost", request: 2 })).toBe(saving);
    expect(cateringStageOverlay(saving, props, { type: "resolve", id: "lead", request: 0, result: { ok: false, code: "generic" } })).toBe(saving);
    const failed = cateringStageOverlay(saving, props, { type: "resolve", id: "lead", request: 1, result: { ok: false, code: "network" } });
    const retry = cateringStageOverlay(failed, props, { ...start, request: 3 });
    expect(cateringStageOverlay(retry, props, { type: "resolve", id: "lead", request: 1, result: { ok: true } })).toBe(retry);
    // A dropped response can follow a committed PATCH. The refreshed server stage resolves it.
    expect(cateringStageOverlay(failed, { lead: "confirmed" }, { type: "props" })).toEqual({});
    expect(cateringStageOverlay({ lead: { ...saving.lead!, phase: "saved" } } as CateringStageOverlay, props, start).lead?.phase).toBe("saved");
  });

  it("retains legal transitions and final-stage confirmation in the board", () => {
    const source = readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8");
    expect(source).toContain("LEGAL_TRANSITIONS[lead.stage]");
    expect(source).toContain("stageMoveNeedsConfirm(s)");
    expect(source).toContain("<SaveStatus phase={stageMove.phase}");
    expect(source).toContain("projectedCateringStage(l.stage, stageOverlay[l.id])");
  });
});

describe("pipeline network refusal", () => {
  it("keeps network distinct from an unknown server refusal in en and es", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    try {
      expect(await postJson("/api/catering/pipeline/lead", { stage: "confirmed" }, "PATCH")).toEqual({ ok: false, code: "network" });
      expect(resolveErrorKey("network")).toBe("catering.pipeline.error.network");
      expect(en[resolveErrorKey("network")]).toBeTruthy();
      expect(es[resolveErrorKey("network")]).toBeTruthy();
      expect(resolveErrorKey("unexpected")).toBe("catering.pipeline.error.generic");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
