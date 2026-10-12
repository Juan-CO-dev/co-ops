"use client";

import type { ReactNode } from "react";

/** Keep translations on the server; only native range-form interactions need JavaScript. */
export function ReportRangeForm({ action, children }: { action: string; children: ReactNode }) {
  return <form action={action} className="mb-4 flex flex-wrap items-end gap-3"
    onChange={(event) => {
      const input = event.target as unknown as HTMLInputElement;
      if (input.name !== "from" && input.name !== "to") return;
      const select = event.currentTarget.elements.namedItem("range") as HTMLSelectElement;
      select.value = "custom";
    }}
    onSubmit={(event) => {
      const form = event.currentTarget;
      const select = form.elements.namedItem("range") as HTMLSelectElement;
      // Presets must not submit the dates still displayed from the previous range.
      for (const name of ["from", "to"]) {
        const input = form.elements.namedItem(name) as HTMLInputElement;
        input.disabled = select.value !== "custom";
        // Native submission snapshots successful controls before the next task.
        // Restore editability if navigation is cancelled or the user goes Back.
        if (input.disabled) setTimeout(() => { input.disabled = false; }, 0);
      }
    }}
  >{children}</form>;
}
