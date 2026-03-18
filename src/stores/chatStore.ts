import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──

export type ChatMessageRole = "user" | "agent" | "system";
export type ConversationStatus = "streaming" | "waiting" | "completed" | "failed";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: string;
  isStreaming: boolean;
}

export interface Conversation {
  id: string;
  personaId: string;
  messages: ChatMessage[];
  status: ConversationStatus;
}

// ── Helpers ──

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Store Interface ──

interface ChatState {
  conversations: Record<string, Conversation>;
  activeConversationId: string | null;

  startConversation: (taskId: string, personaId: string, prompt: string) => void;
  appendAgentChunk: (taskId: string, chunk: string) => void;
  finalizeAgentTurn: (taskId: string) => void;
  addUserMessage: (taskId: string, content: string) => void;
  markCompleted: (taskId: string) => void;
  markFailed: (taskId: string) => void;
  setActiveConversation: (id: string | null) => void;
  removeConversation: (id: string) => void;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  conversations: {},
  activeConversationId: null,

  startConversation: (taskId, personaId, prompt) => {
    const conversation: Conversation = {
      id: taskId,
      personaId,
      messages: [
        {
          id: genId("msg"),
          role: "user",
          content: prompt,
          timestamp: new Date().toISOString(),
          isStreaming: false,
        },
      ],
      status: "streaming",
    };
    set((s) => ({
      conversations: { ...s.conversations, [taskId]: conversation },
    }));
  },

  appendAgentChunk: (taskId, chunk) => {
    set((s) => {
      const conv = s.conversations[taskId];
      if (!conv) return s;

      const messages = [...conv.messages];
      const lastMsg = messages[messages.length - 1];

      // If the last message is a streaming agent message, append to it
      if (lastMsg && lastMsg.role === "agent" && lastMsg.isStreaming) {
        messages[messages.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + chunk,
        };
      } else {
        // Create a new streaming agent message
        messages.push({
          id: genId("msg"),
          role: "agent",
          content: chunk,
          timestamp: new Date().toISOString(),
          isStreaming: true,
        });
      }

      return {
        conversations: {
          ...s.conversations,
          [taskId]: { ...conv, messages },
        },
      };
    });
  },

  finalizeAgentTurn: (taskId) => {
    set((s) => {
      const conv = s.conversations[taskId];
      if (!conv) return s;

      const messages = conv.messages.map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false } : msg,
      );

      return {
        conversations: {
          ...s.conversations,
          [taskId]: { ...conv, messages, status: "waiting" },
        },
      };
    });
  },

  addUserMessage: (taskId, content) => {
    const state = get();
    const conv = state.conversations[taskId];
    if (!conv) return;

    const userMsg: ChatMessage = {
      id: genId("msg"),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
      isStreaming: false,
    };

    set((s) => ({
      conversations: {
        ...s.conversations,
        [taskId]: {
          ...conv,
          messages: [...conv.messages, userMsg],
          status: "streaming",
        },
      },
    }));

    // Send to the interactive agent PTY
    invoke("respond_to_agent", {
      taskId,
      questionId: null,
      response: content,
    }).catch(() => {});
  },

  markCompleted: (taskId) => {
    set((s) => {
      const conv = s.conversations[taskId];
      if (!conv) return s;

      const messages = conv.messages.map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false } : msg,
      );

      return {
        conversations: {
          ...s.conversations,
          [taskId]: { ...conv, messages, status: "completed" },
        },
      };
    });
  },

  markFailed: (taskId) => {
    set((s) => {
      const conv = s.conversations[taskId];
      if (!conv) return s;

      const messages = conv.messages.map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false } : msg,
      );

      return {
        conversations: {
          ...s.conversations,
          [taskId]: { ...conv, messages, status: "failed" },
        },
      };
    });
  },

  setActiveConversation: (id) => set({ activeConversationId: id }),

  removeConversation: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.conversations;
      return {
        conversations: rest,
        activeConversationId:
          s.activeConversationId === id ? null : s.activeConversationId,
      };
    }),
}));
