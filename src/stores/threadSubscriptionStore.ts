import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ThreadSubscription {
  id: string; // channelId + ":" + threadTs
  channelId: string;
  channelName: string;
  threadTs: string;
  label: string; // first ~60 chars of opening message
  summary: string; // user-editable summary shown on Hub
  sender: string;
  lastKnownReplyTs: string | null; // ts of latest reply we've seen
  latestReplyTs: string | null;    // ts from the live data
  subscribedAt: string;
}

interface ThreadSubscriptionState {
  subscriptions: ThreadSubscription[];
  subscribe: (sub: Omit<ThreadSubscription, "subscribedAt">) => void;
  unsubscribe: (id: string) => void;
  clearAll: () => void;
  markSeen: (id: string, replyTs: string) => void;
  updateLatest: (id: string, latestReplyTs: string | null) => void;
  updateSummary: (id: string, summary: string) => void;
}

export const useThreadSubscriptionStore = create<ThreadSubscriptionState>()(
  persist(
    (set) => ({
      subscriptions: [],
      subscribe: (sub) =>
        set((s) => ({
          subscriptions: s.subscriptions.some((x) => x.id === sub.id)
            ? s.subscriptions
            : [...s.subscriptions, { ...sub, subscribedAt: new Date().toISOString() }],
        })),
      unsubscribe: (id) =>
        set((s) => ({ subscriptions: s.subscriptions.filter((x) => x.id !== id) })),
      clearAll: () => set({ subscriptions: [] }),
      markSeen: (id, replyTs) =>
        set((s) => ({
          subscriptions: s.subscriptions.map((x) =>
            x.id === id ? { ...x, lastKnownReplyTs: replyTs } : x
          ),
        })),
      updateLatest: (id, latestReplyTs) =>
        set((s) => ({
          subscriptions: s.subscriptions.map((x) =>
            x.id === id ? { ...x, latestReplyTs } : x
          ),
        })),
      updateSummary: (id, summary) =>
        set((s) => ({
          subscriptions: s.subscriptions.map((x) =>
            x.id === id ? { ...x, summary } : x
          ),
        })),
    }),
    { name: "thread-subscriptions" }
  )
);
