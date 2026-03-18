import { create } from "zustand";

export type PanelId = "hub" | "slack" | "gitlab" | "agents" | "linear" | "todos";

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
  pendingThread: PendingThread | null;
  pendingMR: PendingMR | null;

  // Navigation history
  historyBack: PanelId[];
  historyForward: PanelId[];
  canGoBack: boolean;
  canGoForward: boolean;

  setActivePanel: (id: PanelId) => void;
  openSlackThread: (thread: PendingThread) => void;
  clearPendingThread: () => void;
  openMR: (mr: PendingMR) => void;
  clearPendingMR: () => void;
  toggleSidebar: () => void;
  goBack: () => void;
  goForward: () => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  activePanel: "hub",
  sidebarCollapsed: false,
  pendingThread: null,
  pendingMR: null,
  historyBack: [],
  historyForward: [],
  canGoBack: false,
  canGoForward: false,

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
