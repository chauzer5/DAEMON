import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusStore, type FocusItem } from "../stores/focusStore";
import { extractTicketIds, extractMRRefs } from "../utils/signals";
import type {
  EnrichedMergeRequest,
  LinearIssue,
  SlackSection,
  DatadogMonitor,
} from "../types/models";

// ── Result type ──

export interface CorrelationResult {
  added: number;
  details: string[];
}

// ── Keyword extraction ──

/** Common stop words to skip during keyword extraction */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "are",
  "this", "that", "if", "not", "out", "up", "do", "my", "we", "so",
  "can", "has", "have", "had", "get", "got", "see", "just", "about",
  "how", "what", "when", "who", "why", "all", "its", "been", "will",
  "going", "figure", "check", "look", "into", "some", "any", "able",
  "down", "they", "them", "their", "our", "new", "old",
]);

/**
 * Extract meaningful keywords from text for fuzzy matching.
 * Returns lowercased tokens of 3+ chars that aren't stop words.
 * Also extracts standalone numbers of 3+ digits (like error codes).
 */
function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/**
 * Check if a target string contains enough keywords to be a match.
 * Requires at least `threshold` keywords to match.
 */
function keywordMatch(keywords: string[], target: string, threshold: number): boolean {
  if (keywords.length === 0) return false;
  const lower = target.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) hits++;
    if (hits >= threshold) return true;
  }
  return false;
}

/**
 * Returns a callback that scans all loaded data sources for a given focus item
 * and auto-attaches any discovered links that aren't already present.
 */
export function useCorrelateItem() {
  const queryClient = useQueryClient();

  return useCallback(
    (item: FocusItem): CorrelationResult => {
      const result: CorrelationResult = { added: 0, details: [] };
      const addLink = useFocusStore.getState().addLink;

      // ── Collect structured signals from the focus item ──
      const ticketIds = new Set<string>();
      const mrIids = new Set<string>();

      // From title
      for (const id of extractTicketIds(item.title)) ticketIds.add(id);
      for (const iid of extractMRRefs(item.title)) mrIids.add(iid);

      // From notes
      for (const note of item.notes) {
        for (const id of extractTicketIds(note.text)) ticketIds.add(id);
        for (const iid of extractMRRefs(note.text)) mrIids.add(iid);
      }

      // From existing links
      for (const link of item.links) {
        if (link.source === "linear" && link.sourceId) ticketIds.add(link.sourceId.toUpperCase());
        if (link.source === "gitlab" && link.sourceId) mrIids.add(link.sourceId);
      }

      const hasStructuredSignals = ticketIds.size > 0 || mrIids.size > 0;

      // ── Extract keywords for fuzzy matching (always, as a supplement) ──
      const allText = [item.title, ...item.notes.map((n) => n.text), ...item.links.map((l) => l.label)].join(" ");
      const keywords = extractKeywords(allText);
      // Require at least 2 keyword hits for fuzzy matches (avoids false positives)
      const fuzzyThreshold = Math.min(2, Math.max(1, Math.ceil(keywords.length * 0.3)));

      // Helper to check if a link is already attached
      const existingLinks = new Set(
        item.links.map((l) => `${l.source}:${l.sourceId ?? l.slackRef?.threadTs ?? l.label}`),
      );
      const isAlreadyLinked = (source: string, id: string) => existingLinks.has(`${source}:${id}`);
      // Track what we add this scan to avoid duplicates within the same run
      const addedThisScan = new Set<string>();
      const tryAdd = (source: string, id: string, linkData: Parameters<typeof addLink>[1]) => {
        const key = `${source}:${id}`;
        if (isAlreadyLinked(source, id) || addedThisScan.has(key)) return;
        addedThisScan.add(key);
        addLink(item.id, linkData);
        result.added++;
      };

      // ── Scan GitLab MRs ──
      const mrs = queryClient.getQueryData<EnrichedMergeRequest[]>(["gitlab", "mergeRequests"]);
      if (mrs) {
        for (const mr of mrs) {
          const mrIid = String(mr.iid);
          // Direct MR ref match
          if (mrIids.has(mrIid)) {
            tryAdd("gitlab", mrIid, {
              source: "gitlab",
              label: `!${mr.iid}: ${mr.title}`,
              subtitle: `${mr.author} · ${mr.target_branch}`,
              navigateTo: "gitlab",
              sourceId: mrIid,
              url: mr.web_url,
              sourceBranch: mr.source_branch,
            });
            result.details.push(`MR !${mr.iid}`);
            continue;
          }
          // Check if MR branch or title references any of our ticket IDs
          const branchMatch = mr.source_branch.match(/^([A-Za-z]+-\d+)/);
          const branchTicket = branchMatch ? branchMatch[1].toUpperCase() : null;
          const titleTickets = extractTicketIds(mr.title);

          const structuredMatch = hasStructuredSignals && (
            (branchTicket && ticketIds.has(branchTicket))
            || titleTickets.some((t) => ticketIds.has(t))
          );

          // Keyword fallback: match against MR title + branch
          const fuzzyMatch = !structuredMatch
            && keywords.length > 0
            && keywordMatch(keywords, `${mr.title} ${mr.source_branch}`, fuzzyThreshold);

          if (structuredMatch || fuzzyMatch) {
            tryAdd("gitlab", mrIid, {
              source: "gitlab",
              label: `!${mr.iid}: ${mr.title}`,
              subtitle: `${mr.author} · ${mr.target_branch}`,
              navigateTo: "gitlab",
              sourceId: mrIid,
              url: mr.web_url,
              sourceBranch: mr.source_branch,
            });
            result.details.push(`MR !${mr.iid}`);
          }
        }
      }

      // ── Scan Linear Issues ──
      const issues = queryClient.getQueryData<LinearIssue[]>(["linear", "issues"]);
      if (issues) {
        for (const issue of issues) {
          const structuredMatch = ticketIds.has(issue.identifier);

          // Keyword fallback: match against issue title
          const fuzzyMatch = !structuredMatch
            && keywords.length > 0
            && keywordMatch(keywords, issue.title, fuzzyThreshold);

          if (structuredMatch || fuzzyMatch) {
            tryAdd("linear", issue.identifier, {
              source: "linear",
              label: `${issue.identifier}: ${issue.title}`,
              subtitle: `${issue.status} · ${issue.team_key}`,
              navigateTo: "linear",
              sourceId: issue.identifier,
              url: issue.url,
            });
            result.details.push(issue.identifier);
          }
        }
      }

      // ── Scan Slack Messages ──
      const sections = queryClient.getQueryData<SlackSection[]>(["slack", "sections"]);
      if (sections) {
        for (const section of sections) {
          for (const msg of section.messages) {
            const msgTickets = extractTicketIds(msg.message);
            const msgMRs = extractMRRefs(msg.message);

            const structuredMatch = hasStructuredSignals && (
              msgTickets.some((t) => ticketIds.has(t))
              || msgMRs.some((iid) => mrIids.has(iid))
            );

            // Keyword fallback: match against message text
            const fuzzyMatch = !structuredMatch
              && keywords.length > 0
              && keywordMatch(keywords, msg.message, fuzzyThreshold);

            if (structuredMatch || fuzzyMatch) {
              const slackKey = msg.raw_ts;
              tryAdd("slack", slackKey, {
                source: "slack",
                label: `${msg.sender} in #${msg.channel}`,
                subtitle: msg.message.slice(0, 80),
                navigateTo: "slack",
                url: msg.permalink,
                slackRef: { channelId: msg.channel_id, threadTs: msg.raw_ts },
              });
              if (!isAlreadyLinked("slack", slackKey)) {
                result.details.push(`#${msg.channel}`);
              }
            }
          }
        }
      }

      // ── Scan Datadog Monitors ──
      const monitors = queryClient.getQueryData<DatadogMonitor[]>(["datadog", "monitors"]);
      if (monitors) {
        for (const monitor of monitors) {
          const monitorTickets = extractTicketIds(monitor.name);
          const structuredMatch = hasStructuredSignals
            && monitorTickets.some((t) => ticketIds.has(t));

          // Keyword fallback: match against monitor name + message + tags
          const fuzzyMatch = !structuredMatch
            && keywords.length > 0
            && keywordMatch(
              keywords,
              `${monitor.name} ${monitor.message} ${monitor.tags.join(" ")}`,
              fuzzyThreshold,
            );

          if (structuredMatch || fuzzyMatch) {
            const monId = String(monitor.id);
            tryAdd("datadog", monId, {
              source: "datadog",
              label: monitor.name,
              subtitle: `${monitor.status} · ${monitor.monitor_type}`,
              navigateTo: "hub",
              sourceId: monId,
            });
            result.details.push(`Monitor: ${monitor.name.slice(0, 40)}`);
          }
        }
      }

      return result;
    },
    [queryClient],
  );
}
