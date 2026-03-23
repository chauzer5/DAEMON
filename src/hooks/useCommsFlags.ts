import { useQuery } from "@tanstack/react-query";
import { fetchCommsFlags } from "../services/tauri-bridge";

export function useCommsFlags() {
  return useQuery({
    queryKey: ["launchdarkly", "comms-flags"],
    queryFn: fetchCommsFlags,
    refetchInterval: 60_000,
    retry: false,
  });
}
