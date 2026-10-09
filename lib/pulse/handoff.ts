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
import type { AuthContext } from "@/lib/session";
import { canAuthorHandoff, crewScoped, PULSE_V2_BASE_LEVEL } from "@/lib/pulse/scope-shared";
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

function bind(actor: AuthContext, locationId: string): void {
  if (actor.level < PULSE_V2_BASE_LEVEL) throw new HandoffError(403, "role_insufficient");
  if (!UUID.test(locationId) || !lockLocationContext({ role: actor.role, locations: actor.locations }, locationId)) {
    throw new HandoffError(403, "location_access_denied");
  }
}

interface NoteRow { id: string; author_id: string; audience: HandoffAudience; body: string; created_at: string }

export async function loadHandoffNotes(service: SupabaseClient, actor: AuthContext, args: { locationId: string; date: string }): Promise<HandoffNote[]> {
  bind(actor, args.locationId);
  const { data, error } = await service.from("pulse_handoff_notes")
    .select("id, author_id, audience, body, created_at")
    .eq("location_id", args.locationId).eq("business_date", args.date).is("superseded_at", null)
    .in("audience", audiencesFor(actor.level))
    .order("created_at", { ascending: false }).limit(50)
    .returns<NoteRow[]>();
  if (error) {
    if (isMissingTable(error)) throw new PulseNotInstalledError("pulse_handoff_notes");
    throw new Error(`handoff notes: ${error.message}`);
  }
  const notes = data ?? [];
  if (notes.length === 0) return [];
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
  const name = new Map((users ?? []).map((u) => [u.id, u.name]));
  // Crew never see who acknowledged (other people's details); they see their own notes only.
  const showPeople = !crewScoped(actor.level);
  return notes.map((n) => {
    const mine = acks.filter((a) => a.note_id === n.id);
    return {
      id: n.id, body: n.body, audience: n.audience, at: n.created_at,
      authorName: showPeople ? (name.get(n.author_id) ?? null) : null,
      acks: showPeople ? mine.map((a) => ({ name: name.get(a.user_id) ?? "—", at: a.acked_at })) : [],
      ackedByMe: mine.some((a) => a.user_id === actor.user.id),
    };
  });
}

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
  await audit({
    actorId: actor.user.id, actorRole: actor.role, action: "handoff.note_supersede", resourceTable: "pulse_handoff_notes", resourceId: args.noteId,
    metadata: { location_id: args.locationId }, ipAddress: args.ip, userAgent: args.userAgent,
  });
  return { changed: true };
}
