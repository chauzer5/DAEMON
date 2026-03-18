import { useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Compass,
  Crosshair,
  Zap,
  Swords,
  Shield,
  Eye,
  FileText,
  Bug,
} from "lucide-react";
import type { PersonaConfig } from "../../config/personaTypes";
import styles from "./PersonaCard.module.css";

const ICON_MAP: Record<string, typeof Search> = {
  Search,
  Compass,
  Crosshair,
  Zap,
  Swords,
  Shield,
  Eye,
  FileText,
  Bug,
};

interface PersonaCardProps {
  persona: PersonaConfig;
  selected: boolean;
  solo?: boolean;
  onClick: () => void;
}

export function PersonaCard({ persona, selected, solo, onClick }: PersonaCardProps) {
  const Icon = ICON_MAP[persona.icon] ?? Search;
  const cardRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const card = cardRef.current;
      if (card) {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const ripple = document.createElement("span");
        ripple.className = styles.ripple;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        card.appendChild(ripple);
        ripple.addEventListener("animationend", () => ripple.remove());
      }
      onClick();
    },
    [onClick],
  );

  return (
    <motion.button
      ref={cardRef}
      layout
      layoutId={`persona-card-${persona.id}`}
      className={`${styles.card} ${selected ? styles.selected : ""} ${solo ? styles.solo : ""}`}
      onClick={handleClick}
      style={{ "--persona-color": persona.color } as React.CSSProperties}
      whileHover={{ y: -3, scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <div className={styles.scanline} />
      <div className={`${styles.corner} ${styles.cornerTL}`} />
      <div className={`${styles.corner} ${styles.cornerBR}`} />

      {persona.avatar ? (
        <motion.div className={styles.avatarWrap} layoutId={`persona-avatar-${persona.id}`}>
          <img
            src={persona.avatar}
            alt={persona.name}
            className={styles.avatar}
          />
          <div className={styles.avatarGlitch} />
        </motion.div>
      ) : (
        <Icon size={20} className={styles.icon} />
      )}
      <motion.span className={styles.name} layoutId={`persona-name-${persona.id}`}>
        {persona.name}
      </motion.span>
      {!solo && (
        <>
          <span className={styles.role}>{persona.role}</span>
          <span className={styles.franchise}>{persona.franchise}</span>
        </>
      )}
    </motion.button>
  );
}
