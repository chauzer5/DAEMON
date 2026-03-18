import { useMemo } from "react";
import { useSlackSections } from "./useSlackMentions";
import { useMergeRequests } from "./useMergeRequests";
import { useLinearIssues } from "./useLinearIssues";
import { useTodoStore, type TodoItem } from "../stores/todoStore";

/** Priority levels considered "critical" for the Hub badge count. */
const CRITICAL_RULE_IDS = new Set([
  "gl-failed-pipeline",
  "gl-has-conflicts",
  "ln-in-progress",
  "ln-urgent",
]);

/**
 * Aggregates to-do items from all connected sources using default rules.
 * Reuses cached data from the existing React Query hooks.
 *
 * Returns { todos, criticalCount } where criticalCount is the subset
 * that warrants immediate attention (for the Hub badge).
 */
export function useTodos() {
  const { data: slackSections } = useSlackSections();
  const { data: mergeRequests } = useMergeRequests();
  const { data: linearIssues } = useLinearIssues();
  const { pinnedIds, dismissedIds, manualTodos } = useTodoStore();

  return useMemo(() => {
    const items: TodoItem[] = [];

    // ── GitLab ──────────────────────────────────────────────

    if (mergeRequests) {
      for (const mr of mergeRequests) {
        const isMine = mr.author_username === "ajholloway34";

        // Your MRs with failed pipelines
        if (isMine && mr.pipeline_status === "failed") {
          items.push({
            id: `gl-pipeline-${mr.id}`,
            type: "linked",
            source: "gitlab",
            title: `Pipeline failed: ${mr.title}`,
            subtitle: `!${mr.iid}`,
            url: mr.web_url,
            priority: "high",
            ruleId: "gl-failed-pipeline",
            updatedAt: mr.updated_at,
          });
        }

        // Your MRs with merge conflicts
        if (isMine && mr.has_conflicts) {
          items.push({
            id: `gl-conflict-${mr.id}`,
            type: "linked",
            source: "gitlab",
            title: `Conflicts: ${mr.title}`,
            subtitle: `!${mr.iid}`,
            url: mr.web_url,
            priority: "high",
            ruleId: "gl-has-conflicts",
            updatedAt: mr.updated_at,
          });
        }

        // MRs with mentions
        if (mr.you_are_mentioned) {
          items.push({
            id: `gl-mention-${mr.id}`,
            type: "linked",
            source: "gitlab",
            title: `Mentioned in: ${mr.title}`,
            subtitle: `!${mr.iid}`,
            url: mr.web_url,
            priority: "medium",
            ruleId: "gl-mentioned",
            updatedAt: mr.updated_at,
          });
        }
      }
    }

    // ── Slack ────────────────────────────────────────────────

    if (slackSections) {
      for (const section of slackSections) {
        if (section.section_type !== "mentions") continue;
        for (const msg of section.messages) {
          if (!msg.is_unread) continue;
          items.push({
            id: `sl-mention-${msg.id}`,
            type: "linked",
            source: "slack",
            title: `${msg.sender}: ${msg.message.slice(0, 80)}${msg.message.length > 80 ? "..." : ""}`,
            subtitle: section.title,
            url: msg.permalink,
            priority: "medium",
            ruleId: "sl-mentions",
            updatedAt: msg.timestamp,
          });
        }
      }
    }

    // ── Linear ──────────────────────────────────────────────

    if (linearIssues) {
      for (const issue of linearIssues) {
        if (!issue.assignee_is_me) continue;
        // Deployed/completed/cancelled — done, skip
        if (issue.status_type === "completed" || issue.status_type === "cancelled" || issue.status === "Deployed") continue;

        // In Progress — you're actively working on it
        if (issue.status_type === "started") {
          items.push({
            id: `ln-started-${issue.id}`,
            type: "linked",
            source: "linear",
            title: issue.title,
            subtitle: `${issue.identifier} · ${issue.status}`,
            url: issue.url,
            priority: "high",
            ruleId: "ln-in-progress",
            updatedAt: issue.updated_at,
          });
          continue;
        }

        // Urgent or High priority (1 = urgent, 2 = high) regardless of status
        if (issue.priority >= 1 && issue.priority <= 2) {
          items.push({
            id: `ln-priority-${issue.id}`,
            type: "linked",
            source: "linear",
            title: issue.title,
            subtitle: `${issue.identifier} · ${issue.status} · P${issue.priority === 1 ? "urgent" : "high"}`,
            url: issue.url,
            priority: issue.priority === 1 ? "high" : "medium",
            ruleId: issue.priority === 1 ? "ln-urgent" : "ln-high-priority",
            updatedAt: issue.updated_at,
          });
          continue;
        }

        // Unstarted tickets assigned to you — low priority, still worth tracking
        if (issue.status_type === "unstarted") {
          items.push({
            id: `ln-unstarted-${issue.id}`,
            type: "linked",
            source: "linear",
            title: issue.title,
            subtitle: `${issue.identifier} · ${issue.status}`,
            url: issue.url,
            priority: "low",
            ruleId: "ln-ready-to-start",
            updatedAt: issue.updated_at,
          });
        }
      }
    }

    // ── Manual todos ────────────────────────────────────────

    for (const mt of manualTodos) {
      items.push({
        id: mt.id,
        type: "manual",
        source: mt.source,
        title: mt.title,
        subtitle: mt.subtitle,
        url: mt.url,
        priority: mt.priority,
        ruleId: "manual",
        updatedAt: mt.createdAt,
        nav: mt.nav,
      });
    }

    // ── Apply pinned/dismissed, sort, compute critical count ──

    const todos = items
      .map((item) => ({
        ...item,
        type: pinnedIds.has(item.id) ? ("pinned" as const) : item.type,
      }))
      .filter((item) => !dismissedIds.has(item.id))
      .sort((a, b) => {
        // Pinned first, then by priority
        if (a.type === "pinned" && b.type !== "pinned") return -1;
        if (b.type === "pinned" && a.type !== "pinned") return 1;
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

    const criticalCount = todos.filter(
      (t) => CRITICAL_RULE_IDS.has(t.ruleId),
    ).length;

    return { todos, criticalCount };
  }, [slackSections, mergeRequests, linearIssues, pinnedIds, dismissedIds, manualTodos]);
}
