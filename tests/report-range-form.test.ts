import { describe, expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import { ReportRangeForm } from "@/components/reports-hub/ReportRangeForm";

describe("range form interactions", () => {
  const setup = () => {
    const fields = {
      range: { name: "range", value: "last7" },
      from: { name: "from", value: "2026-10-01", disabled: false },
      to: { name: "to", value: "2026-10-07", disabled: false },
    };
    const currentTarget = { elements: { namedItem: (name: string) => fields[name as keyof typeof fields] } };
    const props = ReportRangeForm({action:"/reports",children:null}).props;
    const change = (name: keyof typeof fields) => props.onChange({currentTarget,target:fields[name]} as unknown as FormEvent<HTMLFormElement>);
    const submit = () => props.onSubmit({currentTarget} as unknown as FormEvent<HTMLFormElement>);
    return {fields,change,submit};
  };
  it.each(["from", "to"] as const)("editing %s selects custom and submits both dates", name => {
    const {fields,change,submit} = setup();
    change(name); submit();
    expect(fields.range.value).toBe("custom");
    expect(fields.from.disabled).toBe(false); expect(fields.to.disabled).toBe(false);
  });
  it.each(["last30", "last90", "last12m"])("selecting preset %s omits stale dates, including Sales presets", preset => {
    const {fields,change,submit} = setup();
    change("from");
    fields.range.value = preset; change("range"); submit();
    expect(fields.range.value).toBe(preset);
    expect(fields.from.disabled).toBe(true); expect(fields.to.disabled).toBe(true);
  });
  it("restores date editability after the native submission snapshot", () => {
    vi.useFakeTimers();
    try {
      const {fields,submit} = setup();
      submit();
      expect(fields.from.disabled).toBe(true);
      vi.runAllTimers();
      expect(fields.from.disabled).toBe(false);
      expect(fields.to.disabled).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
