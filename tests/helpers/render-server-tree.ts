/**
 * A unit-level SERIALIZER of a server component tree (nav PR 9; the PR 7 / PR 8 payload-test method). NOT browser or RSC
 * evidence: it expands the tree in-process.
 *
 * It calls every function component (awaiting async server components), renders a <Suspense> boundary's CONTENT (never
 * its fallback, so a streamed child such as the bar's bell is rendered if it is in the tree), and stops at STAND-INS:
 * components a test replaced with `standIn(name)`, whose props it records (that is what would cross to the client) and
 * whose element-valued props and children it keeps expanding. Host elements contribute their string props and text.
 */
import { Fragment, Suspense, isValidElement, type ReactElement, type ReactNode } from "react";

export interface StandInCall { readonly name: string; readonly props: Record<string, unknown> }
export interface ServerTree { readonly standIns: StandInCall[]; readonly text: string }

const STAND_IN = Symbol.for("co.test.standIn");
type StandIn = ((props: Record<string, unknown>) => null) & { [STAND_IN]: string };

/** A component that renders nothing itself; the serializer records its props and expands its element props. */
export function standIn(name: string): StandIn {
  const fn = (() => null) as unknown as StandIn;
  fn[STAND_IN] = name;
  return fn;
}

/** The props, minus element-valued ones, as JSON (what a client island would be handed). */
function printable(props: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (k !== "children" && !isValidElement(v) && typeof v !== "function") out[k] = v;
  try { return JSON.stringify(out); } catch { return ""; }
}

export async function renderServerTree(node: ReactNode | Promise<ReactNode>): Promise<ServerTree> {
  const standIns: StandInCall[] = [];
  const text: string[] = [];
  async function walk(n: unknown): Promise<void> {
    if (n === null || n === undefined || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") { text.push(String(n)); return; }
    if (n instanceof Promise) { await walk(await n); return; }
    if (Array.isArray(n)) { for (const c of n) await walk(c); return; }
    if (!isValidElement(n)) return;
    const el = n as ReactElement<Record<string, unknown>>;
    const { type, props } = el;
    if (type === Fragment || type === Suspense) { await walk(props.children); return; }
    if (typeof type === "string") {
      for (const [k, v] of Object.entries(props)) if (k !== "children" && typeof v === "string") text.push(v);
      await walk(props.children);
      return;
    }
    if (typeof type === "function") {
      const name = (type as Partial<StandIn>)[STAND_IN];
      if (name) {
        standIns.push({ name, props });
        text.push(`[${name} ${printable(props)}]`);
        for (const [k, v] of Object.entries(props)) if (k === "children" || isValidElement(v) || Array.isArray(v)) await walk(v);
        return;
      }
      await walk((type as (p: Record<string, unknown>) => unknown)(props));
      return;
    }
    // A context provider or another exotic type: its children.
    await walk(props.children);
  }
  await walk(node);
  return { standIns, text: text.join(" ") };
}
