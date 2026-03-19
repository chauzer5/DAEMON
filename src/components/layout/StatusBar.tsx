import { useState, useEffect, useRef, useCallback } from "react";
import { Check, RefreshCw, Settings } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./StatusBar.module.css";
import { useTheme } from "../../themes";
import { usePersonaStore } from "../../stores/personaStore";
import { useChatStore } from "../../stores/chatStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { getPersonaById } from "../../config/personas";
import { useSlackSections, useMergeRequests, useLinearIssues } from "../../hooks";

// ── Types ──

type ConnectionState = "connected" | "loading" | "error";

interface ServiceInfo {
  name: string;
  state: ConnectionState;
  lastUpdated: number | null;
  isRefetching: boolean;
  error?: string;
  refetch: () => void;
}

// ── Helpers ──

function useClockTime() {
  const [time, setTime] = useState(() => formatTime(new Date()));
  useEffect(() => {
    const interval = setInterval(() => setTime(formatTime(new Date())), 1000);
    return () => clearInterval(interval);
  }, []);
  return time;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function queryToState(status: string, isRefetching: boolean): ConnectionState {
  if (status === "error") return "error";
  if (status === "pending" && !isRefetching) return "loading";
  return "connected";
}

// ── Service Indicator with Tooltip ──

function ServiceIndicator({ service }: { service: ServiceInfo }) {
  const dotClass =
    service.state === "connected"
      ? styles.dotConnected
      : service.state === "loading"
        ? styles.dotLoading
        : styles.dotError;

  return (
    <div className={styles.indicator}>
      <span className={`${styles.dot} ${dotClass}`} />
      <span>{service.name}</span>
      {service.isRefetching && (
        <RefreshCw size={8} className={styles.refetchingSpin} />
      )}

      {/* Hover popup */}
      <div className={styles.servicePopup}>
        <div className={styles.servicePopupHeader}>
          <span className={`${styles.servicePopupDot} ${dotClass}`} />
          <span className={styles.servicePopupName}>{service.name}</span>
          <span
            className={`${styles.servicePopupState} ${
              service.state === "connected"
                ? styles.servicePopupStateOk
                : service.state === "error"
                  ? styles.servicePopupStateErr
                  : styles.servicePopupStateLoad
            }`}
          >
            {service.state === "connected"
              ? "Connected"
              : service.state === "error"
                ? "Error"
                : "Loading..."}
          </span>
        </div>

        {service.error && (
          <div className={styles.servicePopupError}>{service.error}</div>
        )}

        <div className={styles.servicePopupMeta}>
          <span>
            Last polled:{" "}
            {service.lastUpdated ? timeAgo(service.lastUpdated) : "never"}
          </span>
        </div>

        <button
          className={styles.servicePopupRefresh}
          onClick={(e) => {
            e.stopPropagation();
            service.refetch();
          }}
        >
          <RefreshCw size={10} />
          Refresh now
        </button>
      </div>
    </div>
  );
}

// ── Agent Ticker ──

const agentSpring = { type: "spring" as const, stiffness: 400, damping: 25 };

interface TickerAgent {
  id: string;
  personaId: string;
  prompt: string;
  status: "running" | "completed" | "failed" | "question";
  questionId?: string;
  questionText?: string;
}

// ── Question Chip — handles its own answer state ──

interface QuestionChipProps {
  agent: TickerAgent & { questionId: string; questionText: string };
  persona: NonNullable<ReturnType<typeof getPersonaById>>;
}

function QuestionChip({ agent, persona }: QuestionChipProps) {
  const answerQuestion = usePersonaStore((s) => s.answerQuestion);
  const dismissQuestion = usePersonaStore((s) => s.dismissQuestion);
  const setActivePanel = useLayoutStore((s) => s.setActivePanel);
  const conversations = useChatStore((s) => s.conversations);
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Find the task ID associated with this question for chat navigation
  const question = usePersonaStore((s) =>
    s.pendingQuestions.find((q) => q.id === agent.questionId),
  );
  const taskId = question?.taskId;

  const handleNavigateToChat = useCallback(() => {
    if (taskId && conversations[taskId]) {
      useChatStore.getState().setActiveConversation(taskId);
      setActivePanel("agents");
    }
  }, [taskId, conversations, setActivePanel]);

  const handleSend = useCallback(() => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    answerQuestion(agent.questionId, trimmed);
    setAnswer("");
  }, [answer, agent.questionId, answerQuestion]);

  const handleSkip = useCallback(() => {
    dismissQuestion(agent.questionId);
  }, [agent.questionId, dismissQuestion]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleSend();
      if (e.key === "Escape") handleSkip();
      // Prevent event from bubbling up and closing the popup
      e.stopPropagation();
    },
    [handleSend, handleSkip],
  );

  return (
    <motion.div
      key={agent.id}
      className={`${styles.agentTickerItem} ${styles.agentTickerItemQuestion}`}
      initial={{ opacity: 0, scale: 0, width: 0 }}
      animate={{ opacity: 1, scale: 1, width: "auto" }}
      exit={{ opacity: 0, scale: 0, width: 0 }}
      transition={agentSpring}
      style={{ "--agent-color": persona.color } as React.CSSProperties}
      onClick={handleNavigateToChat}
    >
      {persona.avatar && (
        <img
          src={persona.avatar}
          alt={persona.name}
          className={styles.agentTickerAvatar}
        />
      )}
      <span className={styles.agentTickerQuestionBadge}>?</span>
      <span className={styles.agentTickerName}>{persona.name}</span>

      {/* Question popup */}
      <div
        className={styles.agentTickerPopup}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.agentTickerPopupHeader}>
          {persona.avatar && (
            <img
              src={persona.avatar}
              alt={persona.name}
              className={styles.agentTickerPopupAvatar}
            />
          )}
          <div>
            <span
              className={styles.agentTickerPopupName}
              style={{ color: persona.color }}
            >
              {persona.name}
            </span>
            <span className={styles.agentTickerPopupRole}>{persona.role}</span>
          </div>
          <span className={`${styles.servicePopupState} ${styles.servicePopupStateQuestion}`}>
            Needs input
          </span>
        </div>

        <div className={styles.agentTickerPopupPrompt}>
          {agent.questionText}
        </div>

        <div className={styles.agentTickerPopupAnswer}>
          <input
            ref={inputRef}
            type="text"
            className={styles.agentTickerAnswerInput}
            placeholder="Your answer..."
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
          <div className={styles.agentTickerAnswerActions}>
            <button
              className={styles.agentTickerAnswerSend}
              onClick={(e) => { e.stopPropagation(); handleSend(); }}
              disabled={!answer.trim()}
            >
              Send
            </button>
            <button
              className={styles.agentTickerAnswerSkip}
              onClick={(e) => { e.stopPropagation(); handleSkip(); }}
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AgentTicker() {
  const backgroundRuns = usePersonaStore((s) => s.backgroundRuns);
  const activeSingleRun = usePersonaStore((s) => s.activeSingleRun);
  const activeMission = usePersonaStore((s) => s.activeMission);
  const completedUnseen = usePersonaStore((s) => s.completedUnseen);
  const pendingQuestions = usePersonaStore((s) => s.pendingQuestions);
  const dismissCompletedRun = usePersonaStore((s) => s.dismissCompletedRun);
  const setActivePanel = useLayoutStore((s) => s.setActivePanel);

  // Build the set of task IDs that have pending (unanswered) questions so we
  // can suppress the normal "running" chip for those agents.
  const questionTaskIds = new Set(
    pendingQuestions.filter((q) => !q.answered).map((q) => q.taskId),
  );

  const agents: TickerAgent[] = [];

  // Pending questions — shown first (highest priority)
  for (const q of pendingQuestions) {
    if (q.answered) continue;
    agents.push({
      id: `q-${q.id}`,
      personaId: q.personaId,
      prompt: q.question,
      status: "question",
      questionId: q.id,
      questionText: q.question,
    });
  }

  // Running background agents (skip those with an active question)
  for (const run of backgroundRuns) {
    if (questionTaskIds.has(run.id)) continue;
    agents.push({ id: run.id, personaId: run.personaId, prompt: run.prompt, status: "running" });
  }
  // Focused single run (skip if has active question)
  if (activeSingleRun?.status === "running" && !questionTaskIds.has(activeSingleRun.id)) {
    agents.push({
      id: activeSingleRun.id,
      personaId: activeSingleRun.personaId,
      prompt: activeSingleRun.prompt,
      status: "running",
    });
  }
  // Active mission persona
  if (activeMission?.status === "running") {
    const activeEntry = activeMission.timelineEntries.find((e) => e.status === "active");
    if (activeEntry && !questionTaskIds.has(activeEntry.id)) {
      agents.push({
        id: activeEntry.id,
        personaId: activeEntry.personaId,
        prompt: activeMission.description,
        status: "running",
      });
    }
  }
  // Completed but unseen
  for (const run of completedUnseen) {
    agents.push({
      id: run.id,
      personaId: run.personaId,
      prompt: run.prompt,
      status: run.status === "failed" ? "failed" : "completed",
    });
  }

  if (agents.length === 0) return null;

  return (
    <div className={styles.agentTicker}>
      <AnimatePresence>
        {agents.map((agent) => {
          const persona = getPersonaById(agent.personaId);
          if (!persona) return null;

          // Question state — dedicated component
          if (
            agent.status === "question" &&
            agent.questionId != null &&
            agent.questionText != null
          ) {
            return (
              <QuestionChip
                key={agent.id}
                agent={agent as TickerAgent & { questionId: string; questionText: string }}
                persona={persona}
              />
            );
          }

          const isDone = agent.status !== "running";

          return (
            <motion.div
              key={agent.id}
              className={`${styles.agentTickerItem} ${isDone ? styles.agentTickerItemDone : ""}`}
              initial={{ opacity: 0, scale: 0, width: 0 }}
              animate={{ opacity: 1, scale: 1, width: "auto" }}
              exit={{ opacity: 0, scale: 0, width: 0 }}
              transition={agentSpring}
              style={{ "--agent-color": persona.color } as React.CSSProperties}
              onClick={isDone ? () => {
                setActivePanel("agents");
                dismissCompletedRun(agent.id);
              } : undefined}
            >
              {persona.avatar && (
                <img
                  src={persona.avatar}
                  alt={persona.name}
                  className={styles.agentTickerAvatar}
                />
              )}
              {isDone ? (
                <span className={`${styles.agentTickerCheck} ${agent.status === "failed" ? styles.agentTickerCheckFailed : ""}`}>
                  <Check size={8} />
                </span>
              ) : (
                <span className={styles.agentTickerDot} />
              )}
              <span className={styles.agentTickerName}>{persona.name}</span>

              {/* Hover popup */}
              <div className={styles.agentTickerPopup}>
                <div className={styles.agentTickerPopupHeader}>
                  {persona.avatar && (
                    <img
                      src={persona.avatar}
                      alt={persona.name}
                      className={styles.agentTickerPopupAvatar}
                    />
                  )}
                  <div>
                    <span
                      className={styles.agentTickerPopupName}
                      style={{ color: persona.color }}
                    >
                      {persona.name}
                    </span>
                    <span className={styles.agentTickerPopupRole}>
                      {persona.role}
                    </span>
                  </div>
                  {isDone && (
                    <span className={`${styles.servicePopupState} ${
                      agent.status === "completed" ? styles.servicePopupStateOk : styles.servicePopupStateErr
                    }`}>
                      {agent.status === "completed" ? "Done" : "Failed"}
                    </span>
                  )}
                </div>
                <div className={styles.agentTickerPopupPrompt}>
                  {agent.prompt}
                </div>
                {isDone && (
                  <div className={styles.agentTickerPopupHint}>
                    Click to view output
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── Main StatusBar ──

export function StatusBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const time = useClockTime();
  const { theme } = useTheme();
  const { leftTag, rightTag, tickerMessages } = theme.statusBar;
  const tickerLoop = [...tickerMessages, ...tickerMessages];
  const isLcars = theme.layoutStyle === "lcars";

  // Live service status from TanStack Query
  const slack = useSlackSections();
  const gitlab = useMergeRequests();
  const linear = useLinearIssues();

  const services: ServiceInfo[] = [
    {
      name: "Slack",
      state: queryToState(slack.status, slack.isRefetching),
      lastUpdated: slack.dataUpdatedAt || null,
      isRefetching: slack.isRefetching,
      error: slack.error?.message,
      refetch: () => slack.refetch(),
    },
    {
      name: "GitLab",
      state: queryToState(gitlab.status, gitlab.isRefetching),
      lastUpdated: gitlab.dataUpdatedAt || null,
      isRefetching: gitlab.isRefetching,
      error: gitlab.error?.message,
      refetch: () => gitlab.refetch(),
    },
    {
      name: "Linear",
      state: queryToState(linear.status, linear.isRefetching),
      lastUpdated: linear.dataUpdatedAt || null,
      isRefetching: linear.isRefetching,
      error: linear.error?.message,
      refetch: () => linear.refetch(),
    },
  ];

  if (isLcars) {
    return (
      <div className={styles.statusBarLcars}>
        <div className={styles.lcarsStatusSegments}>
          <div className={styles.lcarsStatusPillLeft} style={{ background: "#cc9966" }}>
            <span className={styles.lcarsStatusTagText}>{leftTag}</span>
          </div>
          <div className={styles.lcarsStatusIndicators}>
            {services.map((service) => (
              <span
                key={service.name}
                className={`${styles.lcarsStatusLabel} ${service.state === "connected" ? styles.lcarsStatusLabelConnected : styles.lcarsStatusLabelDisconnected}`}
              >
                {service.name}
              </span>
            ))}
          </div>
          <div className={styles.lcarsStatusFillSeg} style={{ background: "#ff9933" }}>
            <div className={styles.lcarsTickerMask}>
              <div className={styles.lcarsTickerInner}>
                {tickerLoop.map((msg, idx) => (
                  <span key={idx}>{msg}</span>
                ))}
              </div>
            </div>
          </div>
          <div className={styles.lcarsStatusTimeText}>{time}</div>
          <button className={styles.settingsBtnLcars} onClick={onOpenSettings}>
            <Settings size={13} />
          </button>
          <div className={styles.lcarsStatusElbow} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.statusBar}>
      <div className={styles.indicators}>
        {services.map((service) => (
          <ServiceIndicator key={service.name} service={service} />
        ))}
      </div>
      <AgentTicker />
      <div className={styles.dataTicker}>
        <div className={styles.dataTickerInner}>
          {tickerLoop.map((msg, idx) => (
            <span key={idx}>{msg}</span>
          ))}
        </div>
      </div>
      <div className={styles.rightSection}>
        <span className={styles.hudTagAlt}>{rightTag}</span>
        <span className={styles.timestamp}>{time}</span>
        <button className={styles.settingsBtn} onClick={onOpenSettings}>
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
