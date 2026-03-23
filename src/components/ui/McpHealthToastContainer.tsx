import { AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useMcpHealthStore } from "../../stores/mcpHealthStore";
import { McpHealthToast } from "./McpHealthToast";
import styles from "./McpHealthToast.module.css";

export function McpHealthToastContainer() {
  const toasts = useMcpHealthStore(
    useShallow((s) =>
      s.events.filter((e) => e.status === "pending" || e.status === "recovering"),
    ),
  );

  if (toasts.length === 0) return null;

  return (
    <div className={styles.toastContainer}>
      <AnimatePresence mode="popLayout">
        {toasts.slice(0, 3).map((event) => (
          <McpHealthToast key={event.id} event={event} />
        ))}
      </AnimatePresence>
    </div>
  );
}
