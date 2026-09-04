/**
 * Machine-written notes block — pure. A system tributary (ezCater webhook, Toast catering scan)
 * writes its order context into `catering_pipeline.notes` inside a marked block so a later
 * refresh replaces ONLY that block and every character a human typed survives.
 */
export function machineNotesMarkers(source: string, endLabel: string = source): { begin: string; end: string } {
  return { begin: `--- ${source} (auto) ---`, end: `--- end ${endLabel} ---` };
}

export function wrapMachineNotes(source: string, block: string, endLabel?: string): string {
  const m = machineNotesMarkers(source, endLabel);
  return `${m.begin}\n${block.trim()}\n${m.end}`;
}

/** Replace this source's marked block inside existing notes (human text before/after is kept);
 *  if absent, append after the human text. Never drops a character a human wrote. */
export function mergeMachineNotes(source: string, existing: string | null | undefined, block: string, endLabel?: string): string {
  const m = machineNotesMarkers(source, endLabel);
  const wrapped = wrapMachineNotes(source, block, endLabel);
  const cur = existing ?? "";
  const start = cur.indexOf(m.begin);
  const end = start >= 0 ? cur.indexOf(m.end, start + m.begin.length) : -1;
  if (start >= 0 && end > start) {
    const before = cur.slice(0, start).replace(/\s+$/, "");
    const after = cur.slice(end + m.end.length).replace(/^\s+/, "");
    return [before, wrapped, after].filter((s) => s.length > 0).join("\n\n");
  }
  const human = cur.trim();
  return human ? `${human}\n\n${wrapped}` : wrapped;
}
