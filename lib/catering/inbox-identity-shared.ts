/** Literal ILIKE matching, identical to the catering contact lookup contract. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, char => `\\${char}`);
}

/** ezCater's pipeline external_ref is the provider UUID (0225), not its display
 * order number. Treat a single UUID as a candidate only; identity revalidates
 * both source and reference against the existing lead. Unknown formats stay null. */
export function inboxExternalReference(sender: string | null, subject: string, body: string): string | null {
  const domain = sender?.trim().toLowerCase().split("@")[1] ?? "";
  if (domain !== "ezcater.com" && !domain.endsWith(".ezcater.com")) return null;
  const refs = [...new Set((`${subject}\n${body}`.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) ?? []).map(ref => ref.toLowerCase()))];
  return refs.length === 1 ? refs[0]! : null;
}
