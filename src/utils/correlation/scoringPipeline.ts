/**
 * Unified scoring pipeline: runs all signal extractors and produces
 * scored correlations for a single focus item against all data sources.
 */

import type { FocusItem } from "../../stores/focusStore";
import type {
  EnrichedMergeRequest,
  LinearIssue,
  SlackSection,
  DatadogMonitor,
} from "../../types/models";
import {
  type ScoredSignal,
  type CorrelationScore,
  SIGNAL_WEIGHTS,
  scoreTier,
} from "./types";
import { extractTicketIds, extractMRRefs } from "../signals";
import { extractErrorCodes } from "./errorCodes";
import {
  extractServiceFromTags,
  extractServiceFromQuery,
  extractTeamFromTags,
  branchSegments,
  serviceMatchesSegments,
  channelMatchesService,
} from "./serviceNames";
import { buildCorpus, cosineSimilarity } from "./tfidf";

// ── Types ──

export interface ScoredMatch {
  entityId: string;
  source: "gitlab" | "linear" | "slack" | "datadog";
  label: string;
  subtitle?: string;
  score: CorrelationScore;
  /** Data needed to create a FocusLink if the user accepts */
  linkData: Record<string, unknown>;
}

// ── Pipeline ──

export function scoreCorrelations(
  item: FocusItem,
  mrs: EnrichedMergeRequest[] | undefined,
  issues: LinearIssue[] | undefined,
  sections: SlackSection[] | undefined,
  monitors: DatadogMonitor[] | undefined,
): ScoredMatch[] {
  const focusId = `focus:${item.id}`;

  // ── 1. Collect all structured IDs from the focus item ──
  const ticketIds = new Set<string>();
  const mrIids = new Set<string>();
  const allFocusText = [item.title, ...item.notes.map((n) => n.text), ...item.links.map((l) => l.label)].join(" ");

  for (const id of extractTicketIds(item.title)) ticketIds.add(id);
  for (const iid of extractMRRefs(item.title)) mrIids.add(iid);
  for (const note of item.notes) {
    for (const id of extractTicketIds(note.text)) ticketIds.add(id);
    for (const iid of extractMRRefs(note.text)) mrIids.add(iid);
  }
  for (const link of item.links) {
    if (link.source === "linear" && link.sourceId) ticketIds.add(link.sourceId.toUpperCase());
    if (link.source === "gitlab" && link.sourceId) mrIids.add(link.sourceId);
  }

  // ── 2. Extract error codes from focus item ──
  const focusErrorCodes = new Set(extractErrorCodes(allFocusText));

  // ── 3. Collect person names from focus item context ──
  const focusPersons = new Set<string>();
  for (const link of item.links) {
    if (link.subtitle) {
      // Subtitles often contain author names like "AJ · main"
      const parts = link.subtitle.split(/\s*·\s*/);
      if (parts[0]) focusPersons.add(parts[0].trim().toLowerCase());
    }
  }

  // ── 4. Collect service names from linked monitors ──
  const focusServices = new Set<string>();

  // ── 5. Build TF-IDF corpus ──
  const tfidfDocs = new Map<string, string>();
  tfidfDocs.set(focusId, allFocusText);

  // ── 6. Score GitLab MRs ──
  const matchMap = new Map<string, { signals: ScoredSignal[]; label: string; subtitle: string; source: "gitlab" | "linear" | "slack" | "datadog"; linkData: Record<string, unknown> }>();

  if (mrs) {
    for (const mr of mrs) {
      const entityId = `gitlab:${mr.iid}`;
      const mrSignals: ScoredSignal[] = [];
      const mrIid = String(mr.iid);

      // Structured: direct MR ref
      if (mrIids.has(mrIid)) {
        mrSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.mr_ref_match, reason: "mr_ref_match" });
      }

      // Structured: branch contains ticket ID
      const brMatch = mr.source_branch.match(/^([A-Za-z]+-\d+)/);
      const brTicket = brMatch ? brMatch[1].toUpperCase() : null;
      if (brTicket && ticketIds.has(brTicket)) {
        mrSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.branch_ticket, reason: "branch_ticket" });
      }

      // Structured: title contains ticket ID
      for (const tid of extractTicketIds(mr.title)) {
        if (ticketIds.has(tid)) {
          mrSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.ticket_id_match, reason: "ticket_id_match" });
          break;
        }
      }

      // Error codes
      const mrErrors = extractErrorCodes(`${mr.title} ${mr.source_branch}`);
      for (const code of mrErrors) {
        if (focusErrorCodes.has(code)) {
          mrSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.error_code_match, reason: "error_code_match" });
          break;
        }
      }

      // Person overlap
      const mrAuthor = mr.author.toLowerCase();
      if (focusPersons.has(mrAuthor)) {
        mrSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.person_overlap, reason: "person_overlap" });
      }

      // Temporal proximity (within 6 hours)
      const mrTime = new Date(mr.updated_at).getTime();
      const focusTime = new Date(item.createdAt).getTime();
      const gapHours = Math.abs(mrTime - focusTime) / 3_600_000;
      if (gapHours < 12 && mrSignals.length > 0) {
        const tempScore = SIGNAL_WEIGHTS.temporal_proximity * Math.exp(-gapHours / 4);
        if (tempScore > 0.01) {
          mrSignals.push({ a: focusId, b: entityId, score: tempScore, reason: "temporal_proximity" });
        }
      }

      // Add to TF-IDF corpus
      tfidfDocs.set(entityId, `${mr.title} ${mr.source_branch.replace(/[-_/]/g, " ")}`);

      if (mrSignals.length > 0 || tfidfDocs.has(entityId)) {
        matchMap.set(entityId, {
          signals: mrSignals,
          label: `!${mr.iid}: ${mr.title}`,
          subtitle: `${mr.author} · ${mr.target_branch}`,
          source: "gitlab",
          linkData: {
            source: "gitlab",
            label: `!${mr.iid}: ${mr.title}`,
            subtitle: `${mr.author} · ${mr.target_branch}`,
            navigateTo: "gitlab",
            sourceId: mrIid,
            url: mr.web_url,
            sourceBranch: mr.source_branch,
          },
        });
      }
    }
  }

  // ── 7. Score Linear Issues ──
  if (issues) {
    for (const issue of issues) {
      const entityId = `linear:${issue.identifier}`;
      const issueSignals: ScoredSignal[] = [];

      // Structured: ticket ID match
      if (ticketIds.has(issue.identifier)) {
        issueSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.ticket_id_match, reason: "ticket_id_match" });
      }

      // Error codes
      const issueErrors = extractErrorCodes(issue.title);
      for (const code of issueErrors) {
        if (focusErrorCodes.has(code)) {
          issueSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.error_code_match, reason: "error_code_match" });
          break;
        }
      }

      // Label overlap with focus keywords
      if (issue.labels.length > 0) {
        const focusLower = allFocusText.toLowerCase();
        for (const label of issue.labels) {
          if (label.length >= 3 && focusLower.includes(label.toLowerCase())) {
            issueSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.label_overlap, reason: "label_overlap" });
            break;
          }
        }
      }

      // Temporal proximity
      const issueTime = new Date(issue.updated_at).getTime();
      const focusTime = new Date(item.createdAt).getTime();
      const gapHours = Math.abs(issueTime - focusTime) / 3_600_000;
      if (gapHours < 12 && issueSignals.length > 0) {
        const tempScore = SIGNAL_WEIGHTS.temporal_proximity * Math.exp(-gapHours / 4);
        if (tempScore > 0.01) {
          issueSignals.push({ a: focusId, b: entityId, score: tempScore, reason: "temporal_proximity" });
        }
      }

      tfidfDocs.set(entityId, `${issue.title} ${issue.labels.join(" ")} ${issue.team_name}`);

      matchMap.set(entityId, {
        signals: issueSignals,
        label: `${issue.identifier}: ${issue.title}`,
        subtitle: `${issue.status} · ${issue.team_key}`,
        source: "linear",
        linkData: {
          source: "linear",
          label: `${issue.identifier}: ${issue.title}`,
          subtitle: `${issue.status} · ${issue.team_key}`,
          navigateTo: "linear",
          sourceId: issue.identifier,
          url: issue.url,
        },
      });
    }
  }

  // ── 8. Score Datadog Monitors ──
  if (monitors) {
    for (const monitor of monitors) {
      const entityId = `datadog:${monitor.id}`;
      const monSignals: ScoredSignal[] = [];
      const monId = String(monitor.id);

      // Structured: ticket ID in monitor name
      for (const tid of extractTicketIds(monitor.name)) {
        if (ticketIds.has(tid)) {
          monSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.ticket_id_match, reason: "ticket_id_match" });
          break;
        }
      }

      // Error codes in monitor name/message
      const monErrors = extractErrorCodes(`${monitor.name} ${monitor.message}`);
      for (const code of monErrors) {
        if (focusErrorCodes.has(code)) {
          monSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.error_code_match, reason: "error_code_match" });
          break;
        }
      }

      // Service tag matching against focus text
      const monServices = [
        ...extractServiceFromTags(monitor.tags),
        ...extractServiceFromQuery(monitor.query),
      ];
      const focusSegments = allFocusText.toLowerCase().split(/[\s\-_/.,;:]+/).filter((s) => s.length >= 2);
      if (serviceMatchesSegments(monServices, focusSegments)) {
        monSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.service_tag_match, reason: "service_tag_match" });
      }
      // Also match service against linked MR branches
      for (const link of item.links) {
        if (link.sourceBranch) {
          const segments = branchSegments(link.sourceBranch);
          if (serviceMatchesSegments(monServices, segments)) {
            monSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.query_service_match, reason: "query_service_match" });
            break;
          }
        }
      }

      // Team tag overlap
      const monTeams = extractTeamFromTags(monitor.tags);
      for (const team of monTeams) {
        if (focusSegments.includes(team)) {
          monSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.label_overlap, reason: "label_overlap" });
          break;
        }
      }

      // Collect services for Slack matching later
      for (const svc of monServices) focusServices.add(svc);

      tfidfDocs.set(entityId, `${monitor.name} ${monitor.message} ${monitor.tags.join(" ")}`);

      matchMap.set(entityId, {
        signals: monSignals,
        label: monitor.name,
        subtitle: `${monitor.status} · ${monitor.monitor_type}`,
        source: "datadog",
        linkData: {
          source: "datadog",
          label: monitor.name,
          subtitle: `${monitor.status} · ${monitor.monitor_type}`,
          navigateTo: "hub",
          sourceId: monId,
        },
      });
    }
  }

  // ── 9. Score Slack Messages ──
  if (sections) {
    for (const section of sections) {
      for (const msg of section.messages) {
        const entityId = `slack:${msg.channel_id}:${msg.raw_ts}`;
        const slackSignals: ScoredSignal[] = [];

        // Structured: ticket/MR refs in message
        for (const tid of extractTicketIds(msg.message)) {
          if (ticketIds.has(tid)) {
            slackSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.ticket_id_match, reason: "ticket_id_match" });
            break;
          }
        }
        for (const iid of extractMRRefs(msg.message)) {
          if (mrIids.has(iid)) {
            slackSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.mr_ref_match, reason: "mr_ref_match" });
            break;
          }
        }

        // Error codes
        const msgErrors = extractErrorCodes(msg.message);
        for (const code of msgErrors) {
          if (focusErrorCodes.has(code)) {
            slackSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.error_code_match, reason: "error_code_match" });
            break;
          }
        }

        // URL references to known entities
        if (msg.message.includes("gitlab.com") || msg.message.includes("linear.app")) {
          // Check for MR URLs
          const mrUrlMatch = msg.message.match(/merge_requests\/(\d+)/);
          if (mrUrlMatch && mrIids.has(mrUrlMatch[1])) {
            slackSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.url_reference, reason: "url_reference" });
          }
          // Check for Linear URLs
          for (const tid of ticketIds) {
            if (msg.message.includes(tid)) {
              slackSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.url_reference, reason: "url_reference" });
              break;
            }
          }
        }

        // Person overlap (sender matches a known author)
        if (focusPersons.has(msg.sender.toLowerCase())) {
          slackSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.person_overlap, reason: "person_overlap" });
        }

        // Channel matches a service name from monitors
        if (focusServices.size > 0 && channelMatchesService(msg.channel, [...focusServices])) {
          slackSignals.push({ a: focusId, b: entityId, score: SIGNAL_WEIGHTS.service_tag_match * 0.5, reason: "service_tag_match" });
        }

        tfidfDocs.set(entityId, msg.message);

        matchMap.set(entityId, {
          signals: slackSignals,
          label: `${msg.sender} in #${msg.channel}`,
          subtitle: msg.message.slice(0, 80),
          source: "slack",
          linkData: {
            source: "slack",
            label: `${msg.sender} in #${msg.channel}`,
            subtitle: msg.message.slice(0, 80),
            navigateTo: "slack",
            url: msg.permalink,
            slackRef: { channelId: msg.channel_id, threadTs: msg.raw_ts },
          },
        });
      }
    }
  }

  // ── 10. Compute TF-IDF similarity for ALL entities ──
  if (tfidfDocs.size > 1) {
    const corpus = buildCorpus(tfidfDocs);
    const focusVec = corpus.vectors.get(focusId);
    if (focusVec && focusVec.size > 0) {
      for (const [entityId, vec] of corpus.vectors) {
        if (entityId === focusId) continue;
        const sim = cosineSimilarity(focusVec, vec);
        if (sim > 0.08) {
          const score = SIGNAL_WEIGHTS.tfidf_text * sim;
          const entry = matchMap.get(entityId);
          if (entry) {
            entry.signals.push({ a: focusId, b: entityId, score, reason: "tfidf_text" });
          }
        }
      }
    }
  }

  // ── 11. Aggregate scores and filter ──
  const results: ScoredMatch[] = [];

  for (const [entityId, entry] of matchMap) {
    if (entry.signals.length === 0) continue;

    const total = Math.min(1.0, entry.signals.reduce((sum, s) => sum + s.score, 0));
    if (total < 0.15) continue; // below weak threshold

    results.push({
      entityId,
      source: entry.source,
      label: entry.label,
      subtitle: entry.subtitle,
      score: {
        total,
        signals: entry.signals,
        tier: scoreTier(total),
      },
      linkData: entry.linkData,
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score.total - a.score.total);

  return results;
}
