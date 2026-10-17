/**
 * CC chunk H9 fix 7 (2026-10-17, P3) — after `head_moved`, tab B said "your view is updated" while it still showed the old head
 * (~3 s, dev). The notice now says it is LOADING until the reload delivers a NEW head, and only then that the view is updated
 * (pinned in the reducer). en + es.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { EditNotice } from "@/components/schedule/PersonRow";
import { editReducer, initialEditState } from "@/components/schedule/use-drag-snap-shared";

const E = en as Record<string, string>;
const S = es as Record<string, string>;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("H9 fix 7: after head_moved the board says 'loading' until the new head is on screen", () => {
  it("refused head_moved → LOADING (reload asked); the reload with a NEW head → 'your view is updated'", () => {
    let s = editReducer(initialEditState("h1"), { type: "submit" });
    s = editReducer(s, { type: "refused", seq: 1, expectedHead: "h1", code: "head_moved" });
    expect(s).toMatchObject({ head: "h1", pending: null, reload: true, notice: "head_moving" });
    const updated = editReducer(s, { type: "reloaded", head: "h2" });
    expect(updated).toMatchObject({ head: "h2", reload: false, notice: "head_moved", pending: null });
    // A reload that brings back the SAME head has not updated the view: still loading.
    expect(editReducer(s, { type: "reloaded", head: "h1" })).toMatchObject({ notice: "head_moving" });
  });

  it("en + es: the loading notice never claims the view is updated", () => {
    const r = (state: ReturnType<typeof initialEditState>, lang: "en" | "es") =>
      text(renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: lang, children: createElement(EditNotice, { state }) })));
    for (const [lang, L] of [["en", E], ["es", S]] as const) {
      const loading = r({ ...initialEditState("h"), notice: "head_moving" as never, reload: true }, lang);
      expect(loading).toContain(L["schedule.board.edit.head_moving"]!);
      expect(loading).not.toContain(L["schedule.board.edit.head_moved"]!);
      expect(r({ ...initialEditState("h"), notice: "head_moved" }, lang)).toContain(L["schedule.board.edit.head_moved"]!);
    }
  });
});
