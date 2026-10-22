/**
 * THE SCHEDULES LIB — generate, the horizon (preview / apply), edit, approve, replay, the Wednesday draft
 * (Scheduling Phase 2, Tasks 17 + 19). Server-only, service role, every write through a 0275 definer RPC built by
 * `rpc-args-shared` (the exact named arguments the PGlite harness proves).
 *
 * Every act decides its rule FIRST (`access-shared`), before any I/O; an AGM's edit right is the one rule that needs
 * the shop's `agm_access` row, read only after every I/O-free refusal has had its say. The step-up tier is the ROUTE's
 * (Tier B for approve and for a rebuild that overwrites a confirmed edited week); this lib passes SQL only the
 * confirmation flag (J12). SQL decides every rule again.
 *
 *  - generate / rebuild: `generatorInputFor` → `buildWeek` (validator-clean or `generator_invalid_output`, audited) →
 *    the context guard → `commit_schedule_revision`. Demand `unavailable` never builds (`demand_unavailable`).
 *  - the horizon: `previewHorizon` builds every week and diffs it against its head; its token binds the inputs digest,
 *    the structure version, every head and the demand kind. `applyHorizon` recomputes and refuses `preview_stale` on any
 *    difference; an edited week is rebuilt only when confirmed (else SKIPPED and named); week by week, a mid-range failure
 *    answers `{landed, skipped, failed}`.
 *  - edit: `applyEdit` on the head under the CURRENT context of the edited date; the other days are carried as they are.
 *  - approve: refuses `unresolved_gaps` (every unresolved_search gap, inherited or not) and `rules_failing` (a NEW
 *    error) BEFORE the RPC; writes an approval, never a revision. `budget_limited` gaps do not block (a manager's choice).
 *  - replay: ORIGINAL validation against the head's stored context, from the revision tables ONLY (no live read).
 *
 * No email, no SMS, no notification.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit-actions";
import { operationalNow } from "@/lib/midshift-shared";
import { isMissingTable } from "@/lib/people/facts";
import { canSeeScheduleMoney, scheduleActRefusal, type ScheduleAct } from "./access-shared";
import { gapLine } from "./board-view-shared";
import type { NarrativeLine } from "@/lib/people-narrative";
import { assertContextFits, canonicalJson, contextAdvisory, digest64, toContextSnapshot, type AdvisoryItem, type RuleContext } from "./context-shared";
import { diffWeeks, type WeekDiff } from "./diff-shared";
import { applyEdit, isEditOp, type EditOp } from "./edit-shared";
import { ScheduleError, isScheduleErrorCode, type ScheduleErrorCode } from "./errors-shared";
import { type GeneratorOutput } from "./generator/build-shared";
import { generateWeek as generateScheduleWeek } from "./generator/dispatch-shared";
import { horizonActions, planHorizon, type HorizonRequest } from "./horizon-shared";
import { loadScheduleShopSettings, loadSchedulingInputs, loadWeekHeads } from "./inputs";
import { generatorInputFor, sqlStructureVersion, type SchedulingInputs, type StoredWeek } from "./inputs-shared";
import { approveWeekCall, commitRevisionCall } from "./rpc-args-shared";
import { approvalRefusal, checkScheduleRules, type DayRecord, type DeclaredGap, type RuleProblem, type Shift } from "./rules-shared";
import type { PeopleActor } from "@/lib/people/access-shared";

// ─── Deps, refusals ──────────────────────────────────────────────────────────

export type LoadInputs = (service: SupabaseClient, args: { locationId: string; weekStarts: readonly string[]; now: Date }) => Promise<SchedulingInputs>;
export interface ScheduleDeps {
  service: SupabaseClient;
  now?: Date;
  /** Injected in tests; defaults to the one batch loader. */
  loadInputs?: LoadInputs;
  /** A new uuid (an edit's revision id, a horizon run id). */
  newId?: () => string;
}
const nowOf = (d: ScheduleDeps) => d.now ?? new Date();
const todayOf = (d: ScheduleDeps) => operationalNow(nowOf(d)).date;
const loader = (d: ScheduleDeps): LoadInputs => d.loadInputs ?? loadSchedulingInputs;
/** Before 0275 the revision tables are missing: inputs_unavailable (503); anything else is not the caller's to hear. */
function missingTables(e: unknown): never {
  if (isMissingTable({ message: e instanceof Error ? e.message : String(e) })) throw new ScheduleError("inputs_unavailable");
  throw e;
}
const newId = (d: ScheduleDeps) => (d.newId ?? (() => crypto.randomUUID()))();

/** A 0274 / 0275 refusal (`raise exception '<code>'`) by name; a missing function is `inputs_unavailable`; else an Error. */
export function rpcRefusal(error: { code?: string; message: string }): never {
  if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message)) throw new ScheduleError("inputs_unavailable");
  const code = error.message.trim();
  if (isScheduleErrorCode(code)) throw new ScheduleError(code);
  throw new Error(`schedule rpc: ${error.message}`);
}

async function rpc(service: SupabaseClient, call: { fn: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc(call.fn, call.args);
  if (error) rpcRefusal(error);
  return (data ?? {}) as Record<string, unknown>;
}

/**
 * The permission gate, before any I/O. A refusal that holds even if the shop let AGMs edit is final at once; only an
 * AGM asking an AGM-edit act reads the shop's `agm_access` (one row) and is judged again.
 */
export async function gate(service: SupabaseClient, actor: PeopleActor, locationId: string, act: ScheduleAct): Promise<void> {
  const best = scheduleActRefusal(actor, locationId, act, { agmAccess: "edit" });
  if (best) throw new ScheduleError(best);
  if (scheduleActRefusal(actor, locationId, act, { agmAccess: "read" }) === null) return;
  const settings = await loadScheduleShopSettings(service, locationId);
  const r = scheduleActRefusal(actor, locationId, act, { agmAccess: settings.agmAccess });
  if (r) throw new ScheduleError(r);
}

async function log(actor: PeopleActor | null, action: AuditAction, locationId: string, metadata: Record<string, unknown>): Promise<void> {
  await audit({ actorId: actor?.userId ?? null, actorRole: actor?.role ?? null, action, resourceTable: "schedule_weeks", resourceId: locationId,
    metadata: { location_id: locationId, ...metadata, ...(actor ? {} : { actor_context: "cron" }) }, ipAddress: null, userAgent: null });
}

// ─── Building a week ─────────────────────────────────────────────────────────

export interface ProblemsSplit { newErrors: number; newGaps: number; newWarnings: number; inherited: number; unresolved: number; budgetLimited: number }
function splitProblems(out: Pick<GeneratorOutput, "problems" | "gaps">): ProblemsSplit {
  const p = out.problems;
  return {
    newErrors: p.filter((x) => !x.inherited && x.severity === "error").length, newGaps: p.filter((x) => !x.inherited && x.severity === "gap").length,
    newWarnings: p.filter((x) => !x.inherited && x.severity === "warning").length, inherited: p.filter((x) => x.inherited).length,
    unresolved: out.gaps.filter((g) => g.cause === "unresolved_search").length, budgetLimited: out.gaps.filter((g) => g.cause === "budget_limited").length,
  };
}

/** DISPLAY ONLY (0275 `problems_summary`): counts per code and the first 50; the complete lists are the day and gap rows. */
export function problemsSummary(problems: readonly RuleProblem[]): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const p of problems) counts[p.code] = (counts[p.code] ?? 0) + 1;
  return { counts: Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]!])), first: problems.slice(0, 50), total: problems.length };
}

/** Build one week from the inputs (pure apart from the generator-invalid audit). */
async function build(inputs: SchedulingInputs, weekStart: string, today: string, buildDays: readonly string[] | undefined, actor: PeopleActor | null): Promise<{ out: GeneratorOutput; inputsDigest: string }> {
  const gi = generatorInputFor(inputs, weekStart, { today, buildDays });
  try {
    return { out: generateScheduleWeek(gi), inputsDigest: digest64(canonicalJson(gi)) };
  } catch (e) {
    if (e instanceof ScheduleError && e.code === "generator_invalid_output") {
      await log(actor, "schedule.generator_invalid", inputs.locationId, { week_start: weekStart, params: e.params });
    }
    throw e;
  }
}

/** The SQL day rows: structure versions as SQL stores them (the defaults sentinel → NULL). */
function sqlDays(days: readonly DayRecord[]): DayRecord[] {
  return days.map((d) => ({ ...d, structureVersionId: sqlStructureVersion(d.structureVersionId) as string }));
}

interface CommitArgs {
  actor: PeopleActor | null; locationId: string; weekStart: string; expectedHead: string | null; kind: "generated" | "regenerated" | "edited";
  structureVersionId: string; shifts: readonly Shift[]; days: readonly DayRecord[]; gaps: readonly DeclaredGap[]; context: RuleContext;
  generatorVersion: string; reasons: Readonly<Record<string, unknown>>; inputsDigest: string; problems: readonly RuleProblem[]; confirmedOverwrite?: boolean; horizonRunId?: string | null; revisionId?: string;
}
/** One revision through the 0275 writer: the context guard first (CC chunk D ruling 3), then the exact named args. */
async function commit(service: SupabaseClient, c: CommitArgs): Promise<{ revisionId: string }> {
  assertContextFits(c.context);
  const snap = toContextSnapshot(c.context);
  const call = commitRevisionCall({
    actorId: c.actor?.userId ?? null, locationId: c.locationId, weekStart: c.weekStart, expectedHead: c.expectedHead, kind: c.kind,
    structureVersionId: sqlStructureVersion(c.structureVersionId), shifts: c.shifts, days: sqlDays(c.days), gaps: c.gaps, context: snap.context, reasons: c.reasons,
    meta: {
      actorContext: c.actor ? "user" : "cron", inputsDigest: c.inputsDigest, generatorVersion: c.generatorVersion, problemsSummary: problemsSummary(c.problems), contextDigest: snap.digest,
      ...(c.confirmedOverwrite !== undefined ? { confirmedOverwrite: c.confirmedOverwrite } : {}),
      ...(c.horizonRunId !== undefined ? { horizonRunId: c.horizonRunId } : {}), ...(c.revisionId !== undefined ? { revisionId: c.revisionId } : {}),
    },
  });
  const data = await rpc(service, call);
  return { revisionId: String(data.revision_id) };
}

function headSnapshotOf(w: StoredWeek | undefined) {
  return w?.head ? { shifts: w.head.shifts, gaps: w.head.gaps, days: w.head.days } : null;
}

function diffOf(inputs: SchedulingInputs, actor: PeopleActor, w: StoredWeek | undefined, out: GeneratorOutput): WeekDiff {
  const canSeeMoney = canSeeScheduleMoney(actor, inputs.locationId);
  const wageCentsByUser = canSeeMoney ? Object.fromEntries(Object.values(out.context.people).map((p) => [p.userId, inputs.wages.byUserCents[p.userId] ?? inputs.shopSettings.estimatedHourlyCents])) : undefined;
  return diffWeeks(headSnapshotOf(w), { shifts: out.shifts, gaps: out.gaps, days: out.days }, { people: out.context.people, canSeeMoney, ...(wageCentsByUser ? { wageCentsByUser } : {}) });
}

export interface WeekResult { weekStart: string; revisionId: string; kind: "generated" | "regenerated"; problems: ProblemsSplit; gaps: number; whatChanged: WeekDiff }

/**
 * Generate a week that has no revision yet, or rebuild one (every day from today on). A week carrying manager edits is
 * rebuilt only with `confirmEdited` (the route took Tier B); otherwise `edited_week_unconfirmed`, nothing written.
 */
export async function generateWeek(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; weekStart: string; expectedHead: string | null; confirmEdited?: boolean }): Promise<WeekResult> {
  const head = args.expectedHead !== null;
  await gate(deps.service, args.actor, args.locationId, head ? "regenerate" : "generate");
  const inputs = await loader(deps)(deps.service, { locationId: args.locationId, weekStarts: [args.weekStart], now: nowOf(deps) });
  if (!inputs.shopSettings.enabled) throw new ScheduleError("shop_not_enabled");
  const w = inputs.weeks[args.weekStart];
  if ((w?.headRevisionId ?? null) !== args.expectedHead) throw new ScheduleError("head_moved");
  if (w?.edited && !args.confirmEdited) throw new ScheduleError("edited_week_unconfirmed");
  const today = todayOf(deps);
  const { out, inputsDigest } = await build(inputs, args.weekStart, today, undefined, args.actor);
  const kind = head ? "regenerated" : "generated";
  const { revisionId } = await commit(deps.service, {
    actor: args.actor, locationId: args.locationId, weekStart: args.weekStart, expectedHead: args.expectedHead, kind, structureVersionId: inputs.structure.id,
    generatorVersion: out.version, shifts: out.shifts, days: out.days, gaps: out.gaps, context: out.context, reasons: out.reasons, inputsDigest, problems: out.problems,
    ...(head ? { confirmedOverwrite: !!(w?.edited && args.confirmEdited) } : {}),
  });
  const action: AuditAction = !head ? "schedule.generate" : w?.edited ? "schedule.regenerate_overwrite" : "schedule.regenerate";
  await log(args.actor, action, args.locationId, { week_start: args.weekStart, revision_id: revisionId, based_on: args.expectedHead, inputs_digest: inputsDigest, generator_version: out.version });
  return { weekStart: args.weekStart, revisionId, kind, problems: splitProblems(out), gaps: out.gaps.length, whatChanged: diffOf(inputs, args.actor, w, out) };
}

// ─── The horizon ─────────────────────────────────────────────────────────────

export interface PreviewWeek {
  weekStart: string; buildDays: string[]; keptDays: string[]; confidence: "normal" | "further_out"; edited: boolean; headRevisionId: string | null;
  /** Each gap with its certificate as the board words it (chunk F, Task 23) — never the raw certificate. */
  whatChanged: WeekDiff; problems: ProblemsSplit; gaps: Array<Pick<DeclaredGap, "date" | "code" | "positionId" | "fromQ" | "toQ" | "cause"> & { line: NarrativeLine }>; hourlyHoursOnBudgetedDates: number;
}
export interface HorizonPreview { weeks: PreviewWeek[]; token: string }

async function previewOf(deps: ScheduleDeps, actor: PeopleActor, locationId: string, request: HorizonRequest) {
  const today = todayOf(deps);
  const plan = planHorizon(request, today);
  const inputs = await loader(deps)(deps.service, { locationId, weekStarts: plan.map((w) => w.weekStart), now: nowOf(deps) });
  if (!inputs.shopSettings.enabled) throw new ScheduleError("shop_not_enabled");
  if (inputs.demand.kind === "unavailable") throw new ScheduleError("demand_unavailable", { params: { cause: inputs.demand.cause } });
  const built: Array<{ plan: (typeof plan)[number]; out: GeneratorOutput; inputsDigest: string; week: StoredWeek | undefined }> = [];
  for (const p of plan) {
    const { out, inputsDigest } = await build(inputs, p.weekStart, today, p.buildDays, actor);
    built.push({ plan: p, out, inputsDigest, week: inputs.weeks[p.weekStart] });
  }
  const token = digest64(canonicalJson({
    v: 1, locationId, request, today, structureVersionId: inputs.structure.id, demand: inputs.demand.kind,
    weeks: built.map((b) => ({ weekStart: b.plan.weekStart, head: b.week?.headRevisionId ?? null, edited: !!b.week?.edited, inputsDigest: b.inputsDigest })),
  }));
  return { inputs, built, token, today };
}

export async function previewHorizon(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; request: HorizonRequest }): Promise<HorizonPreview> {
  await gate(deps.service, args.actor, args.locationId, "regenerate");
  const { inputs, built, token } = await previewOf(deps, args.actor, args.locationId, args.request);
  return {
    token,
    weeks: built.map((b) => ({
      weekStart: b.plan.weekStart, buildDays: b.plan.buildDays, keptDays: b.plan.keptDays, confidence: b.plan.confidence, edited: !!b.week?.edited,
      headRevisionId: b.week?.headRevisionId ?? null, whatChanged: diffOf(inputs, args.actor, b.week, b.out), problems: splitProblems(b.out),
      gaps: b.out.gaps.map((g) => ({ date: g.date, code: g.code, positionId: g.positionId, fromQ: g.fromQ, toQ: g.toQ, cause: g.cause, line: gapLine(g) })),
      hourlyHoursOnBudgetedDates: b.out.stats.budgetedDates.reduce((n, d) => n + (b.out.stats.hourlyHoursByDate[d] ?? 0), 0),
    })),
  };
}

export interface HorizonApplyResult {
  landed: Array<{ weekStart: string; revisionId: string }>;
  skipped: Array<{ weekStart: string; code: "edited_week_unconfirmed" }>;
  failed: { weekStart: string; code: ScheduleErrorCode } | null;
  horizonRunId: string;
}

/** True when any edited week of the request is among `confirmedWeekStarts` (the route asks Tier B then). */
export function overwritesConfirmedEdits(preview: HorizonPreview, confirmedWeekStarts: readonly string[]): boolean {
  return preview.weeks.some((w) => w.edited && confirmedWeekStarts.includes(w.weekStart));
}

export async function applyHorizon(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; request: HorizonRequest; token: string; confirmedWeekStarts: readonly string[] }): Promise<HorizonApplyResult> {
  await gate(deps.service, args.actor, args.locationId, "regenerate");
  const { inputs, built, token } = await previewOf(deps, args.actor, args.locationId, args.request);
  if (token !== args.token) throw new ScheduleError("preview_stale");
  const heads: Record<string, { edited: boolean }> = Object.fromEntries(built.map((b) => [b.plan.weekStart, { edited: !!b.week?.edited }]));
  const acts = horizonActions(built.map((b) => b.plan), heads, args.confirmedWeekStarts);
  const runId = newId(deps);
  const landed: HorizonApplyResult["landed"] = [];
  for (const p of acts.build) {
    const b = built.find((x) => x.plan.weekStart === p.weekStart)!;
    const expectedHead = b.week?.headRevisionId ?? null;
    try {
      const { revisionId } = await commit(deps.service, {
        actor: args.actor, locationId: args.locationId, weekStart: p.weekStart, expectedHead, kind: expectedHead ? "regenerated" : "generated",
        structureVersionId: inputs.structure.id,
        generatorVersion: b.out.version, shifts: b.out.shifts, days: b.out.days, gaps: b.out.gaps, context: b.out.context, reasons: b.out.reasons, inputsDigest: b.inputsDigest, problems: b.out.problems,
        ...(expectedHead ? { confirmedOverwrite: !!b.week?.edited && args.confirmedWeekStarts.includes(p.weekStart) } : {}), horizonRunId: runId,
      });
      landed.push({ weekStart: p.weekStart, revisionId });
      const action: AuditAction = !expectedHead ? "schedule.generate" : b.week?.edited ? "schedule.regenerate_overwrite" : "schedule.regenerate";
      await log(args.actor, action, args.locationId, { week_start: p.weekStart, revision_id: revisionId, based_on: expectedHead, horizon_run_id: runId, generator_version: b.out.version });
    } catch (e) {
      if (e instanceof ScheduleError) return { landed, skipped: acts.skipped, failed: { weekStart: p.weekStart, code: e.code }, horizonRunId: runId };
      throw e;
    }
  }
  return { landed, skipped: acts.skipped, failed: null, horizonRunId: runId };
}

// ─── Edit ────────────────────────────────────────────────────────────────────

export async function saveEdit(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; weekStart: string; expectedHead: string; op: EditOp }): Promise<{ revisionId: string; problems: RuleProblem[] }> {
  await gate(deps.service, args.actor, args.locationId, "edit");
  // Astra chunk E P3-5: the exact op union, before any read (the route already answered 400 for a malformed body).
  if (!isEditOp(args.op)) throw new ScheduleError("invalid_payload");
  const inputs = await loader(deps)(deps.service, { locationId: args.locationId, weekStarts: [args.weekStart], now: nowOf(deps) });
  if (!inputs.shopSettings.enabled) throw new ScheduleError("shop_not_enabled");
  const w = inputs.weeks[args.weekStart];
  if (!w?.head) throw new ScheduleError("week_not_found");
  if (w.headRevisionId !== args.expectedHead) throw new ScheduleError("head_moved");
  const today = todayOf(deps);
  const date = args.op.kind === "addShift" ? args.op.date : args.op.shift.date;
  if (date < today) throw new ScheduleError("day_locked", { params: { date } });
  // The CURRENT context of the edited date (the snapshot this revision stores), every other day carried.
  const editInputs = { ...inputs, weeks: { ...inputs.weeks, [args.weekStart]: { ...w, edited: false, historicalEditedDates: [] } } };
  const liveBuild = (await build(editInputs, args.weekStart, today, [date], args.actor)).out;
  const live = liveBuild.context;
  const ctx: RuleContext = { ...live, days: { [date]: { ...live.days[date]!, ...(w.head.context.days[date]?.crew ? { crew: structuredClone(w.head.context.days[date]!.crew) } : {}) } } };
  const revisionId = newId(deps);
  const r = applyEdit({ locationId: args.locationId, weekStart: args.weekStart, shifts: w.head.shifts, gaps: w.head.gaps, days: w.head.days }, args.op, ctx, { today, newRevisionId: revisionId });
  const days = r.schedule.days.map((d) => (d.date === date ? d : { ...d, inherited: true, problems: d.problems.map((p) => ({ ...p, inherited: true })) }));
  const reasons: Record<string, unknown> = {};
  for (const sh of r.schedule.shifts) {
    const k = `${sh.date}|${sh.userId}|${sh.startQ}`;
    if (w.head.reasons[k] !== undefined) reasons[k] = w.head.reasons[k];
  }
  await commit(deps.service, {
    actor: args.actor, locationId: args.locationId, weekStart: args.weekStart, expectedHead: args.expectedHead, kind: "edited", structureVersionId: inputs.structure.id,
    generatorVersion: liveBuild.version, shifts: r.schedule.shifts, days, gaps: r.schedule.gaps, context: ctx, reasons, inputsDigest: digest64(canonicalJson({ op: args.op, head: args.expectedHead })),
    problems: r.problems, revisionId,
  });
  await log(args.actor, "schedule.edit", args.locationId, { week_start: args.weekStart, revision_id: revisionId, based_on: args.expectedHead, op: args.op, problems: r.problems.length });
  return { revisionId, problems: r.problems };
}

// ─── Approve ─────────────────────────────────────────────────────────────────

/** The head's problems as the validator reports them: NEW on its built days, INHERITED on carried ones. */
export function headProblems(w: StoredWeek): RuleProblem[] {
  return (w.head?.days ?? []).flatMap((d) => d.problems.map((p) => ({ ...p, inherited: d.inherited || p.inherited })));
}

export async function approveWeek(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; weekStart: string; expectedHead: string }): Promise<{ approvalId: string | null; revisionId: string; alreadyApproved: boolean }> {
  await gate(deps.service, args.actor, args.locationId, "approve");
  const weeks = await loadWeekHeads(deps.service, args.locationId, [args.weekStart]).catch(missingTables);
  const w = weeks[args.weekStart];
  if (!w?.head) throw new ScheduleError("week_not_found");
  if (w.headRevisionId !== args.expectedHead) throw new ScheduleError("head_moved");
  const refusal = approvalRefusal({ locationId: args.locationId, weekStart: args.weekStart, shifts: w.head.shifts, gaps: w.head.gaps, days: w.head.days }, headProblems(w));
  if (refusal) throw new ScheduleError(refusal);
  const data = await rpc(deps.service, approveWeekCall({ actorId: args.actor.userId, locationId: args.locationId, weekStart: args.weekStart, expectedHead: args.expectedHead }));
  const out = { approvalId: (data.approval_id as string | null) ?? null, revisionId: String(data.revision_id), alreadyApproved: data.already_approved === true };
  if (!out.alreadyApproved) await log(args.actor, "schedule.week_approve", args.locationId, { week_start: args.weekStart, revision_id: out.revisionId, approval_id: out.approvalId });
  return out;
}

// ─── Replay (original validation) and the current-inputs advisory ────────────

/**
 * ORIGINAL validation of the head, from the revision tables ONLY: its shifts, gaps and day records against its stored
 * context. A saved revision validates identically forever (r3 P2-4, r4 P2) — `identical` proves it.
 */
export async function replayWeek(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; weekStart: string }): Promise<{ recorded: RuleProblem[]; replayed: RuleProblem[]; identical: boolean }> {
  await gate(deps.service, args.actor, args.locationId, "view");
  const w = (await loadWeekHeads(deps.service, args.locationId, [args.weekStart]).catch(missingTables))[args.weekStart];
  if (!w?.head) throw new ScheduleError("week_not_found");
  // CC addendum A: an edited head was validated as a manager's edit (the station floor warns) — replay it the same way.
  const replayed = checkScheduleRules({ locationId: args.locationId, weekStart: args.weekStart, shifts: w.head.shifts, gaps: w.head.gaps, days: w.head.days.map((d) => (d.inherited ? d : { ...d, problems: [] })) }, w.head.context, { managerEdited: w.edited });
  const recorded = headProblems(w);
  const key = (ps: RuleProblem[]) => canonicalJson([...ps].map((p) => ({ ...p, inherited: false })).sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1)));
  return { recorded, replayed, identical: key(recorded) === key(replayed) };
}

/** What changed since the head was validated (members, availability, budgets, structure, day types, demand, catering, need). */
export async function currentInputsAdvisory(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; weekStart: string }): Promise<AdvisoryItem[]> {
  await gate(deps.service, args.actor, args.locationId, "view");
  const inputs = await loader(deps)(deps.service, { locationId: args.locationId, weekStarts: [args.weekStart], now: nowOf(deps) });
  if (!inputs.weeks[args.weekStart]?.head) throw new ScheduleError("week_not_found");
  return adviseFromInputs(inputs, args.weekStart, args.actor);
}

/** The advisory for a week from inputs already loaded (the board reuses its one load): the head's built dates re-run on the live inputs. */
export async function adviseFromInputs(inputs: SchedulingInputs, weekStart: string, actor: PeopleActor): Promise<AdvisoryItem[]> {
  const w = inputs.weeks[weekStart];
  if (!w?.head) return [];
  const builtDates = Object.keys(w.head.context.days);
  const live = (await build(inputs, weekStart, w.head.context.today, builtDates, actor)).out.context;
  return contextAdvisory(w.head.context, live);
}
