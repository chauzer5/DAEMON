import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusStore, type FocusItem, type FocusLink } from "../stores/focusStore";
import { scoreCorrelations } from "../utils/correlation/scoringPipeline";
import type { ConfidenceTier } from "../utils/correlation/types";
import type {
  EnrichedMergeRequest,
  LinearIssue,
  SlackSection,
  DatadogMonitor,
} from "../types/models";

// ── Result type ──

export interface CorrelationResult {
  added: number;
  total: number;
  details: CorrelationDetail[];
}

export interface CorrelationDetail {
  label: string;
  tier: ConfidenceTier;
  score: number;
  reasons: string[];
  autoLinked: boolean;
}

/**
 * Returns a callback that runs the full scoring pipeline on a focus item
 * and auto-attaches high-confidence matches as links.
 *
 * - "definite" and "strong" matches are auto-linked.
 * - "probable" and "weak" matches are reported but not linked.
 */
export function useCorrelateItem() {
  const queryClient = useQueryClient();

  return useCallback(
    (item: FocusItem): CorrelationResult => {
      const addLink = useFocusStore.getState().addLink;

      // Pull all data from React Query cache
      const mrs = queryClient.getQueryData<EnrichedMergeRequest[]>(["gitlab", "mergeRequests"]);
      const issues = queryClient.getQueryData<LinearIssue[]>(["linear", "issues"]);
      const sections = queryClient.getQueryData<SlackSection[]>(["slack", "sections"]);
      const monitors = queryClient.getQueryData<DatadogMonitor[]>(["datadog", "monitors"]);

      // Run the scoring pipeline
      const matches = scoreCorrelations(item, mrs, issues, sections, monitors);

      // Build existing links set to avoid duplicates
      const existingLinks = new Set(
        item.links.map((l) => `${l.source}:${l.sourceId ?? l.slackRef?.threadTs ?? l.label}`),
      );
      const addedThisScan = new Set<string>();

      const result: CorrelationResult = { added: 0, total: matches.length, details: [] };

      for (const match of matches) {
        const linkKey = `${match.source}:${(match.linkData as Record<string, string>).sourceId ?? (match.linkData as Record<string, { threadTs: string }>).slackRef?.threadTs ?? match.label}`;
        const alreadyLinked = existingLinks.has(linkKey) || addedThisScan.has(linkKey);
        const autoLink = !alreadyLinked && (match.score.tier === "definite" || match.score.tier === "strong");

        if (autoLink) {
          addedThisScan.add(linkKey);
          addLink(item.id, match.linkData as Omit<FocusLink, "id">);
          result.added++;
        }

        // Deduplicate signal reasons for display
        const reasons = [...new Set(match.score.signals.map((s) => s.reason))];

        result.details.push({
          label: match.label,
          tier: match.score.tier,
          score: match.score.total,
          reasons,
          autoLinked: autoLink,
        });
      }

      return result;
    },
    [queryClient],
  );
}
