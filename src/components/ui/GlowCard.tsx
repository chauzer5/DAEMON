import { type ReactNode } from "react";
import { motion } from "framer-motion";
import styles from "./GlowCard.module.css";
import { useTheme } from "../../themes";

interface GlowCardProps {
  children: ReactNode;
  urgent?: boolean;
  className?: string;
  onClick?: () => void;
  /**
   * Zero-based index used to stagger entrance animations when cards appear in
   * a list.  Cards with higher indices animate in later.  Defaults to 0.
   */
  index?: number;
}

// ── Animation variants ──────────────────────────────────────────────────────

/** Entry: each card slides up from below and fades in */
const cardVariants = {
  hidden: {
    opacity: 0,
    y: 18,
    scale: 0.97,
  },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 320,
      damping: 24,
      mass: 0.7,
      delay: i * 0.055,
    },
  }),
};

/** Hover state: scale up + brighter glow */
const hoverState = {
  scale: 1.012,
  y: -2,
  boxShadow:
    "0 0 12px rgba(176,38,255,0.35), 0 0 28px rgba(176,38,255,0.18), 0 4px 20px rgba(0,0,0,0.4), inset 0 0 10px rgba(176,38,255,0.06)",
  borderColor: "rgba(176,38,255,0.45)",
  transition: {
    type: "spring" as const,
    stiffness: 380,
    damping: 22,
  },
};

/** Tap/press state: satisfying "press into screen" feel */
const tapState = {
  scale: 0.975,
  y: 1,
  boxShadow:
    "0 0 6px rgba(176,38,255,0.5), 0 0 14px rgba(0,255,245,0.25), inset 0 0 16px rgba(176,38,255,0.1)",
  transition: {
    type: "spring" as const,
    stiffness: 600,
    damping: 28,
  },
};

/** Urgent hover: brighter magenta glow on press */
const urgentHoverState = {
  scale: 1.012,
  y: -2,
  boxShadow:
    "0 0 14px rgba(255,44,241,0.45), 0 0 32px rgba(255,44,241,0.22), 0 4px 20px rgba(0,0,0,0.4), inset 0 0 10px rgba(255,44,241,0.08)",
  borderColor: "rgba(255,44,241,0.55)",
  transition: {
    type: "spring" as const,
    stiffness: 380,
    damping: 22,
  },
};

const urgentTapState = {
  scale: 0.975,
  y: 1,
  boxShadow:
    "0 0 8px rgba(255,44,241,0.7), 0 0 18px rgba(255,44,241,0.35), inset 0 0 16px rgba(255,44,241,0.12)",
  transition: {
    type: "spring" as const,
    stiffness: 600,
    damping: 28,
  },
};

export function GlowCard({ children, urgent, className, onClick, index = 0 }: GlowCardProps) {
  const { theme } = useTheme();
  const isLcars = theme.layoutStyle === "lcars";

  const classNames = [
    styles.card,
    urgent ? styles.urgent : "",
    onClick ? styles.clickable : "",
    isLcars ? styles.cardLcars : "",
    isLcars && urgent ? styles.urgentLcars : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (isLcars) {
    // LCARS: no framer-motion animations — clean flat Federation style
    return (
      <div
        className={classNames}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      >
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={classNames}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      // ── Entrance animation ──────────────────────────────────────────
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      custom={index}
      // ── Layout animation — smooth reorder when list changes ─────────
      layout
      layoutId={undefined}
      // ── Interaction states ──────────────────────────────────────────
      whileHover={urgent ? urgentHoverState : hoverState}
    >
      {children}
    </motion.div>
  );
}
