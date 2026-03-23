import { useQuery } from "@tanstack/react-query";
import { checkGmailAlerts, gmailAlertToSlack } from "../services/tauri-bridge";
import { useEffect, useRef } from "react";

/**
 * Polls Gmail for actionable emails every 5 minutes.
 * When new alerts are found, sends a Slack DM summary.
 */
export function useGmailAlerts() {
  const lastAlertIds = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["gmail", "alerts"],
    queryFn: checkGmailAlerts,
    refetchInterval: 5 * 60_000, // 5 minutes
    retry: false,
  });

  useEffect(() => {
    if (!query.data || query.data.length === 0) return;

    const currentIds = new Set(query.data.map((a) => a.id));
    const hasNew = query.data.some((a) => !lastAlertIds.current.has(a.id));

    if (hasNew && lastAlertIds.current.size > 0) {
      // New alerts appeared since last check — DM ourselves
      gmailAlertToSlack().catch(console.error);
    }

    lastAlertIds.current = currentIds;
  }, [query.data]);

  return query;
}
