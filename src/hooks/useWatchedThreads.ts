import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useThreadSubscriptionStore } from "../stores/threadSubscriptionStore";
import { fetchThreadReplies } from "../services/tauri-bridge";
import { notifyWatchedThread } from "../services/notifications";

export function useWatchedThreads() {
  const { subscriptions, updateLatest } = useThreadSubscriptionStore();
  const queryClient = useQueryClient();
  // Track previous latestReplyTs to detect *new* replies (not just existing unread)
  const prevLatestRef = useRef<Record<string, string | null>>({});

  useEffect(() => {
    if (subscriptions.length === 0) return;

    const poll = async () => {
      for (const sub of subscriptions) {
        try {
          const replies = await fetchThreadReplies(sub.channelId, sub.threadTs);
          const latest = replies.length > 1 ? replies[replies.length - 1].raw_ts : null;
          const prevLatest = prevLatestRef.current[sub.id];

          // Fire notification if latestReplyTs actually changed since last poll
          if (latest && prevLatest && latest !== prevLatest) {
            const lastReply = replies[replies.length - 1];
            notifyWatchedThread(
              sub.summary || sub.label,
              sub.channelName,
              lastReply.sender,
              lastReply.message,
            );
          }

          prevLatestRef.current[sub.id] = latest;
          updateLatest(sub.id, latest);
          queryClient.setQueryData(["slack", "thread", sub.channelId, sub.threadTs], replies);
        } catch {
          // ignore poll errors
        }
      }
    };

    poll();
    const interval = setInterval(poll, 60_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptions.map((s) => s.id).join(",")]);

  return subscriptions.map((sub) => ({
    ...sub,
    hasNew:
      sub.latestReplyTs !== null &&
      sub.latestReplyTs !== sub.lastKnownReplyTs,
  }));
}
