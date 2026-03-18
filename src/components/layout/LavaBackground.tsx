import { useTheme } from "../../themes";
import styles from "./LavaBackground.module.css";

export function LavaBackground() {
  const { theme } = useTheme();

  // Respect animation preference — disable for themes that opt out
  if (theme.animations && "lavaLamp" in theme.animations && !theme.animations.lavaLamp) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.blob} ${styles.blob1}`} />
      <div className={`${styles.blob} ${styles.blob2}`} />
      <div className={`${styles.blob} ${styles.blob3}`} />
      <div className={`${styles.blob} ${styles.blob4}`} />
    </div>
  );
}
