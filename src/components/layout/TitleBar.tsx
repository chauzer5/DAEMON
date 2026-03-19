<<<<<<< HEAD
import { MessageSquare, GitMerge, Bot, LayoutList, RefreshCw } from "lucide-react";
import styles from "./TitleBar.module.css";
=======
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutStore } from "../../stores/layoutStore";
>>>>>>> fb88e2446a8d1d38d8da40bf2a2a73db0e4fb13c
import { useTheme } from "../../themes";
import styles from "./TitleBar.module.css";

<<<<<<< HEAD
export type PanelId = "slack" | "gitlab" | "agents" | "linear";

interface TitleBarProps {
  openPanels: Set<PanelId>;
  onTogglePanel: (id: PanelId) => void;
  onResync: () => void;
}

const PANELS: { id: PanelId; label: string; icon: typeof MessageSquare }[] = [
  { id: "slack", label: "Slack", icon: MessageSquare },
  { id: "gitlab", label: "GitLab", icon: GitMerge },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "linear", label: "Linear", icon: LayoutList },
];

/** LCARS button color: muted, uniform — content over chrome */
const LCARS_BUTTON_COLORS = ["#ff9933", "#9999ff", "#9966cc", "#cc9966"];

export function TitleBar({ openPanels, onTogglePanel, onResync }: TitleBarProps) {
=======
export function TitleBar() {
>>>>>>> fb88e2446a8d1d38d8da40bf2a2a73db0e4fb13c
  const { theme } = useTheme();
  const isLcars = theme.layoutStyle === "lcars";
  const { goBack, goForward, canGoBack, canGoForward } = useLayoutStore();

  const navButtons = (
    <div className={isLcars ? styles.navButtonsLcars : styles.navButtons}>
      <button
        className={isLcars ? styles.navBtnLcars : styles.navBtn}
        onClick={goBack}
        disabled={!canGoBack}
        title="Go back"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        className={isLcars ? styles.navBtnLcars : styles.navBtn}
        onClick={goForward}
        disabled={!canGoForward}
        title="Go forward"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );

  if (isLcars) {
    return (
      <div className={styles.titleBarLcars} data-tauri-drag-region>
        {/* Smaller curved elbow on the left */}
        <div className={styles.lcarsElbow} data-tauri-drag-region />

        {/* Resync button */}
        <div className={styles.panelTogglesLcars}>
          <button
            className={styles.panelToggleLcars}
            onClick={onResync}
            title="Resync all panels"
            style={{ "--lcars-btn-color": "#33cc99" } as React.CSSProperties}
          >
            <RefreshCw size={12} />
          </button>
        </div>

<<<<<<< HEAD
        {/* Simplified bar: elbow color, toggles, fill, pill end */}
        <div className={styles.lcarsBarSegments} data-tauri-drag-region>
          <div className={styles.lcarsBarSeg} data-tauri-drag-region style={{ background: "#cc9966", flex: "0 0 60px" }} />

          {/* Panel toggle buttons — subtle text inside the bar */}
          <div className={styles.panelTogglesLcars}>
            {PANELS.map(({ id, label, icon: Icon }, idx) => (
              <button
                key={id}
                className={`${styles.panelToggleLcars} ${openPanels.has(id) ? styles.panelToggleLcarsActive : ""}`}
                onClick={() => onTogglePanel(id)}
                title={`${openPanels.has(id) ? "Close" : "Open"} ${label}`}
                style={{ "--lcars-btn-color": LCARS_BUTTON_COLORS[idx % LCARS_BUTTON_COLORS.length] } as React.CSSProperties}
              >
                <Icon size={12} />
                <span className={styles.panelToggleLabel}>{label}</span>
              </button>
            ))}
          </div>

          {/* Fill segment that stretches */}
          <div className={styles.lcarsBarSeg} data-tauri-drag-region style={{ background: "#ff9933", flex: "1 1 auto" }} />
          {/* Pill-shaped right end */}
          <div className={styles.lcarsBarSeg} data-tauri-drag-region style={{ background: "#cc9966", flex: "0 0 40px", borderRadius: "0 22px 22px 0" }} />
=======
        {/* Nav buttons */}
        {navButtons}

        {/* Simplified bar: elbow color, fill, pill end */}
        <div className={styles.lcarsBarSegments}>
          <div className={styles.lcarsBarSeg} style={{ background: "#cc9966", flex: "0 0 60px" }} />
          <div className={styles.lcarsBarSeg} style={{ background: "#ff9933", flex: "1 1 auto" }} />
          <div className={styles.lcarsBarSeg} style={{ background: "#cc9966", flex: "0 0 40px", borderRadius: "0 22px 22px 0" }} />
>>>>>>> fb88e2446a8d1d38d8da40bf2a2a73db0e4fb13c
        </div>

        {/* Logo — right side */}
        <div className={styles.logoSection} data-tauri-drag-region>
          <img
            src={theme.bootSequence.logoPath}
            alt="D.A.E.M.O.N."
            className={styles.logoImgLcars}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.titleBar} data-tauri-drag-region>
<<<<<<< HEAD
      {/* Resync + Panel toggle buttons — left side */}
      <div className={styles.panelToggles}>
        <button
          className={styles.panelToggle}
          onClick={onResync}
          title="Resync all panels"
        >
          <RefreshCw size={13} />
        </button>
        {PANELS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`${styles.panelToggle} ${openPanels.has(id) ? styles.panelToggleActive : ""}`}
            onClick={() => onTogglePanel(id)}
            title={`${openPanels.has(id) ? "Close" : "Open"} ${label}`}
          >
            <Icon size={13} />
            <span className={styles.panelToggleLabel}>{label}</span>
          </button>
        ))}
      </div>
=======
      {/* Nav buttons — left side after traffic lights */}
      {navButtons}
>>>>>>> fb88e2446a8d1d38d8da40bf2a2a73db0e4fb13c

      {/* Logo — right side */}
      <div className={styles.logoSection} data-tauri-drag-region>
        <img
          src={theme.bootSequence.logoPath}
          alt="D.A.E.M.O.N."
          className={styles.logoImg}
        />
      </div>
    </div>
  );
}
