import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import styles from "./Panel.module.css";
import { useTheme } from "../../themes";

interface PanelProps {
  title: string;
  icon: LucideIcon;
  badge?: string | number;
  badgeVariant?: "default" | "green";
  children: ReactNode;
  style?: React.CSSProperties;
}

export function Panel({ title, icon: Icon, badge, badgeVariant = "default", children, style }: PanelProps) {
  const { theme } = useTheme();
  const isLcars = theme.layoutStyle === "lcars";

  return (
    <div className={`${styles.panel} ${isLcars ? styles.panelLcars : ""}`} style={style}>
      {/* Corner decorations — hidden for LCARS */}
      {!isLcars && (
        <>
          <span className={styles.cornerTL} />
          <span className={styles.cornerTR} />
          <span className={styles.cornerBL} />
          <span className={styles.cornerBR} />
        </>
      )}

      <div className={`${styles.header} ${isLcars ? styles.headerLcars : ""}`}>
        <Icon size={16} className={`${styles.icon} ${isLcars ? styles.iconLcars : ""}`} />
        <span className={`${styles.title} ${isLcars ? styles.titleLcars : ""}`}>{title}</span>
        {badge !== undefined && (
          <span className={`${styles.badge} ${badgeVariant === "green" ? styles.badgeGreen : ""} ${isLcars ? styles.badgeLcars : ""}`}>
            {badge}
          </span>
        )}
      </div>
      <div className={`${styles.content} ${isLcars ? styles.contentLcars : ""}`}>{children}</div>
    </div>
  );
}
