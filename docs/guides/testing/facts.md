# Guides v2 — code-verified facts sheet

Read from branch `docs/guides-v2`, 2026-10-13. Writers may state only what this sheet proves. Every line carries its evidence.

How to read it:

- Labels are written `key` → "English" → "Spanish". The English is in `lib/i18n/en.json` and the Spanish in `lib/i18n/es.json`, on the same line number in both files.
- Role levels come from `lib/roles.ts:47-62`. Prospect is 0, Hired (Not Yet Worked) 1, Trainee 2, Employee 3, Key Holder and Trainer 4, Shift Lead 5, AGM, Catering Manager, Prep Manager and Social Media Manager 6, GM 7, Manager of Operations 8, Owner 9, Chief Growth Strategist 10.
- "Assigned" means the person holds an active assignment for that task, for that shop, for today. The rule: below level 4 you need the assignment; at level 4 and up the floor alone is enough. Evidence: `lib/assignments.ts:73-91`, `lib/assignments-shared.ts:36-39`.
- Shops: always write the shop name (P Street, Capitol Hill). The app shows a short shop code in some places (login tile, location chip, some banners). Writers should not repeat it.

---

## Roles and task floors (reference)

- Task floors: AM prep 3, mid-day prep 3, opening report 3; cash report, receiving, counts, ordering, PM report 4 — `lib/assignments-shared.ts:36-39`
- Below level 4, a task opens only with an active assignment for today. At level 4 and up, the floor is enough — `lib/assignments.ts:76-77`, `lib/assignments.ts:78-90`
- An assignment never takes access away from a key holder: "Assignments delegate work; they never remove KH authority" — `lib/assignments.ts:72`
- PIN length is 4 digits for every role — `lib/roles.ts:98-100`
- Roles at level 5 and up also have an email and password sign-in path — `lib/roles.ts:34-35`, `lib/roles.ts:47-55`

## Getting in — login tiles

- Route `/`. There are two ways in: the tile flow (location → role → name → PIN) and the manager email + password form — `app/page.tsx:4-10`
- The login screens are always in English. No language toggle exists before sign-in — `app/page.tsx:93-98`
- Screen 1 heading: `auth.login.heading_location` → "Where are you?" → "¿Dónde estás?" — `lib/i18n/en.json:2906`, `app/page.tsx:230`
- Each location tile shows the short shop code above the shop name — `components/auth/LocationTile.tsx:38-41`
- Screen 2 heading: `auth.login.heading_role` → "What's your role?" → "¿Cuál es tu rol?" — `lib/i18n/en.json:2907`, `app/page.tsx:232`
- The role tiles offered are GM, AGM, Catering Manager, Shift Lead, Key Holder, Trainer, Employee and Trainee. There are no tiles for Prep Manager, Social Media Manager, Manager of Operations, Owner or Chief Growth Strategist — `app/page.tsx:76-85`
- Each role tile shows a short label above the full role name — `components/auth/RoleTile.tsx:45-48`
- Role names: `role.gm` → "General Manager" → "Gerente General"; `role.agm` → "Assistant General Manager" → "Subgerente General"; `role.catering_mgr` → "Catering Manager" → "Gerente de Catering"; `role.shift_lead` → "Shift Lead" → "Líder de Turno"; `role.key_holder` → "Key Holder" → "Encargado de Llaves"; `role.trainer` → "Trainer" → "Entrenador"; `role.employee` → "Employee" → "Empleado"; `role.trainee` → "Trainee" → "Aprendiz" — `lib/i18n/en.json:2413-2422`
- Screen 3 heading: `auth.login.heading_name` → "Who are you?" → "¿Quién eres?" — `lib/i18n/en.json:2908`, `app/page.tsx:234`
- Screen 4 prompt: `auth.pin.prompt` → "Enter your 4-digit PIN" → "Ingresa tu PIN de 4 dígitos" — `lib/i18n/en.json:2936`, `components/auth/PinKeypad.tsx:198`
- Keypad buttons: `auth.pin.clear` → "Clear" → "Borrar" (`lib/i18n/en.json:2944`); `auth.pin.back` → "Back" → "Atrás" (`lib/i18n/en.json:2946`) — `components/auth/PinKeypad.tsx:250`, `components/auth/PinKeypad.tsx:296`
- Back on the tile screens: `auth.login.back` → "Back" → "Atrás" — `lib/i18n/en.json:2909`, `app/page.tsx:449`
- Wrong PIN: `auth.pin.error_invalid` → "Wrong PIN. Try again." → "PIN incorrecto. Inténtalo de nuevo." — `lib/i18n/en.json:2938`, `components/auth/PinKeypad.tsx:219`
- Too many tries: `auth.pin.locked_title` → "Account locked" → "Cuenta bloqueada"; `auth.pin.locked_body` → "Too many failed attempts. Try again in {time}." → "Demasiados intentos fallidos. Inténtalo de nuevo en {time}." — `lib/i18n/en.json:2941-2942`, `components/auth/PinKeypad.tsx:230-235`
- Manager link (top right): `auth.login.surface_to_manager` → "Manager login →" → "Acceso de gerente →"; it switches back with `auth.login.surface_to_tile` → "Use tile login →" → "Usar acceso por mosaicos →" — `lib/i18n/en.json:2901-2902`, `app/page.tsx:271`
- After a correct PIN the app goes to the page you came from, or the dashboard — `app/page.tsx:136`
- Automatic sign-out after 10 minutes with no activity (can be changed with a server setting) — `lib/session.ts:20`, `lib/session.ts:40`
- After an automatic sign-out the login screen says: `auth.login.idle_signed_out` → "You were signed out after 10 minutes of inactivity." → "Se cerró tu sesión tras 10 minutos de inactividad." — `lib/i18n/en.json:2903`, `app/page.tsx:284-292`

## Getting in — the dashboard

- Route `/dashboard`. Header line: `dashboard.header.greeting` → "Hi, {name}." → "Hola, {name}." — `lib/i18n/en.json:2354`, `app/(authed)/dashboard/page.tsx:562`
- The header shows a role badge with your role name — `app/(authed)/dashboard/page.tsx:583-601`
- With one shop you see a fixed chip (shop code · shop name). With more than one shop you get a switcher to change shop — `app/(authed)/dashboard/page.tsx:639-658`
- Level 9 and up with no shop list set see an "all locations" chip — `app/(authed)/dashboard/page.tsx:523`, `app/(authed)/dashboard/page.tsx:615-626`
- Level 4 and up get a warning when yesterday's closing was not confirmed: `dashboard.yesterday.title` → "Yesterday's closing at {code} was not confirmed." → "El cierre de ayer en {code} no fue confirmado."; button `dashboard.yesterday.cta` → "Review yesterday's closing" → "Revisar el cierre de ayer" — `app/(authed)/dashboard/page.tsx:667-669`, `lib/i18n/en.json:2378`, `lib/i18n/en.json:2380`
- The dashboard shows the compact shift board ("My shift") — `app/(authed)/dashboard/page.tsx:670`, `components/assignments/ShiftBoardClient.tsx:177`
- The "Today's operations" card carries the closing checklist for every role: `dashboard.today.label` → "Today's operations" → "Operaciones de hoy"; `dashboard.today.closing_label` → "Closing checklist" → "Lista de cierre"; buttons `dashboard.cta.start_closing` → "Start closing" → "Empezar cierre", `dashboard.cta.continue_closing` → "Continue closing" → "Continuar cierre" — `app/(authed)/dashboard/page.tsx:674-679`, `lib/i18n/en.json:2358`, `lib/i18n/en.json:2360`, `lib/i18n/en.json:2374`, `lib/i18n/en.json:2376`
- The "Reports" section (`dashboard.reports.heading` → "Reports" → "Reportes") appears only when you hold a task or a station today — `app/(authed)/dashboard/page.tsx:684`, `lib/i18n/en.json:2498`
- Task tiles (Opening, AM prep, Mid-day prep, Receiving, Ordering, Counts, Cash, PM report) appear only to the person assigned that task today, at every level. This includes key holders and managers — `app/(authed)/dashboard/page.tsx:386`, `lib/assignment-sections.ts:19-22`, `lib/assignments-shared.ts:118-121`
- If you hold a station, a card links to it on the closing checklist: `assignments.stationCard` → "My station: {station}" → "Mi estación: {station}" — `app/(authed)/dashboard/page.tsx:686-689`, `lib/i18n/en.json:390`
- **Log out** is at the bottom of the dashboard: `auth.logout.label` → "Log out" → "Cerrar sesión" — `app/(authed)/dashboard/page.tsx:771-773`, `components/auth/LogoutButton.tsx:40`, `lib/i18n/en.json:2404`

## Getting in — the menu (Explore chips)

- The menu is a row of chips under the label `nav.section_label` → "Explore" → "Explorar" — `components/DashboardNav.tsx:39-46`, `lib/i18n/en.json:472`
- Chips in display order, with the lowest level that sees each one. Each chip also checks its own page (`lib/nav-links.ts:44-53`):
  - Mid-Shift Pulse: level 2 when Pulse v2 is on, level 4 when it is off — `lib/nav-links.ts:46-47`. Label `nav.mid_shift` → "Mid-Shift Pulse" → "Pulso de medio turno" — `lib/i18n/en.json:1959`
  - Reports Hub (2): `nav.reports_hub` → "Reports Hub" → "Centro de reportes" — `lib/nav-links.ts:20`, `lib/i18n/en.json:473`
  - Assignments (everyone): `nav.assignments` → "Assignments" → "Asignaciones" — `lib/nav-links.ts:21`, `lib/i18n/en.json:379`
  - Trends (4): `nav.trends` → "Trends" → "Tendencias" — `lib/nav-links.ts:22`, `lib/i18n/en.json:474`
  - LTO (6): `nav.lto` → "LTO" → "LTO" — `lib/nav-links.ts:23`, `lib/i18n/en.json:488`
  - Written Reports (2): `nav.written_reports` → "Written Reports" → "Reportes escritos" — `lib/nav-links.ts:24`, `lib/i18n/en.json:489`
  - Catering (5): `nav.catering` → "Catering" → "Catering" — `lib/nav-links.ts:25`, `lib/i18n/en.json:537`
  - Maintenance (3): `maintenance.nav_label` → "Maintenance" → "Mantenimiento" — `lib/nav-links.ts:26`, `lib/i18n/en.json:2763`
  - Training (everyone): `nav.training` → "Training" → "Capacitación" — `lib/nav-links.ts:27`, `lib/i18n/en.json:478`
  - Recipes (6, opens the admin recipe list): `nav.recipes` → "Recipes" → "Recetas" — `lib/nav-links.ts:28`, `lib/i18n/en.json:479`
  - Profile (everyone): `nav.profile` → "Profile" → "Perfil" — `lib/nav-links.ts:29`, `lib/i18n/en.json:475`
  - Settings (everyone): `nav.settings` → "Settings" → "Configuración" — `lib/nav-links.ts:30`, `lib/i18n/en.json:476`
  - My Performance (everyone). The route is `/my-feedback`, but the label reads `nav.my_feedback` → "My Performance" → "Mi Desempeño" — `lib/nav-links.ts:31`, `lib/i18n/en.json:1960`
  - Vault: only while the vault switch is on (it is off; see DO NOT DOCUMENT) — `lib/nav-links.ts:49-51`
  - Admin (6), shown last: `nav.admin` → "Admin" → "Admin" — `lib/nav-links.ts:52`, `lib/i18n/en.json:538`
- The menu never shows Ordering or any placeholder page (Recipes stub, Announcements, Tips, AI, Rollups, Deep Cleaning, Feedback, Comms) — `tests/nav-links.test.ts:19-21`
- The caller reports PULSE_V2 is on in production. Code only shows the switch is off unless set to "1", so its production state cannot be confirmed from the code — `lib/pulse/flag.ts:2-6`
- A user menu sits top right: a round button with your initial (`user_menu.aria_label` → "User menu" → "Menú de usuario") — `app/(authed)/layout.tsx:55-60`, `components/UserMenu.tsx:141-155`, `lib/i18n/en.json:452`
- In the user menu: "Signed in as", a language switch (English / Español), a Dashboard link (on other pages), and **Sign out** (`user_menu.sign_out` → "Sign out" → "Cerrar sesión") — `components/UserMenu.tsx:168-195`, `components/UserMenu.tsx:250-277`, `lib/i18n/en.json:453-459`
- The profile blurb editor in the user menu appears only at level 6 and up: `user_menu.blurb.label` → "Profile blurb" → "Tu perfil" — `components/UserMenu.tsx:33`, `components/UserMenu.tsx:211`, `lib/i18n/en.json:461`

## Morning — Opening Report

- Tap path: Dashboard → Reports → **Opening Report** tile → **Open / continue**. The tile shows only if the opening is assigned to you. Without it: Assignments → Tasks list → **Opening prep** (level 4 and up). Route `/operations/opening?location=…` — `app/(authed)/dashboard/page.tsx:690-699`, `components/assignments/ShiftBoardClient.tsx:221-225`, `lib/assignments-shared.ts:90-96`
- Tile: `dashboard.opening.tile_label` → "Opening Report" → "Reporte de apertura"; `dashboard.opening.cta` → "Open / continue" → "Abrir / continuar" — `lib/i18n/en.json:2111-2112`
- The same task is named differently on the shift board: `assignments.task.opening_report` → "Opening prep" → "Preparación de apertura" — `lib/i18n/en.json:446`
- Lowest role that can OPEN it: Employee (3) with today's opening assignment; Key Holder (4) without one. Anyone else is sent back to the dashboard — `app/(authed)/operations/opening/page.tsx:159-160`, `lib/assignments-shared.ts:37`, `lib/assignments.ts:76-77`
- Lowest role that can SUBMIT it: the same as above. Every save and submit runs the same check — `app/(authed)/operations/opening/opening-client.tsx:1170-1171`, `lib/opening.ts:743-751`, `app/api/opening/submit/phase1/route.ts:378-379`
- An old draft note says employees "cannot submit". It was replaced by "KH+ OR today's active opening assignment" — `lib/opening-draft-shared.ts:70-74`
- Page label and title: `opening.page.label` → "Opening Report" → "Reporte de Apertura"; `opening.page.title` → "Phase 1 — Verification" → "Fase 1 — Verificación" — `lib/i18n/en.json:2522-2523`
- Subtitle: `opening.page.subtitle` → "Verify last night's closing matches reality. Tap each station once you've checked it; add a comment if anything looks off." → "Verifica que el cierre de anoche corresponda con la realidad. Toca cada estación una vez que la revises; añade un comentario si algo no coincide." — `lib/i18n/en.json:2524`
- Gate: the opening is blocked only if last night's closing exists and is still open. If there was no closing last night, there is no block — `app/(authed)/operations/opening/page.tsx:96-125`, `app/(authed)/operations/opening/page.tsx:165-169`
- Gate banner: `opening.gate.title` → "Waiting on last night's closing at {code}" → "Esperando el cierre de anoche en {code}"; `opening.gate.body` → "The closing report from {date} hasn't been finalized yet. Opening will unlock once it's confirmed or auto-released." → "El reporte de cierre del {date} aún no se ha finalizado. La Apertura se desbloqueará cuando se confirme o se libere automáticamente."; button `opening.gate.cta_view_prior_closing` → "View last night's closing" → "Ver el cierre de anoche" — `app/(authed)/operations/opening/page.tsx:171-183`, `lib/i18n/en.json:2530-2532`
- Phase tabs: `opening.phase.tab_phase1` → "Phase 1 · Verify" → "Fase 1 · Verificar" (`lib/i18n/en.json:2556`); `opening.phase.tab_phase2` → "Phase 2 — Prep Entry" → "Fase 2 — Entrada de Prep" (`lib/i18n/en.json:2631`); before Phase 1 is submitted it reads `opening.phase.tab_phase2_locked` → "Phase 2 (locked)" → "Fase 2 (bloqueada)" (`lib/i18n/en.json:2632`) — `app/(authed)/operations/opening/opening-client.tsx:1804-1847`
- Phase 1: tap each station's button `opening.station.tick_button` → "Verified" → "Verificar" (the Spanish is the verb "Verify", not "Verified") — `lib/i18n/en.json:2538`, `components/opening/OpeningVerificationStation.tsx`
- Prep sections have `opening.section_verify.cta` → "Verify section" → "Verificar sección"; it is greyed out with `opening.section_verify.disabled_null_items` → "Recount items without closer data first" until those recounts are typed — `lib/i18n/en.json:2641`, `lib/i18n/en.json:2644`
- Phase 1 saves itself as you go (a shared draft). A second person who opens the same opening finds the first person's ticks, temperatures and comments — `app/(authed)/operations/opening/page.tsx:250-259`, `app/api/opening/phase1/draft/route.ts:3-8`
- Draft status line: `opening.draft.saved` → "Saved a moment ago" → "Guardado hace un momento" — `lib/i18n/en.json:2554`, `app/(authed)/operations/opening/opening-client.tsx:2070-2077`
- Phase 1 button: `opening.submit.button_label` → "Submit Opening" → "Enviar Apertura" — `lib/i18n/en.json:2567`, `app/(authed)/operations/opening/opening-client.tsx:2098`
- Submit Opening needs every station ticked and every temperature filled (plus a reason if prompted) — `app/(authed)/operations/opening/opening-client.tsx:1153-1157`
- On submit, the report moves from "open" to "phase1_complete" and Phase 2 unlocks for everyone with access — `app/api/opening/submit/phase1/route.ts:52`, `app/(authed)/operations/opening/opening-client.tsx:1146-1152`
- The "Hand to a key holder" text exists (`opening.submit.button_label_hand_off` → "Hand to a key holder" → "Pásalo a un key holder", `lib/i18n/en.json:2560`). It shows only when the viewer cannot submit, but anyone who cannot submit is redirected before the page loads. In practice it never shows — `app/(authed)/operations/opening/opening-client.tsx:2098`, `app/(authed)/operations/opening/page.tsx:159-160`
- Phase 2 — Prep Entry: each row shows `opening.phase2.par_label` → "Par" → "Par", `opening.phase2.closer_estimate_label` → "Closer count" → "Conteo de cierre", `opening.phase2.prep_need_label` → "Prep need" → "Por preparar"; you type `opening.phase2.opener_prepped_label` → "Opener prepped" → "Preparado hoy" — `lib/i18n/en.json:2635-2637`, `lib/i18n/en.json:2653`
- Phase 2 rows can be undone with `opening.phase2.revoke.cta` → "Undo" → "Deshacer" — `lib/i18n/en.json:2698`
- Phase 2 finish button: `opening.finalize.button_label` → "Finalize Phase 2" → "Finalizar Fase 2". After finishing it reads `opening.finalize.button_label_finalized` → "Phase 2 finalized" → "Fase 2 finalizada" — `lib/i18n/en.json:2758`, `lib/i18n/en.json:2760`
- Finalize works only from "phase1_complete" with no outstanding rows. It moves the report to "phase2_complete" — `app/(authed)/operations/opening/opening-client.tsx:1167-1169`, `lib/opening.ts:2726`
- The "Closer count" is last night's AM Prep count of what was left at closing: "Closer's actual count of remaining inventory from prior-night AM Prep" — `lib/opening.ts:659-668`
- If last night's AM Prep is missing, the closer count is empty ("closer_count NULL when AM Prep missing for prior operational date") — `lib/opening.ts:853-855`, `lib/opening.ts:671-678`
- Once done, the page is read-only: `opening.read_only.title` → "Opening verified" → "Apertura verificada" — `app/(authed)/operations/opening/page.tsx:203-219`, `lib/i18n/en.json:2534`
- Late after 10:30 AM. The store opens at 10:30 — `lib/midshift-shared.ts:278`, `lib/midshift-shared.ts:286`, `lib/midshift-shared.ts:323-324`

## The board — /assignments

- Tap path: Dashboard → Explore → **Assignments**, or the **Assignments** / **View my day** link at the bottom of "My shift". Route `/assignments` — `lib/nav-links.ts:21`, `components/assignments/ShiftBoardClient.tsx:342`
- Every level can open it. It shows the shops you belong to — `app/(authed)/assignments/page.tsx:12-25`
- Page title `assignments.title` → "Assignments" → "Asignaciones"; board heading `assignments.team` → "Today's team" → "Equipo de hoy". The dashboard version is headed `assignments.myShift` → "My shift" → "Mi turno" — `app/(authed)/assignments/page.tsx:29`, `components/assignments/ShiftBoardClient.tsx:177`, `lib/i18n/en.json:399-402`
- Below level 4 the bottom link reads `assignments.viewDay` → "View my day" → "Ver mi día"; at level 4 and up it reads "Assignments" — `components/assignments/ShiftBoardClient.tsx:342`, `lib/i18n/en.json:417`
- Section headings: level 4 and up see `assignments.takeAssignTasks` → "Take or assign tasks" → "Tomar o asignar tareas" and `assignments.takeAssignStations` → "Take or assign stations" → "Tomar o asignar estaciones". Below 4 they read `assignments.tasks` → "Tasks" → "Tareas" and `assignments.stations` → "Stations" → "Estaciones" — `components/assignments/ShiftBoardClient.tsx:181`, `components/assignments/ShiftBoardClient.tsx:214-217`, `lib/i18n/en.json:386-387`, `lib/i18n/en.json:411`, `lib/i18n/en.json:421`
- The first item in the task list is **Closing checklist**: `assignments.everyone` → "Everyone on shift · no assignment needed" → "Todos en el turno · no requiere asignación" — `components/assignments/ShiftBoardClient.tsx:220`, `lib/i18n/en.json:394-395`
- Task names: `assignments.task.am_prep` → "AM prep" → "Preparación de la mañana"; `.mid_day_prep` → "Mid-day prep" → "Preparación del mediodía"; `.cash_report` → "Cash report" → "Reporte de caja"; `.opening_report` → "Opening prep" → "Preparación de apertura"; `.receiving` → "Receiving" → "Recepción"; `.counts` → "Counts" → "Conteos"; `.ordering` → "Ordering" → "Pedidos"; `.pm_report` → "PM report" → "Reporte PM" — `lib/i18n/en.json:380-383`, `lib/i18n/en.json:443-446`
- Level 4 and up can open any task they qualify for. Below 4, only your own assigned task is a link. Otherwise you see `assignments.assignedOther` → "Assigned to someone else. Ask a key holder to change the assignment before doing this task." → "Asignada a otra persona. Pídele a un encargado de llaves que cambie la asignación antes de hacer esta tarea." — `components/assignments/ShiftBoardClient.tsx:223-229`, `lib/i18n/en.json:398`
- "Take" = a level 4+ person opens an unassigned task and does it. Hint: `assignments.takeHint` → "Open an unassigned task to do it. Your submission records you as the doer; to assign it to yourself, ask another key holder." — `components/assignments/ShiftBoardClient.tsx:218`, `lib/i18n/en.json:393`
- A "taken" task is labelled "Taken by {name} · {time}". It gives no access by itself — `lib/i18n/en.json:355`, `lib/assignment-taken.ts:7-11`
- Unassigned task prompt (level 4+ on "My shift"): `assignments.unassignedAction` → "Unassigned: {task} · assign or take it" → "Sin asignar: {task} · asigna o haz la tarea" — `components/assignments/ShiftBoardClient.tsx:214-215`, `lib/i18n/en.json:384`
- Assigning a task: level 4 and up, only to someone at your level or below who meets the task's floor. Button `assignments.assignTask` → "Assign task" → "Asignar tarea" — `lib/assignments.ts:244-253`, `lib/assignments-shared.ts:112-114`, `lib/i18n/en.json:416`
- Taking back an assignment: level 4 and up, `assignments.retract` → "Retract" → "Retirar" — `lib/assignments.ts:268-272`, `components/assignments/ShiftBoardClient.tsx:246`, `components/assignments/ShiftBoardClient.tsx:291`, `lib/i18n/en.json:413`
- Changing an assignment made by someone more senior requires a reason: `assignments.reasonRequired` → "This assignment was made by someone with a higher role. Select a reason to change it."; "Other" needs a written note — `lib/assignments-shared.ts:14-22`, `lib/i18n/en.json:363-364`
- Stations: level 4 and up place people with `assignments.setStation` → "Set station" → "Asignar estación" — `components/assignments/ShiftBoardClient.tsx:195-207`, `lib/i18n/en.json:409`
- Anyone can claim their own station, but only from the dashboard "My shift" board (`assignments.claimChange` → "Claim / change station" → "Elegir / cambiar estación"). Below level 4 you cannot pick a position someone already holds — `components/assignments/ShiftBoardClient.tsx:247`, `components/assignments/ShiftBoardClient.tsx:274`, `lib/i18n/en.json:410`
- Breaks: `assignments.lifecycle.startBreak` → "Start break" → "Iniciar descanso" / `assignments.lifecycle.backFromBreak` → "Back from break" → "Volver del descanso". You can do this for yourself; level 4+ can do it for others at or below their level — `components/assignments/ShiftBoardClient.tsx:252`, `lib/assignments.ts:166`, `lib/i18n/en.json:5486-5487`
- A station only appears on the board if it is switched on, staffed, and has at least one active position. Other closing sections stay only on the closing checklist — `lib/assignments-shared.ts:45-57`
- **End my shift** (`whosHere.endMyShift` → "End my shift" → "Terminar mi turno"). Confirm text: `whosHere.endMyShiftConfirm` → "End your shift? Your station is released and your open tasks are unassigned." → "¿Terminar tu turno? Se libera tu estación y se quitan tus tareas abiertas." — `components/assignments/ShiftBoardClient.tsx:78-87`, `components/assignments/ShiftBoardClient.tsx:329`, `lib/i18n/en.json:5498`, `lib/i18n/en.json:5500`
- Level 4+ can end someone else's shift (at or below their level) with `whosHere.endShift` → "End shift" → "Terminar turno" — `components/assignments/ShiftBoardClient.tsx:81`, `lib/assignments.ts:191-195`, `lib/i18n/en.json:5499`
- End my shift only writes inside CO-OPS (the `end_shift` database call, recorded as `shift.end`). Nothing in it writes to Toast, so it does not clock you out of Toast — `lib/assignments.ts:185-207`
- End my shift and the "Here now" list exist only while the WHOS_HERE switch is on (`WHOS_HERE=1`). Production state cannot be confirmed from code — `lib/whos-here.ts:15-17`, `lib/assignments.ts:188`, `components/assignments/ShiftBoardClient.tsx:79`
- Station hours and staffing trims: GM (7) and up for their own shop, level 8 for any shop — `lib/assignments.ts:209-218`
- Stations page (`/stations`, from the **Stations** button on the board) is read-only for staff; timing edits need GM (7) — `app/(authed)/stations/page.tsx:11`, `app/(authed)/stations/page.tsx:36-38`, `components/assignments/ShiftBoardClient.tsx:178`

## All day — closing checklist by station

- Tap path: Dashboard → Today's operations → **Start closing** / **Continue closing**, or Assignments → **Closing checklist**. Route `/operations/closing?location=…` — `app/(authed)/dashboard/page.tsx:913`, `components/assignments/ShiftBoardClient.tsx:220`
- Title: `closing.page.title` → "Closing checklist" → "Lista de cierre"; `closing.page.progress_label` → "Progress" → "Progreso" — `lib/i18n/en.json:2295`, `lib/i18n/en.json:2298`
- Lowest role that can OPEN it: Trainee (2), but only once the day's checklist exists. Starting a new day's checklist needs Employee (3) — `app/(authed)/operations/closing/page.tsx:236-237`, `lib/checklists.ts:769-771`
- Who can tick a line: anyone whose level is at or above that line's "min role level". Each line in the template sets its own level — `lib/checklist-constants.ts:49-60`, `lib/checklists.ts:934-941`
- Lines above your level are marked: `closing.station.awaiting_higher_role` → " · {count} awaiting higher role" → " · {count} esperando rol superior" — `lib/i18n/en.json:2303`
- Report lines (AM prep, cash, mid-day prep and other report links) cannot be ticked by hand. They tick themselves when that report is filed — `lib/checklist-constants.ts:58`
- Stations close through the day: a station counts as closed when every active line in its closing section has a live completion. If a line is reopened, the station reopens — `supabase/migrations/0230_station_lifecycle.sql:4-6`, `supabase/migrations/0230_station_lifecycle.sql:216-218`, `docs/ROADMAP.md:366`
- A closed station shows `assignments.lifecycle.closed` → "Closed · {time}" → "Cerrada · {time}" on the board — `components/assignments/ShiftBoardClient.tsx:89`, `lib/i18n/en.json:5476`
- Station "usually closes" times are hints only: `assignments.lifecycle.timingHint` → "Hints only. Closing checklist items close stations; these times do not." — `lib/i18n/en.json:5482`
- Closing is late after 9:00 PM. The store closes at 8:00 PM — `lib/midshift-shared.ts:280`, `lib/midshift-shared.ts:289`, `lib/midshift-shared.ts:329-330`

## All day — Mid-Shift Pulse

- Tap path: Dashboard → Explore → **Mid-Shift Pulse**. Route `/mid-shift`; each section has a detail page `/mid-shift/<section>` — `lib/nav-links.ts:47`, `lib/pulse/scope-shared.ts:113-119`
- With Pulse v2 on: level 2 and up open it, 0–1 are denied. Level 8 and up get the side-by-side **Both shops** view — `lib/pulse/scope-shared.ts:38-39`, `lib/pulse/scope-shared.ts:105-111`, `lib/pulse/scope-shared.ts:57-58`
- With Pulse v2 off: the old page, level 4 and up only — `app/(authed)/mid-shift/page.tsx:56-70`, `lib/midshift-shared.ts:12`
- **Correction to the brief:** a GM (7) does not get Both shops. That needs level 8 (Manager of Operations) and up. A GM only sees the shops they belong to — `lib/pulse/scope-shared.ts:16`, `lib/pulse/scope-shared.ts:57-68`
- Page title `pulse.page.title` → "Mid-shift Pulse" → "Pulso de medio turno"; `pulse.page.both_shops` → "Both shops" → "Ambas tiendas" — `lib/i18n/en.json:5653-5654`
- Sections and the lowest level that sees each: Needs attention 2, Live shop floor 2, People 4, Stations & tasks 2, Sales 7, Catering 2, Inventory 4, Food safety 2, Handoff 2 — `lib/pulse/scope-shared.ts:70-82`
- Section labels: `pulse.section.attention` → "Needs attention" → "Requiere atención"; `.floor` → "Live shop floor" → "Piso en vivo"; `.people` → "People" → "Personas"; `.stations` → "Stations & tasks" → "Estaciones y tareas"; `.sales` → "Sales" → "Ventas"; `.catering` → "Catering" → "Catering"; `.inventory` → "Inventory" → "Inventario"; `.food_safety` → "Food safety" → "Seguridad alimentaria"; `.handoff` → "Handoff" → "Entrega de turno" — `lib/i18n/en.json:5669-5677`
- Crew (below 4) see only their own tasks and stations, counts instead of names, catering timing with no names or money, food-safety reminders, and notes meant for crew — `lib/pulse/scope-shared.ts:9-11`, `lib/pulse/scope-shared.ts:91-94`
- Key Holder / Shift Lead (4–5) get full detail except money. AGM (6) adds handoff writing. GM (7) adds sales and money — `lib/pulse/scope-shared.ts:12-15`, `lib/pulse/scope-shared.ts:40-45`
- Only GM (7) and up can save the floor layout (`pulse.floor.arrange` → "Arrange" → "Organizar") — `lib/pulse/scope-shared.ts:46-47`, `lib/i18n/en.json:5713`
- Floor view toggle: `pulse.floor.mode_3d` → "3D view" → "Vista 3D" / `pulse.floor.mode_2d` → "Map view" → "Vista de mapa" — `lib/i18n/en.json:5711-5712`
- The maintenance link appears only at level 3 and up (`pulse.food_safety.maintenance_link` → "Maintenance log" → "Registro de mantenimiento"). Below 3, the fridge alert opens the pulse's own food-safety page instead — `lib/pulse/scope-shared.ts:48-56`, `components/pulse/sections/FoodSafetySection.tsx:35`, `lib/pulse/sections.ts:301`, `lib/i18n/en.json:5825`
- Fridge reminder after 10:30 AM if any fridge is unchecked: `pulse.food_safety.reminder` → "Fridge temps haven't been checked yet today." — `lib/pulse/sections.ts:304`, `lib/pulse/sections.ts:594`, `lib/i18n/en.json:5820`
- A section your role cannot see shows `pulse.card.error_forbidden` → "Not available for your role." → "No disponible para tu rol." — `lib/i18n/en.json:5665`
- Sections refresh every 60 seconds (`pulse.page.refresh_note` → "Refreshes every 60 s") — `lib/i18n/en.json:5656`

## All day — fridge temps and maintenance

- Tap path: Dashboard → Explore → **Maintenance**. Route `/maintenance?location=…` — `lib/nav-links.ts:26`
- Lowest role to open it and save a note: Employee (3). Trainees cannot — `lib/maintenance.ts:18`, `app/api/maintenance/note/route.ts:61-62`
- The page's code comment wrongly calls the level-3 gate "KH+". The number is 3 — `app/(authed)/maintenance/page.tsx:8`
- Title `maintenance.page.title` → "Maintenance Log" → "Registro de mantenimiento"; `maintenance.overview.fridges_heading` → "Fridge temps" → "Temperaturas de refrigeradores" — `lib/i18n/en.json:2764-2765`
- Fridge temperatures are not typed here. They come from the temperature lines on the opening (AM) and closing (PM) checklists — `lib/maintenance.ts:26-33`, `lib/maintenance.ts:52-57`
- Status: no reading today / out of range (any reading today above the fridge's safe max) / ok. The default safe max is 41°F — `lib/maintenance.ts:19`, `lib/maintenance.ts:71-75`
- Status labels: `maintenance.status.out_of_range` → "Out of range" → "Fuera de rango"; `maintenance.status.no_reading` → "No reading today" → "Sin lectura hoy" — `lib/i18n/en.json:2770-2771`
- Note form: `maintenance.add_note.title` → "Log a maintenance note" → "Registrar nota de mantenimiento"; `maintenance.add_note.equipment_label` → "Equipment" → "Equipo"; `maintenance.add_note.submit` → "Save note" → "Guardar nota" — `lib/i18n/en.json:2783-2784`, `lib/i18n/en.json:2788`

## All day — deliveries (receiving)

- Tap path: Dashboard → Reports → **Receiving** tile (only if assigned to you), or Reports Hub → Inventory → **Receiving**. Route `/operations/receiving?location=…` — `app/(authed)/dashboard/page.tsx:730-737`, `app/(authed)/reports/page.tsx:92`
- Lowest role to open and file it: Key Holder (4). Below 4 you are sent to the dashboard — `app/(authed)/operations/receiving/page.tsx:21`, `app/(authed)/operations/receiving/page.tsx:26`, `lib/assignments-shared.ts:38`
- Title `receiving.page.title` → "Receiving" → "Recepción" — `lib/i18n/en.json:3149`
- Finish buttons: `receiving.door.submit_complete` → "Delivery confirmed" → "Entrega confirmada"; `receiving.door.submit_partial` → "Save partial — truck still unloading" → "Guardar parcial — el camión sigue descargando" — `components/receiving/ReceivingForm.tsx:1942-1951`, `lib/i18n/en.json:3247-3248`
- Item that didn't come: the form lists `receiving.missing.title` → "Some expected items were never confirmed" → "No confirmaste algunos artículos esperados"; each has `receiving.missing.received` → "Received" → "Sí llegó" or `receiving.missing.not_arrived` → "Didn't arrive" → "No llegó" — `components/receiving/ReceivingForm.tsx:1831-1876`, `lib/i18n/en.json:3265`, `lib/i18n/en.json:3269-3271`
- What happens: `receiving.missing.summary_claim` → "{n} short(s) will be claimed on this delivery." Anything left unanswered: `receiving.missing.summary_unanswered` → "Anything left unanswered is filed as not counted — it will show up against the invoice." — `components/receiving/ReceivingForm.tsx:1886-1895`, `lib/i18n/en.json:3273-3274`
- Shorts can be claimed only against a purchase order: `receiving.error.missing_requires_po` → "Shorts can only be claimed against a purchase order." — `lib/i18n/en.json:3277`
- Claimed shorts become vendor credits: `receiving.credits.panel_title` → "Open vendor credits" → "Créditos de proveedor abiertos" — `lib/i18n/en.json:3282`

## All day — mid-day prep

- Tap path: Dashboard → Reports → **Mid-day Prep** tile → `dashboard.mid_day_prep.new_cta` → "+ New mid-day prep" → "+ Nueva preparación de mediodía". Route `/operations/mid-day?instance=…` — `lib/i18n/en.json:2118-2119`, `app/(authed)/operations/mid-day/page.tsx:4-7`
- Lowest role to start and finish it: Employee (3) with today's mid-day prep assignment; Key Holder (4) without — `app/api/prep/mid-day/route.ts:84-89`, `app/(authed)/operations/mid-day/page.tsx:123`, `lib/prep.ts:1176-1178`, `lib/assignments-shared.ts:37`
- The no-access message still says it is a key-holder task: `dashboard.mid_day_prep.role_gate` → "Mid-day prep is a key-holder task. Ask a key holder or manager to open it." This message is outdated, because an assigned employee can open it — `components/MidDayPrepTile.tsx:41-47`, `lib/i18n/en.json:2123`
- At most 2 per shop per day: `dashboard.mid_day_prep.cap_reached` → "Mid-day prep limit reached ({cap} per day)." — `lib/prep.ts:1020-1025`, `lib/i18n/en.json:2129`
- The code's stated purpose for the two runs: "one on-demand mid-shift top-up + one 'leave the closing/next-opener with prepped items' pass" — `lib/prep.ts:1020-1024`
- Phase 1 counts `mid_day_prep.phase1.on_hand` → "On hand" → "En mano" (and `mid_day_prep.phase1.back_up` → "Bulk backup" → "Respaldo a granel") against par, then `mid_day_prep.phase1.submit` → "Submit count → Phase 2" → "Enviar conteo → Fase 2" — `components/MidDayPhase1Form.tsx:174-226`, `lib/i18n/en.json:2168-2172`
- Phase 2: enter `mid_day_prep.phase2.prepped` → "Prepped" → "Preparado", then `mid_day_prep.phase2.finalize` → "Finalize prep" → "Finalizar preparación" — `lib/i18n/en.json:2174`, `lib/i18n/en.json:2180`
- Finishing ticks the closing checklist's Mid-day Prep line automatically, with a count — `lib/prep.ts:1581-1589`, `lib/prep.ts:1597-1603`
- Due from 2:00 PM, late after 3:30 PM — `lib/midshift-shared.ts:279`, `lib/midshift-shared.ts:287-288`, `lib/midshift-shared.ts:325-328`

## Night — AM prep (the closing count)

- Tap path: Dashboard → Reports → **AM Prep** tile (if assigned) → `dashboard.am_prep.cta_start` → "Start AM Prep" → "Iniciar Lista de Prep AM", or the AM Prep line on the closing checklist. Route `/operations/am-prep?location=…` — `lib/i18n/en.json:2499-2500`, `app/(authed)/dashboard/page.tsx:700-721`
- Lowest role to open and submit it: Employee (3) with today's AM prep assignment; Key Holder (4) without — `app/(authed)/operations/am-prep/page.tsx:20-21`, `app/(authed)/operations/am-prep/page.tsx:98-101`, `lib/prep.ts:629-631`
- It is a night job. The opener's "Closer count" is read from last night's AM Prep — `lib/opening.ts:659-668`, `lib/opening.ts:853-855`
- AM prep and cash have no clock time. They are due once closing is done: "am_prep + cash are NOT clock-based — they're 'expected when closing is done'" — `lib/midshift-shared.ts:281-282`, `lib/midshift-shared.ts:331-335`
- AM prep's BACK UP column is "the bulk container tomorrow's opener starts from" — `lib/prep.ts:624-627`
- Submitting AM prep auto-ticks the closing checklist's AM prep line for the same day. If today's closing does not exist yet, the submit fails and nothing is saved — `lib/prep.ts:264-269`
- The count saves itself as a shared draft for the shop and day: `am_prep.draft.restored` → "Picked up where you left off at {time} ({name})" — `app/(authed)/operations/am-prep/page.tsx:28-30`, `lib/i18n/en.json:2493`
- Button `am_prep.submit.button` → "Submit AM Prep" → "Enviar Lista de Prep AM"; success `am_prep.banner.success` → "AM Prep submitted at {time} by {name}" — `lib/i18n/en.json:2454`, `lib/i18n/en.json:2462`
- The board's Spanish task name `assignments.task.am_prep` → "Preparación de la mañana" means "morning prep". The tile reads "Lista de Prep AM" — `lib/i18n/en.json:443`, `lib/i18n/en.json:2499`
- If today's AM prep has zero saved items, the closing shows an advisory note: `closing.am_prep_gap.banner` → "AM Prep had 0 items saved today - check with the opener." It never blocks finalizing — `app/(authed)/operations/closing/closing-client.tsx:128-133`, `lib/i18n/en.json:2321`

## Night — PM report

- Tap path: Dashboard → Reports → **PM report** tile (if assigned), or Assignments → Tasks → **PM report**. Route `/pm-report?location=…` — `app/(authed)/dashboard/page.tsx:761-767`, `lib/assignments-shared.ts:94`
- Lowest role to open and submit it: Key Holder (4) — `lib/pm-report.ts:6`, `app/(authed)/pm-report/page.tsx:48`, `app/(authed)/pm-report/page.tsx:60`
- Title `pm.page.title` → "PM Report" — `lib/i18n/en.json:2069`
- Each employee is graded on four 3-way scales: `pm.eval.arrived_ready` → "Arrived ready" → "Llegó listo"; `pm.eval.attitude` → "Attitude" → "Actitud"; `pm.eval.production` → "Production" → "Producción"; `pm.eval.team_player` → "Team player" → "Trabajo en equipo" — `app/(authed)/pm-report/pm-report-client.tsx:98-101`, `lib/i18n/en.json:2084-2087`
- Grades: `pm.attitude.great` → "Great" → "Excelente"; `pm.attitude.good` → "Good" → "Bien"; `pm.attitude.needs_work` → "Needs work" → "Necesita mejorar". Default is Good — `lib/i18n/en.json:2088-2090`, `app/(authed)/pm-report/pm-report-client.tsx:98-101`
- Also `pm.eval.area_to_improve` → "Area to improve" → "Área a mejorar", and a private note: `pm.eval.note_private_hint` → "Only managers see this note" → "Solo los gerentes ven esta nota" — `lib/i18n/en.json:2091`, `lib/i18n/en.json:2095`
- MVP: `pm.mvp.heading` → "MVP" → "MVP" — `lib/i18n/en.json:2080`, `lib/pm-report.ts:373-386`
- Button `pm.submit` → "Submit PM Report" → "Enviar Reporte PM" — `lib/i18n/en.json:2101`
- On submit, each graded employee gets an in-app notice: `notif.shift_feedback.title` → "New shift feedback" → "Nuevo comentario de turno" — `lib/pm-report.ts:415-450`, `lib/i18n/en.json:2802`

## Night — cash deposit

- Tap path: Dashboard → Reports → **Cash Deposit** tile (if assigned) → `cash.cta.start` → "Start cash deposit" → "Iniciar depósito", or the closing banner button `closing.cash_required.cta` → "Do the cash deposit". Route `/cash?location=…` — `lib/i18n/en.json:2130`, `lib/i18n/en.json:2133`, `lib/i18n/en.json:2320`
- Lowest role to open and sign it: Key Holder (4) — `lib/cash-shared.ts:11`, `app/(authed)/cash/page.tsx:67`, `lib/cash.ts:116-118`
- Fields: `cash.field.projected` → "Projected (from Toast)"; `cash.field.drawer_total` → "Drawer total"; `cash.field.cash_tips` → "Cash tips"; `cash.section.on_shift` → "On shift today"; `cash.field.over_short_note` → "Over/short note (optional)" — `lib/i18n/en.json:2139-2143`
- Count by `cash.count.toggle_hand` → "Enter total" or `cash.count.toggle_denomination` → "Count by denomination" — `lib/i18n/en.json:2144-2145`
- $200 float stays in the register (`cash.hint.float` → "$200 stays in the register" → "$200 se quedan en la caja"). Deposit = drawer − float; over/short = deposit − projected — `lib/cash-shared.ts:12-13`, `lib/cash-shared.ts:25-34`, `lib/i18n/en.json:2147`
- Sign with your PIN: `cash.submit.button` → "Sign & submit deposit" → "Firmar y enviar depósito" — `lib/i18n/en.json:2154`, `app/(authed)/cash/cash-client.tsx:52`, `app/(authed)/cash/cash-client.tsx:93`
- It can be redone (the new one replaces the old) until the closing is finalized. After that: `cash.error.closing_finalized` → "Today's closing is finalized — the deposit is locked." — `lib/cash.ts:119-130`, `lib/cash.ts:143-150`, `lib/i18n/en.json:2157`
- Filing it ticks the closing's cash line. Closing cannot be finalized without it — `lib/checklists.ts:1322-1344`

## Night — closing confirm and walk-out

- Finish button on the checklist: `closing.review.button_complete` → "Review & submit" → "Revisar y enviar"; if required lines are open, `closing.review.button_incomplete` → "Review & submit (incomplete)" — `lib/i18n/en.json:2311-2312`
- Unfinished required lines need a written reason: `closing.review.heading_incomplete` → "Some required items aren't done — explain why"; placeholder `closing.review.reason_placeholder` → "Why couldn't this be completed?" → "¿Por qué no se completó?" — `lib/i18n/en.json:2315-2316`
- Lowest role to finalize: Key Holder (4) ("Locking up requires a key holder") — `lib/checklist-constants.ts:41-42`, `lib/admin/template-builder-shared.ts:158`, `lib/checklists.ts:1316-1319`
- The confirmer must also be at or above the highest role level among the lines that were ticked — `lib/checklists.ts:1375-1383`
- Walk-out: every line in the "Walk-Out Verification" section must be done before finalizing — `lib/checklist-constants.ts:15`, `lib/checklist-constants.ts:43-45`, `app/(authed)/operations/closing/closing-client.tsx:343`
- The cash deposit must be filed: `closing.cash_required.banner` → "Cash deposit required before you can finalize the closing." — `lib/checklists.ts:1331-1344`, `lib/i18n/en.json:2319`
- Lines marked "hard gate" block finalizing with no reason option — `lib/checklists.ts:1346-1373`
- Confirm with your PIN: `auth.pin_modal.title` → "Confirm with your PIN" → "Confirma con tu PIN" — `app/api/checklist/confirm/route.ts:1-24`, `lib/i18n/en.json:2330`
- After confirm: banner `closing.banner.confirmed` → "Closing confirmed{time} by {who}" → "Cierre confirmado{time} por {who}". The list is read-only — `lib/i18n/en.json:2305`, `app/(authed)/operations/closing/page.tsx:20-31`
- On confirm the app pulls the day's Toast sales, runs the digest step (sends nothing while digests are off), and releases held stations and tasks (only with WHOS_HERE on) — `app/api/checklist/confirm/route.ts:102-117`, `lib/report-digests-engine.ts:540`
- A day not confirmed shows the next day: `closing.banner.yesterday_unconfirmed` → "Yesterday's closing wasn't finalized. Contact a manager to resolve." — `lib/i18n/en.json:2308`

## Night — handoff notes

- Where: Mid-Shift Pulse → **Handoff** section (Pulse v2) — `lib/pulse/scope-shared.ts:30`, `lib/i18n/en.json:5677`
- Reading: everyone at level 2 and up. Crew (below 4) get only notes marked for crew or for everyone, without author names — `lib/pulse/handoff.ts:3-6`, `lib/pulse/handoff.ts:39-42`, `lib/pulse/handoff.ts:97-101`
- Writing, and the "Got it" acknowledgement: level 6 (AGM, Catering Manager, Prep Manager, Social Media Manager) and up — `lib/pulse/scope-shared.ts:42-43`, `lib/pulse/handoff.ts:124`, `lib/pulse/handoff.ts:147`
- Labels: `pulse.handoff.write` → "Write a handoff note" → "Escribir una nota de entrega"; audience `pulse.handoff.audience.crew` → "For crew" → "Para el equipo", `.managers` → "For managers" → "Para gerentes", `.all` → "For everyone" → "Para todos"; `pulse.handoff.send` → "Post note" → "Publicar nota"; `pulse.handoff.ack` → "Got it" → "Recibido" — `lib/i18n/en.json:5828-5838`
- A note must be 1–1000 characters. Only the author or someone of higher level can retract it — `lib/pulse/handoff.ts:126`, `lib/pulse/handoff.ts:175-190`
- The table exists in production (migration 0240 applied 2026-10-09) — `supabase/migrations/0240_pulse_v2.sql:2`

## Manager tools — counts, ordering, production

- Counts — route `/operations/counts?location=…`, title `counts.page.title` → "Inventory Audit" → "Auditoría de inventario" — `lib/i18n/en.json:3417`
- Counts: Key Holder (4) with task access can record a count. Levels 4–5 re-enter their PIN; AGM and up use a password check — `lib/counts.ts:97`, `app/(authed)/operations/counts/page.tsx:16-24`
- Counts: on-hand reading (and the Reports Hub "Counts" link) needs AGM (6) — `lib/counts.ts:96`, `app/(authed)/reports/page.tsx:92`
- Ordering walk — route `/ordering?location=…`, title `ordering.page.title_bare` → "Ordering walk" → "Recorrido de pedido". Key Holder (4) and up, with task access — `app/ordering/page.tsx:49`, `app/ordering/page.tsx:95`, `lib/ordering.ts:110`, `lib/i18n/en.json:3545`
- Ordering is not in the Explore menu. Open it from the dashboard Ordering tile, the board task, or Reports Hub → Inventory → **Ordering** — `tests/nav-links.test.ts:19-21`, `app/(authed)/reports/page.tsx:92`
- A confirmed purchase order can be emailed to the vendor from the app with a Send tap (two-tap), or sent by hand. The email leg can be dormant per shop — `lib/po-email.ts:1-21`
- Production — route `/operations/production?location=…`, title `production.page.title` → "Production" → "Producción". Key Holder (4) and up; the yield statistics part needs Shift Lead (5) — `app/(authed)/operations/production/page.tsx:17`, `app/(authed)/operations/production/page.tsx:27`, `lib/yield-stats-shared.ts:44`, `lib/i18n/en.json:3880`

## Manager tools — Reports Hub, sales, trends

- Reports Hub — Explore → **Reports Hub**, route `/reports`, title `reports.page.title` → "Reports" → "Reportes". Trainee (2) and up — `app/(authed)/reports/page.tsx:23`, `lib/i18n/en.json:2804`
- Below level 4 the hub shows only your own work: `reports.hub.own_scope` → "Only your recorded work and feedback about you are included. …" — `app/(authed)/reports/page.tsx:68`, `lib/reports-hub.ts:148-158`, `lib/i18n/en.json:158`
- Hub families: Operations (all), Operations trends (4+), Written reports (all), People → My feedback (all) and Team trends (6+), Sales (7+), Inventory (6+ or task access), Catering (5+), Menu costing (6+) — `app/(authed)/reports/page.tsx:87-94`
- Cash reports in the hub: level 4 and up. Notes on checklist lines: level 5 and up — `lib/reports-hub.ts:175`, `lib/reports-hub.ts:721`, `lib/reports-hub.ts:940`, `lib/reports-hub.ts:973`
- A checklist that closed itself shows `reports.hub.auto_closed` → "Auto-closed — not confirmed" → "Cerrado automáticamente — sin confirmar" — `lib/i18n/en.json:152`
- Sales — route `/reports/sales`, GM (7) and up. All shops at once needs level 8 — `app/(authed)/reports/sales/page.tsx:4`, `app/(authed)/reports/sales/page.tsx:38-42`, `lib/sales-reports-shared.ts:21`
- Sales sub-pages: `reports.sales.checks.title` → "Sales checks" → "Cuentas de ventas"; `reports.sales.catering.title` → "Catering sales" → "Ventas de catering" — `lib/i18n/en.json:280`, `lib/i18n/en.json:315`
- Trends — Explore → **Trends**, route `/reports/trends`, Key Holder (4) and up. The Team view needs AGM (6) — `app/(authed)/reports/trends/page.tsx:37`, `app/(authed)/reports/trends/page.tsx:53`, `lib/team-metrics.ts:15`
- Reports export files download (CSV/PDF). Scheduled email delivery is not active — `docs/ROADMAP.md:370`, `docs/guides/launch-manager.en.md:71`

## Manager tools — customers, catering accounts, marketing download

- Customers — Admin → **Customers** (`customers.title` → "Customers" → "Clientes"), route `/admin/customers`. GM (7) and up, for their own shops; level 8 sees every shop — `lib/admin/sections.ts:37`, `lib/customers/access-shared.ts:4-15`, `app/admin/customers/page.tsx:19`, `lib/i18n/en.json:5843`
- Raw email/phone is shown only to level 9+ (Owner, Chief Growth Strategist) — `lib/customers/access-shared.ts:4-11`
- The whole Customers area is behind the CUSTOMER_PROFILES switch. While it is off the page says `customers.disabled` → "Customer profiles are not turned on yet." — `lib/customers/customers.ts:38-40`, `app/admin/customers/page.tsx:22-25`, `lib/i18n/en.json:5844`
- Catering accounts — route `/admin/customers/catering`, GM (7) and up — `app/admin/customers/catering/page.tsx:11`
- Marketing download button: `customers.export.segment` → "Download opted-in list for this view" → "Descargar la lista de esta vista con consentimiento"; hint `customers.export.segmentHint` → "Only people who opted in to email are included." — `app/admin/customers/page.tsx:66`, `components/admin/customers/MarketingListButton.tsx:23-24`, `lib/i18n/en.json:5934-5935`
- Marketing download role gate: level 9+ only (the button and the server both check), plus a password step-up — `app/admin/customers/page.tsx:66`, `lib/customers/customers.ts:601-602`, `app/api/admin/customers/export/route.ts:8-18`
- Only opted-in people are included. There is no override — `lib/customers/exports-core.ts:4-6`, `lib/customers/exports-core.ts:30-32`
- If nobody has opted in, the button reads `customers.export.noneOptedIn` → "No one has opted in yet: the list fills after the Toast marketing list is imported (Consent page)" — `lib/i18n/en.json:5936`

## Manager tools — basic admin pages

- Admin opens at level 6 — `app/admin/layout.tsx:28`, `app/admin/layout.tsx:34`
- Admin sections and floors: Vendors, SKUs, Products, Recipes, Items, Menu costing, Weights & Trim, Catering 6; Stations, Toast employees, Customers, Checklist Templates, Report recipients 7; User Management, Categories 8 — `lib/admin/sections.ts:33-68`
- Labels: `admin.section.users` → "User Management" → "Gestión de Usuarios"; `admin.section.checklist-templates` → "Checklist Templates" → "Plantillas de Listas"; `admin.section.vendors` → "Vendors" → "Proveedores"; `admin.section.skus` → "SKUs"; `admin.section.items` → "Items" → "Artículos"; `admin.section.weights` → "Weights & Trim" → "Pesos y merma" — `lib/i18n/en.json:546-550`, `lib/i18n/en.json:4744`
- Par Levels (7), Locations (9) and Audit (9) are "coming soon" tiles — `lib/admin/sections.ts:69-71`

## Catering — hub

- Tap path: Dashboard → Explore → **Catering**, route `/catering`. Shift Lead (5) and up — `lib/nav-links.ts:25`, `app/(authed)/catering/page.tsx:16`, `app/(authed)/catering/page.tsx:31`
- Hub cards: `catering.insights.title` → "Catering Insights" → "Panel de Catering"; `catering.pipeline.title` → "Catering Pipeline" → "Flujo de catering"; `catering.quotes.title` → "Catering Quotes" → "Cotizaciones de Catering"; `catering.customers.title` → "Catering Customers" → "Clientes de catering"; `catering.companies.title` → "Catering Companies" → "Empresas de Catering" — `app/(authed)/catering/page.tsx:18-24`, `lib/i18n/en.json:552`, `lib/i18n/en.json:582`, `lib/i18n/en.json:4137`, `lib/i18n/en.json:4226`, `lib/i18n/en.json:4270`
- Level 6 and up also see `catering.hub.admin_link_title` → "Admin & setup" → "Administración y configuración" — `app/(authed)/catering/page.tsx:26`, `app/(authed)/catering/page.tsx:36-38`, `lib/i18n/en.json:4268`

## Catering — pipeline (leads, stages, notes)

- Route `/catering/pipeline`. View at Shift Lead (5); add, edit and move at level 6 (AGM / Catering Manager) — `lib/catering/pipeline.ts:38-39`, `app/(authed)/catering/pipeline/page.tsx:37-38`
- Stages in order: `catering.pipeline.stage.inquiry` → "Inquiry" → "Consulta"; `.quote_sent` → "Quote sent" → "Cotización enviada"; `.confirmed` → "Confirmed" → "Confirmado"; `.out` → "Out for delivery" → "En reparto"; `.completed` → "Completed" → "Completado"; `.lost` → "Lost" → "Perdido" — `lib/catering/pipeline-shared.ts:9`, `lib/i18n/en.json:593-598`
- Moves: forward always works (skips allowed). Backward only from Confirmed or Quote sent. Lost from any open stage. Completed and Lost are final — `lib/catering/pipeline-shared.ts:15-16`, `lib/catering/pipeline-shared.ts:38-48`, `lib/catering/pipeline-shared.ts:81`
- Stage effects on prep demand: Confirmed reserves; Out/Completed use it up; Lost/Inquiry/Quote sent release it — `lib/catering/pipeline-shared.ts:29`
- New leads start at Inquiry — `lib/catering/pipeline.ts:403-445`
- Buttons: `catering.pipeline.add_lead` → "Add lead" → "Agregar prospecto"; `catering.pipeline.move_to` → "Move to" → "Mover a"; search `catering.pipeline.search.placeholder` → "Search leads by name, company, or phone…" — `lib/i18n/en.json:584`, `lib/i18n/en.json:589`, `lib/i18n/en.json:4573`
- Lead notes, contact, date and headcount are edited in place on the lead — `lib/catering/pipeline.ts:6`
- Moving an order to the other shop: Catering Manager or level 8+ — `lib/catering/transfers-shared.ts:5-6`

## Catering — quotes

- Route `/catering/quotes`. View at Shift Lead (5); build, revise and send at level 6 — `lib/catering/quotes.ts:31-32`, `app/(authed)/catering/quotes/page.tsx:27-28`
- Buttons: `catering.quotes.new` → "New quote" → "Nueva cotización"; `catering.quotes.send` → "Send quote" → "Enviar cotización"; `catering.quotes.revise` → "Revise" → "Revisar"; `catering.quotes.mark_accepted` → "Mark accepted" → "Marcar aceptada"; `catering.quotes.mark_declined` → "Mark declined" → "Marcar rechazada" — `lib/i18n/en.json:4139`, `lib/i18n/en.json:4185-4188`
- Statuses: draft, sent, accepted, declined, expired — `lib/i18n/en.json:4141-4145`
- Payments: view at 5, mark paid at 6 — `lib/catering/payments.ts:29-30`

## Catering — ezCater orders

- ezCater orders show as leads in the Pipeline, with an `catering.ezcater.title` → "ezCater order" → "Pedido de ezCater" detail box — `components/catering/pipeline/PipelineClient.tsx:463`, `components/catering/pipeline/EzcaterDetail.tsx:11`, `lib/i18n/en.json:5445`
- Pipeline panel `catering.toast_pending.title` → "Not in Toast yet" → "Aún no registrado en Toast" lists ezCater orders not yet entered in Toast — `components/catering/pipeline/PipelineClient.tsx:99`, `components/catering/pipeline/NotInToast.tsx:28`, `lib/i18n/en.json:27`
- Admin → Catering → `admin.ezcaterReview.title` → "ezCater item review" → "Revisión de artículos de ezCater": Catering Manager or level 8+ — `app/admin/catering/ezcater-review/page.tsx:11`, `lib/catering/transfers-shared.ts:5-6`, `lib/i18n/en.json:57`

## Catering — customers, companies, insights, setup

- Catering Customers `/catering/customers`: view 5, edit 6 — `lib/catering/customers.ts:19-20`, `app/(authed)/catering/customers/page.tsx:22-23`
- Catering Companies `/catering/companies`: view 5, edit 6 — `lib/catering/companies.ts:22-23`, `app/(authed)/catering/companies/page.tsx:19-20`
- Catering Insights `/catering/insights`: Shift Lead (5) and up — `lib/catering/insights.ts:28`, `app/(authed)/catering/insights/page.tsx:23`
- Setup (Admin → Catering, `/admin/catering`, level 6): Packages, FAQ, Prep demand, LTO 6; Menu, Capacity, Zones, Fulfillment 7; Pricing and Rate rules 8 — `app/admin/catering/page.tsx:24-38`, `app/admin/catering/page.tsx:43-45`

## Your stuff — profile, language, notes, my feedback

- Profile — Explore → **Profile**, route `/profile`, everyone. Title `profile.directory_title` → "Team Profiles" → "Perfiles del Equipo" — `lib/nav-links.ts:29`, `app/(authed)/profile/page.tsx:22`, `lib/i18n/en.json:3120`
- Language — Explore → **Settings** (`settings.page.title` → "Settings" → "Configuración"), card `settings.language.title` → "Language" → "Idioma". Also in the user menu (top right) under "Language" — `app/(authed)/settings/page.tsx:34`, `components/settings/LanguageSettingCard.tsx`, `components/UserMenu.tsx:178-195`, `lib/i18n/en.json:527`, `lib/i18n/en.json:529`
- Settings also links to Profile: `settings.profile.link` → "Go to Profile" → "Ir a Perfil" — `app/(authed)/settings/page.tsx:50-55`, `lib/i18n/en.json:534`
- Notes (Written Reports) — Explore → **Written Reports**, route `/reports/written` (the old `/written-reports` redirects there). Read from level 2, write from level 3 — `lib/nav-links.ts:24`, `app/(authed)/written-reports/page.tsx:22`, `app/(authed)/reports/written/page.tsx:27`, `lib/written-reports-shared.ts:53`
- Written report labels: `written_reports.page.title` → "Written Reports" → "Reportes escritos"; `written_reports.new` → "New report" → "Nuevo reporte"; `written_reports.submit_new` → "Post report" → "Publicar reporte" — `lib/i18n/en.json:490-493`
- My feedback — Explore → **My Performance**, route `/my-feedback`, everyone. Page title `me.title` → "My Performance" → "Mi Desempeño" — `lib/nav-links.ts:31`, `app/(authed)/my-feedback/page.tsx:71`, `lib/i18n/en.json:1961`
- Grades from a submitted PM report feed My Performance (with MVP flag) — `lib/pm-report.ts:199-230`

---

## DO NOT DOCUMENT

- Password vault: every page and route refuses until `VAULT_ENABLED=1`. The nav chip is hidden while it is off — `lib/vault-flag.ts:1-8`, `lib/nav-links.ts:49-51`, `docs/runbooks/vault-master-key.md:16`
- Emailed digests: the delivery switch defaults to "off" ("The mode is OFF until CC/Juan turn it on"); while it is off nothing is sent — `lib/report-digests-shared.ts:47-50`, `lib/report-digests-engine.ts:540`
- Scheduled report/accountant package emails ride the same off/preview/live switch — `lib/report-package.ts:1-6`
- Email delivery stays off until after launch — `docs/ROADMAP.md:370`, `docs/guides/launch-manager.en.md:71`
- Report recipients setup exists (Admin, level 7), but nothing is emailed while the switch is off. Do not tell people they will receive emails — `lib/admin/sections.ts:68`, `lib/report-digests-engine.ts:540`
- Customer profiles, Customers and Catering accounts: behind `CUSTOMER_PROFILES=1` (off unless set). Production state cannot be confirmed from code — `lib/customers/customers.ts:10`, `lib/customers/customers.ts:38-40`
- Meta audience file: refused while `META_AUDIENCE_EXPORT` is off ("Pete's OK pending") — `lib/customers/exports-core.ts:10-11`, `lib/customers/exports-core.ts:54-56`, `app/api/admin/customers/export/route.ts:8-11`
- Toast marketing-list sync: not implemented even with `TOAST_MARKETING_SYNC=1` — `lib/customers/consent-sources.ts:10`, `lib/customers/consent-sources.ts:27`
- Who's here / End my shift / presence lines: behind `WHOS_HERE=1` (off unless set). The launch guides already describe End my shift. Confirm it is on before documenting — `lib/whos-here.ts:8`, `lib/whos-here.ts:15-17`
- Mid-Shift Pulse v2: behind `PULSE_V2=1`. The caller reports it is on; code cannot prove it — `lib/pulse/flag.ts:1-7`
- Toast labor pull / station-lifecycle reconcile from Toast clock-outs: `TOAST_LABOR_PULL=1`, `STATION_LIFECYCLE=1` (off unless set) — `lib/toast/labor.ts:28-35`
- Toast order capture: `TOAST_ORDER_CAPTURE=1` (off unless set). ezCater stock depletion: `EZCATER_DEPLETION_ENABLED=1` (off unless set) — `lib/toast/capture.ts:16`, `lib/toast-sales-pull-run.ts:21`
- Placeholder pages ("coming soon" cards): `/recipes`, `/announcements`, `/tips`, `/ai`, `/rollups`, `/deep-cleaning`, `/feedback`, `/comms` — `app/recipes/page.tsx:1`, `app/announcements/page.tsx:1`, `app/tips/page.tsx:1`, `app/ai/page.tsx:1`, `app/rollups/page.tsx:1`, `app/deep-cleaning/page.tsx:1`, `app/feedback/page.tsx:1`, `app/comms/page.tsx:1`
- More placeholders: `/operations/prep`, `/operations/overlay`, `/operations/synthesis` — `app/(authed)/operations/prep/page.tsx:1`, `app/(authed)/operations/overlay/page.tsx:1`, `app/(authed)/operations/synthesis/page.tsx:1`
- None of the placeholders appear in the menu — `tests/nav-links.test.ts:19-21`
- Admin "coming soon" tiles: Par Levels, Locations, Audit — `lib/admin/sections.ts:69-71`
- **Correction to the brief:** `/ordering` is NOT a placeholder. It is the live Ordering walk, only left out of the menu — `app/ordering/page.tsx:1-22`, `tests/nav-links.test.ts:19`
- Dead text: the opening's "Hand to a key holder" button and the mid-day "key-holder task" message describe rules the code no longer has (see Opening and Mid-day sections) — `app/(authed)/operations/opening/opening-client.tsx:2098`, `lib/i18n/en.json:2123`

---

## Current guides vs code

- Manager guide puts **AM prep** in the morning, after the opening ("Morning: … Then the prep half … then **AM prep**"). The code treats AM prep as the closing count that the next opener reads, due once closing is done — `docs/guides/manager-guide.md:17` vs `lib/opening.ts:659-668`, `lib/midshift-shared.ts:281-282`
- Manager guide says Submit Opening is key holder and up, and that employees see **Hand to a key holder**. In code, an employee assigned the opening can submit it, and an unassigned employee cannot even open the page — `docs/guides/manager-guide.md:17`, `docs/guides/manager-guide.md:158` vs `app/(authed)/operations/opening/page.tsx:159-160`, `app/(authed)/operations/opening/opening-client.tsx:1171`, `lib/opening-draft-shared.ts:70-74`
- Staff guide says staff fill in the whole opening and a key holder submits. In code, staff without today's opening assignment are redirected away — `docs/guides/staff-guide.md:15`, `docs/guides/staff-guide.md:149` vs `app/(authed)/operations/opening/page.tsx:159-160`
- Staff and manager guides say nothing on the opening saves until Submit Opening. In code, Phase 1 autosaves as a shared draft — `docs/guides/staff-guide.md:155`, `docs/guides/staff-guide.md:529`, `docs/guides/manager-guide.md:144` vs `app/(authed)/operations/opening/page.tsx:250-259`, `app/api/opening/phase1/draft/route.ts:3-8`
- Staff guide says Phase 2 "is not your beat". In code, once Phase 1 is submitted, the prep tab is open to anyone with opening access — `docs/guides/staff-guide.md:153` vs `app/(authed)/operations/opening/opening-client.tsx:1146-1152`
- Guides say mid-day prep "stays a key-holder job". In code, an employee assigned mid-day prep can open and finish it — `docs/guides/staff-guide.md:17`, `docs/guides/manager-guide.md:342`, `docs/guides/manager-guide.md:354` vs `lib/assignments-shared.ts:37`, `app/api/prep/mid-day/route.ts:84-86`, `lib/prep.ts:1176`
- Staff guide says the dashboard "Reports" section holds the Opening Report card. In code, task tiles show only to the person assigned that task — `docs/guides/staff-guide.md:112` vs `app/(authed)/dashboard/page.tsx:386`, `app/(authed)/dashboard/page.tsx:684`, `lib/assignment-sections.ts:19-22`
- Manager guide lists Cash Deposit, PM Report and Mid-day Prep tiles as "key holder and up" and Inventory Audit as "AGM and up". In code, every task tile is assignment-based, and counts are recorded from KH (4) with task access — `docs/guides/manager-guide.md:111` vs `lib/assignment-sections.ts:19-22`, `lib/counts.ts:96-97`
- Manager guide says "Inventory audits … start at AGM" and the pulse audit tile is AGM+. In code, recording a count starts at KH (4); only on-hand reading is AGM (6) — `docs/guides/manager-guide.md:28`, `docs/guides/manager-guide.md:762` vs `lib/counts.ts:96-97`, `app/(authed)/operations/counts/page.tsx:16-24`
- Staff guide describes **Trends** charts on the dashboard and lists Trends for employees. In code, the Trends chip and page start at level 4, and the dashboard has no trends block — `docs/guides/staff-guide.md:113-117`, `docs/guides/staff-guide.md:128` vs `lib/nav-links.ts:22`, `app/(authed)/reports/trends/page.tsx:37`, `app/(authed)/dashboard/page.tsx:545-777`
- Staff guide says the Explore list shows Catering (which bounces employees) and lists placeholder pages "They open". In code, Catering shows only at level 5 and no placeholder is in the menu — `docs/guides/staff-guide.md:132-134`, `docs/guides/staff-guide.md:494` vs `lib/nav-links.ts:25`, `tests/nav-links.test.ts:19-21`
- Staff guide says **Feedback** in the Explore list is customer feedback. It is not in the menu at all — `docs/guides/staff-guide.md:411` vs `tests/nav-links.test.ts:21`
- Manager guide says Explore adds **Ordering** and calls **LTO** a placeholder. Ordering is not in the menu. LTO is a real page (level 6 chip) — `docs/guides/manager-guide.md:112` vs `lib/nav-links.ts:19-32`, `tests/nav-links.test.ts:21`, `app/(authed)/lto/page.tsx:22-31`
- Manager guide says Mid-Shift Pulse is read-only and key holder and up. With Pulse v2 it opens at level 2 and has write actions (handoff notes at 6, floor layout at 7) — `docs/guides/manager-guide.md:746` vs `lib/pulse/scope-shared.ts:38-47`, `lib/nav-links.ts:46`
- Manager guide says Admin sections other than Checklist Templates/Par Levels open at AGM. In code, Stations, Toast employees, Customers and Report recipients need GM (7) and Categories needs 8 — `docs/guides/manager-guide.md:980` vs `lib/admin/sections.ts:33-38`, `lib/admin/sections.ts:59`, `lib/admin/sections.ts:68`
- Staff guide's maintenance section says "Any employee can open it". True for Employee (3), but Trainees (2) are refused — `docs/guides/staff-guide.md:324` vs `lib/maintenance.ts:18`
- The closing's AM-prep advisory text tells the closer to "check with the opener", which conflicts with AM prep being the closing count. The staff guide repeats it — `lib/i18n/en.json:2321`, `docs/guides/staff-guide.md:260` vs `lib/opening.ts:659-668`

## Production switches (read from the Vercel production env list, values not decrypted, 2026-10-13)

- ON in production: `PULSE_V2=1`, `WHOS_HERE=1` (Toast employee links, manager presence, **End my shift**, shop-closed release), `CUSTOMER_PROFILES=1` (Customers), `TOAST_LABOR_PULL=1`, `TOAST_ORDER_CAPTURE=1`, `EZCATER_DEPLETION_ENABLED=1`, `DEPLETION_SOURCE=capture` — Vercel project env list (CC, 2026-10-13)
- NOT set in production (so OFF): `STATION_LIFECYCLE` — do not document the Toast clock-out station reconcile — `lib/toast/labor.ts:34`; Vercel env list has no such key
- The sim for guides v2 runs with the three on-screen switches that production has on: `PULSE_V2=1 WHOS_HERE=1 CUSTOMER_PROFILES=1 node scripts/sim/dev-sim.mjs` (the sim passes parent env through — `lib/sim-isolation-shared.ts:134-140`)
