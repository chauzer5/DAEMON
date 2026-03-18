import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, ChevronDown, ChevronRight, Bell, BellOff, ArrowLeft, ExternalLink, CheckCircle2, ListPlus } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Panel } from "../../components/layout/Panel";
import { RetroLoader } from "../../components/ui/RetroLoader";
import { ErrorState } from "../../components/ui/ErrorState";
import { useSlackSections } from "../../hooks";
import { useThreadReplies } from "../../hooks/useThreadReplies";
import { fetchThreadReplies, markAsRead } from "../../services/tauri-bridge";
import { useThreadSubscriptionStore } from "../../stores/threadSubscriptionStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { ActionMenu } from "../../components/ai/ActionMenu";
import { AgentPromptBar } from "../../components/ai/AgentPromptBar";
import { CreateTodoModal } from "../../components/ui/CreateTodoModal";
import type { SlackSection, SlackMessage } from "../../types/models";
import styles from "./SlackPanel.module.css";

// ── Framer Motion variants ─────────────────────────────────────
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const sectionVariants = {
  hidden: { opacity: 0, x: -24, filter: "blur(4px)" },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: {
      delay: i * 0.07,
      duration: 0.35,
      ease: EASE_OUT,
    },
  }),
} satisfies Record<string, object>;

const threadRowVariants = {
  hidden: { opacity: 0, x: -20, filter: "blur(3px)" },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: {
      delay: i * 0.055,
      duration: 0.3,
      ease: EASE_OUT,
    },
  }),
  exit: {
    opacity: 0,
    x: -12,
    filter: "blur(3px)",
    transition: { duration: 0.18 },
  },
} satisfies Record<string, object>;

const replyVariants = {
  hidden: { opacity: 0, y: -10, scaleY: 0.92, filter: "brightness(2) blur(2px)" },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scaleY: 1,
    filter: "brightness(1) blur(0px)",
    transition: {
      delay: i * 0.06,
      duration: 0.38,
      ease: EASE_OUT,
    },
  }),
} satisfies Record<string, object>;

const expandVariants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: "auto",
    opacity: 1,
    transition: { duration: 0.3, ease: EASE_OUT },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.22, ease: "easeIn" as const },
  },
} satisfies Record<string, object>;

// ── Thread Loader ─────────────────────────────────────────────
const THREAD_LOADING_LINES = [
  "Intercepting thread data stream...",
  "Decrypting conversation payload...",
  "Reconstructing message timeline...",
  "Tracing reply chains through the void...",
  "Downloading corporate banter...",
  "Parsing threaded discourse...",
];

function ThreadLoader() {
  const [lineIdx, setLineIdx] = useState(() => Math.floor(Math.random() * THREAD_LOADING_LINES.length));

  useEffect(() => {
    const iv = setInterval(() => setLineIdx((i) => (i + 1) % THREAD_LOADING_LINES.length), 2200);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className={styles.threadLoader}>
      <div className={styles.threadLoaderBars}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={styles.threadLoaderBar} style={{ animationDelay: `${i * 0.12}s` }} />
        ))}
      </div>
      <div className={styles.threadLoaderText}>{THREAD_LOADING_LINES[lineIdx]}</div>
      <div className={styles.threadLoaderScanline} />
    </div>
  );
}

// ── Thread Detail View ────────────────────────────────────────
function ThreadDetailView({
  channelId,
  threadTs,
  onBack,
}: {
  channelId: string;
  threadTs: string;
  onBack: () => void;
}) {
  const { data: replies, isLoading } = useThreadReplies(
    channelId,
    threadTs,
    true
  );
  const { subscriptions, subscribe, unsubscribe } = useThreadSubscriptionStore();
  const [animating, setAnimating] = useState(false);
  const [showCreateTodo, setShowCreateTodo] = useState(false);

  const subId = `${channelId}:${threadTs}`;
  const isSubscribed = subscriptions.some((s) => s.id === subId);

  // Sort by raw_ts ascending (chronological)
  const sorted = useMemo(() => {
    if (!replies) return [];
    return [...replies].sort((a, b) => a.raw_ts.localeCompare(b.raw_ts));
  }, [replies]);

  const root = sorted[0];

  const handleWatch = () => {
    if (isSubscribed) {
      unsubscribe(subId);
    } else if (root) {
      setAnimating(true);
      subscribe({
        id: subId,
        channelId,
        channelName: root.channel,
        threadTs,
        label: root.message.slice(0, 60),
        summary: root.message.slice(0, 60),
        sender: root.sender,
        lastKnownReplyTs: sorted.length > 1 ? sorted[sorted.length - 1].raw_ts : null,
        latestReplyTs: sorted.length > 1 ? sorted[sorted.length - 1].raw_ts : null,
      });
      setTimeout(() => setAnimating(false), 800);
    }
  };

  return (
    <div className={styles.threadDetail}>
      <div className={styles.threadDetailToolbar}>
        <button className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={12} />
          Back
        </button>
        {root && (
          <button
            className={`${styles.watchBtn} ${isSubscribed ? styles.watchBtnActive : ""} ${animating ? styles.watchBtnPop : ""}`}
            onClick={handleWatch}
            title={isSubscribed ? "Unwatch thread" : "Watch thread — shows on Hub"}
          >
            {isSubscribed ? <BellOff size={12} /> : <Bell size={12} />}
            <span>{isSubscribed ? "Watching" : "Watch"}</span>
          </button>
        )}
        {root && (
          <button
            className={styles.watchBtn}
            onClick={() => setShowCreateTodo(true)}
            title="Create To-Do from thread"
          >
            <ListPlus size={12} />
            <span>To-Do</span>
          </button>
        )}
        {root && (
          <ActionMenu
            source="slack"
            context={{
              message: root.message,
              sender: root.sender,
              channel: root.channel,
              channelId: root.channel_id,
              threadTs: root.raw_ts,
              permalink: root.permalink,
            }}
          />
        )}
      </div>
      {root && (
        <AgentPromptBar
          contextLabel={`Thread in ${root.channel}`}
          contextPrefix={`Regarding Slack thread in ${root.channel}\nFrom: ${root.sender}\nMessage: ${root.message}\nPermalink: ${root.permalink}`}
        />
      )}
      {showCreateTodo && root && (
        <CreateTodoModal
          preset={{
            source: "slack",
            title: `${root.sender}: ${root.message.slice(0, 80)}`,
            subtitle: root.channel,
            url: root.permalink,
          }}
          onClose={() => setShowCreateTodo(false)}
        />
      )}
      <div className={styles.threadDetailMessages}>
        {isLoading && <ThreadLoader />}
        {sorted.map((msg, i) => (
          <motion.div
            key={msg.id}
            className={`${styles.replyRow} ${i === 0 ? styles.replyRowRoot : styles.replyRowIndent}`}
            custom={i}
            variants={replyVariants}
            initial="hidden"
            animate="visible"
          >
            <div className={styles.replyHeader}>
              <span className={styles.replySender}>{msg.sender}</span>
              <span className={styles.replyTimestamp}>{msg.timestamp}</span>
              {msg.permalink && (
                <button
                  className={styles.openInSlackBtn}
                  onClick={() => open(msg.permalink)}
                >
                  <ExternalLink size={10} />
                </button>
              )}
            </div>
            <p className={styles.replyBody}>{msg.message}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Thread Row ────────────────────────────────────────────────
function ThreadRow({
  msg,
  isSubscribed,
  onSubscribe,
  onUnsubscribe,
  onClick,
  showChannel,
}: {
  msg: SlackMessage;
  isSubscribed: boolean;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  onClick: () => void;
  showChannel?: boolean;
}) {
  const [animating, setAnimating] = useState(false);
  const [showTodoModal, setShowTodoModal] = useState(false);
  const preview = msg.message.length > 80
    ? msg.message.slice(0, 80) + "…"
    : msg.message;

  const handleWatch = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSubscribed) {
      onUnsubscribe();
    } else {
      setAnimating(true);
      onSubscribe();
      setTimeout(() => setAnimating(false), 800);
    }
  };

  return (
    <motion.div
      className={`${styles.threadRow} ${msg.is_unread ? styles.threadRowUnread : ""}`}
      whileHover={{
        x: 3,
        boxShadow: msg.is_unread
          ? "inset 3px 0 12px rgba(57,255,20,0.15), 0 0 16px rgba(57,255,20,0.08)"
          : "inset 0 0 12px rgba(0,255,245,0.06), 0 0 12px rgba(0,255,245,0.05)",
        transition: { duration: 0.15 },
      }}
    >
      <div
        className={styles.threadRowMain}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      >
        <div className={styles.threadRowHeader}>
          <span className={styles.sender}>{msg.sender}</span>
          {showChannel && <span className={styles.threadChannel}>{msg.channel}</span>}
          <span className={styles.timestamp}>{msg.timestamp}</span>
          {msg.reply_count > 0 && (
            <span className={styles.replyBadge}>
              {msg.reply_count} {msg.reply_count === 1 ? "reply" : "replies"}
            </span>
          )}
        </div>
        <p className={styles.threadPreview}>{preview}</p>
      </div>
      <div className={styles.threadRowActions}>
        <button
          className={`${styles.watchBtn} ${isSubscribed ? styles.watchBtnActive : ""} ${animating ? styles.watchBtnPop : ""}`}
          onClick={handleWatch}
          title={isSubscribed ? "Unwatch thread" : "Watch thread — shows on Hub"}
        >
          {isSubscribed ? <BellOff size={12} /> : <Bell size={12} />}
          <span>{isSubscribed ? "Watching" : "Watch"}</span>
        </button>
        <button
          className={styles.quickTodoBtn}
          onClick={(e) => {
            e.stopPropagation();
            setShowTodoModal(true);
          }}
          title="Create To-Do"
        >
          <ListPlus size={12} />
        </button>
        <ActionMenu
          source="slack"
          context={{
            message: msg.message,
            sender: msg.sender,
            channel: msg.channel,
            channelId: msg.channel_id,
            threadTs: msg.raw_ts,
            permalink: msg.permalink,
          }}
        />
      </div>
      {showTodoModal && (
        <CreateTodoModal
          preset={{
            source: "slack",
            title: `${msg.sender}: ${msg.message.slice(0, 80)}`,
            subtitle: msg.channel,
            url: msg.permalink,
          }}
          onClose={() => setShowTodoModal(false)}
        />
      )}
    </motion.div>
  );
}

// ── Channel Section ───────────────────────────────────────────
function ChannelSection({
  section,
  onThreadClick,
  onRefresh,
}: {
  section: SlackSection;
  onThreadClick: (msg: SlackMessage) => void;
  onRefresh: () => void;
}) {
  const isMyThreads = section.section_type === "my_threads";
  const [expanded, setExpanded] = useState(isMyThreads || section.unread_count > 0);
  const { subscriptions, subscribe, unsubscribe } = useThreadSubscriptionStore();
  const subscribedIds = useMemo(() => new Set(subscriptions.map((s) => s.id)), [subscriptions]);

  const channelName = section.title;

  const sectionColor =
    section.section_type === "my_threads"
      ? styles.sectionMyThreads
      : section.section_type === "mentions"
        ? styles.sectionMentions
        : section.section_type === "search"
          ? styles.sectionSearch
          : styles.sectionChannel;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeaderRow}>
        <button
          className={`${styles.sectionHeader} ${sectionColor}`}
          onClick={() => setExpanded(!expanded)}
        >
          <span className={styles.chevron}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className={styles.sectionTitle}>{channelName}</span>
          {section.unread_count > 0 && (
            <span className={styles.unreadBadge}>{section.unread_count}</span>
          )}
          <span className={styles.sectionBadge}>{section.messages.length}</span>
        </button>
        {section.unread_count > 0 && section.messages.length > 0 && (
          <button
            className={styles.markReadBtn}
            onClick={async (e) => {
              e.stopPropagation();
              const latest = section.messages.reduce((a, b) =>
                a.raw_ts > b.raw_ts ? a : b
              );
              await markAsRead(latest.channel_id, latest.raw_ts);
              onRefresh();
            }}
            title="Mark as read"
          >
            <CheckCircle2 size={12} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className={styles.sectionMessages}
            variants={expandVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{ overflow: "hidden" }}
          >
            {section.messages.length === 0 && (
              <div className={styles.emptySection}>No messages</div>
            )}
            {section.messages.map((msg, i) => {
              const subId = `${msg.channel_id}:${msg.raw_ts}`;
              // For my_threads, each message knows its own channel
              const threadChannelName = isMyThreads ? msg.channel : channelName;
              return (
                <motion.div
                  key={msg.id}
                  custom={i}
                  variants={threadRowVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <ThreadRow
                    msg={msg}
                    showChannel={isMyThreads}
                    isSubscribed={subscribedIds.has(subId)}
                    onSubscribe={() =>
                      subscribe({
                        id: subId,
                        channelId: msg.channel_id,
                        channelName: threadChannelName,
                        threadTs: msg.raw_ts,
                        label: msg.message.slice(0, 60),
                        summary: msg.message.slice(0, 60),
                        sender: msg.sender,
                        lastKnownReplyTs: msg.latest_reply_ts,
                        latestReplyTs: msg.latest_reply_ts,
                      })
                    }
                    onUnsubscribe={() => unsubscribe(subId)}
                    onClick={() => onThreadClick(msg)}
                  />
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Parse Slack thread URL ────────────────────────────────────
function parseSlackUrl(url: string): { channelId: string; threadTs: string } | null {
  // Format: https://xxx.slack.com/archives/CXXXXXXXX/pTTTTTTTTTTTTTTTT
  const match = url.match(/\/archives\/([A-Z0-9]+)\/p(\d+)/);
  if (!match) return null;
  const channelId = match[1];
  // Convert p-format to ts format: p1773683042597019 → 1773683042.597019
  const raw = match[2];
  const threadTs = raw.slice(0, 10) + "." + raw.slice(10);
  return { channelId, threadTs };
}

// ── Watch Thread URL input ────────────────────────────────────
function WatchThreadInput({ onWatch }: { onWatch: (channelId: string, threadTs: string) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const { subscribe } = useThreadSubscriptionStore();
  const { data: sections } = useSlackSections();

  const handleSubmit = async () => {
    setError("");
    const parsed = parseSlackUrl(url.trim());
    if (!parsed) {
      setError("Paste a Slack thread URL");
      return;
    }

    // Fetch thread to get root message info
    try {
      const replies = await fetchThreadReplies(parsed.channelId, parsed.threadTs);
      if (replies.length === 0) {
        setError("Thread not found");
        return;
      }
      const root = replies[0];
      // Find channel name from sections or use the ID
      const channelName = sections?.flatMap(s => s.messages)
        .find(m => m.channel_id === parsed.channelId)?.channel
        ?? `#${parsed.channelId}`;

      const subId = `${parsed.channelId}:${parsed.threadTs}`;
      subscribe({
        id: subId,
        channelId: parsed.channelId,
        channelName,
        threadTs: parsed.threadTs,
        label: root.message.slice(0, 60),
        summary: root.message.slice(0, 60),
        sender: root.sender,
        lastKnownReplyTs: replies.length > 1 ? replies[replies.length - 1].raw_ts : null,
        latestReplyTs: replies.length > 1 ? replies[replies.length - 1].raw_ts : null,
      });
      setUrl("");
      onWatch(parsed.channelId, parsed.threadTs);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className={styles.watchInput}>
      <input
        className={styles.watchUrlField}
        placeholder="Paste Slack thread URL to watch..."
        value={url}
        onChange={(e) => { setUrl(e.target.value); setError(""); }}
        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
      />
      <button className={styles.watchUrlBtn} onClick={handleSubmit}>Watch</button>
      {error && <span className={styles.watchUrlError}>{error}</span>}
    </div>
  );
}

// ── Slack Panel ───────────────────────────────────────────────
export function SlackPanel() {
  const { data: sections, isLoading, isError, error, refetch } = useSlackSections();
  const [activeThread, setActiveThread] = useState<{ channelId: string; threadTs: string } | null>(null);
  const pendingThread = useLayoutStore((s) => s.pendingThread);
  const clearPendingThread = useLayoutStore((s) => s.clearPendingThread);

  // If navigated here from Hub with a specific thread, open it
  useEffect(() => {
    if (pendingThread) {
      setActiveThread({ channelId: pendingThread.channelId, threadTs: pendingThread.threadTs });
      clearPendingThread();
    }
  }, [pendingThread, clearPendingThread]);

  const totalUnread = useMemo(() => {
    if (!sections) return 0;
    return sections.reduce((sum, s) => sum + s.unread_count, 0);
  }, [sections]);

  return (
    <Panel
      title="Slack"
      icon={MessageSquare}
      badge={totalUnread > 0 ? `${totalUnread} unread` : undefined}
      badgeVariant={totalUnread > 0 ? "green" : "default"}
      onRefresh={() => refetch()}
    >
      {isLoading && <RetroLoader type="slack" />}
      {isError && <ErrorState message={String(error)} onRetry={() => refetch()} />}

      <AnimatePresence mode="wait">
        {activeThread ? (
          <motion.div
            key="thread-detail"
            initial={{ opacity: 0, x: 30, filter: "blur(6px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)", transition: { duration: 0.35, ease: EASE_OUT } }}
            exit={{ opacity: 0, x: 30, filter: "blur(6px)", transition: { duration: 0.2 } }}
          >
            <ThreadDetailView
              channelId={activeThread.channelId}
              threadTs={activeThread.threadTs}
              onBack={() => setActiveThread(null)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="sections-list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            <WatchThreadInput onWatch={(channelId, threadTs) => setActiveThread({ channelId, threadTs })} />
            {sections?.map((section, i) => (
              <motion.div
                key={section.title}
                custom={i}
                variants={sectionVariants}
                initial="hidden"
                animate="visible"
              >
                <ChannelSection
                  section={section}
                  onThreadClick={(msg) => setActiveThread({ channelId: msg.channel_id, threadTs: msg.raw_ts })}
                  onRefresh={() => refetch()}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}
