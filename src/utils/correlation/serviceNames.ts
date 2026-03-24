/**
 * Extract service/team names from various sources for cross-matching.
 */

/** Extract service names from Datadog tags like "service:mailer" */
export function extractServiceFromTags(tags: string[]): string[] {
  const services: string[] = [];
  for (const tag of tags) {
    const m = tag.match(/^service:(.+)$/);
    if (m) services.push(m[1].toLowerCase());
  }
  return services;
}

/** Extract service names from Datadog query strings like {service:payment-api} */
export function extractServiceFromQuery(query: string): string[] {
  const services: string[] = [];
  const re = /service:([a-z0-9_-]+)/gi;
  for (const m of query.matchAll(re)) {
    services.push(m[1].toLowerCase());
  }
  return services;
}

/** Extract team/env from Datadog tags like "team:comms", "env:production" */
export function extractTeamFromTags(tags: string[]): string[] {
  const teams: string[] = [];
  for (const tag of tags) {
    const m = tag.match(/^team:(.+)$/);
    if (m) teams.push(m[1].toLowerCase());
  }
  return teams;
}

/**
 * Split a branch name into meaningful segments.
 * "sur-940-mailer-retry-fix" -> ["sur", "940", "mailer", "retry", "fix"]
 */
export function branchSegments(branch: string): string[] {
  return branch.toLowerCase().split(/[-_/]+/).filter((s) => s.length >= 2);
}

/**
 * Check if any service name appears in a set of text segments.
 */
export function serviceMatchesSegments(
  services: string[],
  segments: string[],
): boolean {
  for (const svc of services) {
    // Direct match: "mailer" in segments
    if (segments.includes(svc)) return true;
    // Partial: "payment-api" matched by segment "payment"
    const svcParts = svc.split("-");
    if (svcParts.length > 1 && svcParts.some((p) => segments.includes(p))) return true;
  }
  return false;
}

/** Check if a channel name matches any service name */
export function channelMatchesService(channel: string, services: string[]): boolean {
  const channelLower = channel.toLowerCase();
  return services.some((svc) => channelLower.includes(svc));
}
