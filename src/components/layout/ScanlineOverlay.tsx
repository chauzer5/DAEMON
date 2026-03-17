import styles from "./ScanlineOverlay.module.css";
import { useTheme } from "../../themes";

interface ScanlineOverlayProps {
  enabled?: boolean;
}

export function ScanlineOverlay({ enabled = true }: ScanlineOverlayProps) {
  const { theme } = useTheme();

  // LCARS is clean — no scanlines, no chromatic aberration
  if (theme.layoutStyle === "lcars") return null;

  if (!enabled) return null;
  return (
    <>
      <div className={styles.scanlines} />
      <div className={styles.chromaticEdge} />
    </>
  );
}
