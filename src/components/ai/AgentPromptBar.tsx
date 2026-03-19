import { useState, useRef, useEffect } from "react";
import { DEFAULT_PERSONAS } from "../../config/personas";
import { usePersonaStore } from "../../stores/personaStore";
import styles from "./AgentPromptBar.module.css";

interface AgentPromptBarProps {
  /** Short label shown before input, e.g. "MR !42" */
  contextLabel: string;
  /** Full context string prepended to the user's prompt */
  contextPrefix: string;
}

export function AgentPromptBar({ contextLabel, contextPrefix }: AgentPromptBarProps) {
  const [prompt, setPrompt] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const hasPrompt = prompt.trim().length > 0;

  useEffect(() => {
    return () => clearTimeout(flashTimer.current);
  }, []);

  const handleSend = (personaId: string) => {
    if (!hasPrompt) return;
    const fullPrompt = `${contextPrefix}\n\n${prompt.trim()}`;
    usePersonaStore.getState().launchAgent(personaId, fullPrompt);
    setPrompt("");
    clearTimeout(flashTimer.current);
    setFlashId(personaId);
    flashTimer.current = setTimeout(() => setFlashId(null), 600);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && hasPrompt) {
      e.preventDefault();
      // Enter sends to first persona (Zexion / researcher) as default
      handleSend(DEFAULT_PERSONAS[0].id);
    }
  };

  return (
    <div className={styles.bar}>
      <span className={styles.contextLabel}>{contextLabel}</span>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        placeholder="Ask an agent about this..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className={styles.avatars}>
        {DEFAULT_PERSONAS.map((p) => (
          <img
            key={p.id}
            src={p.avatar}
            alt={p.name}
            title={`${p.name} — ${p.role}`}
            className={`${styles.avatar} ${hasPrompt ? styles.avatarReady : ""} ${flashId === p.id ? styles.avatarFlash : ""}`}
            onClick={() => handleSend(p.id)}
          />
        ))}
      </div>
    </div>
  );
}
