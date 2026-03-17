import { type ReactNode } from "react";
import styles from "./GlowCard.module.css";
import { useTheme } from "../../themes";

interface GlowCardProps {
  children: ReactNode;
  urgent?: boolean;
  className?: string;
  onClick?: () => void;
}

export function GlowCard({ children, urgent, className, onClick }: GlowCardProps) {
  const { theme } = useTheme();
  const isLcars = theme.layoutStyle === "lcars";

  return (
    <div
      className={`${styles.card} ${urgent ? styles.urgent : ""} ${onClick ? styles.clickable : ""} ${isLcars ? styles.cardLcars : ""} ${isLcars && urgent ? styles.urgentLcars : ""} ${className ?? ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      {children}
    </div>
  );
}
