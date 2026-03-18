import { useMemo, useState } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  GitMerge,
  LayoutList,
  CheckSquare,
  AlertTriangle,
  ChevronRight,
  Bell,
  Pencil,
  Check,
  X,
  Zap,
  User,
} from "lucide-react";
import { Panel } from "../../components/layout/Panel";
import { useSlackSections } from "../../hooks/useSlackMentions";
import { useMergeRequests } from "../../hooks/useMergeRequests";
import { useLinearIssues } from "../../hooks/useLinearIssues";
import { useTodos } from "../../hooks/useTodos";
import { useLayoutStore } from "../../stores/layoutStore";
import type { PanelId } from "../../stores/layoutStore";
import { useWatchedThreads } from "../../hooks/useWatchedThreads";
import { useThreadSubscriptionStore } from "../../stores/threadSubscriptionStore";
import styles from "./HubPanel.module.css";

// ── Mini stat card ──────────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  alertValue,
  alertLabel,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: number | string;
  accent: "cyan" | "magenta" | "purple" | "green" | "orange";
  alertValue?: number;
  alertLabel?: string;
  onClick: () => void;
}) {
  return (
    <button className={`${styles.statCard} ${styles[`accent_${accent}`]}`} onClick={onClick}>
      <div className={styles.statHeader}>
        <Icon size={14} className={styles.statIcon} />
        <span className={styles.statLabel}>{label}</span>
      </div>
      <div className={styles.statValue}>{value}</div>
      {alertValue !== undefined && alertValue > 0 && (
        <div className={styles.statAlert}>
          <AlertTriangle size={10} />
          <span>{alertValue} {alertLabel}</span>
        </div>
      )}
    </button>
  );
}

// ── Compact action item row ──────────────────────────────────────
function ActionRow({
  icon: Icon,
  source,
  title,
  subtitle,
  urgent,
  onClick,
}: {
  icon: typeof MessageSquare;
  source: string;
  title: string;
  subtitle?: string;
  urgent?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`${styles.actionRow} ${urgent ? styles.urgent : ""} ${styles.clickable}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
    >
      <Icon size={12} className={`${styles.rowIcon} ${styles[`rowIcon_${source}`]}`} />
      <div className={styles.rowContent}>
        <span className={styles.rowTitle}>{title}</span>
        {subtitle && <span className={styles.rowSubtitle}>{subtitle}</span>}
      </div>
      <ChevronRight size={10} className={styles.rowChevron} />
    </div>
  );
}

// ── Watched thread row with editable summary ────────────────────
function WatchedThreadRow({
  id,
  summary,
  subtitle,
  hasNew,
  onClick,
}: {
  id: string;
  summary: string;
  subtitle: string;
  hasNew: boolean;
  onClick: () => void;
}) {
  const updateSummary = useThreadSubscriptionStore((s) => s.updateSummary);
  const unsubscribe = useThreadSubscriptionStore((s) => s.unsubscribe);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary);
  const [dismissing, setDismissing] = useState(false);

  const save = () => {
    updateSummary(id, draft.trim() || summary);
    setEditing(false);
  };

  const handleUnwatch = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissing(true);
    setTimeout(() => unsubscribe(id), 500);
  };

  return (
    <div className={`${styles.actionRow} ${hasNew ? styles.urgent : ""} ${dismissing ? styles.unwatching : ""}`}>
      <Bell size={12} className={`${styles.rowIcon} ${styles.rowIcon_slack}`} />
      <div className={styles.rowContent}>
        {editing ? (
          <div className={styles.editRow}>
            <input
              className={styles.summaryInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
              autoFocus
            />
            <button className={styles.saveBtn} onClick={save} title="Save">
              <Check size={10} />
            </button>
          </div>
        ) : (
          <>
            <span className={`${styles.rowTitle} ${styles.clickable}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}>
              {summary}
            </span>
            <span className={styles.rowSubtitle}>
              {subtitle}
              <button
                className={styles.editBtn}
                onClick={(e) => { e.stopPropagation(); setDraft(summary); setEditing(true); }}
                title="Edit summary"
              >
                <Pencil size={8} />
              </button>
            </span>
          </>
        )}
      </div>
      {!editing && (
        <div className={styles.rowActions}>
          <button
            className={styles.unwatchBtn}
            onClick={handleUnwatch}
            title="Unwatch"
          >
            <X size={10} />
          </button>
          <ChevronRight size={10} className={`${styles.rowChevron} ${styles.clickable}`} onClick={onClick} />
        </div>
      )}
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────
function HubSection({
  title,
  accent,
  children,
  empty,
  tabs,
  activeTab,
  onTabChange,
}: {
  title: string;
  accent: "cyan" | "magenta" | "purple" | "green" | "orange";
  children: React.ReactNode;
  empty?: boolean;
  tabs?: string[];
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}) {
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionHeader} ${styles[`sectionHeader_${accent}`]}`}>
        <span className={styles.sectionTitle}>{title}</span>
        {tabs && (
          <div className={styles.sectionTabs}>
            {tabs.map((tab) => (
              <button
                key={tab}
                className={`${styles.sectionTab} ${activeTab === tab ? styles.sectionTabActive : ""}`}
                onClick={() => onTabChange?.(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.sectionBody}>
        {empty ? (
          <div className={styles.emptyRow}>All clear</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ── Hub Panel ────────────────────────────────────────────────────
export function HubPanel() {
  const setActivePanel = useLayoutStore((s) => s.setActivePanel);
  const openSlackThread = useLayoutStore((s) => s.openSlackThread);
  const nav = (id: PanelId) => () => setActivePanel(id);
  const [mrTab, setMrTab] = useState<"My Team" | "Schema Change" | "Mine">("My Team");

  const { data: slackSections, refetch: refetchSlack } = useSlackSections();
  const { data: mergeRequests, refetch: refetchMRs } = useMergeRequests();
  const { data: linearIssues, refetch: refetchLinear } = useLinearIssues();
  const { todos, criticalCount } = useTodos();
  const watchedThreads = useWatchedThreads();

  // ── Slack metrics ──
  const { totalUnread, urgentSlack } = useMemo(() => {
    if (!slackSections) return { totalUnread: 0, urgentSlack: [] };
    const mentions: { title: string; subtitle: string }[] = [];
    let totalUnread = 0;
    for (const s of slackSections) {
      for (const m of s.messages) {
        if (m.is_unread) {
          totalUnread++;
          if (s.section_type === "mentions") {
            mentions.push({
              title: `${m.sender}: ${m.message.slice(0, 60)}${m.message.length > 60 ? "…" : ""}`,
              subtitle: s.title,
            });
          }
        }
      }
    }
    return { totalUnread, urgentSlack: mentions.slice(0, 3) };
  }, [slackSections]);

  // ── GitLab metrics ──
  const { approvalCount, teamMRs, waitingMRs, myMRs } = useMemo(() => {
    if (!mergeRequests) return { approvalCount: 0, teamMRs: [], waitingMRs: [], myMRs: [] };
    const needsApproval = mergeRequests.filter((mr) => mr.needs_your_approval);
    const team = needsApproval.filter((mr) => mr.is_team_member);
    const nonTeam = needsApproval.filter((mr) => !mr.is_team_member);
    const mine = mergeRequests.filter((mr) => mr.author_username === "ajholloway34");
    return {
      approvalCount: needsApproval.length,
      teamMRs: team.slice(0, 3).map((mr) => ({
        title: mr.title,
        subtitle: `!${mr.iid} · ${mr.author}`,
      })),
      waitingMRs: nonTeam.slice(0, 3).map((mr) => ({
        title: mr.title,
        subtitle: `!${mr.iid} · ${mr.author}`,
      })),
      myMRs: mine.slice(0, 3).map((mr) => ({
        title: mr.title,
        subtitle: `!${mr.iid} · ${mr.pipeline_status ?? "no pipeline"}`,
      })),
    };
  }, [mergeRequests]);

  // ── Linear metrics ──
  const myCount = useMemo(() => {
    if (!linearIssues) return 0;
    return linearIssues.filter((i) => i.assignee_is_me).length;
  }, [linearIssues]);

  // ── Todos ──
  const topTodos = todos.slice(0, 5);

  return (
    <Panel
      title="Hub"
      icon={LayoutDashboard}
      badge={criticalCount > 0 ? `${criticalCount} critical` : undefined}
      badgeVariant={criticalCount > 0 ? "default" : "green"}
      onRefresh={() => { refetchSlack(); refetchMRs(); refetchLinear(); }}
    >
      <div className={styles.hub}>
        {/* ── Stat row ── */}
        <div className={styles.statsRow}>
          <StatCard
            icon={MessageSquare}
            label="Slack"
            value={totalUnread}
            accent="cyan"
            alertValue={urgentSlack.length}
            alertLabel="mentions"
            onClick={nav("slack")}
          />
          <StatCard
            icon={GitMerge}
            label="GitLab"
            value={mergeRequests?.length ?? "—"}
            accent="purple"
            alertValue={approvalCount}
            alertLabel="need review"
            onClick={nav("gitlab")}
          />
          <StatCard
            icon={LayoutList}
            label="Linear"
            value={myCount}
            accent="magenta"
            onClick={nav("linear")}
          />
          <StatCard
            icon={CheckSquare}
            label="To-Dos"
            value={todos.length}
            accent="green"
            alertValue={criticalCount}
            alertLabel="critical"
            onClick={nav("todos")}
          />
        </div>

        {/* ── Action feed ── */}
        <div className={styles.feedGrid}>
          {/* Slack mentions */}
          <HubSection title="Slack Mentions" accent="cyan" empty={urgentSlack.length === 0}>
            {urgentSlack.map((m, i) => (
              <ActionRow key={i} icon={MessageSquare} source="slack" title={m.title} subtitle={m.subtitle} urgent onClick={nav("slack")} />
            ))}
          </HubSection>

          {/* MRs — tabbed */}
          <HubSection
            title="Merge Requests"
            accent="purple"
            tabs={["My Team", "Schema Change", "Mine"]}
            activeTab={mrTab}
            onTabChange={(t) => setMrTab(t as "My Team" | "Schema Change" | "Mine")}
            empty={mrTab === "My Team" ? teamMRs.length === 0 : mrTab === "Schema Change" ? waitingMRs.length === 0 : myMRs.length === 0}
          >
            {mrTab === "My Team"
              ? teamMRs.map((mr, i) => (
                  <ActionRow key={i} icon={GitMerge} source="gitlab" title={mr.title} subtitle={mr.subtitle} urgent onClick={nav("gitlab")} />
                ))
              : mrTab === "Schema Change"
                ? waitingMRs.map((mr, i) => (
                    <ActionRow key={i} icon={GitMerge} source="gitlab" title={mr.title} subtitle={mr.subtitle} onClick={nav("slack")} />
                  ))
                : myMRs.map((mr, i) => (
                    <ActionRow key={i} icon={GitMerge} source="gitlab" title={mr.title} subtitle={mr.subtitle} onClick={nav("gitlab")} />
                  ))
            }
          </HubSection>

          {/* Watched Threads */}
          <HubSection title="Watched Threads" accent="cyan" empty={watchedThreads.length === 0}>
            {watchedThreads.map((sub) => (
              <WatchedThreadRow
                key={sub.id}
                id={sub.id}
                summary={sub.summary || sub.label}
                subtitle={`${sub.channelName} · ${sub.sender}`}
                hasNew={sub.hasNew}
                onClick={() => openSlackThread({ channelId: sub.channelId, threadTs: sub.threadTs })}
              />
            ))}
          </HubSection>

          {/* Top to-do items */}
          <HubSection title="To-Dos" accent="green" empty={topTodos.length === 0}>
            {topTodos.map((t) => {
              const isManual = t.ruleId === "manual";
              const SourceIcon = t.source === "slack" ? MessageSquare
                : t.source === "gitlab" ? GitMerge
                : t.source === "linear" ? LayoutList
                : CheckSquare;
              return (
                <div
                  key={t.id}
                  className={`${styles.todoRow} ${styles[`todoPriority_${t.priority}`]} ${styles.clickable}`}
                  onClick={() => setActivePanel("todos")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setActivePanel("todos"); }}
                >
                  <SourceIcon size={12} className={`${styles.rowIcon} ${styles[`rowIcon_${t.source}`]}`} />
                  <div className={styles.rowContent}>
                    <span className={styles.rowTitle}>{t.title}</span>
                    <div className={styles.todoMeta}>
                      {t.subtitle && <span className={styles.rowSubtitle}>{t.subtitle}</span>}
                      <span className={`${styles.todoOrigin} ${isManual ? styles.todoOriginManual : styles.todoOriginAuto}`}>
                        {isManual ? <User size={7} /> : <Zap size={7} />}
                        {isManual ? "manual" : "auto"}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={10} className={styles.rowChevron} />
                </div>
              );
            })}
          </HubSection>
        </div>
      </div>
    </Panel>
  );
}
