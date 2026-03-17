import { MessageSquare, GitMerge, Bot, LayoutList } from "lucide-react";
import styles from "./TitleBar.module.css";
import { useTheme } from "../../themes";

export type PanelId = "slack" | "gitlab" | "agents" | "linear";

interface TitleBarProps {
  openPanels: Set<PanelId>;
  onTogglePanel: (id: PanelId) => void;
}

const PANELS: { id: PanelId; label: string; icon: typeof MessageSquare }[] = [
  { id: "slack", label: "Slack", icon: MessageSquare },
  { id: "gitlab", label: "GitLab", icon: GitMerge },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "linear", label: "Linear", icon: LayoutList },
];

/** LCARS button color cycle: orange, tan, blue, purple */
const LCARS_BUTTON_COLORS = ["#ff9933", "#cc6699", "#9999ff", "#9966cc"];

export function TitleBar({ openPanels, onTogglePanel }: TitleBarProps) {
  const { theme } = useTheme();
  const isLcars = theme.layoutStyle === "lcars";

  return (
    <div className={`${styles.titleBar} ${isLcars ? styles.titleBarLcars : ""}`} data-tauri-drag-region>
      {/* LCARS curved sidebar element */}
      {isLcars && <div className={styles.lcarsElbow} />}

      {/* Panel toggle buttons — left side */}
      <div className={`${styles.panelToggles} ${isLcars ? styles.panelTogglesLcars : ""}`}>
        {PANELS.map(({ id, label, icon: Icon }, idx) => (
          <button
            key={id}
            className={`${styles.panelToggle} ${openPanels.has(id) ? styles.panelToggleActive : ""} ${isLcars ? styles.panelToggleLcars : ""} ${isLcars && openPanels.has(id) ? styles.panelToggleLcarsActive : ""}`}
            onClick={() => onTogglePanel(id)}
            title={`${openPanels.has(id) ? "Close" : "Open"} ${label}`}
            style={isLcars ? { "--lcars-btn-color": LCARS_BUTTON_COLORS[idx % LCARS_BUTTON_COLORS.length] } as React.CSSProperties : undefined}
          >
            <Icon size={13} />
            <span className={styles.panelToggleLabel}>{label}</span>
          </button>
        ))}
      </div>

      {/* Logo — right side */}
      <div className={styles.logoSection}>
        <img
          src="/assets/daemon-logo.png?v=5"
          alt="D.A.E.M.O.N."
          className={`${styles.logoImg} ${isLcars ? styles.logoImgLcars : ""}`}
        />
      </div>
    </div>
  );
}
