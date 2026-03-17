import { useState, useEffect, useMemo, useRef } from "react";
import styles from "./BootSequence.module.css";

// Each line has a tier: 1 = always shown, 2 = medium+, 3 = long only
const ALL_BOOT_LINES: { text: string; tier: number }[] = [
  { text: "NectarCorp BIOS v4.20.69 — Unified Firmware Interface", tier: 1 },
  { text: "Copyright (C) 2026 NectarCorp Industries. All rights reserved.", tier: 2 },
  { text: "", tier: 1 },
  { text: "POST: Power-On Self Test...", tier: 1 },
  { text: "CPU: AMD Ryzen 9 9950X @ 5.7GHz .................... OK", tier: 1 },
  { text: "RAM: Testing 131072 MB DDR5-6400 ECC ............... OK", tier: 1 },
  { text: "  Bank 0: 32768 MB @ 6400 MHz ...................... PASS", tier: 3 },
  { text: "  Bank 1: 32768 MB @ 6400 MHz ...................... PASS", tier: 3 },
  { text: "  Bank 2: 32768 MB @ 6400 MHz ...................... PASS", tier: 3 },
  { text: "  Bank 3: 32768 MB @ 6400 MHz ...................... PASS", tier: 3 },
  { text: "GPU: NVIDIA RTX 5090 Ti (48GB VRAM) ................ OK", tier: 1 },
  { text: "NVMe: Samsung 990 PRO 4TB .......................... OK", tier: 2 },
  { text: "NEURAL_LINK: Arasaka Mk.IV Cortical Interface ...... CONNECTED", tier: 1 },
  { text: "  Bandwidth: 847 Gbps .............................. NOMINAL", tier: 3 },
  { text: "  Latency: 0.003ms ................................. NOMINAL", tier: 3 },
  { text: "USB: 12 devices detected ........................... OK", tier: 3 },
  { text: "NET: 10GbE eth0 link ............................... UP", tier: 2 },
  { text: "", tier: 1 },
  { text: "Loading D.A.E.M.O.N. kernel v0.1.0...", tier: 1 },
  { text: "  [████████████████████████████████████] 100%", tier: 1 },
  { text: "", tier: 1 },
  { text: "Starting system services:", tier: 2 },
  { text: "  systemd[1]: Starting D.A.E.M.O.N. core...", tier: 2 },
  { text: "  systemd[1]: Started syslog-ng.service", tier: 3 },
  { text: "  systemd[1]: Started NetworkManager.service", tier: 3 },
  { text: "  systemd[1]: Started quantum-mesh.service", tier: 3 },
  { text: "", tier: 2 },
  { text: "Mounting filesystems:", tier: 2 },
  { text: "  /dev/sda1 on / ................................... OK", tier: 2 },
  { text: "  /dev/sda2 on /mnt/corporate-overlord ............. OK", tier: 3 },
  { text: "  /dev/nvme0n1p1 on /var/cache/node_modules ........ OK (429,817 packages)", tier: 2 },
  { text: "", tier: 2 },
  { text: "Initializing subsystems:", tier: 1 },
  { text: "  Quantum entanglement resolver .................... OK", tier: 2 },
  { text: "  Predictive meeting cancellation engine ........... ARMED", tier: 3 },
  { text: "  Stack Overflow scraper ........................... DEPRECATED (use Claude)", tier: 2 },
  { text: "  todo_list.txt (WARNING: 847 items found) ......... LOADED", tier: 1 },
  { text: "  Works on my machine? ............................. YES", tier: 2 },
  { text: "  Compiling 441 Rust crates ........................ OK", tier: 1 },
  { text: "  rm -rf node_modules && npm install ............... SKIPPED", tier: 2 },
  { text: "  Verifying left-pad is not deprecated ............. UNCERTAIN", tier: 2 },
  { text: "  Checking if semicolons matter .................... DEPENDS WHO YOU ASK", tier: 3 },
  { text: "  Loading .env (praying it's not in git) ........... OK", tier: 2 },
  { text: "", tier: 1 },
  { text: "Establishing secure uplinks:", tier: 1 },
  { text: "  ├─ Slack    ⟶ nectar-hr.slack.com ................ LINKED", tier: 1 },
  { text: "  ├─ GitLab   ⟶ gitlab.com/nectarhr ............... LINKED", tier: 1 },
  { text: "  ├─ Linear   ⟶ linear.app/nectar ................. LINKED", tier: 1 },
  { text: "  └─ Claude   ⟶ /usr/local/bin/claude ............. STANDBY", tier: 1 },
  { text: "", tier: 1 },
  { text: "Deploying countermeasures:", tier: 2 },
  { text: "  ├─ Unnecessary meetings .......................... BLOCKED", tier: 2 },
  { text: "  ├─ Scope creep .................................. DETECTED (ironic)", tier: 2 },
  { text: "  ├─ \"Quick question\" DMs .......................... QUEUED", tier: 3 },
  { text: "  ├─ Tabs vs spaces debate ......................... TABS (fight me)", tier: 3 },
  { text: "  ├─ PR with 4000+ lines changed .................. NOPE", tier: 3 },
  { text: "  └─ Production incidents on Friday at 4:59pm ...... INEVITABLE", tier: 2 },
  { text: "", tier: 2 },
  { text: "Final diagnostics:", tier: 2 },
  { text: "  Caffeine-to-productivity ratio ................... 1:0.03", tier: 3 },
  { text: "  Imposter syndrome module ......................... FAILED (as expected)", tier: 2 },
  { text: "  git blame anxiety level .......................... ELEVATED", tier: 3 },
  { text: "  Rubber duck availability ......................... 1 (on desk)", tier: 3 },
  { text: "  All systems ...................................... GREEN", tier: 1 },
  { text: "", tier: 1 },
  { text: "╔══════════════════════════════════════════════════════════╗", tier: 1 },
  { text: "║  D.A.E.M.O.N. ONLINE — ALL SYSTEMS OPERATIONAL         ║", tier: 1 },
  { text: "║  Distributed Autonomous Engineering Management          ║", tier: 2 },
  { text: "║  Orchestration Node v0.1.0                              ║", tier: 2 },
  { text: "║                                                         ║", tier: 2 },
  { text: "║  \"It's not a bug, it's a feature.\"                      ║", tier: 1 },
  { text: "╚══════════════════════════════════════════════════════════╝", tier: 1 },
];

// Duration → max tier: 3-6s = tier 1 only, 7-10s = tier 1+2, 11-15s = all tiers
function getBootLines(duration: number): string[] {
  const maxTier = duration <= 6 ? 1 : duration <= 10 ? 2 : 3;
  return ALL_BOOT_LINES
    .filter((line) => line.tier <= maxTier)
    .map((line) => line.text);
}

// Phases: text → clearText → logoGrow → logoHold → reveal → done
type Phase = "text" | "clearText" | "logoGrow" | "logoHold" | "reveal" | "done";

function getBootSettings() {
  const enabled = localStorage.getItem("daemon_boot_enabled") !== "false";
  const duration = parseInt(localStorage.getItem("daemon_boot_duration") ?? "5", 10);
  return { enabled, duration };
}

export function BootSequence() {
  const { enabled, duration } = useMemo(getBootSettings, []);
  const bootLines = useMemo(() => getBootLines(duration), [duration]);
  const [phase, setPhase] = useState<Phase>(enabled ? "text" : "done");
  const [visibleLines, setVisibleLines] = useState(0);
  const logoRef = useRef<HTMLImageElement>(null);

  // Text phase timing
  const lineTime = (duration * 1000) * 0.65;
  const holdTime = (duration * 1000) * 0.15;
  const delayPerLine = lineTime / bootLines.length;

  useEffect(() => {
    if (!enabled) return;

    // Phase 1: Show text lines
    const lineTimers = bootLines.map((_, idx) =>
      setTimeout(() => setVisibleLines(idx + 1), idx * delayPerLine),
    );

    const totalLineTime = bootLines.length * delayPerLine;

    // Phase 2: Clear text away (after hold)
    const clearTimer = setTimeout(() => {
      setPhase("clearText");
    }, totalLineTime + holdTime);

    // Phase 3: Logo grows to fill screen
    const growTimer = setTimeout(() => {
      setPhase("logoGrow");
    }, totalLineTime + holdTime + 600);

    // Phase 4: Hold on large logo
    const holdTimer = setTimeout(() => {
      setPhase("logoHold");
    }, totalLineTime + holdTime + 600 + 1200);

    // Phase 5: Fade to dashboard
    const revealTimer = setTimeout(() => {
      setPhase("reveal");
    }, totalLineTime + holdTime + 600 + 1200 + 1500);

    // Phase 6: Done
    const doneTimer = setTimeout(() => {
      setPhase("done");
    }, totalLineTime + holdTime + 600 + 1200 + 1500 + 800);

    return () => {
      lineTimers.forEach(clearTimeout);
      clearTimeout(clearTimer);
      clearTimeout(growTimer);
      clearTimeout(holdTimer);
      clearTimeout(revealTimer);
      clearTimeout(doneTimer);
    };
  }, [enabled, delayPerLine, holdTime, bootLines]);

  if (phase === "done") return null;

  return (
    <div className={`${styles.bootOverlay} ${phase === "reveal" ? styles.overlayFadeOut : ""}`}>
      {/* Text content — fades out during clearText */}
      <div className={`${styles.bootContent} ${
        phase !== "text" ? styles.textFadeOut : ""
      }`}>
        <div className={styles.bootLines}>
          {bootLines.slice(0, visibleLines).map((text, idx) => (
            <div
              key={idx}
              className={`${styles.bootLine} ${
                text.includes("ONLINE") ? styles.bootLineReady : ""
              } ${
                text.includes("FAILED") || text.includes("INEVITABLE") || text.includes("UNCERTAIN")
                  ? styles.bootLineWarn
                  : ""
              } ${
                text.includes("LINKED") || text.includes("OK") || text.includes("ALL GREEN")
                  ? styles.bootLineOk
                  : ""
              } ${text === "" ? styles.bootLineSpacer : ""}`}
            >
              {text}
            </div>
          ))}
          {phase === "text" && visibleLines < bootLines.length && (
            <span className={styles.bootCursor}>█</span>
          )}
        </div>
      </div>

      {/* Logo — always present, transforms through phases */}
      <img
        ref={logoRef}
        src="/assets/daemon-logo.png?v=5"
        alt="D.A.E.M.O.N."
        className={`${styles.bootLogo} ${
          phase === "text" || phase === "clearText"
            ? styles.logoSmall
            : styles.logoLarge
        }`}
      />
    </div>
  );
}
