import { type ReactNode, type CSSProperties } from "react";
import styles from "./HoverTooltip.module.css";

interface HoverTooltipProps {
  children: ReactNode;
  label: string;
  /** Direction the line extends: "right" (default) or "left" */
  direction?: "right" | "left";
  /** Color variant: "cyan" (default), "magenta", or "yellow" */
  color?: "cyan" | "magenta" | "yellow";
  /** Length of the connecting line in px */
  lineLength?: number;
  className?: string;
}

export function HoverTooltip({
  children,
  label,
  direction = "right",
  color = "cyan",
  lineLength = 60,
  className,
}: HoverTooltipProps) {
  const lineStyle: CSSProperties = {
    "--line-length": `${lineLength}px`,
  } as CSSProperties;

  const isLeft = direction === "left";

  const lineClass = isLeft
    ? styles.lineLeft
    : color === "magenta"
      ? styles.lineMagenta
      : color === "yellow"
        ? styles.lineYellow
        : styles.line;

  const textClass = isLeft
    ? styles.textLeft
    : color === "magenta"
      ? styles.textMagenta
      : color === "yellow"
        ? styles.textYellow
        : styles.text;

  return (
    <span className={`${styles.wrapper} ${className ?? ""}`}>
      {children}
      <span className={lineClass} style={lineStyle} />
      <span className={textClass} style={lineStyle}>
        {label}
      </span>
    </span>
  );
}
