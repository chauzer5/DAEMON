import { Pin, X, ExternalLink, GitMerge, MessageSquare, LayoutList, CheckSquare, Zap, User } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useTodoStore, type TodoItem as TodoItemType } from "../../stores/todoStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { ActionMenu } from "../../components/ai/ActionMenu";
import type { ActionSource } from "../../config/aiActions";
import styles from "./TodoItem.module.css";

const SOURCE_ICONS: Record<string, typeof MessageSquare> = {
  slack: MessageSquare,
  gitlab: GitMerge,
  linear: LayoutList,
  manual: CheckSquare,
};

const SOURCE_PANEL: Record<string, string> = {
  slack: "slack",
  gitlab: "gitlab",
  linear: "linear",
  manual: "todos",
};

/** Human-readable explanation of why this todo exists */
const RULE_DESCRIPTIONS: Record<string, string> = {
  "gl-failed-pipeline": "Auto: Your MR has a failed pipeline",
  "gl-has-conflicts": "Auto: Your MR has merge conflicts",
  "gl-mentioned": "Auto: You were mentioned in this MR",
  "sl-mentions": "Auto: You were @mentioned in Slack",
  "ln-in-progress": "Auto: This ticket is in progress and assigned to you",
  "ln-urgent": "Auto: Urgent priority ticket assigned to you",
  "ln-high-priority": "Auto: High priority ticket assigned to you",
  "ln-ready-to-start": "Auto: Unstarted ticket assigned to you",
  "manual": "Manually added to-do",
};

const ACTION_SOURCES = new Set<string>(["slack", "gitlab", "linear"]);

function buildTodoContext(item: TodoItemType): Record<string, unknown> {
  switch (item.source) {
    case "slack":
      return {
        message: item.title,
        sender: "",
        channel: item.subtitle ?? "",
        permalink: item.url ?? "",
      };
    case "gitlab":
      return {
        iid: item.nav?.iid ?? "",
        title: item.title,
        webUrl: item.url ?? "",
      };
    case "linear":
      return {
        identifier: item.subtitle?.split(" · ")[0] ?? "",
        title: item.title,
        url: item.url ?? "",
        status: item.subtitle?.split(" · ")[1] ?? "",
      };
    default:
      return {};
  }
}

interface TodoItemProps {
  item: TodoItemType;
}

export function TodoItemCard({ item }: TodoItemProps) {
  const { pinItem, unpinItem, dismissItem, removeManualTodo } = useTodoStore();
  const setActivePanel = useLayoutStore((s) => s.setActivePanel);
  const SourceIcon = SOURCE_ICONS[item.source] ?? CheckSquare;
  const isPinned = item.type === "pinned";
  const isManual = item.ruleId === "manual";
  const tooltip = RULE_DESCRIPTIONS[item.ruleId] ?? `Auto: ${item.ruleId}`;

  const openMR = useLayoutStore((s) => s.openMR);

  const navigateToSource = () => {
    // If the todo has internal nav data, use it for deep linking
    if (item.nav?.panel === "gitlab" && item.nav.projectId && item.nav.iid) {
      openMR({ projectId: item.nav.projectId, iid: item.nav.iid });
      return;
    }
    const panel = SOURCE_PANEL[item.source];
    if (panel) setActivePanel(panel as import("../../stores/layoutStore").PanelId);
  };

  const handleDismiss = () => {
    if (item.type === "manual" || isManual) {
      removeManualTodo(item.id);
    } else {
      dismissItem(item.id);
    }
  };

  return (
    <div
      className={`${styles.item} ${styles[item.priority]}`}
      onClick={navigateToSource}
      title={tooltip}
    >
      <div className={styles.sourceIcon}>
        <SourceIcon size={14} />
      </div>
      <div className={styles.content}>
        <span className={styles.title}>{item.title}</span>
        <div className={styles.metaRow}>
          {item.subtitle && (
            <span className={styles.subtitle}>{item.subtitle}</span>
          )}
          <span className={`${styles.originTag} ${isManual ? styles.originManual : styles.originAuto}`}>
            {isManual ? <User size={8} /> : <Zap size={8} />}
            {isManual ? "manual" : "auto"}
          </span>
        </div>
      </div>
      <div className={styles.actions}>
        {ACTION_SOURCES.has(item.source) && (
          <ActionMenu
            source={item.source as ActionSource}
            context={buildTodoContext(item)}
            compact
          />
        )}
        <button
          className={`${styles.actionBtn} ${isPinned ? styles.pinned : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            isPinned ? unpinItem(item.id) : pinItem(item.id);
          }}
          title={isPinned ? "Unpin" : "Pin"}
        >
          <Pin size={12} />
        </button>
        <button
          className={styles.actionBtn}
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          title={isManual ? "Delete" : "Dismiss"}
        >
          <X size={12} />
        </button>
        {item.url && (
          <button
            className={styles.actionBtn}
            onClick={(e) => {
              e.stopPropagation();
              open(item.url!);
            }}
            title="Open in browser"
          >
            <ExternalLink size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
