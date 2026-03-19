import { useQuery } from "@tanstack/react-query";
import { fetchThreadReplies } from "../services/tauri-bridge";

export function useThreadReplies(channelId: string, threadTs: string, enabled: boolean) {
  return useQuery({
    queryKey: ["slack", "thread", channelId, threadTs],
    queryFn: () => fetchThreadReplies(channelId, threadTs),
    enabled,
    refetchInterval: 60_000,
  });
}
