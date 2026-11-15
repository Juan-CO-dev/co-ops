/**
 * Machine-written notes block — pure. A system tributary (ezCater webhook, Toast catering scan)
 * writes its order context into `catering_pipeline.notes` inside a marked block so a later
 * refresh replaces ONLY that block and every character a human typed survives.
 */
export function machineNotesMarkers(source: string, endLabel: string = source): { begin: string; end: string } {
  return { begin: `--- ${source} (auto) ---`, end: `--- end ${endLabel} ---` };
}

/** Customer-supplied text inside the block (a Toast special request, ezCater instructions) can never spell a marker:
 *  runs of three or more dashes become an em dash (audit W11/B170). No machine block uses "---" itself. */
export function wrapMachineNotes(source: string, block: string, endLabel?: string): string {
  const m = machineNotesMarkers(source, endLabel);
  return `${m.begin}\n${block.trim().replace(/-{3,}/g, "—")}\n${m.end}`;
}

/** The marked block: both markers on whole lines (the begin at a line start, the end alone on its line), so a marker
 *  quoted mid-line inside the block (rows written before wrapMachineNotes neutralised it) never ends it early.
 *  `end` is the index where the end marker starts. */
export function findMachineBlock(cur: string, m: { begin: string; end: string }): { start: number; end: number } | null {
  let start = cur.indexOf(m.begin);
  while (start > 0 && cur[start - 1] !== "\n") start = cur.indexOf(m.begin, start + 1);
  if (start < 0) return null;
  for (let at = cur.indexOf(`\n${m.end}`, start + m.begin.length); at >= 0; at = cur.indexOf(`\n${m.end}`, at + 1)) {
    const after = at + 1 + m.end.length;
    if (after === cur.length || cur[after] === "\n" || cur[after] === "\r") return { start, end: at + 1 };
  }
  return null;
}

/** Replace this source's marked block inside existing notes (human text before/after is kept);
 *  if absent, append after the human text. Never drops a character a human wrote. */
export function mergeMachineNotes(source: string, existing: string | null | undefined, block: string, endLabel?: string): string {
  const m = machineNotesMarkers(source, endLabel);
  const wrapped = wrapMachineNotes(source, block, endLabel);
  const cur = existing ?? "";
  const found = findMachineBlock(cur, m);
  if (found) {
    const before = cur.slice(0, found.start).replace(/\s+$/, "");
    const after = cur.slice(found.end + m.end.length).replace(/^\s+/, "");
    return [before, wrapped, after].filter((s) => s.length > 0).join("\n\n");
  }
  const human = cur.trim();
  return human ? `${human}\n\n${wrapped}` : wrapped;
}
