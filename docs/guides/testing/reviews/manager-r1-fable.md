# Manager guide — review round 1, Fable 5.1 (2026-10-13). FIX FIRST (~717 claims checked)

FALSE
1. **Submit Opening gate** (Morning › Opening verification › 4; ES L412): also needs every prep section verified (`opening-client.tsx:1101-1134`; steplog 14). → "The button stays grey until each station is ticked, each temp is typed and every prep section says Verified." (ES "…y cada sección de prep esté verificada").
2. **Delivery confirmed gate** (All day › Check in a delivery › 4; ES L660): invoice number NOT required. Needs vendor, date, at least one counted line, no half-filled new-item line, and the photo or **Photo later** (`components/receiving/ReceivingForm.tsx:606-607`). → "**Delivery confirmed** stays grey until at least one line has a count and you have taken the photo or ticked **Photo later**. A half-filled new-item line also blocks it." Keep "type the Invoice #" as advice, not a gate.
3. **Counts PIN order** (Manager tools › Counts › 3; ES L1238): levels 4-5 type the PIN in the **PIN** box next to the button BEFORE tapping; the button stays grey until 4 digits (`components/counts/CountForm.tsx:167,368-373`; `counts/page.tsx:45`). AGM+ tap **Record audit**, then the password box. → rewrite both.

SPANISH / LABEL
4. ES L668: "Esto marca solo la línea…" reads "ONLY". → "La línea de prep de mediodía en la lista de cierre se marca sola." (`lib/prep.ts:1581-1603`)
5. ES L941 / L675: Spanish section names are **Verificación de salida** and **Gerente de cierre** (`scripts/seed-closing-template.ts:112-113`) — use "Gerente de cierre (Closing Manager)", "Verificación de salida (Walk-Out Verification)".
6. L195 / ES L280: **Assigned to someone else** is the start of a longer message (`en.json:398`) → "a message that starts **Assigned to someone else**" (ES "Asignada a otra persona…").
7. ES L679: missing "Úsalos en el tablero o en **Mi turno**." (EN L622 has it).
8. ES adds **Fase 1 — conteo al par** (L667) and **Confirma con tu PIN** (L943) that EN lacks → add the English labels ("Phase 1 — count to par", "Confirm with your PIN") at EN L575 / L882.

UNPROVEN
9. L177 / ES L279: "Only a GM can change them." → "Only a GM or above can change them." (`lib/assignments.ts:217-218`).
10. "Just modified by someone else" (L898-904): PIN double-submit fix #458 shipped to production on 2026-10-13. A second request is no longer sent; a genuine close from another device now shows **This checklist is already confirmed.** (`closing.error.instance_closed`). → Rewrite: "If you see **This checklist is already confirmed.**, someone already submitted this closing (maybe on another device). It is saved. Check the dashboard: the card says **Closed** or **Closed with items incomplete**." Drop the "Just modified" wording. (CC addition)

PLAIN
11. Delivery › 3 (L532-536; ES L659): "only against a purchase order" applies to **Didn't arrive** (whole item missing) (`lib/receiving.ts:172,525`); a **Short** on a light line works on any delivery (steplog 22). → split accordingly.
12. Production (L1069): "Ask your GM for that link" → "A GM saves the Production page as a bookmark on the shop tablet; open it from there."
13. App words › Roles (L23; ES L228): add Catering Manager ("AGM (and Catering Manager)").
14. Night › AM prep (L689): add "On the board it is listed as **AM prep**, but you do it at night." (ES already has it).
15. Confirm the closing › 2 (L868): "Tap the yellow **Continue** at the bottom of the reasons panel." to tell it from **Continue closing**.
