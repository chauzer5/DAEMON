import { useState, useEffect } from "react";
import { X, Check, AlertCircle, Loader2, Settings } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { NeonButton } from "./NeonButton";
import { useTheme, getAllThemes } from "../../themes";
import type { ThemeDefinition } from "../../themes/types";
import styles from "./SettingsModal.module.css";

interface AppSettings {
  gitlab_pat: string | null;
  linear_api_key: string | null;
  launchdarkly_api_key: string | null;
  gitlab_group_id: string;
  linear_team_id: string;
}

type TestStatus = "idle" | "testing" | "success" | "error";

// ── Sub-components ────────────────────────────────────────────────────────────

function CredentialRow({
  label,
  settingKey,
  currentValue,
  placeholder,
  testFn,
  onSaved,
}: {
  label: string;
  settingKey: string;
  currentValue: string | null;
  placeholder: string;
  testFn: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testResult, setTestResult] = useState("");

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await invoke("save_setting", { key: settingKey, value: value.trim() });
      setEditing(false);
      setValue("");
      onSaved();
      setTestStatus("idle");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestStatus("testing");
    setTestResult("");
    try {
      const result = await invoke<string>(testFn);
      setTestStatus("success");
      setTestResult(String(result));
    } catch (e) {
      setTestStatus("error");
      setTestResult(String(e));
    }
  };

  return (
    <div className={styles.credRow}>
      <div className={styles.credHeader}>
        <span className={styles.credLabel}>{label}</span>
        <div className={styles.credStatus}>
          {currentValue ? (
            <span className={styles.credConfigured}>
              <Check size={10} /> {currentValue}
            </span>
          ) : (
            <span className={styles.credMissing}>
              <AlertCircle size={10} /> Not configured
            </span>
          )}
        </div>
      </div>

      {editing ? (
        <div className={styles.credEdit}>
          <input
            className={styles.credInput}
            type="password"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            autoFocus
          />
          <NeonButton onClick={handleSave} disabled={saving || !value.trim()}>
            {saving ? "..." : "Save"}
          </NeonButton>
          <motion.button
            className={styles.cancelBtn}
            onClick={() => {
              setEditing(false);
              setValue("");
            }}
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.85 }}
          >
            <X size={14} />
          </motion.button>
        </div>
      ) : (
        <div className={styles.credActions}>
          <NeonButton variant="purple" onClick={() => setEditing(true)}>
            {currentValue ? "Update" : "Configure"}
          </NeonButton>
          {currentValue && (
            <NeonButton
              variant="cyan"
              onClick={handleTest}
              disabled={testStatus === "testing"}
            >
              {testStatus === "testing" ? (
                <>
                  <Loader2 size={10} className={styles.spinIcon} /> Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </NeonButton>
          )}
        </div>
      )}

      <AnimatePresence>
        {testStatus === "success" && (
          <motion.div
            className={styles.testSuccess}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Check size={12} /> Connected: {testResult}
          </motion.div>
        )}
        {testStatus === "error" && (
          <motion.div
            className={styles.testError}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <AlertCircle size={12} /> {testResult}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BootSettings() {
  const [enabled, setEnabled] = useState(() => {
    return localStorage.getItem("daemon_boot_enabled") !== "false";
  });
  const [duration, setDuration] = useState(() => {
    return parseInt(localStorage.getItem("daemon_boot_duration") ?? "5", 10);
  });

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem("daemon_boot_enabled", String(next));
  };

  const handleDuration = (val: number) => {
    setDuration(val);
    localStorage.setItem("daemon_boot_duration", String(val));
  };

  return (
    <div className={styles.credRow}>
      <div className={styles.credHeader}>
        <span className={styles.credLabel}>Show boot animation on startup</span>
        <motion.button
          className={`${styles.toggleBtn} ${enabled ? styles.toggleOn : styles.toggleOff}`}
          onClick={handleToggle}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
        >
          <span className={styles.toggleKnob} />
        </motion.button>
      </div>
      <AnimatePresence>
        {enabled && (
          <motion.div
            className={styles.sliderRow}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <span className={styles.sliderLabel}>Duration</span>
            <input
              type="range"
              min={3}
              max={15}
              value={duration}
              onChange={(e) => handleDuration(parseInt(e.target.value, 10))}
              className={styles.slider}
            />
            <span className={styles.sliderValue}>{duration}s</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThemeSelector() {
  const { themeId, setThemeId } = useTheme();
  const allThemes: ThemeDefinition[] = getAllThemes();

  return (
    <div className={styles.themeGrid}>
      {allThemes.map((t, i) => {
        const isActive = t.id === themeId;
        return (
          <motion.button
            key={t.id}
            className={`${styles.themeCard} ${isActive ? styles.themeCardActive : ""}`}
            onClick={() => setThemeId(t.id)}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              type: "spring",
              stiffness: 500,
              damping: 40,
              delay: 0.18 + i * 0.06,
            }}
            whileHover={{
              scale: 1.02,
              transition: { type: "spring", stiffness: 500, damping: 30 },
            }}
            whileTap={{ scale: 0.97 }}
          >
            <div className={styles.themeColorStrip}>
              {t.previewColors.map((color, ci) => (
                <span
                  key={ci}
                  className={styles.themeColorSwatch}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className={styles.themeCardInfo}>
              <span className={styles.themeCardName}>{t.name}</span>
              <span className={styles.themeCardDesc}>{t.description}</span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ── Section wrapper with stagger ─────────────────────────────────────────────

function Section({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 500,
        damping: 42,
        delay: 0.1 + index * 0.07,
      }}
    >
      {children}
    </motion.div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const loadSettings = async () => {
    try {
      const s = await invoke<AppSettings>("get_settings");
      setSettings(s);
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <motion.div
        className={styles.modal}
        initial={{ opacity: 0, scale: 0.88, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 14 }}
        transition={{ type: "spring", stiffness: 460, damping: 36, mass: 0.8, delay: 0.04 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <motion.div
          className={styles.modalHeader}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 40, delay: 0.08 }}
        >
          <Settings size={16} className={styles.headerIcon} />
          <span className={styles.modalTitle}>System Configuration</span>
          <motion.button
            className={styles.closeBtn}
            onClick={onClose}
            whileHover={{
              scale: 1.2,
              rotate: 90,
              transition: { type: "spring", stiffness: 600, damping: 18 },
            }}
            whileTap={{ scale: 0.8, rotate: 45 }}
          >
            <X size={16} />
          </motion.button>
        </motion.div>

        <div className={styles.modalContent}>
          {/* Theme */}
          <Section index={0}>
            <div className={styles.sectionTitle}>Theme</div>
            <div className={styles.sectionDesc}>
              Choose a visual theme for the D.A.E.M.O.N. interface
            </div>
            <ThemeSelector />
          </Section>

          {/* API Credentials */}
          <Section index={1}>
            <div className={styles.sectionTitle} style={{ marginTop: "24px" }}>
              API Credentials
            </div>
            <div className={styles.sectionDesc}>
              Tokens are stored locally in ~/.config/daemon/credentials.json
            </div>
            {settings && (
              <>
                <CredentialRow
                  label="GitLab Personal Access Token"
                  settingKey="gitlab_pat"
                  currentValue={settings.gitlab_pat}
                  placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                  testFn="test_gitlab_connection"
                  onSaved={loadSettings}
                />
                <CredentialRow
                  label="Linear API Key"
                  settingKey="linear_api_key"
                  currentValue={settings.linear_api_key}
                  placeholder="lin_api_xxxxxxxxxxxxxxxxxxxx"
                  testFn="test_linear_connection"
                  onSaved={loadSettings}
                />
                <CredentialRow
                  label="LaunchDarkly API Key"
                  settingKey="launchdarkly_api_key"
                  currentValue={settings.launchdarkly_api_key}
                  placeholder="api-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  testFn="test_launchdarkly_connection"
                  onSaved={loadSettings}
                />
              </>
            )}
          </Section>

          {/* Slack */}
          <Section index={2}>
            <div className={styles.sectionTitle} style={{ marginTop: "24px" }}>
              Slack
            </div>
            <div className={styles.slackInfo}>
              <Check size={12} className={styles.slackCheck} />
              Credentials auto-extracted from Slack desktop app. No
              configuration needed.
            </div>
          </Section>

          {/* Boot Sequence */}
          <Section index={3}>
            <div className={styles.sectionTitle} style={{ marginTop: "24px" }}>
              Boot Sequence
            </div>
            <BootSettings />
          </Section>

          {/* About */}
          <Section index={4}>
            <div className={styles.sectionTitle} style={{ marginTop: "24px" }}>
              About
            </div>
            <div className={styles.aboutInfo}>
              <div>D.A.E.M.O.N. v0.1.0</div>
              <div className={styles.aboutSub}>
                Distributed Autonomous Engineering Management Orchestration Node
              </div>
              <div className={styles.aboutSub}>
                Built with Tauri v2 + React 18 + TypeScript + Rust
              </div>
            </div>
          </Section>
        </div>
      </motion.div>
    </motion.div>
  );
}
