import io, json

def rw(path):
    return io.open(path, encoding='utf-8', newline='').read()
def wr(path, s):
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
def sub(s, old, new, path, count=1):
    assert old in s, 'NOT FOUND in %s: %r' % (path, old[:70])
    return s.replace(old, new, count)

# ── lib/catering/pipeline.ts ──────────────────────────────────────────────────
p = 'lib/catering/pipeline.ts'
s = rw(p)
s = sub(s, 'import { getRoleLevel } from "@/lib/roles";',
        'import { getRoleLevel, type RoleCode } from "@/lib/roles";', p)
s = sub(s, 'import { PIPELINE_STAGES, type PipelineStage } from "./pipeline-shared";',
        'import { PIPELINE_STAGES, type PipelineStage } from "./pipeline-shared";\nimport { isLeadSource } from "./intake-shared";', p)
# DbLeadRow + LEAD_COLS + mapLead + PipelineLead
s = sub(s, '  estimated_revenue_cents: number | null;\n  created_by: string | null;',
        '  estimated_revenue_cents: number | null;\n  assigned_to: string | null;\n  created_by: string | null;', p)
s = sub(s, 'estimated_revenue_cents, created_by, created_at, updated_at',
        'estimated_revenue_cents, assigned_to, created_by, created_at, updated_at', p)
s = sub(s, '    estimatedRevenueCents: r.estimated_revenue_cents,\n    createdBy: r.created_by,',
        '    estimatedRevenueCents: r.estimated_revenue_cents,\n    assignedTo: r.assigned_to,\n    createdBy: r.created_by,', p)
s = sub(s, '  estimatedRevenueCents: number | null;\n  createdBy: string | null;',
        '  estimatedRevenueCents: number | null;\n  /** The "order lead" — the client-facing owner of this order (spec #2b). */\n  assignedTo: string | null;\n  createdBy: string | null;', p)
# validation helpers (after the error class — anchor on requireLevel helper end)
anchor = 'function requireLevel(actor: AuthContext, min: number): void {'
i = s.find(anchor)
assert i >= 0, 'requireLevel anchor'
j = s.find('}\n', i)
helpers = '''
/** New lead_source writes must come from the intake registry (legacy free text stays readable). */
function validateLeadSource(v: string | null | undefined): void {
  if (v != null && !isLeadSource(v)) {
    throw new CateringPipelineError(400, "invalid_source", "Unknown lead source");
  }
}

/** The "order lead" must be an active staff member (level >= 3). */
async function requireAssignable(userId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("users").select("id, role, active")
    .eq("id", userId).maybeSingle<{ id: string; role: RoleCode; active: boolean }>();
  if (error) throw new Error(`pipeline assignable check: ${error.message}`);
  if (!data || !data.active || getRoleLevel(data.role) < 3) {
    throw new CateringPipelineError(400, "invalid_assignee", "Assignee must be an active staff member");
  }
}
'''
s = s[:j+2] + helpers + s[j+2:]
# input types (create at ~319, edit at ~461): add assignedTo after both leadSource lines
s = s.replace('  leadSource?: string | null;', '  leadSource?: string | null;\n  assignedTo?: string | null;', 2)
# createLead: validation + insert column
s = sub(s, '''  if (!input.contactName || input.contactName.trim().length === 0) {
    throw new CateringPipelineError(400, "invalid_payload", "contactName is required");
  }
  const sb = getServiceRoleClient();''',
'''  if (!input.contactName || input.contactName.trim().length === 0) {
    throw new CateringPipelineError(400, "invalid_payload", "contactName is required");
  }
  validateLeadSource(input.leadSource);
  if (input.assignedTo != null) await requireAssignable(input.assignedTo);
  const sb = getServiceRoleClient();''', p)
s = sub(s, '      estimated_revenue_cents: input.estimatedRevenueCents ?? null,\n      created_by: actor.user.id,',
        '      estimated_revenue_cents: input.estimatedRevenueCents ?? null,\n      assigned_to: input.assignedTo ?? null,\n      created_by: actor.user.id,', p)
# editLead: patch field + validation + before-read + audit metadata
s = sub(s, '  if (input.leadSource !== undefined) patch.lead_source = input.leadSource;',
'''  if (input.leadSource !== undefined) {
    validateLeadSource(input.leadSource);
    patch.lead_source = input.leadSource;
  }
  if (input.assignedTo !== undefined) {
    if (input.assignedTo != null) await requireAssignable(input.assignedTo);
    patch.assigned_to = input.assignedTo;
  }''', p)
s = sub(s, '''  const { error: uErr, count } = await sb
    .from("catering_pipeline")
    .update(patch, { count: "exact" })
    .eq("id", id);
  if (uErr) throw new Error(`editLead update: ${uErr.message}`);
  if (count === 0) throw new CateringPipelineError(404, "not_found", "Lead not found");

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.pipeline.edit",
    resourceTable: "catering_pipeline",
    resourceId: id,
    metadata: { fields: Object.keys(patch).filter((k) => k !== "updated_at") },
    ipAddress: null,
    userAgent: null,
  });''',
'''  // Pre-read the current order lead: the attribution norm (spec #2b) is that
  // ONLY the assignee should edit — others may, but the audit row says so.
  const { data: beforeRow, error: bErr } = await sb
    .from("catering_pipeline").select("assigned_to")
    .eq("id", id).maybeSingle<{ assigned_to: string | null }>();
  if (bErr) throw new Error(`editLead pre-read: ${bErr.message}`);
  if (!beforeRow) throw new CateringPipelineError(404, "not_found", "Lead not found");

  const { error: uErr, count } = await sb
    .from("catering_pipeline")
    .update(patch, { count: "exact" })
    .eq("id", id);
  if (uErr) throw new Error(`editLead update: ${uErr.message}`);
  if (count === 0) throw new CateringPipelineError(404, "not_found", "Lead not found");

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.pipeline.edit",
    resourceTable: "catering_pipeline",
    resourceId: id,
    metadata: {
      fields: Object.keys(patch).filter((k) => k !== "updated_at"),
      ...(beforeRow.assigned_to != null && beforeRow.assigned_to !== actor.user.id
        ? { non_assignee_edit: true, order_lead: beforeRow.assigned_to }
        : {}),
      ...("assigned_to" in patch && patch.assigned_to !== beforeRow.assigned_to
        ? { assigned_to_changed: true, assigned_from: beforeRow.assigned_to, assigned_to: patch.assigned_to }
        : {}),
    },
    ipAddress: null,
    userAgent: null,
  });''', p)
# loadAssignableStaff at end of file
s = s.rstrip() + '''

// ── Assignable staff (spec #2b) ───────────────────────────────────────────────

export interface AssignableStaff { id: string; name: string }

/** Active staff (level >= 3) assignable as an order lead; also powers name display. */
export async function loadAssignableStaff(actor: AuthContext): Promise<AssignableStaff[]> {
  requireLevel(actor, PIPELINE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("users").select("id, name, role, active")
    .eq("active", true).order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; role: RoleCode; active: boolean }>>();
  if (error) throw new Error(`loadAssignableStaff: ${error.message}`);
  return (data ?? []).filter((u) => getRoleLevel(u.role) >= 3).map((u) => ({ id: u.id, name: u.name }));
}
'''
wr(p, s)
print('pipeline.ts ok')

# ── create route: assignedTo passthrough ─────────────────────────────────────
p = 'app/api/catering/pipeline/route.ts'
s = rw(p)
s = sub(s, '  const leadSource = optStr(b.leadSource);',
        '  const leadSource = optStr(b.leadSource);\n  const assignedTo = optStr(b.assignedTo);', p)
s = sub(s, 'company, eventDate, headcount, leadSource, locationId, notes, followUpDate, customerId, estimatedRevenueCents,',
        'company, eventDate, headcount, leadSource, locationId, notes, followUpDate, customerId, estimatedRevenueCents, assignedTo,', p)
s = sub(s, '    leadSource: leadSource ?? null,',
        '    leadSource: leadSource ?? null,\n    assignedTo: assignedTo ?? null,', p)
wr(p, s)
print('create route ok')

# ── edit route: whitelist + branch ───────────────────────────────────────────
p = 'app/api/catering/pipeline/[id]/route.ts'
s = rw(p)
s = sub(s, '  "leadSource",', '  "leadSource",\n  "assignedTo",', p)
old = '''    if ("leadSource" in b) {
      const v = optStr(b.leadSource);
      if (v === undefined) return jsonError(400, "invalid_payload", { field: "leadSource" });'''
i = s.find(old)
assert i >= 0, 'leadSource branch'
# insert an assignedTo branch BEFORE the leadSource branch (same shape, allows null)
branch = '''    if ("assignedTo" in b) {
      const v = b.assignedTo;
      if (v !== null && typeof v !== "string") return jsonError(400, "invalid_payload", { field: "assignedTo" });
      patchInput.assignedTo = v as string | null;
    }
'''
s = s[:i] + branch + s[i:]
wr(p, s)
print('edit route ok')
PYEOF_MARKER_UNUSED = None
