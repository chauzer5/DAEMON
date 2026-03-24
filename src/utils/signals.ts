/** Matches ticket IDs like SUR-940, ENG-512, PRD-123 (case-insensitive) */
export const TICKET_ID_RE = /\b([A-Z]{2,6}-\d{1,6})\b/gi;

/** Matches MR references like !142, !4521 */
export const MR_REF_RE = /!(\d+)\b/g;

/** Extract all ticket IDs from text, normalized to uppercase */
export function extractTicketIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(TICKET_ID_RE)) ids.add(m[1].toUpperCase());
  return [...ids];
}

/** Extract all MR IID references from text */
export function extractMRRefs(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(MR_REF_RE)) ids.add(m[1]);
  return [...ids];
}
