/**
 * Extract error codes and numeric identifiers from text.
 * Matches patterns like: error 30007, HTTP 502, code:E10001, status 500
 */

const ERROR_PATTERNS = [
  /\b(?:error|err|code|status|http)\s*[:#=]?\s*(\d{3,6})\b/gi,
  /\b([45]\d{2})\b/g,                 // standalone HTTP 4xx/5xx codes
  /\bE(\d{4,6})\b/g,                  // E-prefixed codes like E10001
  /\b(\d{5,6})\b/g,                   // 5-6 digit numbers (carrier codes like 30007)
];

/** Common numbers to exclude (years, port numbers, etc.) */
const EXCLUDE = new Set([
  "80", "443", "8080", "3000", "5432", "6379", "27017",
  "2024", "2025", "2026", "2027",
  "10000", "65535",
]);

export function extractErrorCodes(text: string): string[] {
  const codes = new Set<string>();
  for (const re of ERROR_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const code = m[1];
      if (code && !EXCLUDE.has(code)) codes.add(code);
    }
  }
  return [...codes];
}
