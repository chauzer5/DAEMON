import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Link2,
  MessageSquare,
  GitMerge,
  LayoutList,
  Activity,
  Target,
} from "lucide-react";
import { getPersonaById } from "../../config/personas";
import {
  useMonitorStore,
  hydrateTemplate,
  type MonitorEvent,
} from "../../stores/monitorStore";
import {
  useEventContext,
  type ContextField,
} from "../../hooks/useEventContext";
import type { CorrelationSource, CorrelationEntity } from "../../stores/correlationStore";
import styles from "./AgentToast.module.css";

const AUTO_DISMISS_MS = 30_000;

// Source icon mapping for related items
const SOURCE_ICONS: Record<CorrelationSource, typeof MessageSquare> = {
  slack: MessageSquare,
  gitlab: GitMerge,
  linear: LayoutList,
  datadog: Activity,
  focus: Target,
};

const ACCENT_CLASS: Record<string, string> = {
  cyan: styles.accentCyan,
  green: styles.accentGreen,
  red: styles.accentRed,
  magenta: styles.accentMagenta,
  muted: styles.accentMuted,
};

interface AgentToastProps {
  event: MonitorEvent;
}

export function AgentToast({ event }: AgentToastProps) {
  const persona = getPersonaById(event.personaId);
  const [contextOpen, setContextOpen] = useState(false);

  // Look up rule once — rules don't change during a toast's lifetime.
  const rule = useMemo(
    () => useMonitorStore.getState().rules.find((r) => r.id === event.ruleId),
    [event.ruleId],
  );

  // Context summary from cache + correlation engine
  const { fields, related } = useEventContext(event);
  const hasContext = fields.length > 0 || related.length > 0;

  // Track whether the toast has been acted on so we stop the timer
  const actedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss after timeout
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      if (!actedRef.current) {
        actedRef.current = true;
        useMonitorStore.getState().dismissEvent(event.id);
      }
    }, AUTO_DISMISS_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [event.id]);

  const handleAccept = useCallback(() => {
    if (actedRef.current) return;
    actedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    useMonitorStore.getState().dispatchEvent(event.id);
  }, [event.id]);

  const handleDismiss = useCallback(() => {
    if (actedRef.current) return;
    actedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    useMonitorStore.getState().dismissEvent(event.id);
  }, [event.id]);

  if (!persona || !rule) return null;

  const toastMessage = hydrateTemplate(rule.toastTemplate, event.context);

  return (
    <motion.div
      className={styles.toast}
      style={{ "--agent-color": persona.color } as React.CSSProperties}
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      layout
    >
      {persona.avatar && (
        <img
          src={persona.avatar}
          alt={persona.name}
          className={styles.avatar}
        />
      )}

      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.name}>{persona.name}</span>
          <span className={styles.role}>{persona.role}</span>
          <span className={styles.sourceBadge}>{event.source}</span>
        </div>

        <div className={styles.message}>{toastMessage}</div>

        {/* Context toggle + preview */}
        {hasContext && (
          <>
            <button
              className={`${styles.contextToggle} ${contextOpen ? styles.contextToggleOpen : ""}`}
              onClick={() => setContextOpen(!contextOpen)}
            >
              <ChevronDown size={10} className={styles.contextChevron} />
              Context
              {related.length > 0 && (
                <span className={styles.contextRelatedCount}>
                  <Link2 size={8} />
                  {related.length}
                </span>
              )}
            </button>

            <AnimatePresence>
              {contextOpen && (
                <motion.div
                  className={styles.contextPanel}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  {/* Metadata fields */}
                  {fields.length > 0 && (
                    <div className={styles.contextFields}>
                      {fields.map((field, i) => (
                        <ContextFieldRow key={i} field={field} />
                      ))}
                    </div>
                  )}

                  {/* Related items from correlation engine */}
                  {related.length > 0 && (
                    <div className={styles.contextRelated}>
                      <div className={styles.contextRelatedHeader}>
                        <Link2 size={9} />
                        <span>Related</span>
                      </div>
                      {related.slice(0, 6).map((entity) => (
                        <RelatedRow key={entity.id} entity={entity} />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        <div className={styles.actions}>
          <button className={styles.acceptBtn} onClick={handleAccept}>
            On it
          </button>
          <button className={styles.dismissBtn} onClick={handleDismiss}>
            Dismiss
          </button>
        </div>
      </div>

      {/* Auto-dismiss progress — pure CSS animation, no re-renders */}
      <div className={styles.progressBar} />
    </motion.div>
  );
}

// ── Sub-components ──

function ContextFieldRow({ field }: { field: ContextField }) {
  const accentClass = field.accent ? ACCENT_CLASS[field.accent] : "";
  return (
    <div className={styles.contextFieldRow}>
      <span className={styles.contextFieldLabel}>{field.label}</span>
      <span className={`${styles.contextFieldValue} ${accentClass}`}>{field.value}</span>
    </div>
  );
}

function RelatedRow({ entity }: { entity: CorrelationEntity }) {
  const Icon = SOURCE_ICONS[entity.source] ?? Link2;
  return (
    <div className={styles.relatedRow}>
      <Icon size={10} className={styles.relatedIcon} />
      <span className={styles.relatedLabel}>{entity.label}</span>
    </div>
  );
}
