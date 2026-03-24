import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCorrelationStore } from "../stores/correlationStore";
import type { CorrelationEntity } from "../stores/correlationStore";
import type { MonitorEvent } from "../stores/monitorStore";
import { relativeTime } from "../utils/time";
import type {
  EnrichedMergeRequest,
  LinearIssue,
  DatadogMonitor,
} from "../types/models";

// ── Context summary types ──

export interface ContextField {
  label: string;
  value: string;
  accent?: "cyan" | "green" | "red" | "magenta" | "muted";
}

export interface EventContextSummary {
  fields: ContextField[];
  related: CorrelationEntity[];
}

/**
 * Given a MonitorEvent, pulls context from the React Query cache
 * and correlation engine to build a quick summary.
 */
export function useEventContext(event: MonitorEvent): EventContextSummary {
  const queryClient = useQueryClient();
  const revision = useCorrelationStore((s) => s.revision);

  return useMemo(() => {
    const fields: ContextField[] = [];
    let correlationId: string | null = null;

    if (event.source === "gitlab") {
      const iid = event.context.iid;
      correlationId = iid ? `gitlab:${iid}` : null;

      const mrs = queryClient.getQueryData<EnrichedMergeRequest[]>(["gitlab", "mergeRequests"]);
      const mr = mrs?.find((m) => String(m.iid) === iid);

      if (mr) {
        fields.push({ label: "Author", value: mr.author });
        fields.push({ label: "Branch", value: `${mr.source_branch} → ${mr.target_branch}` });
        if (mr.pipeline_status) {
          const accent = mr.pipeline_status === "success" ? "green"
            : mr.pipeline_status === "failed" ? "red"
            : "muted";
          fields.push({ label: "Pipeline", value: mr.pipeline_status, accent });
        }
        if (mr.has_conflicts) {
          fields.push({ label: "Conflicts", value: "Yes", accent: "red" });
        }
        if (mr.reviewers.length > 0) {
          fields.push({ label: "Reviewers", value: mr.reviewers.join(", ") });
        }
        if (mr.needs_your_approval) {
          fields.push({ label: "Needs approval", value: mr.approval_rules_needing_you.join(", ") || "Yes", accent: "magenta" });
        }
        fields.push({ label: "Updated", value: relativeTime(mr.updated_at), accent: "muted" });
        if (mr.notes_count > 0) {
          fields.push({ label: "Comments", value: String(mr.notes_count) });
        }
      }
    }

    if (event.source === "linear") {
      const identifier = event.context.identifier;
      correlationId = identifier ? `linear:${identifier}` : null;

      const issues = queryClient.getQueryData<LinearIssue[]>(["linear", "issues"]);
      const issue = issues?.find((i) => i.identifier === identifier);

      if (issue) {
        const statusAccent = issue.status_type === "completed" ? "green"
          : issue.status_type === "cancelled" ? "red"
          : issue.status.toLowerCase().includes("block") ? "red"
          : "cyan";
        fields.push({ label: "Status", value: issue.status, accent: statusAccent });
        fields.push({ label: "Team", value: issue.team_name });
        if (issue.assignee) {
          fields.push({ label: "Assignee", value: issue.assignee });
        }
        if (issue.labels.length > 0) {
          fields.push({ label: "Labels", value: issue.labels.join(", ") });
        }
        fields.push({ label: "Priority", value: ["Urgent", "High", "Medium", "Low", "None"][issue.priority] ?? String(issue.priority) });
        fields.push({ label: "Updated", value: relativeTime(issue.updated_at), accent: "muted" });
      }
    }

    if (event.source === "datadog") {
      const monitorId = event.context.monitorId;
      correlationId = monitorId ? `datadog:${monitorId}` : null;

      const monitors = queryClient.getQueryData<DatadogMonitor[]>(["datadog", "monitors"]);
      const monitor = monitors?.find((m) => String(m.id) === monitorId);

      if (monitor) {
        const statusAccent = monitor.status === "Alert" ? "red"
          : monitor.status === "Warn" ? "magenta"
          : "green";
        fields.push({ label: "Status", value: monitor.status, accent: statusAccent });
        fields.push({ label: "Type", value: monitor.monitor_type });
        if (monitor.tags.length > 0) {
          fields.push({ label: "Tags", value: monitor.tags.slice(0, 5).join(", ") });
        }
        if (monitor.message) {
          fields.push({ label: "Message", value: monitor.message.slice(0, 120) + (monitor.message.length > 120 ? "..." : "") });
        }
      }
    }

    if (event.source === "slack") {
      // Slack events have context directly in the event
      if (event.context.channel) {
        fields.push({ label: "Channel", value: `#${event.context.channel}` });
      }
      if (event.context.sender) {
        fields.push({ label: "From", value: event.context.sender });
      }
      if (event.context.message) {
        fields.push({ label: "Message", value: event.context.message.slice(0, 120) + (event.context.message.length > 120 ? "..." : "") });
      }
      if (event.context.threadTs) {
        correlationId = `slack:${event.context.channelId}:${event.context.threadTs}`;
      }
    }

    // Pull related items from correlation engine
    const related = correlationId
      ? useCorrelationStore.getState().getRelated(correlationId)
      : [];

    return { fields, related };
    // event.id is sufficient: events are immutable once created, and revision
    // tracks correlation index changes that could affect related items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, queryClient, revision]);
}
