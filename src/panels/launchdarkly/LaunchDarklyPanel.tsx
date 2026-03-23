import { useState, useMemo } from "react";
import { Flag, ArrowLeft, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Panel } from "../../components/layout/Panel";
import { RetroLoader } from "../../components/ui/RetroLoader";
import { ErrorState } from "../../components/ui/ErrorState";
import { useCommsFlags } from "../../hooks";
import type { LDFlag } from "../../types/models";
import styles from "./LaunchDarklyPanel.module.css";

// ── Flag Card ──

function FlagCard({
  flag,
  onSelect,
}: {
  flag: LDFlag;
  onSelect: (key: string) => void;
}) {
  return (
    <div className={styles.flagCard} onClick={() => onSelect(flag.key)}>
      <div className={styles.flagContent}>
        <div className={styles.flagName}>{flag.name}</div>
        <div className={styles.flagKey}>{flag.key}</div>
      </div>
      <div className={styles.envToggles}>
        <div className={flag.test_on ? styles.toggleOn : styles.toggleOff}>
          <span className={styles.envLabel}>T</span>
          {flag.test_on ? "ON" : "OFF"}
        </div>
        <div className={flag.prod_on ? styles.toggleOn : styles.toggleOff}>
          <span className={styles.envLabel}>P</span>
          {flag.prod_on ? "ON" : "OFF"}
        </div>
      </div>
    </div>
  );
}

// ── Detail View ──

function FlagDetail({
  flag,
  onBack,
}: {
  flag: LDFlag;
  onBack: () => void;
}) {
  const ldUrl = `https://app.launchdarkly.com/default/production/features/${flag.key}`;

  return (
    <div className={styles.detailView}>
      <div className={styles.detailToolbar}>
        <button className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={12} /> Back
        </button>
        <button
          className={styles.backBtn}
          onClick={() => open(ldUrl)}
          title="Open in LaunchDarkly"
        >
          <ExternalLink size={12} /> LD
        </button>
      </div>

      <div className={styles.detailTitle}>{flag.name}</div>

      <div className={styles.detailSection}>
        <div className={styles.detailLabel}>Key</div>
        <div className={styles.detailValue}>{flag.key}</div>
      </div>

      {flag.description && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Description</div>
          <div className={styles.detailValue}>{flag.description}</div>
        </div>
      )}

      <div className={styles.detailSection}>
        <div className={styles.detailLabel}>Environment Status</div>
        <div className={styles.envStatusRow}>
          <div
            className={`${styles.envStatusBlock} ${flag.test_on ? styles.envStatusOn : styles.envStatusOff}`}
          >
            <div className={styles.envStatusLabel}>Test</div>
            <div
              className={`${styles.envStatusValue} ${flag.test_on ? styles.envOn : styles.envOff}`}
            >
              {flag.test_on ? "ON" : "OFF"}
            </div>
          </div>
          <div
            className={`${styles.envStatusBlock} ${flag.prod_on ? styles.envStatusOn : styles.envStatusOff}`}
          >
            <div className={styles.envStatusLabel}>Production</div>
            <div
              className={`${styles.envStatusValue} ${flag.prod_on ? styles.envOn : styles.envOff}`}
            >
              {flag.prod_on ? "ON" : "OFF"}
            </div>
          </div>
        </div>
      </div>

      {flag.last_modified && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Last Modified (Prod)</div>
          <div className={styles.detailValue}>
            {new Date(flag.last_modified).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──

export function LaunchDarklyPanel() {
  const { data: flags, isLoading, isError, refetch } = useCommsFlags();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!flags) return [];
    return [...flags].sort((a, b) => {
      // Sort: mismatched envs first, then prod-on, then alphabetical
      const aMismatch = a.prod_on !== a.test_on ? 0 : 1;
      const bMismatch = b.prod_on !== b.test_on ? 0 : 1;
      if (aMismatch !== bMismatch) return aMismatch - bMismatch;
      if (a.prod_on !== b.prod_on) return a.prod_on ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [flags]);

  const summary = useMemo(() => {
    if (!flags) return { prodOn: 0, testOn: 0, mismatch: 0 };
    return {
      prodOn: flags.filter((f) => f.prod_on).length,
      testOn: flags.filter((f) => f.test_on).length,
      mismatch: flags.filter((f) => f.prod_on !== f.test_on).length,
    };
  }, [flags]);

  const selectedFlag = flags?.find((f) => f.key === selectedKey) ?? null;

  if (selectedFlag) {
    return (
      <Panel
        title="LaunchDarkly"
        icon={Flag}
        badge={flags?.length}
        onRefresh={refetch}
      >
        <FlagDetail flag={selectedFlag} onBack={() => setSelectedKey(null)} />
      </Panel>
    );
  }

  return (
    <Panel
      title="LaunchDarkly"
      icon={Flag}
      badge={flags?.length}
      onRefresh={refetch}
    >
      {isLoading ? (
        <RetroLoader text="Loading flags..." />
      ) : isError ? (
        <ErrorState message="Failed to load flags" onRetry={refetch} />
      ) : sorted.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>No comms flags</div>
          <div className={styles.emptyHint}>Add LD API key in settings</div>
        </div>
      ) : (
        <>
          <div className={styles.summaryBar}>
            <span className={`${styles.summaryChip} ${styles.chipOn}`}>
              {summary.prodOn} prod
            </span>
            <span className={`${styles.summaryChip} ${styles.chipOn}`}>
              {summary.testOn} test
            </span>
            {summary.mismatch > 0 && (
              <span className={`${styles.summaryChip} ${styles.chipMismatch}`}>
                {summary.mismatch} mismatch
              </span>
            )}
          </div>
          <div className={styles.flagList}>
            {sorted.map((flag) => (
              <FlagCard
                key={flag.key}
                flag={flag}
                onSelect={setSelectedKey}
              />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
