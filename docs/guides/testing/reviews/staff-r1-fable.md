# Staff guide — review round 1, Fable 5.1 (2026-10-13). FIX FIRST (~555 claims checked)

1. **FALSE — "If nobody did AM prep, the closer count is empty."** (L244; ES L305). The Closer count badge sources from the persisted Phase 1 value: the closer count OR the Phase 1 recount (`components/opening/OpeningPrepEntry.tsx:658-663`; steplog 11–13 showed "CLOSER COUNT: 2 1/3 Pan" after a recount of 2). → "If nobody did AM prep, the number you typed in **Opener recount** shows here as the closer count." L225: add "(or your own recount from Phase 1)".
2. **"awaiting higher role"** — same as Opus item 3 (section header count; line badge "Level 4+ only" / "Shift Lead+ only").
3. **SPANISH — AM prep section names** — same as Opus item 4 (Verduras, Cocidos, Acompañantes, Salsas, Rebanado, Misceláneo).
4. **SPANISH/UNPROVEN — opening section headers (ES L270) and "la sección Closing Manager" (ES L533)** come from the template's translated station (`OpeningPrepEntry.tsx:356-358`). → write both forms, e.g. "Verduras (Veg), Cocidos (Cooks)…".
5. **SPANISH — mid-day times (ES L571)** "Toca desde las 2:00 PM…" reads as "tap". → "Se hace a partir de las 2:00 PM y va tarde después de las 3:30 PM."
6. **SPANISH — board label for AM prep** is "Preparación de la mañana" (`es.json:443`, `assignments.task.am_prep`). → add "En el tablero esta tarea se llama **Preparación de la mañana**. Es la misma Lista de Prep AM."
7. **PLAIN — End my shift sits before Night** (L457-475). It unassigns tasks and removes report tiles (facts.md:132; steplog 35: AM PREP tile vanished). A closer would end the shift before AM prep. → MOVE "End my shift" to the END of Night (both languages) and add: "Closers: finish your station's lines and AM prep first. End my shift takes your tasks and report tiles away."
8. **PLAIN — AM prep retry** (L634; ES L676): after starting the closing, the tile reads **Continue AM Prep** (es "Continuar Lista de Prep AM", `es.json:2501`). → "Go back to the dashboard, tap **Continue AM Prep**, then tap **Submit AM Prep** again."
9. **PLAIN — All day intro** (L309): one 22-word sentence. → split into short sentences.
10. **PLAIN — Morning** (L169; ES L250): "a manager assigns it" → "a manager or key holder" (key holders assign: `lib/assignments.ts:244-253`).
11. **PLAIN — dashboard Reports** (L85; ES L157): Reports also shows when you only hold a station (`app/(authed)/dashboard/page.tsx:684-689`). → "If you have no task and no station today, this part is not there."
