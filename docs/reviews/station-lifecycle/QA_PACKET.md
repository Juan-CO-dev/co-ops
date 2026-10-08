# QA REVIEW - station lifecycle

Uncommitted branch feat/station-lifecycle, tested base HEAD 9e1b519e610f8344c9e4ebf64c56528906e217cd. origin/main advanced to 3e2b37eb (#418 / 0229) during the build; CC must integrate it. Please check correctness and completeness. CC pre-approved implementation and owns cross-family review and sim execution. See HANDOFF.md for contracts, verification, rollout dependencies and file anchors. Report P1/P2/P3 with file:line and a concrete failure scenario, or no findings. Inspect serialization/day boundaries, authority, location binding, SQL NULL checks, grants, no restoration, stale history, BC-040 refusals and whether tests fail on regressions.

Local tests: 357 files / 5,732 passed / one skipped; typecheck only six permitted Leaflet PNG TS2307 errors. SQL harness NOT executed. Explicit Toast user links required; current pull does not create them. No production or git writes.

## Tracked implementation diff

```diff
diff --git a/app/(authed)/stations/page.tsx b/app/(authed)/stations/page.tsx
index 4502baa0..94c90ef6 100644
--- a/app/(authed)/stations/page.tsx
+++ b/app/(authed)/stations/page.tsx
@@ -2,9 +2,13 @@ import Link from "next/link";
 import { requireSessionFromHeaders } from "@/lib/session";
 import { getServiceRoleClient } from "@/lib/supabase-server";
 import { accessibleLocations } from "@/lib/locations";
+import { StationsAdmin } from "@/components/assignments/StationsAdmin";
+import { StepUpProvider } from "@/components/admin/StepUpProvider";
+import { loadShiftBoard } from "@/lib/assignments";
+import { etCalendarDate } from "@/lib/operational-day";
 import { serverT } from "@/lib/i18n/server";
 
-/** Staff view of the GM-managed station positions. */
+/** Staff station view, including KH advisory timing without widening admin access. */
 export default async function StaffStationsPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
   const auth = await requireSessionFromHeaders("/stations");
   const service = getServiceRoleClient();
@@ -16,13 +20,10 @@ export default async function StaffStationsPage({ searchParams }: { searchParams
   const locations = locationsResult.data ?? [];
   const { loc } = await searchParams;
   const location = locations.find((row) => row.id === loc) ?? locations[0];
-  const stationsResult = location ? await service.from("stations").select("id,name,name_es,staffed")
-    .eq("location_id", location.id).eq("active", true).order("sort").order("name") : null;
-  if (stationsResult?.error) throw stationsResult.error;
-  const positionsResult = location ? await service.from("station_positions").select("id,station_id,name,name_es,duty,duty_es,sort")
-    .eq("location_id", location.id).eq("active", true).order("sort").order("name") : null;
-  if (positionsResult?.error) throw positionsResult.error;
-  const es = auth.user.language === "es";
+  const board = location ? await loadShiftBoard(service, {
+    actor: { userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations },
+    locationId: location.id, date: etCalendarDate(new Date().toISOString()),
+  }) : null;
   return <main className="space-y-4">
     <h1 className="text-2xl font-bold">{serverT(auth.user.language, "assignments.stations")}</h1>
     <nav aria-label={serverT(auth.user.language, "assignments.locations")} className="flex flex-wrap gap-2">
@@ -31,13 +32,9 @@ export default async function StaffStationsPage({ searchParams }: { searchParams
         className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 aria-[current=page]:border-co-text">{row.name}</Link>)}
     </nav>
     {!location && <p>{serverT(auth.user.language, "assignments.noLocation")}</p>}
-    {(stationsResult?.data ?? []).map((station) => <section key={station.id} className="co-card space-y-2 p-4">
-      <h2 className="font-bold">{es ? station.name_es || station.name : station.name}</h2>
-      <p className="text-sm text-co-text-muted">{serverT(auth.user.language, station.staffed ? "assignments.staffed" : "assignments.unstaffed")}</p>
-      {(positionsResult?.data ?? []).filter((p) => p.station_id === station.id).map((position) => <div key={position.id} className="border-t border-co-border pt-2">
-        <p className="font-bold">{es ? position.name_es || position.name : position.name}</p>
-        <p className="text-sm text-co-text-muted">{es ? position.duty_es || position.duty : position.duty}</p>
-      </div>)}
-    </section>)}
+    {board && <StepUpProvider unlocked={false} unlockedAt={null}>
+      <StationsAdmin key={board.locationId} locationId={board.locationId} stations={board.stations}
+        translatedNames={[]} canEdit={false} canEditTiming={auth.level >= 4} />
+    </StepUpProvider>}
   </main>;
 }
diff --git a/app/admin/stations/page.tsx b/app/admin/stations/page.tsx
index 2195cf34..45c9348b 100644
--- a/app/admin/stations/page.tsx
+++ b/app/admin/stations/page.tsx
@@ -39,6 +39,6 @@ export default async function StationsPage({ searchParams }: { searchParams: Pro
     <h1 className="text-2xl font-bold text-co-text">{serverT(language, "assignments.stations")}</h1>
     <p>{serverT(language, "assignments.stationsFromClosing")} <Link className="underline" href="/admin/checklist-templates/closing">{serverT(language, "assignments.editClosing")}</Link></p>
     <nav aria-label={serverT(language, "assignments.locations")} className="flex flex-wrap gap-2">{locations.map((location) => <Link key={location.id} href={`/admin/stations?loc=${location.id}`} aria-current={location.id === selected?.id ? "page" : undefined} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{location.name}</Link>)}</nav>
-    {board ? <StationsAdmin key={board.locationId} locationId={board.locationId} stations={board.stations} translatedNames={translatedNames} canEdit={auth.level >= 7} /> : <p>{serverT(language, "assignments.noLocation")}</p>}
+    {board ? <StationsAdmin key={board.locationId} locationId={board.locationId} stations={board.stations} translatedNames={translatedNames} canEdit={auth.level >= 7} canEditTiming={auth.level >= 4} /> : <p>{serverT(language, "assignments.noLocation")}</p>}
   </div>;
 }
diff --git a/app/api/admin/stations/route.ts b/app/api/admin/stations/route.ts
index b3da0d5a..0be39539 100644
--- a/app/api/admin/stations/route.ts
+++ b/app/api/admin/stations/route.ts
@@ -1,20 +1,37 @@
 import type { NextRequest } from "next/server";
 import { assertStepUp } from "@/lib/admin/step-up";
 import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
-import { AssignmentError, saveStationSpanish, saveStationConfig } from "@/lib/assignments";
+import { AssignmentError, saveStationSpanish, saveStationConfig, saveStationTiming } from "@/lib/assignments";
 import { requireSession } from "@/lib/session";
 import { getServiceRoleClient } from "@/lib/supabase-server";
 
 export async function POST(req: NextRequest) {
   const ctx = await requireSession(req, "/api/admin/stations");
   if (ctx instanceof Response) return ctx;
-  if (ctx.level < 7) return jsonError(403, "role_insufficient");
-  const stepUp = assertStepUp(ctx, "B");
-  if (!stepUp.ok) return jsonError(403, stepUp.code);
   const body = await parseJsonBody(req);
   if (body instanceof Response) return body;
   if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
   const b = body as Record<string, unknown>;
+  if (b.operation === "timing") {
+    if (ctx.level < 4) return jsonError(403, "role_insufficient");
+    if (typeof b.locationId !== "string" || typeof b.stationId !== "string" ||
+      (b.positionId !== undefined && typeof b.positionId !== "string") ||
+      Object.keys(b).some((key) => !["operation", "locationId", "stationId", "positionId", "usuallyClosesAt", "usuallyTrimsAt"].includes(key)))
+      return jsonError(400, "invalid_payload");
+    try {
+      return jsonOk(await saveStationTiming(getServiceRoleClient(), {
+        actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations },
+        locationId: b.locationId, stationId: b.stationId, positionId: b.positionId as string | undefined,
+        usuallyClosesAt: b.usuallyClosesAt as string | null | undefined, usuallyTrimsAt: b.usuallyTrimsAt as string | null | undefined,
+      }));
+    } catch (error) {
+      if (error instanceof AssignmentError) return jsonError(error.status, error.code);
+      return jsonError(500, "internal_error");
+    }
+  }
+  if (ctx.level < 7) return jsonError(403, "role_insufficient");
+  const stepUp = assertStepUp(ctx, "B");
+  if (!stepUp.ok) return jsonError(403, stepUp.code);
   if (b.operation === "staffed" || b.operation === "position_create" || b.operation === "position_update") {
     if (typeof b.locationId !== "string" || typeof b.stationId !== "string" ||
       (b.operation === "staffed" && typeof b.staffed !== "boolean") ||
diff --git a/app/api/assignments/route.ts b/app/api/assignments/route.ts
index 9278e273..50bc8fab 100644
--- a/app/api/assignments/route.ts
+++ b/app/api/assignments/route.ts
@@ -1,6 +1,6 @@
 import type { NextRequest } from "next/server";
 import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
-import { AssignmentError, assignTask, retractTask, writeStationEvent } from "@/lib/assignments";
+import { AssignmentError, assignTask, retractTask, writeStationEvent, writeStationBreak } from "@/lib/assignments";
 import { isTaskType, validOverrideReason, type OverrideReason } from "@/lib/assignments-shared";
 import { requireSession } from "@/lib/session";
 import { getServiceRoleClient } from "@/lib/supabase-server";
@@ -19,6 +19,10 @@ export async function POST(req: NextRequest) {
   const service = getServiceRoleClient();
   try {
     switch (b.action) {
+      case "break": {
+        if (typeof b.userId !== "string" || typeof b.onBreak !== "boolean") return jsonError(400, "invalid_payload");
+        return jsonOk(await writeStationBreak(service, { actor, locationId: b.locationId, userId: b.userId, onBreak: b.onBreak }));
+      }
       case "station": {
         if (typeof b.userId !== "string" || (b.stationId !== null && typeof b.stationId !== "string") ||
           (b.positionId !== null && typeof b.positionId !== "string") ||
diff --git a/app/api/cron/toast-sales-today/route.ts b/app/api/cron/toast-sales-today/route.ts
index 130af36a..24e0c319 100644
--- a/app/api/cron/toast-sales-today/route.ts
+++ b/app/api/cron/toast-sales-today/route.ts
@@ -7,6 +7,7 @@ import { audit } from "@/lib/audit";
 import { etCalendarDate } from "@/lib/operational-day";
 import { pullTodaySalesForAllLocations } from "@/lib/catering/toast-sales";
 import { captureIntraday } from "@/lib/toast/capture-intraday";
+import { laborPullEnabled, runToastLaborPull } from "@/lib/toast/labor";
 
 export const runtime = "nodejs";
 export const maxDuration = 120;
@@ -30,7 +31,15 @@ export async function GET(req: NextRequest) {
   try {
     const captureMode = process.env.DEPLETION_SOURCE === "capture";
     const legacy = captureMode ? [] : await pullTodaySalesForAllLocations(today);
-    const capture = await captureIntraday(today, req.signal, Math.max(0, maxDuration * 1000 - (Date.now() - startedAt) - 10_000));
+    const availableMs = Math.max(0, maxDuration * 1000 - (Date.now() - startedAt) - 10_000);
+    const laborReserveMs = laborPullEnabled() ? Math.min(30_000, availableMs) : 0;
+    const capture = await captureIntraday(today, req.signal, Math.max(0, availableMs - laborReserveMs));
+    // Labor is additive and fail-soft. It shares this route's wall-clock budget, and its own single
+    // deadline also covers 0230 reconciliation after the full today + corrections pull succeeds.
+    const laborBudgetMs = Math.min(30_000, Math.max(0, maxDuration * 1000 - (Date.now() - startedAt) - 10_000));
+    const labor = laborBudgetMs >= 1_000
+      ? await runToastLaborPull([today], { deadlineMs: laborBudgetMs, context: "cron", reconcileDate: today })
+      : { ran: false, results: [], modified: 0 };
     const results = captureMode ? capture.results : legacy;
     const n = (k: string) => legacy.filter((r) => r.result === k).length;
     const healthy = captureMode ? !capture.skipped && capture.failures === 0 : n("unknown") === 0 && n("error") === 0;
@@ -47,7 +56,7 @@ export async function GET(req: NextRequest) {
       ipAddress: null, userAgent: null,
     });
     await watchSiblings("toast-sales-today");
-    return jsonOk({ date: today, results, healthy, capture });
+    return jsonOk({ date: today, results, healthy, capture, labor });
   } catch (e) {
     void audit({
       actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
diff --git a/components/assignments/ShiftBoardClient.tsx b/components/assignments/ShiftBoardClient.tsx
index 2fa4490a..05fdba65 100644
--- a/components/assignments/ShiftBoardClient.tsx
+++ b/components/assignments/ShiftBoardClient.tsx
@@ -3,7 +3,7 @@
 import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
 import { useRouter } from "next/navigation";
 import { ActionButton, ActionLink } from "@/components/ActionButton";
-import { formatTime } from "@/lib/i18n/format";
+import { formatTime, formatClockTime } from "@/lib/i18n/format";
 import type { TranslationKey } from "@/lib/i18n/types";
 import { useTranslation } from "@/lib/i18n/provider";
 import { RetrainTaskList } from "@/components/production/RetrainTaskList";
@@ -48,6 +48,18 @@ export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }:
     reason: change.reasonCode ? t(`assignments.reason.${change.reasonCode}`) : change.reasonNote ?? "",
     time: formatTime(change.at, language),
   })}{change.reasonCode && change.reasonNote ? ` · ${change.reasonNote}` : ""}</p>;
+  const taskVacancyLine = (task: TaskType) => board.taskVacancies?.filter((entry) => entry.task === task).map((entry) =>
+    <p key={`${entry.userId}:${entry.at}`} className="text-sm text-co-text-muted">{t("assignments.lifecycle.leftOpen", { name: entry.name, time: formatTime(entry.at, language) })}</p>);
+  const positionVacancyLine = (positionId: string) => {
+    const vacancy = board.positionVacancies?.find((entry) => entry.positionId === positionId);
+    return vacancy ? <p className="text-sm text-co-text-muted">{t(vacancy.reason === "on_break" ? "assignments.lifecycle.openCover" : "assignments.lifecycle.leftOpen", { name: vacancy.name, time: formatTime(vacancy.at, language) })}</p> : null;
+  };
+  const stationStatus = (station: ShiftBoard["stations"][number]) => <>
+    {station.closedAt && <p className="font-bold text-co-text-muted">{t("assignments.lifecycle.closed", { time: formatTime(station.closedAt, language) })}</p>}
+    {station.usuallyClosesAt && <p className="text-sm text-co-text-muted">{t("assignments.lifecycle.usuallyCloses", { time: formatClockTime(station.usuallyClosesAt, language) })}</p>}
+  </>;
+  const trimHint = (position: ShiftBoard["stations"][number]["positions"][number]) => position.sort > 1 && position.usuallyTrimsAt
+    ? <p className="text-sm text-co-text-muted">{t("assignments.lifecycle.usuallyTrims", { time: formatClockTime(position.usuallyTrimsAt, language) })}</p> : null;
   const taskLine = (assignment: TaskAssignment) => <div key={assignment.id} className="text-sm text-co-text-muted">
     <p>{formatAssignmentAttribution({ source: assignment.source ?? "assigned", holderName: assignment.assigneeName ?? board.people.find((person) => person.id === assignment.assigneeId)?.name ?? t("assignments.assignedStaff"), actorName: assignment.assignerName, at: assignment.at ?? "" }, language, t)}</p>
     {changeLine(assignment.change)}
@@ -90,7 +102,7 @@ export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }:
   const unassigned = TASK_TYPES.filter((task) => !board.tasks.some((assignment) => assignment.task === task && assignment.available !== false));
   const people = compact ? board.people.filter((p) => p.id === board.viewerId) : board.people;
   const ownTasks = board.tasks.filter((task) => task.assigneeId === board.viewerId && task.available !== false);
-  const positions = board.stations.filter((station) => station.active && station.staffed).flatMap((station) => station.positions.filter((position) => position.active));
+  const positions = board.stations.filter((station) => station.active && station.staffed && !station.closedAt).flatMap((station) => station.positions.filter((position) => position.active));
   const filledStations = positions.filter((position) => board.people.some((person) => currentStation(board.events, person.id)?.positionId === position.id)).length;
   const sections = useCollapsibleSections(`assignments:${board.viewerId}:${board.locationId}:${compact ? "dashboard" : "page"}`, [
     { id: "tasks", done: compact ? ownTasks.length : TASK_TYPES.length - unassigned.length, total: TASK_TYPES.length },
@@ -136,14 +148,17 @@ export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }:
       const positions = station.positions.filter((p) => p.active);
       const filled = positions.filter((p) => board.people.some((person) => currentStation(board.events, person.id)?.positionId === p.id)).length;
       return <div key={station.id} className="rounded-xl border border-co-border p-3">
-        <h4 className="min-w-0 truncate font-bold" title={language === "es" ? station.nameEs || station.name : station.name}>{language === "es" ? station.nameEs || station.name : station.name} · {filled} {t("assignments.of")} {positions.length}</h4>
+        <h4 className="min-w-0 truncate font-bold" title={language === "es" ? station.nameEs || station.name : station.name}>{language === "es" ? station.nameEs || station.name : station.name}{!station.closedAt && <> · {filled} {t("assignments.of")} {positions.length}</>}</h4>
+        {stationStatus(station)}
         <ul className="mt-2 space-y-2">{positions.map((position) => {
           const occupant = board.people.find((person) => currentStation(board.events, person.id)?.positionId === position.id);
           return <li key={position.id} className="rounded-lg border border-co-border p-2">
-            <p className="truncate font-bold" title={language === "es" ? position.nameEs || position.name : position.name}>{language === "es" ? position.nameEs || position.name : position.name} · {occupant?.name ?? t("assignments.unassigned")}</p>
+            <p className="truncate font-bold" title={language === "es" ? position.nameEs || position.name : position.name}>{language === "es" ? position.nameEs || position.name : position.name} · {station.closedAt ? t("assignments.lifecycle.positionClosed") : occupant?.name ?? t("assignments.unassigned")}</p>
             {(language === "es" ? position.dutyEs || position.duty : position.duty) && <p className="text-sm text-co-text-muted">{language === "es" ? position.dutyEs || position.duty : position.duty}</p>}
-            {stationLine(occupant ? currentStation(board.events, occupant.id) : null, occupant?.name ?? t("assignments.assignedStaff"))}
-            {board.viewerLevel >= 4 && <form className="mt-2 flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
+            {trimHint(position)}
+            {!occupant && !station.closedAt && positionVacancyLine(position.id)}
+            {!station.closedAt && stationLine(occupant ? currentStation(board.events, occupant.id) : null, occupant?.name ?? t("assignments.assignedStaff"))}
+            {board.viewerLevel >= 4 && !station.closedAt && <form className="mt-2 flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
               event.preventDefault();
               const userId = String(new FormData(event.currentTarget).get("userId") || "");
               if (userId) requestMutation({ action: "station", userId, stationId: station.id, positionId: position.id, manage: true }, stationOverrideLevel(userId));
@@ -151,7 +166,7 @@ export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }:
               <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold text-co-text-dim">{t("assignments.person")}
                 <select name="userId" className={control} disabled={disabled} defaultValue="">
                   <option value="" disabled>{t("assignments.person")}</option>
-                  {board.people.filter((person) => person.available !== false && person.level <= board.viewerLevel && (person.id !== board.viewerId || canSelfClaim(currentStation(board.events, person.id))))
+                  {board.people.filter((person) => person.available !== false && !person.onBreak && person.level <= board.viewerLevel && (person.id !== board.viewerId || canSelfClaim(currentStation(board.events, person.id))))
                     .map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                 </select>
               </label>
@@ -174,7 +189,7 @@ export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }:
           const canOpen = board.viewerLevel >= TASK_MIN_LEVEL[task] && (board.viewerLevel >= 4 || assignments.some((assignment) => assignment.assigneeId === board.viewerId && assignment.source !== "taken"));
           return <li key={task} className="rounded-xl border border-co-border p-3">
             {canOpen ? <ActionLink variant="secondary" href={taskHref(task, board.locationId)}>{t(`assignments.task.${task}`)}</ActionLink> : <span>{t(`assignments.task.${task}`)}</span>}
-            <div className="mt-2">{assignments.length === 0 ? <p className="text-sm text-co-text-muted">{t("assignments.attribution.unassigned")}</p> : assignments.map(taskLine)}
+            <div className="mt-2">{assignments.length === 0 ? <><p className="text-sm text-co-text-muted">{t("assignments.attribution.unassigned")}</p>{taskVacancyLine(task)}</> : assignments.map(taskLine)}
               {board.taskChanges?.filter((entry) => entry.task === task).map((entry) => <div key={entry.change.at}>{changeLine(entry.change)}</div>)}
             </div>
             {!canOpen && assignments.length > 0 && <p className="text-sm text-co-text-muted">{t("assignments.assignedOther")}</p>}
@@ -194,15 +209,17 @@ export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }:
       const managerCanEdit = !compact && board.viewerLevel >= 4 && person.available !== false && person.level <= board.viewerLevel
         && (person.id !== board.viewerId || canSelfClaim(current));
       const canRetract = board.viewerLevel >= 4;
-      const canClaim = person.available !== false && compact && person.id === board.viewerId && canSelfClaim(current);
+      const canClaim = person.available !== false && !person.onBreak && compact && person.id === board.viewerId && canSelfClaim(current);
       return <article key={person.id} className="min-w-0 space-y-3 rounded-xl border border-co-border p-3">
         {!compact && <h4 className="truncate font-bold text-co-text" title={person.name}>{person.name}</h4>}
+        {person.onBreak && <><p className="font-bold text-co-text-muted">{t("assignments.lifecycle.onBreak")}</p><p className="text-sm text-co-text-muted">{t("assignments.lifecycle.breakHelp")}</p></>}
+        {person.available !== false && (person.id === board.viewerId || (!compact && board.viewerLevel >= 4 && person.level <= board.viewerLevel)) && <ActionButton variant="secondary" disabled={disabled} onClick={() => void mutate({ action: "break", userId: person.id, onBreak: !person.onBreak })}>{t(person.onBreak ? "assignments.lifecycle.backFromBreak" : "assignments.lifecycle.startBreak")}</ActionButton>}
         {person.available === false && <p className="text-sm text-co-text-muted">{t("assignments.unavailablePerson")}</p>}
         <p className="truncate font-bold text-co-text" title={station?.name}>{station ? `${language === "es" ? station.nameEs || station.name : station.name} · ${position ? (language === "es" ? position.nameEs || position.name : position.name) : ""}` : t("assignments.noStation")}</p>
         {position && <p className="text-sm text-co-text-muted">{language === "es" ? position.dutyEs || position.duty : position.duty}</p>}
         {current?.stationId ? byLine(current.source, current.actorName, current.at) : null}
         {changeLine(current?.change)}
-        {(managerCanEdit || canClaim) && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
+        {!person.onBreak && (managerCanEdit || canClaim) && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
           event.preventDefault();
           const data = new FormData(event.currentTarget);
           const positionId = String(data.get("positionId") || "");
@@ -212,11 +229,11 @@ export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }:
           <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.station")}
             <select key={current?.id ?? "none"} name="positionId" defaultValue={current?.positionId ?? ""} disabled={disabled} className={control}>
               <option value="">{t("assignments.noStation")}</option>
-              {board.stations.filter((s) => (s.active && s.staffed) || s.id === current?.stationId).flatMap((s) =>
+              {board.stations.filter((s) => (s.active && s.staffed && !s.closedAt) || s.id === current?.stationId).flatMap((s) =>
                 s.positions.filter((p) => p.active || p.id === current?.positionId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map((p) => {
                   const holder = board.occupiedPositions?.find((entry) => entry.positionId === p.id);
                   const taken = !!holder && p.id !== current?.positionId;
-                  return <option key={p.id} value={p.id} disabled={!s.active || !s.staffed || !p.active || (board.viewerLevel < 4 && taken)}>
+                  return <option key={p.id} value={p.id} disabled={!s.active || !s.staffed || !!s.closedAt || !p.active || (board.viewerLevel < 4 && taken)}>
                     {language === "es" ? s.nameEs || s.name : s.name} · {language === "es" ? p.nameEs || p.name : p.name}
                     {p.sort === 1 ? ` · ${t("assignments.fillFirst")}` : ""}
                     {holder ? ` · ${t("assignments.takenBy", { name: holder.firstName })}` : ""}
@@ -250,17 +267,18 @@ export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }:
     {compact && section("team", "assignments.teamToday", board.people.filter((person) => person.hasWork).length, board.people.length, <div className="space-y-4">
       <ul className="space-y-3">{TASK_TYPES.map((task) => {
         const assignments = board.tasks.filter((assignment) => assignment.task === task && assignment.available !== false);
-        return <li key={task}><h4 className="font-bold">{t(`assignments.task.${task}`)}</h4>{assignments.length ? assignments.map(taskLine) : <p className="text-sm text-co-text-muted">{t("assignments.attribution.unassigned")}</p>}
+        return <li key={task}><h4 className="font-bold">{t(`assignments.task.${task}`)}</h4>{assignments.length ? assignments.map(taskLine) : <><p className="text-sm text-co-text-muted">{t("assignments.attribution.unassigned")}</p>{taskVacancyLine(task)}</>}
           {board.taskChanges?.filter((entry) => entry.task === task).map((entry) => <div key={entry.change.at}>{changeLine(entry.change)}</div>)}</li>;
       })}</ul>
       {board.stations.filter((station) => station.active && station.staffed).map((station) => <div key={station.id}>
         <h4 className="font-bold">{language === "es" ? station.nameEs || station.name : station.name}</h4>
+        {stationStatus(station)}
         <ul className="space-y-2">{station.positions.filter((position) => position.active).map((position) => {
           const occupant = board.people.find((person) => currentStation(board.events, person.id)?.positionId === position.id);
-          return <li key={position.id}><p>{language === "es" ? position.nameEs || position.name : position.name}</p>{stationLine(occupant ? currentStation(board.events, occupant.id) : null, occupant?.name ?? t("assignments.assignedStaff"))}</li>;
+          return <li key={position.id}><p>{language === "es" ? position.nameEs || position.name : position.name}</p>{trimHint(position)}{!occupant && !station.closedAt && positionVacancyLine(position.id)}{!station.closedAt && stationLine(occupant ? currentStation(board.events, occupant.id) : null, occupant?.name ?? t("assignments.assignedStaff"))}</li>;
         })}</ul>
       </div>)}
-      {board.people.map((person) => { const held = board.tasks.filter((task) => task.assigneeId === person.id && task.available !== false); return <div key={person.id}><h4 className="font-bold">{person.name}</h4>{personStationLine(currentStation(board.events, person.id))}{held.length ? held.map(personTaskLine) : <p className="text-sm text-co-text-muted">{t("assignments.noTasks")}</p>}</div>; })}
+      {board.people.map((person) => { const held = board.tasks.filter((task) => task.assigneeId === person.id && task.available !== false); return <div key={person.id}><h4 className="font-bold">{person.name}</h4>{person.onBreak && <p className="text-sm text-co-text-muted">{t("assignments.lifecycle.onBreak")}</p>}{personStationLine(currentStation(board.events, person.id))}{held.length ? held.map(personTaskLine) : <p className="text-sm text-co-text-muted">{t("assignments.noTasks")}</p>}</div>; })}
     </div>)}
     <dialog ref={reasonDialog} aria-label={t("assignments.confirmChange")} className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border-2 border-co-border bg-co-surface p-4 text-co-text backdrop:bg-black/50" onCancel={(event) => { event.preventDefault(); if (!busy) setPending(null); }}>
     {pending && <form className="space-y-3" onSubmit={(event) => {
diff --git a/components/assignments/StationsAdmin.tsx b/components/assignments/StationsAdmin.tsx
index d1660608..33f15dfe 100644
--- a/components/assignments/StationsAdmin.tsx
+++ b/components/assignments/StationsAdmin.tsx
@@ -1,15 +1,16 @@
 "use client";
-import { useState, useTransition } from "react";
+import { Fragment, useState, useTransition } from "react";
 import { useRouter } from "next/navigation";
+import { formatClockTime, formatTime } from "@/lib/i18n/format";
 import { useTranslation } from "@/lib/i18n/provider";
 import { useStepUp } from "@/components/admin/StepUpProvider";
 import type { Station } from "@/lib/assignments-shared";
 import type { TranslationKey } from "@/lib/i18n/types";
 
-export function StationsAdmin({ locationId, stations, translatedNames, canEdit }: {
-  locationId: string; stations: Station[]; translatedNames: string[]; canEdit: boolean;
+export function StationsAdmin({ locationId, stations, translatedNames, canEdit, canEditTiming = canEdit }: {
+  locationId: string; stations: Station[]; translatedNames: string[]; canEdit: boolean; canEditTiming?: boolean;
 }) {
-  const { t } = useTranslation();
+  const { t, language } = useTranslation();
   const { requestStepUp } = useStepUp();
   const router = useRouter();
   const [busy, setBusy] = useState(false);
@@ -18,7 +19,7 @@ export function StationsAdmin({ locationId, stations, translatedNames, canEdit }
   async function savePayload(payload: Record<string, unknown>) {
     setBusy(true); setError(null);
     try {
-      if (await requestStepUp("B") !== "ok") return;
+      if (payload.operation !== "timing" && await requestStepUp("B") !== "ok") return;
       const send = () => fetch("/api/admin/stations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId, ...payload }) });
       let response = await send();
       let body: { code?: string } = {};
@@ -36,19 +37,34 @@ export function StationsAdmin({ locationId, stations, translatedNames, canEdit }
       startTransition(() => router.refresh());
     } catch { setError("assignments.error"); } finally { setBusy(false); }
   }
+  const timingForm = (stationId: string, value: string | null | undefined, positionId?: string) => canEditTiming
+    ? <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
+      event.preventDefault();
+      const time = String(new FormData(event.currentTarget).get("time") ?? "") || null;
+      void savePayload({ operation: "timing", stationId, ...(positionId ? { positionId, usuallyTrimsAt: time } : { usuallyClosesAt: time }) });
+    }}>
+      <label className="grid min-w-0 max-w-full flex-1 gap-1 text-sm font-bold">{t(positionId ? "assignments.lifecycle.usuallyTrimsLabel" : "assignments.lifecycle.usuallyClosesLabel")}
+        <input name="time" type="time" defaultValue={value?.slice(0, 5) ?? ""} disabled={busy || refreshing} className="min-h-[44px] min-w-0 max-w-full rounded-lg border-2 border-co-border px-3 font-normal" />
+      </label>
+      <button type="submit" disabled={busy || refreshing} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold">{t("common.save")}</button>
+    </form>
+    : value ? <p className="text-sm text-co-text-muted">{t(positionId ? "assignments.lifecycle.usuallyTrims" : "assignments.lifecycle.usuallyCloses", { time: formatClockTime(value, language) })}</p> : null;
   const save = (id: string, nameEs: string) => savePayload({ id, nameEs });
   return <div className="space-y-3" aria-busy={busy || refreshing}>
     {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
     {stations.filter((station) => station.active).map((station) =>
       <div key={station.id} className="co-card space-y-2 p-4">
-        <h2 className="font-bold text-co-text">{station.name}</h2>
+        <h2 className="font-bold text-co-text">{language === "es" ? station.nameEs || station.name : station.name}</h2>
+        {station.closedAt && <p className="font-bold text-co-text-muted">{t("assignments.lifecycle.closed", { time: formatTime(station.closedAt, language) })}</p>}
+        {timingForm(station.id, station.usuallyClosesAt)}
+        {canEditTiming && <p className="text-sm text-co-text-muted">{t("assignments.lifecycle.timingHint")}</p>}
         {canEdit ? <label className="flex min-h-[44px] items-center gap-2 font-bold text-co-text">
           <input type="checkbox" checked={station.staffed} disabled={busy || refreshing}
             onChange={(e) => void savePayload({ operation: "staffed", stationId: station.id, staffed: e.target.checked })} />
           {t("assignments.staffed")}
         </label> : <p className="text-sm text-co-text-muted">{t(station.staffed ? "assignments.staffed" : "assignments.unstaffed")}</p>}
         <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t("assignments.positions")}</h3>
-        {station.positions.map((position) => canEdit ? <form key={position.id} className="grid gap-2 border-t border-co-border pt-3" onSubmit={(e) => {
+        {station.positions.map((position) => <Fragment key={position.id}>{canEdit ? <form className="grid gap-2 border-t border-co-border pt-3" onSubmit={(e) => {
           e.preventDefault(); const data = new FormData(e.currentTarget);
           void savePayload({ operation: "position_update", stationId: station.id, positionId: position.id,
             name: data.get("name"), nameEs: data.get("nameEs"), duty: data.get("duty"), dutyEs: data.get("dutyEs"),
@@ -66,11 +82,9 @@ export function StationsAdmin({ locationId, stations, translatedNames, canEdit }
             <button disabled={busy || refreshing} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold" type="submit">{t("common.save")}</button>
           </div>
         </form> : <div key={position.id} className="border-t border-co-border pt-3">
-          <p className="font-bold">{position.name}{!position.active ? ` · ${t("assignments.inactive")}` : ""}</p>
-          {position.nameEs && <p className="text-sm text-co-text-muted">{position.nameEs}</p>}
-          {position.duty && <p className="text-sm">{position.duty}</p>}
-          {position.dutyEs && <p className="text-sm text-co-text-muted">{position.dutyEs}</p>}
-        </div>)}
+          <p className="font-bold">{language === "es" ? position.nameEs || position.name : position.name}{!position.active ? ` · ${t("assignments.inactive")}` : ""}</p>
+          {(language === "es" ? position.dutyEs || position.duty : position.duty) && <p className="text-sm">{language === "es" ? position.dutyEs || position.duty : position.duty}</p>}
+        </div>}{position.sort > 1 && timingForm(station.id, position.usuallyTrimsAt, position.id)}</Fragment>)}
         {canEdit && <form className="grid gap-2 border-t border-co-border pt-3" onSubmit={(e) => {
           e.preventDefault(); const data = new FormData(e.currentTarget);
           void savePayload({ operation: "position_create", stationId: station.id,
@@ -86,7 +100,7 @@ export function StationsAdmin({ locationId, stations, translatedNames, canEdit }
             <button disabled={busy || refreshing} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold" type="submit">{t("assignments.addPosition")}</button>
           </div>
         </form>}
-        {translatedNames.includes(station.name)
+        {canEdit && (translatedNames.includes(station.name)
           ? <p className="text-sm text-co-text-muted">{station.nameEs}</p>
           : canEdit ? <form onSubmit={(event) => {
             event.preventDefault();
@@ -96,7 +110,7 @@ export function StationsAdmin({ locationId, stations, translatedNames, canEdit }
               <input className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-base font-normal text-co-text" name="nameEs" maxLength={100} defaultValue={station.nameEs ?? ""} />
             </label>
             <button disabled={busy || refreshing} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text" type="submit">{t("common.save")}</button>
-          </form> : <p className="text-sm text-co-text-muted">{station.nameEs}</p>}
+          </form> : <p className="text-sm text-co-text-muted">{station.nameEs}</p>)}
       </div>)}
   </div>;
 }
diff --git a/lib/assignment-sections.ts b/lib/assignment-sections.ts
index 9bd1ff3e..109f6d51 100644
--- a/lib/assignment-sections.ts
+++ b/lib/assignment-sections.ts
@@ -5,7 +5,7 @@ export function assignmentSectionDefaults(board: ShiftBoard, compact: boolean):
   const ownTaskCount = board.tasks.filter((task) => task.assigneeId === board.viewerId && task.available !== false).length;
   const hasStation = !!currentStation(board.events, board.viewerId)?.stationId;
   if (compact) return { tasks: !ownTaskCount && !hasStation, stations: !ownTaskCount && !hasStation, team: false };
-  const positions = board.stations.filter((station) => station.active && station.staffed).flatMap((station) => station.positions.filter((position) => position.active));
+  const positions = board.stations.filter((station) => station.active && station.staffed && !station.closedAt).flatMap((station) => station.positions.filter((position) => position.active));
   const assignedStations = positions.filter((position) => board.people.some((person) => currentStation(board.events, person.id)?.positionId === position.id)).length;
   const progress: SectionProgress[] = [
     { id: "stations", done: assignedStations, total: positions.length },
diff --git a/lib/assignment-taken.ts b/lib/assignment-taken.ts
index ffb91f39..52f09b86 100644
--- a/lib/assignment-taken.ts
+++ b/lib/assignment-taken.ts
@@ -10,7 +10,7 @@ import { selectAllRows } from "./supabase-paginate";
  * Assignments take precedence at the board integration layer.
  */
 export async function loadTakenTasks(service: SupabaseClient, args: {
-  locationId: string; date: string;
+  locationId: string; date: string; includeHistory?: boolean;
 }): Promise<TakenTask[]> {
   const { start, end } = takenDayRange(args.date);
   const [templates, instances, cash, pm, deliveries, counts, orders] = await Promise.all([
@@ -57,5 +57,7 @@ export async function loadTakenTasks(service: SupabaseClient, args: {
   for (const row of deliveries) add(row.id, "receiving", row.received_by, row.created_at);
   for (const row of counts) add(row.id, "counts", row.counted_by, row.counted_at);
   for (const row of orders) add(row.id, "ordering", row.created_by, row.created_at);
-  return dedupeTakenTasks(rows);
+  // Lifecycle callers filter departure boundaries BEFORE deduplication, so a
+  // later start after re-clock-in isn't hidden by this user's first report.
+  return args.includeHistory ? rows : dedupeTakenTasks(rows);
 }
diff --git a/lib/assignments-shared.ts b/lib/assignments-shared.ts
index f9d1f0e8..0b2d16c6 100644
--- a/lib/assignments-shared.ts
+++ b/lib/assignments-shared.ts
@@ -38,13 +38,15 @@ export const TASK_MIN_LEVEL: Record<TaskType, number> = {
 export function isTaskType(value: unknown): value is TaskType {
   return typeof value === "string" && TASK_TYPES.some((task) => task === value);
 }
-export interface StationPosition { id: string; stationId: string; name: string; nameEs: string | null; duty: string | null; dutyEs: string | null; sort: number; active: boolean }
-export interface Station { id: string; name: string; nameEs: string | null; sort: number; active: boolean; staffed: boolean; positions: StationPosition[] }
-export interface ShiftPerson { id: string; name: string; level: number; hasWork: boolean; available?: boolean }
+export interface StationPosition { id: string; stationId: string; name: string; nameEs: string | null; duty: string | null; dutyEs: string | null; sort: number; active: boolean; usuallyTrimsAt?: string | null }
+export interface Station { id: string; name: string; nameEs: string | null; sort: number; active: boolean; staffed: boolean; positions: StationPosition[]; closedAt?: string | null; usuallyClosesAt?: string | null }
+export interface ShiftPerson { id: string; name: string; level: number; hasWork: boolean; available?: boolean; onBreak?: boolean }
 export interface StationEvent {
   id: string; sequence: string; locationId: string; businessDate: string;
   userId: string; stationId: string | null; positionId?: string | null; kind: "assign" | "claim" | "move" | "release";
-  actorId: string; actorName: string | null; at: string; source: "assigned" | "claimed" | null;
+  actorId: string | null; actorName: string | null; at: string; source: "assigned" | "claimed" | null;
+  releaseReason?: "station_closed" | "clocked_out" | "on_break";
+  priorPositionId?: string | null; effectiveAt?: string | null;
   actorLevel?: number; change?: AssignmentChange;
 }
 export interface TaskAssignment {
@@ -60,6 +62,8 @@ export interface ShiftBoard {
   stations: Station[]; people: ShiftPerson[]; events: StationEvent[]; tasks: TaskAssignment[];
   occupiedPositions?: { positionId: string; firstName: string }[];
   taskChanges?: { task: TaskType; change: AssignmentChange }[];
+  positionVacancies?: { positionId: string; userId: string; name: string; reason: "clocked_out" | "on_break"; at: string }[];
+  taskVacancies?: { task: TaskType; userId: string; name: string; at: string }[];
 }
 export function taskHref(task: TaskType, locationId: string): string {
   const paths: Record<TaskType, string> = {
diff --git a/lib/assignments.ts b/lib/assignments.ts
index b49ab91a..d2b9bc17 100644
--- a/lib/assignments.ts
+++ b/lib/assignments.ts
@@ -3,6 +3,9 @@ import type { SupabaseClient } from "@supabase/supabase-js";
 import { audit } from "./audit";
 import { enqueueNotification } from "./notifications";
 import { loadTakenTasks } from "./assignment-taken";
+import { positionVacancies, takenSurvivesDeparture, validStationTime } from "./assignments-lifecycle-shared";
+import { selectAllRows } from "./supabase-paginate";
+import { dedupeTakenTasks } from "./assignment-taken-shared";
 import { lockLocationContext, type LocationActor } from "./locations";
 import { etCalendarDate } from "./operational-day";
 import { getRoleLevel, isRoleCode, type RoleCode } from "./roles";
@@ -28,7 +31,7 @@ function requireUuid(value: string): void {
 function dbError(error: { message: string; code?: string }, context?: "position_name"): never {
   if (error.code === "23505" && context === "position_name") throw new AssignmentError("position_name_taken", 409);
   if (error.code === "23505") throw new AssignmentError("assignment_already_active", 409);
-  const known = ["override_reason_required", "position_taken", "station_locked", "role_insufficient", "location_access_denied", "assignee_unavailable", "self_assignment", "station_unavailable", "assignment_not_found", "invalid_payload"];
+  const known = ["station_closed", "clocked_out", "on_break", "override_reason_required", "position_taken", "station_locked", "role_insufficient", "location_access_denied", "assignee_unavailable", "self_assignment", "station_unavailable", "assignment_not_found", "invalid_payload"];
   const code = known.find((candidate) => error.message === candidate);
   if (code) throw new AssignmentError(code, code === "override_reason_required" ? 422 : code === "position_taken" ? 409 : code === "assignment_not_found" ? 404 : code === "invalid_payload" ? 400 : 403);
   throw new Error(`assignments database failure: ${error.code ?? "unknown"}`);
@@ -146,6 +149,54 @@ export async function writeStationEvent(service: SupabaseClient, args: {
   return { id: result.id };
 }
 
+/** Break is a availability transition, not an assignment override or task edit. */
+export async function writeStationBreak(service: SupabaseClient, args: {
+  actor: AssignmentActor; locationId: string; userId: string; onBreak: boolean;
+}): Promise<{ id: string | null }> {
+  requireLocation(args.actor, args.locationId);
+  requireUuid(args.userId);
+  if (typeof args.onBreak !== "boolean") throw new AssignmentError("invalid_payload", 400);
+  if (args.actor.userId !== args.userId && args.actor.level < 4) throw new AssignmentError("role_insufficient");
+  const level = await targetLevel(service, args.userId, args.locationId);
+  if (args.actor.userId !== args.userId && !canManageAssignee(args.actor.level, level)) throw new AssignmentError("role_insufficient");
+  const { data, error } = await service.rpc("write_station_break", {
+    p_actor_id: args.actor.userId, p_user_id: args.userId, p_location_id: args.locationId, p_on_break: args.onBreak,
+  });
+  if (error) dbError(error);
+  const result = data as { id: string | null; changed: boolean };
+  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
+    action: "station.break", resourceTable: "station_break_events", resourceId: result.id,
+    metadata: { location_id: args.locationId, user_id: args.userId, on_break: args.onBreak }, ipAddress: null, userAgent: null });
+  return { id: result.id };
+}
+
+/** KH+ may edit advisory hours; this does not widen the GM configuration gate. */
+export async function saveStationTiming(service: SupabaseClient, args: {
+  actor: AssignmentActor; locationId: string; stationId: string; positionId?: string;
+  usuallyClosesAt?: string | null; usuallyTrimsAt?: string | null;
+}): Promise<{ id: string }> {
+  requireLocation(args.actor, args.locationId);
+  requireUuid(args.stationId);
+  if (args.actor.level < 4) throw new AssignmentError("role_insufficient");
+  if (await targetLevel(service, args.actor.userId, args.locationId) < 4) throw new AssignmentError("role_insufficient");
+  const isPosition = args.positionId !== undefined;
+  if (isPosition) requireUuid(args.positionId!);
+  const value = isPosition ? args.usuallyTrimsAt : args.usuallyClosesAt;
+  if (!validStationTime(value) || (isPosition ? args.usuallyClosesAt !== undefined : args.usuallyTrimsAt !== undefined))
+    throw new AssignmentError("invalid_payload", 400);
+  let query = isPosition
+    ? service.from("station_positions").update({ usually_trims_at: value }).eq("id", args.positionId!).eq("station_id", args.stationId)
+    : service.from("stations").update({ usually_closes_at: value }).eq("id", args.stationId);
+  if (isPosition && value !== null) query = query.gt("sort", 1);
+  const { data, error } = await query.eq("location_id", args.locationId).select("id").maybeSingle();
+  if (error) dbError(error);
+  if (!data) throw new AssignmentError("station_unavailable", 404);
+  await audit({ actorId: args.actor.userId, actorRole: args.actor.role, action: "station.timing_update",
+    resourceTable: isPosition ? "station_positions" : "stations", resourceId: data.id,
+    metadata: { location_id: args.locationId, time: value }, ipAddress: null, userAgent: null });
+  return data;
+}
+
 export async function assignTask(service: SupabaseClient, args: {
   actor: AssignmentActor; locationId: string; userId: string; task: TaskType; note?: string | null;
 } & OverrideReason): Promise<{ id: string }> {
@@ -279,7 +330,7 @@ export async function saveStationConfig(service: SupabaseClient, args: {
       (duty?.length ?? 0) > 500 || (dutyEs?.length ?? 0) > 500 ||
       !Number.isInteger(args.sort) || args.sort! < 1 || args.sort! > 100 ||
       typeof args.active !== "boolean") throw new AssignmentError("invalid_payload", 400);
-    const fields = { name, name_es: nameEs, duty, duty_es: dutyEs, sort: args.sort, active: args.active };
+    const fields = { name, name_es: nameEs, duty, duty_es: dutyEs, sort: args.sort, active: args.active, ...(args.sort === 1 ? { usually_trims_at: null } : {}) };
     // Deactivating a position keeps its current holder; new claims are refused.
     if (args.operation === "position_update") {
       if (!args.positionId) throw new AssignmentError("invalid_payload", 400);
@@ -343,23 +394,34 @@ export async function loadShiftBoard(service: SupabaseClient, args: {
   const { data: stationDate, error: dayError } = await service.rpc("station_business_date", { p_location_id: args.locationId });
   if (dayError) dbError(dayError);
   if (typeof stationDate !== "string") throw new Error("Station business date unavailable");
-  const stationsResult = await service.from("stations").select("id,name,name_es,sort,active,staffed")
+  const stationsResult = await service.from("stations").select("id,name,name_es,sort,active,staffed,usually_closes_at")
     .eq("location_id", args.locationId).order("sort").order("name");
   if (stationsResult.error) dbError(stationsResult.error);
-  const positionsResult = await service.from("station_positions").select("id,station_id,name,name_es,duty,duty_es,sort,active")
+  const positionsResult = await service.from("station_positions").select("id,station_id,name,name_es,duty,duty_es,sort,active,usually_trims_at")
     .eq("location_id", args.locationId).order("sort").order("name");
   if (positionsResult.error) dbError(positionsResult.error);
+  const closureResult = await service.rpc("station_closures", { p_location_id: args.locationId, p_day: stationDate });
+  if (closureResult.error) dbError(closureResult.error);
+  const closures = new Map<string, string>((closureResult.data ?? []).map((row: { station_id: string; closed_at: string }) => [row.station_id, row.closed_at]));
+  const breakRows = await selectAllRows<{ user_id: string; on_break: boolean }>((from, to) =>
+    service.from("station_break_events").select("user_id,on_break").eq("location_id", args.locationId)
+      .eq("business_date", stationDate).order("sequence").range(from, to));
+  const breaks = new Map(breakRows.map((row) => [row.user_id, row.on_break]));
+  const departureRows = await selectAllRows<{ user_id: string; out_at: string }>((from, to) =>
+    service.from("station_departures").select("user_id,out_at").eq("location_id", args.locationId)
+      .eq("business_date", args.date).order("out_at").order("user_id").range(from, to));
+  const departures = new Map(departureRows.map((row) => [row.user_id, row.out_at]));
   const stations: Station[] = (stationsResult.data ?? []).map((row) => ({
-    id: row.id, name: row.name, nameEs: row.name_es, sort: row.sort, active: row.active, staffed: row.staffed,
+    id: row.id, name: row.name, nameEs: row.name_es, sort: row.sort, active: row.active, staffed: row.staffed, usuallyClosesAt: row.usually_closes_at, closedAt: closures.get(row.id) ?? null,
     positions: (positionsResult.data ?? []).filter((p) => p.station_id === row.id).map((p) => ({
       id: p.id, stationId: p.station_id, name: p.name, nameEs: p.name_es, duty: p.duty,
-      dutyEs: p.duty_es, sort: p.sort, active: p.active,
+      dutyEs: p.duty_es, sort: p.sort, active: p.active, usuallyTrimsAt: p.usually_trims_at,
     })),
   }));
   // Paginate history so the API row limit cannot quietly restore an old head.
   const eventRows: Array<Record<string, unknown>> = [];
   for (let offset = 0; ; offset += 500) {
-    const query = service.from("station_events").select("id,sequence::text,location_id,business_date,user_id,station_id,position_id,kind,actor_id,at,source,reason_code,reason_note,overridden_assigner_id")
+    const query = service.from("station_events").select("id,sequence::text,location_id,business_date,user_id,station_id,position_id,kind,actor_id,at,source,reason_code,reason_note,overridden_assigner_id,prior_position_id,effective_at")
       .eq("location_id", args.locationId).eq("business_date", stationDate).order("sequence");
     const { data, error } = await query.range(offset, offset + 499);
     if (error) dbError(error);
@@ -377,18 +439,19 @@ export async function loadShiftBoard(service: SupabaseClient, args: {
     if ((data ?? []).length < 500) break;
   }
   const taskResult = { data: taskRows };
-  const changes: Array<{ assignment_id: string; report_type: string; actor_id: string; kind: string; created_at: string;
+  const changes: Array<{ assignment_id: string; report_type: string; actor_id: string | null; kind: string; created_at: string; subject_user_id: string | null; effective_at: string | null;
     reason_code: OverrideReasonCode | null; reason_note: string | null; overridden_assigner_id: string | null }> = [];
   for (let offset = 0; ; offset += 500) {
     const result = await service.from("assignment_changes")
-      .select("assignment_id,report_type,actor_id,kind,created_at,reason_code,reason_note,overridden_assigner_id")
+      .select("assignment_id,report_type,actor_id,kind,created_at,reason_code,reason_note,overridden_assigner_id,subject_user_id,effective_at")
       .eq("location_id", args.locationId).eq("operational_date", args.date).order("created_at").order("id")
       .range(offset, offset + 499);
     if (result.error) dbError(result.error);
     changes.push(...(result.data ?? []));
     if ((result.data ?? []).length < 500) break;
   }
-  const taken = await loadTakenTasks(service, { locationId: args.locationId, date: args.date });
+  const takenHistory = await loadTakenTasks(service, { locationId: args.locationId, date: args.date, includeHistory: true });
+  const taken = dedupeTakenTasks(takenHistory.filter((row) => takenSurvivesDeparture(row.at, departures.get(row.userId))));
   const membershipQuery = service.from("user_locations").select("user_id")
     .eq("location_id", args.locationId).eq("active", true);
   const membership = await membershipQuery;
@@ -399,8 +462,10 @@ export async function loadShiftBoard(service: SupabaseClient, args: {
   for (const task of taskRows) rosterIds.add(task.assignee_id);
   for (const task of taken) rosterIds.add(task.userId);
   for (const event of eventRows) rosterIds.add(String(event.user_id));
-  const namesNeeded = new Set([...rosterIds, ...eventRows.map((row) => String(row.actor_id)),
-    ...eventRows.map((row) => String(row.user_id)), ...changes.map((row) => row.actor_id),
+  for (const row of breakRows) rosterIds.add(row.user_id);
+  for (const row of departureRows) rosterIds.add(row.user_id);
+  const namesNeeded = new Set([...rosterIds, ...eventRows.flatMap((row) => row.actor_id ? [String(row.actor_id)] : []),
+    ...eventRows.map((row) => String(row.user_id)), ...changes.flatMap((row) => row.actor_id ? [row.actor_id] : []),
     ...(taskResult.data ?? []).map((row) => String(row.assigner_id))]);
   const users: Array<{ id: string; name: string; role: string; active: boolean }> = [];
   const ids = [...namesNeeded];
@@ -411,17 +476,19 @@ export async function loadShiftBoard(service: SupabaseClient, args: {
   }
   const names = new Map(users.map((user) => [user.id, user.name]));
   const levels = new Map(users.map((user) => [user.id, isRoleCode(user.role) ? getRoleLevel(user.role) : 0]));
-  const changeView = (row: { actor_id: string; reason_code: OverrideReasonCode | null; reason_note: string | null;
+  const changeView = (row: { actor_id: string | null; reason_code: OverrideReasonCode | null; reason_note: string | null;
     overridden_assigner_id: string | null }, at: string): AssignmentChange => ({
-    actorName: names.get(row.actor_id) ?? null, at, reasonCode: row.reason_code,
+    actorName: (row.actor_id ? names.get(row.actor_id) : null) ?? null, at, reasonCode: row.reason_code,
     reasonNote: row.reason_note, overriddenAssignerId: row.overridden_assigner_id,
   });
   const events: StationEvent[] = eventRows.map((row) => ({
     id: String(row.id), sequence: String(row.sequence), locationId: String(row.location_id), businessDate: String(row.business_date),
     userId: String(row.user_id), stationId: row.station_id as string | null, positionId: row.position_id as string | null, kind: row.kind as StationEvent["kind"],
-    actorId: String(row.actor_id), actorName: names.get(String(row.actor_id)) ?? null, at: String(row.at), source: row.source as StationEvent["source"],
+    actorId: row.actor_id ? String(row.actor_id) : null, actorName: names.get(String(row.actor_id)) ?? null, at: String(row.at), source: row.source as StationEvent["source"],
     actorLevel: levels.get(String(row.actor_id)),
-    change: row.reason_code || row.reason_note ? changeView({ actor_id: String(row.actor_id),
+    priorPositionId: row.prior_position_id as string | null, effectiveAt: row.effective_at as string | null,
+    releaseReason: ["station_closed", "clocked_out", "on_break"].includes(String(row.reason_code)) ? row.reason_code as StationEvent["releaseReason"] : undefined,
+    change: !["station_closed", "clocked_out", "on_break"].includes(String(row.reason_code)) && (row.reason_code || row.reason_note) ? changeView({ actor_id: String(row.actor_id),
       reason_code: row.reason_code as OverrideReasonCode | null, reason_note: row.reason_note as string | null,
       overridden_assigner_id: row.overridden_assigner_id as string | null }, String(row.at)) : undefined,
   }));
@@ -447,13 +514,19 @@ export async function loadShiftBoard(service: SupabaseClient, args: {
       source: "taken", at: row.at, available: available.has(row.userId) });
   }
   return { locationId: args.locationId, date: args.date, viewerId: args.actor.userId, viewerLevel: args.actor.level,
-    stations, events,
+    stations, events, positionVacancies: positionVacancies(events, breaks, names),
+    taskVacancies: [...[...new Map(changes.map((row) => [row.report_type, row])).values()]
+      .filter((row) => row.kind === "auto_release" && isTaskType(row.report_type) && row.subject_user_id && row.effective_at)
+      .map((row) => ({ task: row.report_type as TaskType, userId: row.subject_user_id!, name: names.get(row.subject_user_id!) ?? "", at: row.effective_at! })),
+      ...dedupeTakenTasks(takenHistory.filter((row) => !takenSurvivesDeparture(row.at, departures.get(row.userId))))
+        .filter((row) => !changes.some((change) => change.report_type === row.task))
+        .map((row) => ({ task: row.task, userId: row.userId, name: names.get(row.userId) ?? "", at: departures.get(row.userId)! }))],
     taskChanges: changes.filter((row) => row.kind === "retract" && isTaskType(row.report_type))
       .map((row) => ({ task: row.report_type as TaskType, change: changeView(row, row.created_at) })),
     occupiedPositions, tasks, people: users.filter((user) => isRoleCode(user.role) &&
       (available.has(user.id) || tasks.some((task) => task.assigneeId === user.id) || events.some((event) => event.userId === user.id)))
-      .map((user) => ({ id: user.id, name: user.name, available: available.has(user.id), level: isRoleCode(user.role) ? getRoleLevel(user.role) : 0,
-        hasWork: events.some((event) => event.userId === user.id) || tasks.some((task) => task.assigneeId === user.id) }))
+      .map((user) => ({ id: user.id, name: user.name, available: available.has(user.id), onBreak: breaks.get(user.id) ?? false, level: isRoleCode(user.role) ? getRoleLevel(user.role) : 0,
+        hasWork: !!heads.get(user.id)?.stationId || tasks.some((task) => task.assigneeId === user.id) }))
       .sort((a, b) => a.name.localeCompare(b.name)),
   };
 }
diff --git a/lib/audit-actions.ts b/lib/audit-actions.ts
index 9c657c3b..fbd84909 100644
--- a/lib/audit-actions.ts
+++ b/lib/audit-actions.ts
@@ -43,6 +43,8 @@ import { DESTRUCTIVE_ACTIONS } from "@/lib/destructive-actions";
  * to filter for.
  */
 export const NON_DESTRUCTIVE_ACTIONS = [
+  "station.system_release", // 0230 SQL: observed closure / Toast departure.
+  "assignment.system_release", // 0230 SQL: observed Toast departure.
   "ezcater.location_reassigned", // Provider shop observation, including a manual-location conflict.
   "ezcater.order_synced", // Provider observation; metadata contains identities/codes only.
   "vendor.import_staged", // Vendor evidence only; staging does not change the catalog.
diff --git a/lib/destructive-actions.ts b/lib/destructive-actions.ts
index 0f9c7b27..4dbdb313 100644
--- a/lib/destructive-actions.ts
+++ b/lib/destructive-actions.ts
@@ -48,6 +48,8 @@ export const DESTRUCTIVE_ACTIONS = [
   "station.position_update",
   "station.sync",
   "station.event",
+  "station.break", // A human changes the shift's availability record.
+  "station.timing_update", // Advisory station / position configuration.
   "assignment.create",
   "assignment.retract",
   "receiving.store_create",
diff --git a/lib/i18n/format.ts b/lib/i18n/format.ts
index 227abe25..c873a545 100644
--- a/lib/i18n/format.ts
+++ b/lib/i18n/format.ts
@@ -56,6 +56,15 @@ import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/typ
  */
 const OPERATIONAL_TZ = "America/New_York";
 
+/** A database time is a wall-clock hint, not an instant: never shift it by timezone. */
+export function formatClockTime(time: string, language: Language): string {
+  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) return "";
+  const [hour, minute] = time.split(":").map(Number);
+  return new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", {
+    hour: "numeric", minute: "2-digit", timeZone: "UTC",
+  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
+}
+
 /**
  * Format an ISO timestamp into a localized time string in the
  * operational timezone. Empty string on parse failure (defensive —
diff --git a/lib/jobs-registry.ts b/lib/jobs-registry.ts
index 6c43a319..f7729ca0 100644
--- a/lib/jobs-registry.ts
+++ b/lib/jobs-registry.ts
@@ -37,8 +37,8 @@ export const JOBS_REGISTRY = [
   // Its cron heartbeat is written by the capture inside the 09:00 UTC sales pull.
   { job: "toast-order-capture", cadenceMinutes: 1440, source: "vercel", dueUtc: "09:00" },
   { job: "toast-sales-pull", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "toast-sales-pull", dueUtc: "09:00" } }, // 09:00 UTC
-  // Labor (0224): a bounded, fail-soft pull at the end of the nightly; watched only while TOAST_LABOR_PULL=1.
-  { job: "toast-labor-pull", cadenceMinutes: 1440, source: "vercel", dueUtc: "09:00" },
+  // Labor (0224/0230): today's bounded, fail-soft pull rides the 10-minute pinger; nightly remains a backstop.
+  { job: "toast-labor-pull", cadenceMinutes: 10, window: { startHourET: 6, endHourET: 22 }, source: "pinger" },
   { job: "prune-sessions", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "prune-sessions", dueUtc: "08:30" } }, // 08:30 UTC
   { job: "parse-receipts", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "parse-receipts", dueUtc: "09:45" } }, // 09:45 UTC
   { job: "toast-catering-scan", cadenceMinutes: 10, window: { startHourET: 6, endHourET: 22 }, source: "pinger" },
diff --git a/lib/toast/labor.ts b/lib/toast/labor.ts
index 24bd0ca7..a319ce4c 100644
--- a/lib/toast/labor.ts
+++ b/lib/toast/labor.ts
@@ -18,6 +18,7 @@
 import "server-only";
 import { audit } from "@/lib/audit";
 import { getServiceRoleClient } from "@/lib/supabase-server";
+import { etCalendarDate } from "@/lib/operational-day";
 import { toastGet } from "./client";
 import { toastBusinessDate } from "./orders";
 import { employeeFirstNames, jobTitles, normalizeTimeEntries, type LaborEntryRow } from "./labor-shared";
@@ -26,6 +27,11 @@ export function laborPullEnabled(): boolean {
   return process.env.TOAST_LABOR_PULL === "1";
 }
 
+/** Separate from the labor reader so the app may deploy safely before migration 0230 is applied. */
+export function stationLifecycleEnabled(): boolean {
+  return process.env.STATION_LIFECYCLE === "1";
+}
+
 export type LaborPullContext = "cron" | "manual" | "digest";
 
 export interface LaborPullResult {
@@ -68,11 +74,23 @@ export function toastModifiedParam(at: Date): string {
 
 export async function runToastLaborPull(
   dates: readonly string[],
-  opts: { deadlineMs: number; context: LaborPullContext; locationIds?: readonly string[]; now?: Date },
+  opts: {
+    deadlineMs: number;
+    context: LaborPullContext;
+    locationIds?: readonly string[];
+    now?: Date;
+    /** Today's ET day only. Reconciliation runs after both its date pull and corrections succeed. */
+    reconcileDate?: string;
+  },
 ): Promise<LaborPullResult> {
   if (!laborPullEnabled()) return { ran: false, results: [], modified: 0 };
   const signal = AbortSignal.timeout(Math.max(1_000, opts.deadlineMs));
   const now = opts.now ?? new Date();
+  const todayEt = etCalendarDate(now.toISOString());
+  // The module owns the safety boundary: every successful TODAY pull reconciles, while even an
+  // explicit stale option cannot make a historical pull release current work.
+  const reconcileDate = dates.includes(todayEt) && (opts.reconcileDate === undefined || opts.reconcileDate === todayEt)
+    ? todayEt : undefined;
   const out: LaborPullResult = { ran: true, results: [], modified: 0 };
   let locations: Array<{ id: string; toast_restaurant_guid: string }> = [];
   try {
@@ -86,6 +104,8 @@ export async function runToastLaborPull(
     out.results.push({ locationId: "*", businessDate: dates[0] ?? "", ok: false, rows: 0, skipped: 0, error: code(e) });
   }
   for (const loc of locations) {
+    let reconcileDaySucceeded = false;
+    let correctionsSucceeded = false;
     let jobs: Map<string, string> | null = null;
     let employees: Map<string, string> | null = null;
     const write = async (rows: LaborEntryRow[]) => {
@@ -109,6 +129,7 @@ export async function runToastLaborPull(
         const { rows, skipped } = normalizeTimeEntries(raw, { locationId: loc.id, businessDate: day, ...c });
         await write(rows);
         out.results.push({ locationId: loc.id, businessDate: day, ok: true, rows: rows.length, skipped });
+        if (day === reconcileDate) reconcileDaySucceeded = true;
       } catch (e) {
         out.results.push({ locationId: loc.id, businessDate: day, ok: false, rows: 0, skipped: 0, error: code(e) });
       }
@@ -121,9 +142,21 @@ export async function runToastLaborPull(
       const { rows } = normalizeTimeEntries(raw, { locationId: loc.id, businessDate: null, ...c });
       await write(rows);
       out.modified += rows.length;
+      correctionsSucceeded = true;
     } catch (e) {
       out.results.push({ locationId: loc.id, businessDate: "modified", ok: false, rows: 0, skipped: 0, error: code(e) });
     }
+    if (reconcileDate && stationLifecycleEnabled() && reconcileDaySucceeded && correctionsSucceeded) {
+      try {
+        const { error } = await withDeadline(getServiceRoleClient().rpc("reconcile_station_lifecycle", {
+          p_location_id: loc.id,
+          p_day: reconcileDate,
+        }).abortSignal(signal), signal);
+        if (error) throw new Error(signal.aborted ? "toast_labor_deadline" : "toast_labor_reconcile_failed");
+      } catch (e) {
+        out.results.push({ locationId: loc.id, businessDate: "reconcile", ok: false, rows: 0, skipped: 0, error: code(e) });
+      }
+    }
   }
   const failures = out.results.filter((r) => !r.ok).length;
   const job = opts.context === "cron" ? "toast-labor-pull" : `toast-labor-pull-${opts.context}`;

```

## New: supabase/migrations/0230_station_lifecycle.sql

```
-- AUTHORED ONLY 2026-10-08. NOT APPLIED. CC sim + review, then Juan's apply gate.
-- 0229 belongs to ezCater. No seed values, no restoration of released work.
-- Closing state is derived from the latest non-dropped closing instance for the
-- station business day. Its active section items must ALL have live completions.
-- Completion triggers share the station/day lock with claims and break writes.
begin;

-- Ground-truth preflight at application time; old base migrations are absent
-- from this clone. A mismatched schema must refuse, not partially install.
do $$ declare entry text; tab text; col text; begin
  foreach entry in array array[
    'checklist_instances.id','checklist_instances.location_id','checklist_instances.date',
    'checklist_instances.template_id','checklist_instances.dropped_at','checklist_instances.shift_start_at','checklist_instances.triggered_at',
    'checklist_templates.id','checklist_templates.type',
    'checklist_template_items.id','checklist_template_items.template_id','checklist_template_items.station','checklist_template_items.active',
    'checklist_completions.id','checklist_completions.instance_id','checklist_completions.template_item_id',
    'checklist_completions.completed_at','checklist_completions.revoked_at','checklist_completions.superseded_at',
    'toast_time_entries.user_id','toast_time_entries.in_at','toast_time_entries.out_at','toast_time_entries.deleted',
    'toast_time_entries.location_id','toast_time_entries.business_date','toast_time_entries.time_entry_guid',
    'report_assignments.created_at','report_assignments.assignee_id','report_assignments.active',
    'audit_log.actor_id','audit_log.actor_role','audit_log.action','audit_log.resource_table',
    'audit_log.resource_id','audit_log.metadata','audit_log.destructive'
  ] loop
    tab:=split_part(entry,'.',1); col:=split_part(entry,'.',2);
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=tab and column_name=col) then
      raise exception '0230: missing expected column %',entry;
    end if;
  end loop;
end $$;

alter table public.stations add column usually_closes_at time;
alter table public.station_positions add column usually_trims_at time,
  add constraint station_position_trim_after_first check (usually_trims_at is null or sort>1);
alter table public.station_events alter column actor_id drop not null;
alter table public.station_events drop constraint station_events_reason_code_check;
alter table public.station_events add constraint station_events_reason_code_check check
  (reason_code in ('coverage_change','unavailable','skill_fit','correction','other','station_closed','clocked_out','on_break'));
alter table public.station_events add column prior_position_id uuid references public.station_positions(id),
  add column effective_at timestamptz,
  add constraint station_events_system_actor check (actor_id is not null or
    coalesce((kind='release' and reason_code in ('station_closed','clocked_out') and effective_at is not null),false)),
  add constraint station_events_system_reason check (reason_code not in ('station_closed','clocked_out','on_break') or
    (kind='release' and station_id is null and position_id is null and source is null and overridden_assigner_id is null));
alter table public.assignment_changes alter column actor_id drop not null;
alter table public.assignment_changes drop constraint assignment_changes_kind_check;
alter table public.assignment_changes drop constraint assignment_changes_reason_code_check;
alter table public.assignment_changes add constraint assignment_changes_kind_check check (kind in ('assign','retract','auto_release')),
  add constraint assignment_changes_reason_code_check check
    (reason_code in ('coverage_change','unavailable','skill_fit','correction','other','clocked_out')),
  add column subject_user_id uuid references public.users(id),
  add column effective_at timestamptz,
  add constraint assignment_changes_system_actor check
    ((kind='auto_release' and actor_id is null and reason_code is not distinct from 'clocked_out' and subject_user_id is not null and effective_at is not null and overridden_assigner_id is null)
      or (kind<>'auto_release' and actor_id is not null and reason_code is distinct from 'clocked_out'));

create table public.station_break_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  location_id uuid not null references public.locations(id), business_date date not null,
  user_id uuid not null references public.users(id), actor_id uuid references public.users(id),
  on_break boolean not null, at timestamptz not null default clock_timestamp(),
  reason_code text,
  check ((actor_id is not null and reason_code is null) or
    (actor_id is null and not on_break and reason_code is not distinct from 'clocked_out'))
);
create index station_break_events_head on public.station_break_events(location_id,business_date,user_id,sequence desc);
-- Records departures even when no explicit assignment existed. This prevents
-- historical 'taken' report attribution from restoring work on re-clock-in.
create table public.station_departures (
  location_id uuid not null references public.locations(id), business_date date not null,
  user_id uuid not null references public.users(id), out_at timestamptz not null,
  primary key(location_id,business_date,user_id,out_at)
);
alter table public.station_break_events enable row level security;
alter table public.station_departures enable row level security;
create policy station_break_events_no_user_select on public.station_break_events for select using(false);
create policy station_break_events_no_user_insert on public.station_break_events for insert with check(false);
create policy station_break_events_no_user_update on public.station_break_events for update using(false) with check(false);
create policy station_break_events_no_user_delete on public.station_break_events for delete using(false);
create policy station_departures_no_user_select on public.station_departures for select using(false);
create policy station_departures_no_user_insert on public.station_departures for insert with check(false);
create policy station_departures_no_user_update on public.station_departures for update using(false) with check(false);
create policy station_departures_no_user_delete on public.station_departures for delete using(false);
revoke all on public.station_break_events,public.station_departures from public,anon,authenticated,service_role;
grant select on public.station_break_events,public.station_departures to service_role;
revoke all on sequence public.station_break_events_sequence_seq from public,anon,authenticated,service_role;

create function public.station_closures(p_location_id uuid,p_day date)
returns table(station_id uuid,closed_at timestamptz)
language sql volatile security definer set search_path=pg_catalog,public as $$
  with instance as (
    select i.id,i.template_id from public.checklist_instances i
    join public.checklist_templates t on t.id=i.template_id
    where i.location_id=p_location_id and i.date=p_day and t.type='closing' and i.dropped_at is null
    order by i.shift_start_at desc nulls last,i.triggered_at desc nulls last,i.id desc limit 1
  )
  select s.id,max(c.completed_at)
  from instance i join public.checklist_template_items ti on ti.template_id=i.template_id and ti.active
  join public.stations s on s.location_id=p_location_id and s.name=btrim(ti.station) and s.active
  left join public.checklist_completions c on c.instance_id=i.id and c.template_item_id=ti.id
    and c.revoked_at is null and c.superseded_at is null
  group by s.id having count(*)>0 and bool_and(c.id is not null)
$$;

-- Latest Toast shift wins; any still-open shift conservatively prevents release.
-- Never infer identity from names, never use a deleted/future time entry.
create function public.station_clocked_out(p_location_id uuid,p_day date)
returns table(user_id uuid,out_at timestamptz)
language sql volatile security definer set search_path=pg_catalog,public as $$
  with latest as (
    select distinct on (e.user_id) e.user_id,e.out_at
    from public.toast_time_entries e where e.location_id=p_location_id and e.business_date=p_day
      and not e.deleted and e.user_id is not null and e.in_at<=clock_timestamp()
    order by e.user_id,e.in_at desc,e.out_at desc nulls first,e.time_entry_guid
  ) select l.user_id,l.out_at from latest l where l.out_at<=clock_timestamp()
    and not exists(select 1 from public.toast_time_entries e where e.location_id=p_location_id
      and e.business_date=p_day and e.user_id=l.user_id and not e.deleted and e.in_at<=clock_timestamp() and e.out_at is null)
$$;

-- SQL observations use the same fail-open audit doctrine as lib/audit.ts.
create function public.station_lifecycle_audit(p_action text,p_table text,p_id uuid,p_metadata jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_action not in ('station.system_release','assignment.system_release') then raise exception 'invalid_payload'; end if;
  begin
    insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
      values(null,null,p_action,p_table,p_id,p_metadata,false);
  exception when others then raise warning 'station lifecycle audit failed'; end;
end $$;

create function public.release_closed_stations(p_location_id uuid,p_day date)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||p_day::text,0));
  for r in select h.*,c.closed_at from (
    select distinct on (user_id) * from public.station_events
    where location_id=p_location_id and business_date=p_day order by user_id,sequence desc
  ) h join public.station_closures(p_location_id,p_day) c on c.station_id=h.station_id loop
    insert into public.station_events(location_id,business_date,user_id,kind,actor_id,reason_code,prior_position_id,effective_at)
      values(p_location_id,p_day,r.user_id,'release',null,'station_closed',r.position_id,r.closed_at) returning id into v_id;
    perform public.station_lifecycle_audit('station.system_release','station_events',v_id,
      jsonb_build_object('reason','station_closed','location_id',p_location_id,'business_date',p_day,'user_id',r.user_id,'position_id',r.position_id));
  end loop;
end $$;

create function public.reconcile_station_lifecycle(p_location_id uuid,p_day date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; h record; a record; v_id uuid; v_station_day date;
begin
  if p_day is null or p_day<>(clock_timestamp() at time zone 'America/New_York')::date then raise exception 'invalid_payload'; end if;
  v_station_day:=public.station_business_date(p_location_id);
  -- Chronological lock order when a closing spans midnight.
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_station_day::text,0));
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||p_day::text,0));
  perform public.release_closed_stations(p_location_id,v_station_day);
  for r in select * from public.station_clocked_out(p_location_id,p_day) loop
    insert into public.station_departures(location_id,business_date,user_id,out_at)
      values(p_location_id,p_day,r.user_id,r.out_at) on conflict do nothing;
    -- Do not retrospectively erase a human change made after the departure.
    select * into h from public.station_events where location_id=p_location_id
      and business_date=v_station_day and user_id=r.user_id order by sequence desc limit 1;
    if (h.station_id is not null or (h.reason_code='on_break' and h.prior_position_id is not null)) and h.at<=r.out_at then
      insert into public.station_events(location_id,business_date,user_id,kind,actor_id,reason_code,prior_position_id,effective_at)
        values(p_location_id,v_station_day,r.user_id,'release',null,'clocked_out',coalesce(h.position_id,h.prior_position_id),r.out_at) returning id into v_id;
      perform public.station_lifecycle_audit('station.system_release','station_events',v_id,
        jsonb_build_object('reason','clocked_out','location_id',p_location_id,'user_id',r.user_id,'position_id',h.position_id,'out_at',r.out_at));
    end if;
    -- Leaving ends a break, too. A later re-clock-in starts free, not on break.
    if coalesce((select b.on_break and b.at<=r.out_at from public.station_break_events b
      where b.location_id=p_location_id and b.business_date=v_station_day and b.user_id=r.user_id order by b.sequence desc limit 1),false) then
      insert into public.station_break_events(location_id,business_date,user_id,actor_id,on_break,reason_code)
        values(p_location_id,v_station_day,r.user_id,null,false,'clocked_out');
    end if;
    -- An active daily assignment is the existing model's open work contract.
    -- Report history is never mutated; only this delegation is retired.
    for a in update public.report_assignments set active=false where location_id=p_location_id
      and operational_date=p_day and assignee_id=r.user_id and active and created_at<=r.out_at returning * loop
      insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,actor_id,kind,reason_code,subject_user_id,effective_at)
        values(a.id,p_location_id,p_day,a.report_type,null,'auto_release','clocked_out',r.user_id,r.out_at) returning id into v_id;
      perform public.station_lifecycle_audit('assignment.system_release','assignment_changes',v_id,
        jsonb_build_object('reason','clocked_out','assignment_id',a.id,'location_id',p_location_id,'user_id',r.user_id,'out_at',r.out_at));
    end loop;
  end loop;
  return jsonb_build_object('ok',true);
end $$;

create function public.write_station_break(p_actor_id uuid,p_user_id uuid,p_location_id uuid,p_on_break boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_day date:=public.station_business_date(p_location_id); v_actor integer; v_target integer;
  v_previous public.station_break_events%rowtype; h public.station_events%rowtype; v_id uuid;
begin
  if p_on_break is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_day::text,0));
  v_actor:=public.assignment_user_level(p_actor_id,p_location_id);
  v_target:=public.assignment_user_level(p_user_id,p_location_id);
  if p_actor_id<>p_user_id and (v_actor<4 or v_target>v_actor) then raise exception 'role_insufficient'; end if;
  select * into v_previous from public.station_break_events where location_id=p_location_id
    and business_date=v_day and user_id=p_user_id order by sequence desc limit 1;
  if coalesce(v_previous.on_break,false)=p_on_break then
    return jsonb_build_object('id',v_previous.id,'changed',false);
  end if;
  insert into public.station_break_events(location_id,business_date,user_id,actor_id,on_break)
    values(p_location_id,v_day,p_user_id,p_actor_id,p_on_break) returning id into v_id;
  if p_on_break then
    select * into h from public.station_events where location_id=p_location_id and business_date=v_day and user_id=p_user_id order by sequence desc limit 1;
    if h.station_id is not null then
      insert into public.station_events(location_id,business_date,user_id,kind,actor_id,reason_code,prior_position_id,effective_at)
        values(p_location_id,v_day,p_user_id,'release',p_actor_id,'on_break',h.position_id,clock_timestamp());
    end if;
  end if;
  return jsonb_build_object('id',v_id,'changed',true);
end $$;

-- A BEFORE trigger takes the lock before the completion becomes visible; the
-- AFTER trigger observes the full new state, including revocation/supersession.
-- Reopening needs no write: station_closures immediately ceases to return it.
create function public.checklist_station_lifecycle()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location uuid; v_day date;
begin
  select i.location_id,i.date into v_location,v_day from public.checklist_instances i
    join public.checklist_templates t on t.id=i.template_id where i.id=new.instance_id and t.type='closing';
  if v_location is not null and v_day=public.station_business_date(v_location) then
    perform pg_advisory_xact_lock(hashtextextended('station/day/'||v_location::text||'/'||v_day::text,0));
    if tg_when='AFTER' then perform public.release_closed_stations(v_location,v_day); end if;
  end if;
  return new;
end $$;
create trigger checklist_station_lifecycle_lock before insert or update of revoked_at,superseded_at on public.checklist_completions
  for each row execute function public.checklist_station_lifecycle();
create trigger checklist_station_lifecycle_release after insert or update of revoked_at,superseded_at on public.checklist_completions
  for each row execute function public.checklist_station_lifecycle();

-- Existing write RPC bodies follow, with only lifecycle guards added; arguments
-- and defaults remain exactly those of 0228.

create or replace function public.write_task_assignment(p_actor_id uuid,p_location_id uuid,p_user_id uuid,p_task text,p_note text,p_assignment_id uuid,p_reason_code text default null,p_reason_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_day date := (clock_timestamp() at time zone 'America/New_York')::date;
  v_actor integer; v_target integer; v_user uuid := p_user_id; v_task text := p_task;
  v_row public.report_assignments%rowtype; v_id uuid; v_overridden uuid;
begin
  if (p_reason_code is not null and p_reason_code not in ('coverage_change','unavailable','skill_fit','correction','other'))
    or length(coalesce(p_reason_note,''))>500
    or (p_reason_code='other' and not coalesce(p_reason_note ~ '[^[:space:]]',false)) then
    raise exception 'invalid_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_day::text,0));
  v_actor := public.assignment_user_level(p_actor_id,p_location_id);
  if v_actor<4 then raise exception 'role_insufficient'; end if;
  if p_assignment_id is not null then
    select * into v_row from public.report_assignments where id=p_assignment_id and location_id=p_location_id for update;
    if not found then raise exception 'assignment_not_found'; end if;
    -- Past operational days are immutable accountability history.
    if v_row.operational_date < public.station_business_date(p_location_id) then
      raise exception 'assignment_not_found';
    end if;
    if not v_row.active then return jsonb_build_object('id',p_assignment_id,'changed',false); end if;
    if public.assignment_author_level(v_row.assigner_id)>v_actor then
      v_overridden := v_row.assigner_id;
      if p_reason_code is null then raise exception 'override_reason_required'; end if;
    end if;
    -- Retraction is not assigning up: only actor authority and row shop matter.
    update public.report_assignments set active=false where id=p_assignment_id and active returning id into v_id;
    if v_id is not null then
      insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,actor_id,kind,reason_code,reason_note,overridden_assigner_id)
      values(v_id,p_location_id,v_row.operational_date,v_row.report_type,p_actor_id,'retract',p_reason_code,nullif(btrim(p_reason_note),''),v_overridden);
    end if;
    return jsonb_build_object('id',p_assignment_id,'changed',v_id is not null,
      'overridden_assigner_id',v_overridden,'reason_code',p_reason_code,'reason_note',nullif(btrim(p_reason_note),''));
  end if;
  if v_task is null or v_task not in ('am_prep','mid_day_prep','cash_report','opening_report','receiving','counts','ordering','pm_report') or v_user is null or length(p_note)>1000 then
    raise exception 'invalid_payload';
  end if;
  if v_user=p_actor_id then raise exception 'self_assignment'; end if;
  if exists(select 1 from public.station_clocked_out(p_location_id,v_day) where user_id=v_user) then raise exception 'clocked_out'; end if;
  v_target := public.assignment_user_level(v_user,p_location_id);
  if v_target>v_actor then raise exception 'role_insufficient'; end if;
  -- Parenthesized: PL/pgSQL reads an IF condition only up to the FIRST "then" token, so a bare
  -- CASE ... THEN inside the condition is cut in half (sim apply 2026-10-07: syntax error).
  if v_target < (case when v_task in ('am_prep','mid_day_prep','opening_report') then 3 else 4 end) then
    raise exception 'role_insufficient';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('task/'||p_location_id::text||'/'||v_day::text||'/'||v_user::text||'/'||v_task,0));
  select id into v_id from public.report_assignments where location_id=p_location_id and operational_date=v_day
    and assignee_id=v_user and report_type::text=v_task and active;
  if v_id is not null then return jsonb_build_object('id',v_id,'changed',false); end if;
  insert into public.report_assignments(report_type,location_id,operational_date,assigner_id,assignee_id,note,active)
    values(v_task::public.report_type_enum,p_location_id,v_day,p_actor_id,v_user,nullif(btrim(p_note),''),true) returning id into v_id;
  insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,actor_id,kind,reason_code,reason_note)
    values(v_id,p_location_id,v_day,v_task::public.report_type_enum,p_actor_id,'assign',p_reason_code,nullif(btrim(p_reason_note),''));
  return jsonb_build_object('id',v_id,'changed',true,'overridden_assigner_id',null,
    'reason_code',p_reason_code,'reason_note',nullif(btrim(p_reason_note),''));
end $$;


create or replace function public.write_station_event(
  p_actor_id uuid, p_user_id uuid, p_location_id uuid,
  p_station_id uuid, p_position_id uuid, p_manage boolean default false, p_reason_code text default null, p_reason_note text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_day date := public.station_business_date(p_location_id);
  v_actor integer; v_target integer; v_previous public.station_events%rowtype;
  v_id uuid; v_kind text; v_source text; v_overridden uuid;
begin
  if (p_reason_code is not null and p_reason_code not in ('coverage_change','unavailable','skill_fit','correction','other'))
    or length(coalesce(p_reason_note,''))>500
    or (p_reason_code='other' and not coalesce(p_reason_note ~ '[^[:space:]]',false)) then
    raise exception 'invalid_payload';
  end if;
  -- One shop/day lock serializes capacity checks across different people.
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_day::text,0));
  v_actor := public.assignment_user_level(p_actor_id,p_location_id);
  v_target := public.assignment_user_level(p_user_id,p_location_id);
  if (p_manage or p_actor_id <> p_user_id) and (v_actor<4 or v_target>v_actor) then raise exception 'role_insufficient'; end if;
  select * into v_previous from public.station_events
    where location_id=p_location_id and business_date=v_day and user_id=p_user_id
    order by sequence desc limit 1;
  if p_actor_id=p_user_id and v_previous.station_id is not null and v_previous.source='assigned' then
    raise exception 'station_locked';
  end if;
  if (p_station_id is null) <> (p_position_id is null) then raise exception 'invalid_payload'; end if;
  if p_station_id is not null then
    if exists(select 1 from public.station_closures(p_location_id,v_day) where station_id=p_station_id) then raise exception 'station_closed'; end if;
    if coalesce((select on_break from public.station_break_events where location_id=p_location_id and business_date=v_day and user_id=p_user_id order by sequence desc limit 1),false) then raise exception 'on_break'; end if;
    if exists(select 1 from public.station_clocked_out(p_location_id,(clock_timestamp() at time zone 'America/New_York')::date) where user_id=p_user_id) then raise exception 'clocked_out'; end if;
    perform 1 from public.stations s join public.station_positions p
      on p.station_id=s.id and p.location_id=s.location_id
      where s.id=p_station_id and s.location_id=p_location_id and s.active and s.staffed
        and p.id=p_position_id and p.active for share of s,p;
    if not found then raise exception 'station_unavailable'; end if;
  end if;
  v_source := case when p_station_id is null then null when p_actor_id=p_user_id then 'claimed' else 'assigned' end;
  if v_previous.id is not null and v_previous.station_id is not distinct from p_station_id
    and v_previous.position_id is not distinct from p_position_id
    and v_previous.source is not distinct from v_source then
    return jsonb_build_object('id',v_previous.id,'changed',false);
  end if;
  if v_previous.station_id is not null and v_previous.source='assigned'
    and public.assignment_author_level(v_previous.actor_id)>v_actor then
    v_overridden := v_previous.actor_id;
    if p_reason_code is null then raise exception 'override_reason_required'; end if;
  end if;
  if p_position_id is not null and exists (
    select 1 from public.station_events e
    where e.location_id=p_location_id and e.business_date=v_day and e.position_id=p_position_id
      and e.user_id<>p_user_id and e.id=(select h.id from public.station_events h
        where h.location_id=e.location_id and h.business_date=e.business_date
          and h.user_id=e.user_id order by h.sequence desc limit 1)
  ) then raise exception 'position_taken'; end if;
  v_kind := case when p_station_id is null then 'release'
    when v_previous.station_id is not null then 'move'
    when p_actor_id=p_user_id then 'claim' else 'assign' end;
  insert into public.station_events(location_id,business_date,user_id,station_id,position_id,kind,actor_id,source,at,reason_code,reason_note,overridden_assigner_id)
    values(p_location_id,v_day,p_user_id,p_station_id,p_position_id,v_kind,p_actor_id,v_source,clock_timestamp(),p_reason_code,nullif(btrim(p_reason_note),''),v_overridden)
    returning id into v_id;
  return jsonb_build_object('id',v_id,'changed',true,'overridden_assigner_id',v_overridden,
    'reason_code',p_reason_code,'reason_note',nullif(btrim(p_reason_note),''));
end $$;


-- Definer helpers are private even on Supabase's default ACLs.
do $$ declare f regprocedure; r text; tab text; begin
  foreach f in array array[
    'public.station_closures(uuid,date)'::regprocedure,
    'public.station_clocked_out(uuid,date)'::regprocedure,
    'public.station_lifecycle_audit(text,text,uuid,jsonb)'::regprocedure,
    'public.release_closed_stations(uuid,date)'::regprocedure,
    'public.reconcile_station_lifecycle(uuid,date)'::regprocedure,
    'public.write_station_break(uuid,uuid,uuid,boolean)'::regprocedure,
    'public.checklist_station_lifecycle()'::regprocedure,
    'public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean,text,text)'::regprocedure,
    'public.write_task_assignment(uuid,uuid,uuid,text,text,uuid,text,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
      or not has_function_privilege('service_role',f,'EXECUTE') then raise exception '0230: RPC grant escaped'; end if;
  end loop;
  foreach tab in array array['station_break_events','station_departures'] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(r,'public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(r,'public.'||tab,'INSERT,UPDATE,REFERENCES')
        or (r<>'service_role' and has_any_column_privilege(r,'public.'||tab,'SELECT')) then
        raise exception '0230: lifecycle ledger grant escaped';
      end if;
    end loop;
  end loop;
end $$;
commit;

```

## New: lib/assignments-lifecycle-shared.ts

```
/** Pure lifecycle projections; release history never restores a holder. */
import { orderedStationEvents, type ShiftBoard, type StationEvent } from "./assignments-shared";

export function positionVacancies(events: readonly StationEvent[], breaks: ReadonlyMap<string, boolean>, names: ReadonlyMap<string, string>): NonNullable<ShiftBoard["positionVacancies"]> {
  const heads = new Map<string, StationEvent>();
  const vacancies = new Map<string, NonNullable<ShiftBoard["positionVacancies"]>[number]>();
  for (const event of orderedStationEvents(events)) {
    const previous = heads.get(event.userId);
    if (previous?.positionId) vacancies.delete(previous.positionId);
    if (event.positionId) vacancies.delete(event.positionId);
    if (event.priorPositionId && (event.releaseReason === "clocked_out" ||
      (event.releaseReason === "on_break" && breaks.get(event.userId)))) {
      vacancies.set(event.priorPositionId, { positionId: event.priorPositionId, userId: event.userId,
        name: names.get(event.userId) ?? "", reason: event.releaseReason, at: event.effectiveAt ?? event.at });
    }
    heads.set(event.userId, event);
  }
  return [...vacancies.values()];
}

export function takenSurvivesDeparture(at: string, departedAt: string | undefined): boolean {
  return !departedAt || Date.parse(at) > Date.parse(departedAt);
}

export function validStationTime(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value));
}

```

## New: tests/station-lifecycle-migration.test.ts

```
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const old = readFileSync(new URL("../supabase/migrations/0228_assignment_attribution.sql", import.meta.url), "utf8");
const next = readFileSync(new URL("../supabase/migrations/0230_station_lifecycle.sql", import.meta.url), "utf8");
function body(sql: string, name: string) {
  const declaration = sql.search(new RegExp(`create(?: or replace)? function public\\.${name}\\(`));
  const start = sql.indexOf(`function public.${name}(`, declaration);
  return sql.slice(start, sql.indexOf("end $$;", start) + 7);
}

describe("0230 preserves the 0228 human-write contract", () => {
  it.each(["write_station_event", "write_task_assignment"])("keeps %s args/defaults and every existing body line in order", (name) => {
    const source = body(old, name).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const actual = body(next, name).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let offset = 0;
    for (const line of source) {
      const index = actual.indexOf(line, offset);
      expect(index, `missing/reordered ${name}: ${line}`).toBeGreaterThanOrEqual(offset);
      offset = index + 1;
    }
  });
  it("does not reserve 0229 or seed tenant closing/trim times", () => {
    expect(next).not.toMatch(/insert into public\.(stations|station_positions)\s*\(/i);
    expect(next).toContain("AUTHORED ONLY");
    expect(next).toContain("NOT APPLIED");
  });
});

```

Read alongside: scripts/test-station-lifecycle.sql; tests/station-lifecycle-{writers,projection,ui}.test.ts; tests/assignment-board-loader.test.ts; tests/location-bind-differential.test.ts; tests/toast-{labor-r2,capture-route-budget}.test.ts; matching 14 lifecycle keys in lib/i18n/en.json and es.json. Fixture previews and handoff are in this directory.
