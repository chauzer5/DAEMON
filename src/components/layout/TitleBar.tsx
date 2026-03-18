import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutStore } from "../../stores/layoutStore";
import { useTheme } from "../../themes";
import styles from "./TitleBar.module.css";

export function TitleBar() {
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
        <div className={styles.lcarsElbow} />

        {/* Nav buttons */}
        {navButtons}

        {/* Simplified bar: elbow color, fill, pill end */}
        <div className={styles.lcarsBarSegments}>
          <div className={styles.lcarsBarSeg} style={{ background: "#cc9966", flex: "0 0 60px" }} />
          <div className={styles.lcarsBarSeg} style={{ background: "#ff9933", flex: "1 1 auto" }} />
          <div className={styles.lcarsBarSeg} style={{ background: "#cc9966", flex: "0 0 40px", borderRadius: "0 22px 22px 0" }} />
        </div>

        {/* Logo — right side */}
        <div className={styles.logoSection}>
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
      {/* Nav buttons — left side after traffic lights */}
      {navButtons}

      {/* Logo — right side */}
      <div className={styles.logoSection}>
        <img
          src={theme.bootSequence.logoPath}
          alt="D.A.E.M.O.N."
          className={styles.logoImg}
        />
      </div>
    </div>
  );
}
