import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { initialSaveStatus, saveStatusStep } from "@/lib/save-status-shared";
import { EmployeeEvalCard, PmReportClient } from "@/app/(authed)/pm-report/pm-report-client";
import type { PmReportForEdit } from "@/lib/pm-report";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const render = (language: "en" | "es", child: React.ReactNode) => renderToStaticMarkup(
  createElement(TranslationProvider, { initialLanguage: language, children: child }),
);

describe("PM report chunk 2", () => {
  it("guards all four eval labels in the read-only card under the translation provider", () => {
    for (const language of ["en", "es"] as const) {
      const html = render(language, createElement(EmployeeEvalCard, {
        employeeId: "employee", employeeName: "Alex", existing: undefined,
        pmReportId: "report", locationId: "shop", readOnly: true,
      }));
      const labels = language === "en"
        ? ["Arrived ready", "Attitude", "Production", "Team player", "Area to improve", "Note (managers only)"]
        : ["Llegó listo", "Actitud", "Producción", "Trabajo en equipo", "Área a mejorar", "Nota (solo gerentes)"];
      for (const label of labels) expect(html).toContain(label);
    }
  });

  it("shows the persisted MVP and note after submit", () => {
    const report: PmReportForEdit = {
      id: "report", status: "submitted", mvpUserId: "employee", mvpNote: "Stepped up",
      submittedAt: null, submittedByName: "Manager", evals: [], wrapUp: [],
    };
    const html = render("en", createElement(PmReportClient, {
      locationId: "shop", report, timeliness: [], locationUsers: [{ id: "employee", name: "Alex" }],
      presenceRoster: [], language: "en", submitted: true,
    }));
    expect(html).toContain("MVP");
    expect(html).toContain("Alex");
    expect(html).toContain("Stepped up");
  });

  it("invalidates Saved on edit and ignores a late acknowledgement", () => {
    const saving = saveStatusStep(initialSaveStatus, { type: "start" });
    const edited = saveStatusStep(saving, { type: "edit" });
    expect(saveStatusStep(edited, { type: "ack", revision: saving.revision })).toEqual(edited);
    const retry = saveStatusStep(edited, { type: "start" });
    expect(saveStatusStep(retry, { type: "ack", revision: retry.revision }).phase).toBe("saved");
  });

  it("wires both PM saves to shared status and persisted submitted props", () => {
    const source = readFileSync("app/(authed)/pm-report/pm-report-client.tsx", "utf8");
    expect(source).toContain("saveStatusStep(current.current, event)");
    expect(source).toContain("<SaveStatus phase={saveState.phase}");
    expect(source).toContain("<SaveStatus phase={mvpSaveState.phase}");
    expect(source).toContain("report.mvpNote");
    expect(source).toContain("router.refresh(); // Server re-renders");
  });
});
