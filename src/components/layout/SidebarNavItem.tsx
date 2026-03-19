import { type LucideIcon } from "lucide-react";
import styles from "./SidebarNavItem.module.css";
import { useTheme } from "../../themes";

interface SidebarNavItemProps {
  icon: LucideIcon;
  label: string;
  badge?: number;
  active: boolean;
  collapsed: boolean;
  activity?: { running: boolean; avatar?: string; color?: string };
  onClick: () => void;
}

export function SidebarNavItem({
  icon: Icon,
  label,
  badge,
  active,
  collapsed,
  activity,
  onClick,
}: SidebarNavItemProps) {
  const { theme } = useTheme();
  const isLcars = theme.layoutStyle === "lcars";

  return (
    <button
      className={`${isLcars ? styles.navItemLcars : styles.navItem} ${active ? (isLcars ? styles.navItemLcarsActive : styles.navItemActive) : ""} ${collapsed ? styles.collapsed : ""}`}
      onClick={onClick}
      title={label}
    >
      <div className={styles.iconWrap}>
        <Icon size={18} className={isLcars ? styles.iconLcars : styles.icon} />
        {activity?.running && (
          <span
            className={styles.activityDot}
            style={activity.color ? { background: activity.color } : undefined}
          />
        )}
      </div>
      {!collapsed && (
        <>
          <span className={isLcars ? styles.labelLcars : styles.label}>{label}</span>
          {activity?.running && activity.avatar && (
            <img
              src={activity.avatar}
              alt=""
              className={styles.activityAvatar}
            />
          )}
          {badge !== undefined && badge > 0 && (
            <span className={isLcars ? styles.badgeLcars : styles.badge}>{badge}</span>
          )}
        </>
      )}
      {collapsed && badge !== undefined && badge > 0 && (
        <span className={isLcars ? styles.badgeCollapsedLcars : styles.badgeCollapsed}>{badge}</span>
      )}
    </button>
  );
}
