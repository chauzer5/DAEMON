import { type ReactNode } from "react";
import styles from "./DashboardGrid.module.css";
import { useTheme } from "../../themes";

interface DashboardGridProps {
  children: ReactNode;
}

export function DashboardGrid({ children }: DashboardGridProps) {
  const { theme } = useTheme();
  const isLcars = theme.layoutStyle === "lcars";

  return (
    <div className={`${styles.grid} ${isLcars ? styles.gridLcars : ""}`}>
      {children}
      {!isLcars && <div className={styles.intersectionNode} />}
    </div>
  );
}
