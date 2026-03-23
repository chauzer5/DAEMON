import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useMcpHealthStore, type McpHealthEvent } from "../../stores/mcpHealthStore";
import styles from "./McpHealthToast.module.css";

const AUTO_DISMISS_MS = 60_000;

const SERVER_LABELS: Record<string, string> = {
  "datadog-mcp": "Datadog",
  "linear-server": "Linear",
  launchdarkly: "LaunchDarkly",
  figma: "Figma",
  playwright: "Playwright",
};

interface McpHealthToastProps {
  event: McpHealthEvent;
}

export function McpHealthToast({ event }: McpHealthToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useMcpHealthStore((s) => s.dismissEvent);
  const recover = useMcpHealthStore((s) => s.recoverAgent);

  useEffect(() => {
    timerRef.current = setTimeout(() => dismiss(event.id), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [event.id, dismiss]);

  const label = SERVER_LABELS[event.serverName] || event.serverName;
  const isRecovering = event.status === "recovering";

  return (
    <motion.div
      className={styles.toast}
      layout
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <div className={styles.header}>
        <AlertTriangle size={14} className={styles.icon} />
        <span className={styles.title}>MCP Disconnected</span>
      </div>

      <div className={styles.serverName}>{label}</div>

      {event.errorMessage && (
        <div className={styles.errorMsg} title={event.errorMessage}>
          {event.errorMessage}
        </div>
      )}

      {isRecovering ? (
        <div className={styles.status}>Reconnecting...</div>
      ) : (
        <div className={styles.actions}>
          <button
            className={`${styles.actionBtn} ${styles.reconnectBtn}`}
            onClick={() => recover(event.id, "resume")}
          >
            Reconnect
          </button>
          <button
            className={`${styles.actionBtn} ${styles.fallbackBtn}`}
            onClick={() => recover(event.id, "fallback")}
          >
            Use Curl
          </button>
          <button
            className={`${styles.actionBtn} ${styles.dismissBtn}`}
            onClick={() => dismiss(event.id)}
          >
            Dismiss
          </button>
        </div>
      )}
    </motion.div>
  );
}
