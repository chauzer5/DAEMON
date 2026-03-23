import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { recoverMcpAgent } from "../services/tauri-bridge";

export interface McpHealthEvent {
  id: string;
  taskId: string;
  serverName: string;
  errorMessage: string;
  failureCount: number;
  isCritical: boolean;
  status: "pending" | "recovering" | "recovered" | "fallback" | "dismissed";
  detectedAt: string;
}

interface McpHealthState {
  events: McpHealthEvent[];
  addEvent: (event: Omit<McpHealthEvent, "id" | "status" | "detectedAt">) => void;
  updateStatus: (id: string, status: McpHealthEvent["status"]) => void;
  dismissEvent: (id: string) => void;
  recoverAgent: (id: string, strategy: "resume" | "fallback") => void;
}

let nextId = 0;

export const useMcpHealthStore = create<McpHealthState>((set, get) => ({
  events: [],

  addEvent: (event) => {
    // Deduplicate: don't add if we already have a pending event for same task+server
    const existing = get().events.find(
      (e) =>
        e.taskId === event.taskId &&
        e.serverName === event.serverName &&
        (e.status === "pending" || e.status === "recovering"),
    );
    if (existing) return;

    set((s) => ({
      events: [
        ...s.events,
        {
          ...event,
          id: `mcp-${++nextId}`,
          status: "pending" as const,
          detectedAt: new Date().toISOString(),
        },
      ],
    }));
  },

  updateStatus: (id, status) =>
    set((s) => ({
      events: s.events.map((e) => (e.id === id ? { ...e, status } : e)),
    })),

  dismissEvent: (id) =>
    set((s) => ({
      events: s.events.filter((e) => e.id !== id),
    })),

  recoverAgent: async (id, strategy) => {
    const event = get().events.find((e) => e.id === id);
    if (!event) return;

    get().updateStatus(id, "recovering");

    try {
      const result = await recoverMcpAgent(event.taskId, event.serverName, strategy);
      get().updateStatus(id, result === "fallback" ? "fallback" : "recovered");
      // Auto-dismiss after success
      setTimeout(() => get().dismissEvent(id), 5000);
    } catch {
      // Recovery failed — mark as fallback needed
      get().updateStatus(id, "pending");
    }
  },
}));

// ── Tauri event listener (module-level, runs once) ──

listen<{
  task_id: string;
  server_name: string;
  error_message: string;
  failure_count: number;
  is_critical: boolean;
}>("mcp-failure", (event) => {
  const { task_id, server_name, error_message, failure_count, is_critical } =
    event.payload;

  // Only surface critical failures (3+ consecutive)
  if (!is_critical) return;

  useMcpHealthStore.getState().addEvent({
    taskId: task_id,
    serverName: server_name,
    errorMessage: error_message,
    failureCount: failure_count,
    isCritical: is_critical,
  });
});
