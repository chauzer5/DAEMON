import { type ButtonHTMLAttributes } from "react";
import { motion, useAnimation } from "framer-motion";
import styles from "./NeonButton.module.css";

interface NeonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "cyan" | "magenta" | "purple";
}

// Variant → glow color map for the hover pulse
const GLOW_COLORS: Record<string, string> = {
  cyan: "0, 255, 245",
  magenta: "255, 44, 241",
  purple: "176, 38, 255",
};

export function NeonButton({
  variant = "cyan",
  className,
  children,
  ...props
}: NeonButtonProps) {
  const variantClass = variant !== "cyan" ? styles[variant] : "";
  const glowRgb = GLOW_COLORS[variant];
  const glowControls = useAnimation();

  const handleHoverStart = async () => {
    // Rapid neon pulse: flare up then settle into a steady glow
    await glowControls.start({
      boxShadow: [
        `0 0 8px 2px rgba(${glowRgb}, 0.4), inset 0 0 6px rgba(${glowRgb}, 0.15)`,
        `0 0 22px 6px rgba(${glowRgb}, 0.85), inset 0 0 14px rgba(${glowRgb}, 0.35)`,
        `0 0 14px 4px rgba(${glowRgb}, 0.6), inset 0 0 8px rgba(${glowRgb}, 0.2)`,
        `0 0 18px 5px rgba(${glowRgb}, 0.75), inset 0 0 12px rgba(${glowRgb}, 0.3)`,
      ],
      transition: {
        duration: 0.55,
        ease: "easeInOut",
        repeat: Infinity,
        repeatType: "mirror",
      },
    });
  };

  const handleHoverEnd = () => {
    glowControls.start({
      boxShadow: "0 0 0px 0px rgba(0,0,0,0)",
      transition: { duration: 0.2 },
    });
  };

  return (
    <motion.button
      className={`${styles.button} ${variantClass} ${className ?? ""}`}
      // --- Spring press: fast with a tiny overshoot on release ---
      whileTap={{
        scale: 0.93,
        transition: { type: "spring", stiffness: 700, damping: 18, mass: 0.6 },
      }}
      // --- Scale + lift on hover via spring ---
      whileHover={{
        scale: 1.045,
        y: -2,
        transition: { type: "spring", stiffness: 420, damping: 14, mass: 0.7 },
      }}
      // --- Animated glow driven by useAnimation ---
      animate={glowControls}
      onHoverStart={handleHoverStart}
      onHoverEnd={handleHoverEnd}
      {...(props as React.ComponentPropsWithoutRef<typeof motion.button>)}
    >
      {children}
    </motion.button>
  );
}
