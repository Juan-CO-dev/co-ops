/**
 * Mid-shift Pulse v2 — AM→PM handoff notes (0240). SERVER-ONLY.
 *
 * Gates live HERE, before any I/O: reading is every pulse viewer's right but the AUDIENCE filter is
 * applied server-side (crew only ever receive 'crew' / 'all' notes); authoring, superseding and the
 * "Got it" acknowledgement are AGM+ (HANDOFF_AUTHOR_LEVEL); every write is location-bound and
 * audited. While 0240 is unapplied every read throws PulseNotInstalledError so the section renders
 * its explicit "not installed" state instead of a fake empty list.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { lockLocationContext } from "@/lib/locations";
import { getRoleLevel, isRoleCode } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { canAuthorHandoff, canReadPulseLocation, crewScoped, PULSE_V2_BASE_LEVEL } from "@/lib/pulse/scope-shared";
import { invalidateSource } from "@/lib/pulse/source-cache";
import type { HandoffAudience, HandoffNote } from "@/lib/pulse/types";

export class PulseNotInstalledError extends Error {
  constructor(public table: string) { super(`not_installed:${table}`); this.name = "PulseNotInstalledError"; }
}
export class HandoffError extends Error {
  constructor(public status: number, public code: string) { super(code); this.name = "HandoffError"; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HANDOFF_AUDIENCES: readonly HandoffAudience[] = ["crew", "managers", "all"];
export function isHandoffAudience(v: unknown): v is HandoffAudience {
  return typeof v === "string" && (HANDOFF_AUDIENCES as readonly string[]).includes(v);
}

/** PostgREST / Postgres "that table does not exist yet" — the unapplied-migration signal. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(error.message ?? "");
}

/** Which audiences a viewer may read. Crew: notes addressed to crew or everyone. */
export function audiencesFor(level: number): HandoffAudience[] {
  return crewScoped(level) ? ["crew", "all"] : ["crew", "managers", "all"];
}

/** READ bind: the pulse read grant (8+ any shop — Astra #5), else membership. */
function bindRead(actor: AuthContext, locationId: string): void {
  if (actor.level < PULSE_V2_BASE_LEVEL) throw new HandoffError(403, "role_insufficient");
  if (!UUID.test(locationId) || !canReadPulseLocation({ role: actor.role, locations: actor.locations, level: actor.level }, locationId)) {
    throw new HandoffError(403, "location_access_denied");
  }
}
/** WRITE bind: the operational grant, unchanged (9+ all-locations, else membership). */
function bind(actor: AuthContext, locationId: string): void {
  if (actor.level < PULSE_V2_BASE_LEVEL) throw new HandoffError(403, "role_insufficient");
  if (!UUID.test(locationId) || !lockLocationContext({ role: actor.role, locations: actor.locations }, locationId)) {
    throw new HandoffError(403, "location_access_denied");
  }
}

interface NoteRow { id: string; author_id: string; audience: HandoffAudience; body: string; created_at: string }

/** The shop's live notes for the day, every audience, with acks and names — the CACHEABLE unit (one per shop per poll). */
export interface HandoffRaw {
  notes: NoteRow[];
  acks: Array<{ note_id: string; user_id: string; acked_at: string }>;
  names: Record<string, string>;
}

/** Service-role read, no viewer in it: the caller (the section loader) has already scoped the request. */
export async function loadHandoffRaw(service: SupabaseClient, args: { locationId: string; date: string }): Promise<HandoffRaw> {
  const { data, error } = await service.from("pulse_handoff_notes")
    .select("id, author_id, audience, body, created_at")
    .eq("location_id", args.locationId).eq("business_date", args.date).is("superseded_at", null)
    .order("created_at", { ascending: false }).limit(50)
    .returns<NoteRow[]>();
  if (error) {
    if (isMissingTable(error)) throw new PulseNotInstalledError("pulse_handoff_notes");
    throw new Error(`handoff notes: ${error.message}`);
  }
  const notes = data ?? [];
  if (notes.length === 0) return { notes: [], acks: [], names: {} };
  const { data: ackRows, error: ackErr } = await service.from("pulse_handoff_acks")
    .select("note_id, user_id, acked_at").in("note_id", notes.map((n) => n.id))
    .returns<Array<{ note_id: string; user_id: string; acked_at: string }>>();
  if (ackErr) {
    if (isMissingTable(ackErr)) throw new PulseNotInstalledError("pulse_handoff_acks");
    throw new Error(`handoff acks: ${ackErr.message}`);
  }
  const acks = ackRows ?? [];
  const userIds = [...new Set([...notes.map((n) => n.author_id), ...acks.map((a) => a.user_id)])];
  const { data: users, error: uErr } = await service.from("users").select("id, name").in("id", userIds).returns<Array<{ id: string; name: string }>>();
  if (uErr) throw new Error(`handoff users: ${uErr.message}`);
  const names: Record<string, string> = {};
  for (const u of users ?? []) names[u.id] = u.name;
  return { notes, acks, names };
}

/** PURE projection for one viewer: audience filter, crew stripping (no author/ack names), ackedByMe. */
export function projectHandoffNotes(raw: HandoffRaw, viewer: { userId: string; level: number }): HandoffNote[] {
  const audiences = audiencesFor(viewer.level);
  const showPeople = !crewScoped(viewer.level);
  return raw.notes.filter((n) => audiences.includes(n.audience)).map((n) => {
    const mine = raw.acks.filter((a) => a.note_id === n.id);
    return {
      id: n.id, body: n.body, audience: n.audience, at: n.created_at,
      authorName: showPeople ? (raw.names[n.author_id] ?? null) : null,
      acks: showPeople ? mine.map((a) => ({ name: raw.names[a.user_id] ?? "—", at: a.acked_at })) : [],
      ackedByMe: mine.some((a) => a.user_id === viewer.userId),
    };
  });
}

export async function loadHandoffNotes(service: SupabaseClient, actor: AuthContext, args: { locationId: string; date: string }): Promise<HandoffNote[]> {
  bindRead(actor, args.locationId);
  return projectHandoffNotes(await loadHandoffRaw(service, args), { userId: actor.user.id, level: actor.level });
}

/** Writers call this so the next poll re-reads the shop's notes instead of serving the cached set. */
function invalidateHandoff(locationId: string): void { invalidateSource(`handoff|${locationId}|`); }

export async function createHandoffNote(service: SupabaseClient, actor: AuthContext, args: {
  locationId: string; date: string; audience: HandoffAudience; body: string; ip: string | null; userAgent: string | null;
}): Promise<{ id: string }> {
  bind(actor, args.locationId);
  if (!canAuthorHandoff(actor.level)) throw new HandoffError(403, "role_insufficient");
  const body = args.body.trim();
  if (!isHandoffAudience(args.audience) || body.length === 0 || body.length > 1000) throw new HandoffError(400, "invalid_payload");
  const { data, error } = await service.from("pulse_handoff_notes")
    .insert({ location_id: args.locationId, business_date: args.date, author_id: actor.user.id, audience: args.audience, body })
    .select("id").single<{ id: string }>();
  if (error || !data) {
    if (isMissingTable(error)) throw new PulseNotInstalledError("pulse_handoff_notes");
    throw new Error(`handoff create: ${error?.message ?? "no row"}`);
  }
  invalidateHandoff(args.locationId);
  await audit({
    actorId: actor.user.id, actorRole: actor.role, action: "handoff.note_create", resourceTable: "pulse_handoff_notes", resourceId: data.id,
    metadata: { location_id: args.locationId, business_date: args.date, audience: args.audience, length: body.length },
    ipAddress: args.ip, userAgent: args.userAgent,
  });
  return { id: data.id };
}

export async function ackHandoffNote(service: SupabaseClient, actor: AuthContext, args: {
  locationId: string; noteId: string; ip: string | null; userAgent: string | null;
}): Promise<{ changed: boolean }> {
  bind(actor, args.locationId);
  if (!canAuthorHandoff(actor.level)) throw new HandoffError(403, "role_insufficient");
  if (!UUID.test(args.noteId)) throw new HandoffError(400, "invalid_payload");
  // IDOR: the note must belong to the bound shop.
  const { data: note, error: nErr } = await service.from("pulse_handoff_notes").select("id").eq("id", args.noteId)
    .eq("location_id", args.locationId).is("superseded_at", null).maybeSingle<{ id: string }>();
  if (nErr) {
    if (isMissingTable(nErr)) throw new PulseNotInstalledError("pulse_handoff_notes");
    throw new Error(`handoff ack lookup: ${nErr.message}`);
  }
  if (!note) throw new HandoffError(404, "not_found");
  const { error } = await service.from("pulse_handoff_acks").insert({ note_id: args.noteId, user_id: actor.user.id });
  if (error) {
    if (error.code === "23505") return { changed: false };
    if (isMissingTable(error)) throw new PulseNotInstalledError("pulse_handoff_acks");
    throw new Error(`handoff ack: ${error.message}`);
  }
  invalidateHandoff(args.locationId);
  await audit({
    actorId: actor.user.id, actorRole: actor.role, action: "handoff.note_ack", resourceTable: "pulse_handoff_acks", resourceId: args.noteId,
    metadata: { location_id: args.locationId }, ipAddress: args.ip, userAgent: args.userAgent,
  });
  return { changed: true };
}

export async function supersedeHandoffNote(service: SupabaseClient, actor: AuthContext, args: {
  locationId: string; noteId: string; ip: string | null; userAgent: string | null;
}): Promise<{ changed: boolean }> {
  bind(actor, args.locationId);
  if (!canAuthorHandoff(actor.level)) throw new HandoffError(403, "role_insufficient");
  if (!UUID.test(args.noteId)) throw new HandoffError(400, "invalid_payload");
  // Astra #6: only the AUTHOR or a HIGHER level may retract (0240's trigger enforces the same rule in SQL).
  const { data: note, error: nErr } = await service.from("pulse_handoff_notes").select("id, author_id").eq("id", args.noteId)
    .eq("location_id", args.locationId).is("superseded_at", null).maybeSingle<{ id: string; author_id: string }>();
  if (nErr) {
    if (isMissingTable(nErr)) throw new PulseNotInstalledError("pulse_handoff_notes");
    throw new Error(`handoff supersede lookup: ${nErr.message}`);
  }
  if (!note) throw new HandoffError(404, "not_found");
  if (note.author_id !== actor.user.id) {
    const { data: author, error: aErr } = await service.from("users").select("role").eq("id", note.author_id).maybeSingle<{ role: string }>();
    if (aErr) throw new Error(`handoff supersede author: ${aErr.message}`);
    // An unknown author level refuses (never a silent grant).
    const authorLevel = author && isRoleCode(author.role) ? getRoleLevel(author.role) : Number.POSITIVE_INFINITY;
    if (!(actor.level > authorLevel)) throw new HandoffError(403, "not_author_or_higher");
  }
  const { data, error } = await service.from("pulse_handoff_notes")
    .update({ superseded_at: new Date().toISOString(), superseded_by: actor.user.id })
    .eq("id", args.noteId).eq("location_id", args.locationId).is("superseded_at", null)
    .select("id").returns<Array<{ id: string }>>();
  if (error) {
    if (isMissingTable(error)) throw new PulseNotInstalledError("pulse_handoff_notes");
    throw new Error(`handoff supersede: ${error.message}`);
  }
  // UPDATE denials are silent: a zero rowcount is an explicit 404, never a success.
  if ((data ?? []).length === 0) throw new HandoffError(404, "not_found");
  invalidateHandoff(args.locationId);
  await audit({
    actorId: actor.user.id, actorRole: actor.role, action: "handoff.note_supersede", resourceTable: "pulse_handoff_notes", resourceId: args.noteId,
    metadata: { location_id: args.locationId }, ipAddress: args.ip, userAgent: args.userAgent,
  });
  return { changed: true };
}
