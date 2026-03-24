import { useState, useRef, useCallback, useEffect } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  GitMerge,
  Bot,
  LayoutList,
  Archive,
  Globe,
  Activity,
  Flag,
} from "lucide-react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SidebarNavItem } from "./SidebarNavItem";
import { useLayoutStore, type PanelId } from "../../stores/layoutStore";
import { useSlackSections } from "../../hooks";
import { useMergeRequests, useLinearIssues, useDatadogMonitors } from "../../hooks";
import { useTodos } from "../../hooks/useTodos";
import { usePersonaStore } from "../../stores/personaStore";
import { getPersonaById } from "../../config/personas";
import styles from "./Sidebar.module.css";

const NAV_ITEMS: Partial<Record<PanelId, { label: string; icon: typeof MessageSquare }>> = {
  hub: { label: "Hub", icon: LayoutDashboard },
  slack: { label: "Slack", icon: MessageSquare },
  linear: { label: "Linear", icon: LayoutList },
  gitlab: { label: "GitLab", icon: GitMerge },
  agents: { label: "Agents", icon: Bot },
  datadog: { label: "Monitors", icon: Activity },
  launchdarkly: { label: "Flags", icon: Flag },
  browser: { label: "Browse", icon: Globe },
  archive: { label: "Archive", icon: Archive },
};

/** Width of the proximity detection zone in pixels */
const APPROACH_ZONE = 120;

const sidebarTransition = {
  type: "spring" as const,
  stiffness: 340,
  damping: 30,
  mass: 0.9,
};

// Container for staggered nav items
const navContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.055,
      delayChildren: 0.08,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
};

// Each nav item slides in from left with a slight spring bounce.
const navItemVariants = {
  hidden: {
    opacity: 0,
    x: -28,
    filter: "blur(4px)",
  },
  visible: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: {
      type: "spring" as const,
      stiffness: 380,
      damping: 24,
      mass: 0.7,
    },
  },
  exit: {
    opacity: 0,
    x: -18,
    filter: "blur(3px)",
    transition: { duration: 0.12, ease: "easeIn" as const },
  },
} satisfies Record<string, object>;

// ── Sortable Nav Item wrapper ──

interface SortableNavItemProps {
  id: PanelId;
  index: number;
  activePanel: PanelId;
  isDragActive: boolean;
  badge?: number;
  secondaryBadge?: { count: number; label: string };
  activity?: { running: boolean; avatar?: string; color?: string };
  onClick: () => void;
}

function SortableNavItemWrapper({
  id,
  index,
  activePanel,
  isDragActive,
  badge,
  secondaryBadge,
  activity,
  onClick,
}: SortableNavItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const navItem = NAV_ITEMS[id];
  if (!navItem) return null;

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <motion.div
      variants={navItemVariants as Variants}
      // Disable Framer hover/tap animations while dragging
      whileHover={isDragActive ? undefined : { x: 4, transition: { type: "spring" as const, stiffness: 500, damping: 20 } }}
      whileTap={isDragActive ? undefined : {
        scale: 0.96,
        x: 1,
        transition: { type: "spring" as const, stiffness: 700, damping: 20 },
      }}
      custom={index}
      ref={setNodeRef}
      style={sortableStyle}
      {...attributes}
      {...listeners}
    >
      <SidebarNavItem
        icon={navItem.icon}
        label={navItem.label}
        badge={badge}
        secondaryBadge={secondaryBadge}
        active={activePanel === id}
        collapsed={false}
        activity={activity}
        onClick={onClick}
      />
    </motion.div>
  );
}

// ── Static overlay item (rendered during drag) ──

function DragOverlayItem({ id, activePanel, badge, secondaryBadge, activity }: {
  id: PanelId;
  activePanel: PanelId;
  badge?: number;
  secondaryBadge?: { count: number; label: string };
  activity?: { running: boolean; avatar?: string; color?: string };
}) {
  const navItem = NAV_ITEMS[id];
  if (!navItem) return null;

  return (
    <div className={styles.dragOverlay}>
      <SidebarNavItem
        icon={navItem.icon}
        label={navItem.label}
        badge={badge}
        secondaryBadge={secondaryBadge}
        active={activePanel === id}
        collapsed={false}
        activity={activity}
        onClick={() => {}}
      />
    </div>
  );
}

export function Sidebar() {
  const { activePanel, setActivePanel } = useLayoutStore();
  const booting = useLayoutStore((s) => s.booting);
  const panelOrder = useLayoutStore((s) => s.panelOrder);
  const reorderPanels = useLayoutStore((s) => s.reorderPanels);

  const [revealed, setRevealed] = useState(false);
  const [proximity, setProximity] = useState(0); // 0 = far, 1 = at edge
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const [dragActiveId, setDragActiveId] = useState<PanelId | null>(null);

  // Drag sensors — require 8px movement to distinguish from click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveId(event.active.id as PanelId);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDragActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = panelOrder.indexOf(active.id as PanelId);
    const newIndex = panelOrder.indexOf(over.id as PanelId);
    if (oldIndex !== -1 && newIndex !== -1) {
      reorderPanels(arrayMove(panelOrder, oldIndex, newIndex));
    }
  }, [panelOrder, reorderPanels]);

  const handleDragCancel = useCallback(() => {
    setDragActiveId(null);
  }, []);

  // Track cursor proximity to left edge globally
  useEffect(() => {
    if (revealed || booting) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientX < APPROACH_ZONE) {
        const p = 1 - e.clientX / APPROACH_ZONE;
        setProximity(p);
      } else if (proximity > 0) {
        setProximity(0);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [revealed, proximity, booting]);

  const revealSidebar = useCallback(() => {
    if (booting) return;
    clearTimeout(hideTimer.current);
    setRevealed(true);
    setProximity(0);
  }, [booting]);

  const startHide = useCallback(() => {
    // Don't auto-hide while dragging
    if (dragActiveId) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setRevealed(false);
    }, 400);
  }, [dragActiveId]);

  const cancelHide = useCallback(() => {
    clearTimeout(hideTimer.current);
  }, []);

  // Badge data from hooks
  const { data: slackSections } = useSlackSections();
  const { data: mergeRequests } = useMergeRequests();
  const { data: linearIssues } = useLinearIssues();
  const { data: datadogMonitors } = useDatadogMonitors();
  const { todos, criticalCount } = useTodos();

  const slackUnread = slackSections
    ? slackSections.reduce(
        (sum, s) => sum + s.messages.filter((m) => m.is_unread).length,
        0,
      )
    : 0;
  const mrCount = mergeRequests?.filter((mr) => mr.needs_your_approval).length ?? 0;
  const ddAlertMonitors = datadogMonitors?.filter((m) => m.status === "Alert" || m.status === "Warn") ?? [];
  const ddAlertCount = ddAlertMonitors.length;
  const ddCommsAlertCount = ddAlertMonitors.filter((m) => m.tags.includes("team:comms")).length;
  const linearCount = linearIssues?.filter((i) => {
    if (!i.assignee_is_me) return false;
    if (i.status_type === "cancelled") return false;
    if (i.status_type === "backlog") return false;
    // Deployed/completed older than 7 days — stale, hide
    if (i.status_type === "completed" || i.status === "Deployed") {
      const age = Date.now() - new Date(i.updated_at).getTime();
      if (age > 7 * 86_400_000) return false;
    }
    return true;
  }).length ?? 0;
  const todoCount = todos.length;

  // Agent activity indicator
  const activeMission = usePersonaStore((s) => s.activeMission);
  const activeSingleRun = usePersonaStore((s) => s.activeSingleRun);

  const agentActivity = (() => {
    if (activeSingleRun?.status === "running") {
      const persona = getPersonaById(activeSingleRun.personaId);
      return {
        running: true,
        avatar: persona?.avatar,
        color: persona?.color?.startsWith("var(") ? undefined : persona?.color,
      };
    }
    if (activeMission?.status === "running") {
      const activeEntry = activeMission.timelineEntries.find((e) => e.status === "active");
      if (activeEntry) {
        const persona = getPersonaById(activeEntry.personaId);
        return {
          running: true,
          avatar: persona?.avatar,
          color: persona?.color?.startsWith("var(") ? undefined : persona?.color,
        };
      }
      return { running: true };
    }
    return undefined;
  })();

  // Background run completion badge
  const unseenCompletions = usePersonaStore((s) => s.unseenCompletions);
  const backgroundRunCount = usePersonaStore((s) => s.backgroundRuns.length);
  const clearUnseenCompletions = usePersonaStore((s) => s.clearUnseenCompletions);

  const getBadge = (id: PanelId): number | undefined => {
    switch (id) {
      case "hub":
        return criticalCount || undefined;
      case "todos":
        return todoCount || undefined;
      case "datadog":
        return ddAlertCount || undefined;
      case "archive":
        return undefined;
      case "browser":
        return undefined;
      case "slack":
        return slackUnread || undefined;
      case "gitlab":
        return mrCount || undefined;
      case "linear":
        return linearCount || undefined;
      case "agents":
        return (unseenCompletions + backgroundRunCount) || undefined;
      default:
        return undefined;
    }
  };

  const getSecondaryBadge = (id: PanelId): { count: number; label: string } | undefined => {
    if (id === "datadog" && ddCommsAlertCount > 0) {
      return { count: ddCommsAlertCount, label: `${ddCommsAlertCount} comms` };
    }
    return undefined;
  };

  // Compute sidebar width for the collapsed x offset
  const sidebarRef = useRef<HTMLElement>(null);

  const getCollapsedX = () => {
    if (sidebarRef.current) {
      const w = sidebarRef.current.offsetWidth;
      return -(w + 3);
    }
    return -260;
  };

  const baseClass = styles.sidebar;

  // Pulse edge: dynamic intensity based on proximity
  const rgbColor = "0, 255, 245";
  const edgeIntensity = revealed ? 0.15 : proximity;
  const edgeStyle = {
    opacity: edgeIntensity > 0 ? 1 : 0,
    "--edge-intensity": edgeIntensity,
    "--edge-width": `${3 + edgeIntensity * 8}px`,
    "--edge-glow": `0 0 ${edgeIntensity * 30}px ${edgeIntensity * 12}px rgba(${rgbColor}, ${edgeIntensity * 0.5})`,
  } as React.CSSProperties;

  const revealedBoxShadow = "4px 0 30px rgba(0, 0, 0, 0.7), 2px 0 15px rgba(176, 38, 255, 0.25), 0 0 60px rgba(0, 255, 245, 0.08)";

  if (booting) return null;

  return (
    <>
      {/* Hot zone — invisible strip on left edge */}
      {!revealed && (
        <div
          className={styles.hotZone}
          onMouseEnter={revealSidebar}
        />
      )}

      {/* Sidebar drawer — spring slides in from left */}
      <motion.aside
        ref={sidebarRef}
        className={baseClass}
        animate={{
          x: revealed ? 0 : getCollapsedX(),
          boxShadow: revealed ? revealedBoxShadow : "none",
          pointerEvents: revealed ? "auto" : "none",
        }}
        transition={sidebarTransition}
        style={{ pointerEvents: revealed ? "auto" : "none" }}
        onMouseEnter={cancelHide}
        onMouseLeave={startHide}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <AnimatePresence mode="wait">
            {revealed && (
              <motion.nav
                key="nav"
                className={styles.nav}
                variants={navContainerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <SortableContext items={panelOrder} strategy={verticalListSortingStrategy}>
                  {panelOrder.map((id, index) => (
                    <SortableNavItemWrapper
                      key={id}
                      id={id}
                      index={index}
                      activePanel={activePanel}
                      isDragActive={!!dragActiveId}
                      badge={getBadge(id)}
                      secondaryBadge={getSecondaryBadge(id)}
                      activity={id === "agents" ? agentActivity : undefined}
                      onClick={() => {
                        setActivePanel(id);
                        if (id === "agents" && unseenCompletions > 0) {
                          clearUnseenCompletions();
                        }
                      }}
                    />
                  ))}
                </SortableContext>
              </motion.nav>
            )}
          </AnimatePresence>

          <DragOverlay dropAnimation={null}>
            {dragActiveId && (
              <DragOverlayItem
                id={dragActiveId}
                activePanel={activePanel}
                badge={getBadge(dragActiveId)}
                secondaryBadge={getSecondaryBadge(dragActiveId)}
                activity={dragActiveId === "agents" ? agentActivity : undefined}
              />
            )}
          </DragOverlay>
        </DndContext>

        {/* Pulse edge — attached to sidebar's right edge, moves with it */}
        <div
          className={styles.pulseEdge}
          style={edgeStyle}
        />
      </motion.aside>
    </>
  );
}
