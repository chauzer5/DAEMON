import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TodoRule {
  id: string;
  source: "slack" | "gitlab" | "linear";
  enabled: boolean;
  label: string;
  channel?: string;
  keywords?: string[];
  aiExtraction?: boolean;
}

export type TodoItemType = "linked" | "pinned" | "dismissed" | "manual";

export interface TodoItem {
  id: string;
  type: TodoItemType;
  source: "slack" | "gitlab" | "linear" | "manual";
  title: string;
  subtitle?: string;
  url?: string;
  priority: "high" | "medium" | "low";
  ruleId: string;
  updatedAt: string;
  nav?: {
    panel: string;
    projectId?: number;
    iid?: number;
  };
}

export interface ManualTodo {
  id: string;
  source: "slack" | "gitlab" | "linear" | "manual";
  title: string;
  subtitle?: string;
  url?: string;
  priority: "high" | "medium" | "low";
  createdAt: string;
  /** For internal navigation (e.g., open a specific MR) */
  nav?: {
    panel: string;
    projectId?: number;
    iid?: number;
  };
}

interface TodoState {
  pinnedIds: Set<string>;
  dismissedIds: Set<string>;
  customRules: TodoRule[];
  manualTodos: ManualTodo[];
  pinItem: (id: string) => void;
  unpinItem: (id: string) => void;
  dismissItem: (id: string) => void;
  undismissItem: (id: string) => void;
  addRule: (rule: TodoRule) => void;
  removeRule: (ruleId: string) => void;
  toggleRule: (ruleId: string) => void;
  addManualTodo: (todo: ManualTodo) => void;
  removeManualTodo: (id: string) => void;
}

export const useTodoStore = create<TodoState>()(
  persist(
    (set) => ({
      pinnedIds: new Set(),
      dismissedIds: new Set(),
      customRules: [],
      manualTodos: [],

      pinItem: (id) =>
        set((s) => {
          const next = new Set(s.pinnedIds);
          next.add(id);
          return { pinnedIds: next };
        }),

      unpinItem: (id) =>
        set((s) => {
          const next = new Set(s.pinnedIds);
          next.delete(id);
          return { pinnedIds: next };
        }),

      dismissItem: (id) =>
        set((s) => {
          const next = new Set(s.dismissedIds);
          next.add(id);
          return { dismissedIds: next };
        }),

      undismissItem: (id) =>
        set((s) => {
          const next = new Set(s.dismissedIds);
          next.delete(id);
          return { dismissedIds: next };
        }),

      addRule: (rule) =>
        set((s) => ({ customRules: [...s.customRules, rule] })),

      removeRule: (ruleId) =>
        set((s) => ({
          customRules: s.customRules.filter((r) => r.id !== ruleId),
        })),

      toggleRule: (ruleId) =>
        set((s) => ({
          customRules: s.customRules.map((r) =>
            r.id === ruleId ? { ...r, enabled: !r.enabled } : r,
          ),
        })),

      addManualTodo: (todo) =>
        set((s) => ({ manualTodos: [...s.manualTodos, todo] })),

      removeManualTodo: (id) =>
        set((s) => ({
          manualTodos: s.manualTodos.filter((t) => t.id !== id),
          dismissedIds: (() => {
            const next = new Set(s.dismissedIds);
            next.delete(id);
            return next;
          })(),
        })),
    }),
    {
      name: "daemon-todos",
      partialize: (state) => ({
        manualTodos: state.manualTodos,
        pinnedIds: [...state.pinnedIds],
        dismissedIds: [...state.dismissedIds],
      }),
      merge: (persisted: unknown, current) => {
        const p = persisted as { manualTodos?: ManualTodo[]; pinnedIds?: string[]; dismissedIds?: string[] } | undefined;
        return {
          ...current,
          manualTodos: p?.manualTodos ?? [],
          pinnedIds: new Set(p?.pinnedIds ?? []),
          dismissedIds: new Set(p?.dismissedIds ?? []),
        };
      },
    },
  ),
);
