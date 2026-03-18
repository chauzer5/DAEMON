import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTodoStore, type ManualTodo } from "../../stores/todoStore";
import styles from "./CreateTodoModal.module.css";

export interface CreateTodoPreset {
  source: ManualTodo["source"];
  title?: string;
  subtitle?: string;
  url?: string;
  priority?: ManualTodo["priority"];
  nav?: ManualTodo["nav"];
}

interface CreateTodoModalProps {
  preset?: CreateTodoPreset;
  onClose: () => void;
}

let todoCounter = 0;

export function CreateTodoModal({ preset, onClose }: CreateTodoModalProps) {
  const addManualTodo = useTodoStore((s) => s.addManualTodo);
  const [title, setTitle] = useState(preset?.title ?? "");
  const [subtitle, setSubtitle] = useState(preset?.subtitle ?? "");
  const [url] = useState(preset?.url ?? "");
  const [priority, setPriority] = useState<ManualTodo["priority"]>(preset?.priority ?? "medium");
  const [source] = useState(preset?.source ?? "manual");

  const handleCreate = () => {
    if (!title.trim()) return;
    addManualTodo({
      id: `manual-${Date.now()}-${++todoCounter}`,
      source,
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      url: url.trim() || undefined,
      priority,
      createdAt: new Date().toISOString(),
      nav: preset?.nav,
    });
    onClose();
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.headerTitle}>Create To-Do</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.body}>
          <label className={styles.label}>
            Title
            <input
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            />
          </label>

          <label className={styles.label}>
            Note
            <input
              className={styles.input}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Optional context..."
            />
          </label>

          {url && (
            <div className={styles.urlPreview}>
              Linked: <span className={styles.urlText}>{url}</span>
            </div>
          )}

          <div className={styles.priorityRow}>
            <span className={styles.priorityLabel}>Priority</span>
            <div className={styles.priorityOptions}>
              {(["high", "medium", "low"] as const).map((p) => (
                <button
                  key={p}
                  className={`${styles.priorityBtn} ${styles[`priority_${p}`]} ${priority === p ? styles.priorityActive : ""}`}
                  onClick={() => setPriority(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.createBtn}
            onClick={handleCreate}
            disabled={!title.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
