import { create } from "zustand";

export type PanelId = "hub" | "slack" | "gitlab" | "agents" | "linear" | "todos" | "archive" | "browser" | "datadog" | "launchdarkly";

/** Default sidebar order — also the canonical list of sidebar-visible panels */
export const DEFAULT_PANEL_ORDER: PanelId[] = [
  "hub", "slack", "linear", "gitlab", "agents", "datadog", "launchdarkly", "browser", "archive",
];

export interface PendingThread {
  channelId: string;
  threadTs: string;
}

export interface PendingMR {
  projectId: number;
  iid: number;
}

interface LayoutState {
  activePanel: PanelId;
  sidebarCollapsed: boolean;
  booting: boolean;
  pendingThread: PendingThread | null;
  pendingMR: PendingMR | null;
  pendingLinearId: string | null;
  pendingMonitorId: number | null;

  // Sidebar panel ordering (persisted to localStorage)
  panelOrder: PanelId[];

  // Navigation history
  historyBack: PanelId[];
  historyForward: PanelId[];
  canGoBack: boolean;
  canGoForward: boolean;

  setActivePanel: (id: PanelId) => void;
  reorderPanels: (order: PanelId[]) => void;
  setBooting: (booting: boolean) => void;
  openSlackThread: (thread: PendingThread) => void;
  clearPendingThread: () => void;
  openMR: (mr: PendingMR) => void;
  clearPendingMR: () => void;
  openLinearTicket: (identifier: string) => void;
  clearPendingLinear: () => void;
  openMonitor: (monitorId: number) => void;
  clearPendingMonitor: () => void;
  toggleSidebar: () => void;
  goBack: () => void;
  goForward: () => void;
}

// Restore persisted sidebar order (or use default)
function loadPanelOrder(): PanelId[] {
  try {
    const raw = localStorage.getItem("daemon-panel-order");
    if (raw) {
      const parsed = JSON.parse(raw) as PanelId[];
      // Ensure all panels are present (handles newly added panels)
      const known = new Set(parsed);
      const merged = [...parsed];
      for (const id of DEFAULT_PANEL_ORDER) {
        if (!known.has(id)) merged.push(id);
      }
      // Remove panels that no longer exist
      return merged.filter((id) => DEFAULT_PANEL_ORDER.includes(id));
    }
  } catch { /* use default */ }
  return [...DEFAULT_PANEL_ORDER];
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  activePanel: "hub",
  sidebarCollapsed: false,
  booting: true,
  pendingThread: null,
  pendingMR: null,
  pendingMonitorId: null,
  pendingLinearId: null,
  panelOrder: loadPanelOrder(),
  historyBack: [],
  historyForward: [],
  canGoBack: false,
  canGoForward: false,

  setBooting: (booting) => set({ booting }),

  reorderPanels: (order) => {
    set({ panelOrder: order });
    localStorage.setItem("daemon-panel-order", JSON.stringify(order));
  },

  setActivePanel: (id) => {
    const { activePanel, historyBack } = get();
    if (id === activePanel) return;
    set({
      activePanel: id,
      historyBack: [...historyBack, activePanel],
      historyForward: [],
      canGoBack: true,
      canGoForward: false,
    });
  },

  openSlackThread: (thread) => {
    const { activePanel, historyBack } = get();
    const newBack = activePanel === "slack" ? historyBack : [...historyBack, activePanel];
    set({
      activePanel: "slack",
      pendingThread: thread,
      historyBack: newBack,
      historyForward: [],
      canGoBack: newBack.length > 0,
      canGoForward: false,
    });
  },

  clearPendingThread: () => set({ pendingThread: null }),

  openMR: (mr) => {
    const { activePanel, historyBack } = get();
    const newBack = activePanel === "gitlab" ? historyBack : [...historyBack, activePanel];
    set({
      activePanel: "gitlab",
      pendingMR: mr,
      historyBack: newBack,
      historyForward: [],
      canGoBack: newBack.length > 0,
      canGoForward: false,
    });
  },

  clearPendingMR: () => set({ pendingMR: null }),

  openLinearTicket: (identifier) => {
    const { activePanel, historyBack } = get();
    const newBack = activePanel === "linear" ? historyBack : [...historyBack, activePanel];
    set({
      activePanel: "linear",
      pendingLinearId: identifier,
      historyBack: newBack,
      historyForward: [],
      canGoBack: newBack.length > 0,
      canGoForward: false,
    });
  },

  clearPendingLinear: () => set({ pendingLinearId: null }),

  openMonitor: (monitorId) => {
    const { activePanel, historyBack } = get();
    const newBack = activePanel === "datadog" ? historyBack : [...historyBack, activePanel];
    set({
      activePanel: "datadog",
      pendingMonitorId: monitorId,
      historyBack: newBack,
      historyForward: [],
      canGoBack: newBack.length > 0,
      canGoForward: false,
    });
  },

  clearPendingMonitor: () => set({ pendingMonitorId: null }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  goBack: () => {
    const { historyBack, historyForward, activePanel } = get();
    if (historyBack.length === 0) return;
    const prev = historyBack[historyBack.length - 1];
    const newBack = historyBack.slice(0, -1);
    set({
      activePanel: prev,
      historyBack: newBack,
      historyForward: [activePanel, ...historyForward],
      canGoBack: newBack.length > 0,
      canGoForward: true,
    });
  },

  goForward: () => {
    const { historyBack, historyForward, activePanel } = get();
    if (historyForward.length === 0) return;
    const next = historyForward[0];
    const newForward = historyForward.slice(1);
    set({
      activePanel: next,
      historyBack: [...historyBack, activePanel],
      historyForward: newForward,
      canGoBack: true,
      canGoForward: newForward.length > 0,
    });
  },
}));
