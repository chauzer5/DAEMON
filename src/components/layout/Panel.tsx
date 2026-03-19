import { type ReactNode, useState, useCallback } from "react";
import { type LucideIcon, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./Panel.module.css";
import { useTheme } from "../../themes";

interface PanelProps {
  title: string;
  icon: LucideIcon;
  badge?: string | number;
  badgeVariant?: "default" | "green";
  onRefresh?: () => void;
  children: ReactNode;
  style?: React.CSSProperties;
  /** Zero-based index for staggered mount — panels with higher index animate in later */
  index?: number;
}

// ── Animation Variants ──────────────────────────────────────────────────────

/** Container: slides up from below with spring physics */
const panelVariants = {
  hidden: {
    opacity: 0,
    y: 32,
    scale: 0.97,
    filter: "blur(4px)",
  },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      type: "spring" as const,
      stiffness: 280,
      damping: 22,
      mass: 0.8,
      delay: i * 0.07,
    },
  }),
};

/** Header: quick fade + very slight upward nudge, fires after container starts */
const headerVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 28,
      delay: i * 0.07 + 0.12,
    },
  }),
};

/** Content: fades in last so the shell draws first */
const contentVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 220,
      damping: 26,
      delay: i * 0.07 + 0.22,
    },
  }),
};

/**
 * Minimal LCARS color scheme per panel.
 * Each panel uses ONE primary color and ONE accent — not a rainbow.
 */
const LCARS_PANEL_COLORS: Record<string, { primary: string; accent: string }> = {
  "Hub":         { primary: "#cc9966", accent: "#ff9933" },   // tan + orange
  "Slack":       { primary: "#ff9933", accent: "#cc9966" },   // orange + tan
  "GitLab MRs":  { primary: "#9999ff", accent: "#9966cc" },   // blue + purple
  "Agent Teams": { primary: "#9966cc", accent: "#ff9933" },   // purple + orange
  "Linear":      { primary: "#cc9966", accent: "#9999ff" },   // tan + blue
  "To-Dos":      { primary: "#33cc99", accent: "#9966cc" },   // green + purple
};

const LCARS_DEFAULT_COLORS = { primary: "#ff9933", accent: "#cc9966" };

function getLcarsPanelColors(title: string) {
  return LCARS_PANEL_COLORS[title] ?? LCARS_DEFAULT_COLORS;
}

export function Panel({ title, icon: Icon, badge, badgeVariant = "default", onRefresh, children, style, index = 0 }: PanelProps) {
  const { theme } = useTheme();
  const isLcars = theme.layoutStyle === "lcars";
  const [spinning, setSpinning] = useState(false);

  const handleRefresh = useCallback(() => {
    if (!onRefresh || spinning) return;
    setSpinning(true);
    onRefresh();
    setTimeout(() => setSpinning(false), 600);
  }, [onRefresh, spinning]);

  if (isLcars) {
    return (
      <LcarsPanel
        title={title}
        icon={Icon}
        badge={badge}
        badgeVariant={badgeVariant}
        onRefresh={onRefresh ? handleRefresh : undefined}
        spinning={spinning}
        style={style}
      >
        {children}
      </LcarsPanel>
    );
  }

  return (
    <motion.div
      className={styles.panel}
      style={style}
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      custom={index}
      // Hover: subtle border glow pulse via box-shadow — keeps CSS effects alive
      whileHover={{
        boxShadow: [
          "0 0 2px rgba(176,38,255,0.6), 0 0 8px rgba(176,38,255,0.3), 0 0 18px rgba(0,255,245,0.15), inset 0 0 10px rgba(176,38,255,0.05)",
          "0 0 4px rgba(0,255,245,0.7), 0 0 14px rgba(0,255,245,0.35), 0 0 28px rgba(176,38,255,0.18), inset 0 0 14px rgba(0,255,245,0.07)",
          "0 0 2px rgba(176,38,255,0.6), 0 0 8px rgba(176,38,255,0.3), 0 0 18px rgba(0,255,245,0.15), inset 0 0 10px rgba(176,38,255,0.05)",
        ],
        transition: {
          boxShadow: { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
        },
      }}
    >
      {/* Corner decorations — pure CSS, untouched */}
      <span className={styles.cornerTL} />
      <span className={styles.cornerTR} />
      <span className={styles.cornerBL} />
      <span className={styles.cornerBR} />

      {/* ── Border-draw overlay: SVG traces in on mount ── */}
      <BorderDraw index={index} />

      {/* Header — slides in from left with mount shimmer */}
      <motion.div
        className={styles.header}
        variants={headerVariants}
        initial="hidden"
        animate="visible"
        custom={index}
      >
        <Icon size={16} className={styles.icon} />
        <span className={styles.title}>{title}</span>
        {badge !== undefined && (
          <AnimatePresence mode="popLayout">
            <motion.span
              key={String(badge)}
              className={`${styles.badge} ${badgeVariant === "green" ? styles.badgeGreen : ""}`}
              initial={{ opacity: 0, scale: 0.7, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: "spring", stiffness: 450, damping: 22 }}
            >
              {badge}
            </motion.span>
          </AnimatePresence>
        )}
        {onRefresh && (
          <motion.button
            className={`${styles.refreshBtn} ${spinning ? styles.refreshBtnSpinning : ""}`}
            onClick={handleRefresh}
            title="Refresh"
            whileHover={{ scale: 1.15, rotate: 15 }}
            whileTap={{ scale: 0.9, rotate: -30 }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
          >
            <RefreshCw size={12} />
          </motion.button>
        )}
      </motion.div>

      {/* Content — fades in last, after container and header are placed */}
      <motion.div
        className={styles.content}
        variants={contentVariants}
        initial="hidden"
        animate="visible"
        custom={index}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

// ── Border Draw Component ───────────────────────────────────────────────────
// Renders an SVG rect whose stroke-dashoffset animates from full-perimeter to 0,
// creating the effect of the border drawing itself on mount.  Layered on top of
// the CSS border so the CSS border handles normal/hover states and this handles
// only the entry animation.

interface BorderDrawProps {
  index: number;
}

function BorderDraw({ index }: BorderDrawProps) {
  // Animate from no-stroke (pathLength=0) to full stroke (pathLength=1)
  return (
    <motion.svg
      className={styles.borderDraw}
      aria-hidden="true"
      preserveAspectRatio="none"
      // viewBox is irrelevant because we use width/height 100% and a % rect
      viewBox="0 0 100 100"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ delay: index * 0.07 + 0.75, duration: 0.4 }}
    >
      <motion.rect
        x="0.5"
        y="0.5"
        width="99"
        height="99"
        rx="3.5"
        fill="none"
        stroke="url(#borderGrad)"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0, pathOffset: 0 }}
        animate={{ pathLength: 1, pathOffset: 0 }}
        transition={{
          pathLength: {
            type: "spring",
            stiffness: 60,
            damping: 18,
            delay: index * 0.07 + 0.05,
          },
        }}
      />
      <defs>
        <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#b026ff" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#00fff5" stopOpacity="1" />
          <stop offset="70%" stopColor="#ff2cf1" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#b026ff" stopOpacity="0.7" />
        </linearGradient>
      </defs>
    </motion.svg>
  );
}

/* ── LCARS Panel ──────────────────────────────────────────────────
 *  L-shaped frame: vertical sidebar (left) + horizontal header (top)
 *  connected by a curved elbow in the top-left corner.
 *  Both bars are segmented with colored blocks separated by black gaps.
 * ─────────────────────────────────────────────────────────────── */

interface LcarsPanelProps {
  title: string;
  icon: LucideIcon;
  badge?: string | number;
  badgeVariant?: "default" | "green";
  onRefresh?: () => void;
  spinning?: boolean;
  children: ReactNode;
  style?: React.CSSProperties;
}

function LcarsPanel({ title, icon: Icon, badge, badgeVariant = "default", onRefresh, spinning, children, style }: LcarsPanelProps) {
  const { primary, accent } = getLcarsPanelColors(title);

  return (
    <div className={styles.panelLcars} style={style}>
      <div className={styles.lcarsFrame}>
        {/* Top-left elbow: connects sidebar to header bar */}
        <div
          className={styles.lcarsElbowCorner}
          style={{ background: primary }}
        />

        {/* Header bar (top) — accent chip + main fill with title + pill end */}
        <div className={styles.lcarsHeaderBar}>
          <div className={styles.lcarsHeaderSegments}>
            <div
              className={styles.lcarsHeaderSegment}
              style={{ background: accent, flex: "0 0 40px" }}
            />
            <div
              className={styles.lcarsHeaderFill}
              style={{ background: primary }}
            >
              <div className={styles.lcarsHeaderTitle}>
                <Icon size={13} className={styles.iconLcars} />
                <span className={styles.titleLcars}>{title}</span>
                {badge !== undefined && (
                  <span className={`${styles.badgeLcars} ${badgeVariant === "green" ? styles.badgeLcarsGreen : ""}`}>
                    {badge}
                  </span>
                )}
                {onRefresh && (
                  <button
                    className={`${styles.refreshBtnLcars} ${spinning ? styles.refreshBtnLcarsSpinning : ""}`}
                    onClick={onRefresh}
                    title="Refresh"
                  >
                    <RefreshCw size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Thin separator line below header */}
        <div className={styles.lcarsSeparatorLeft} style={{ background: primary }} />
        <div className={styles.lcarsSeparatorRight} />

        {/* Sidebar (left) — main fill + accent pill at bottom */}
        <div className={styles.lcarsSidebar}>
          <div
            className={styles.lcarsSidebarSegment}
            style={{ background: primary, flex: "1 1 auto" }}
          />
          {/* Pill-shaped bottom end */}
          <div
            className={styles.lcarsSidebarPill}
            style={{ background: accent }}
          />
        </div>

        {/* Content area — right of sidebar, below header */}
        <div className={styles.lcarsContent}>
          {children}
        </div>
      </div>
    </div>
  );
}
