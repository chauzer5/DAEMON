import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Plus } from "lucide-react";
import { Panel } from "../../components/layout/Panel";
import { useTodos } from "../../hooks/useTodos";
import { TodoItemCard } from "./TodoItem";
import { CreateTodoModal } from "../../components/ui/CreateTodoModal";
import styles from "./TodosPanel.module.css";

export function TodosPanel() {
  const queryClient = useQueryClient();
  const { todos, criticalCount } = useTodos();
  const [showCreate, setShowCreate] = useState(false);

  const badge = todos.length > 0 ? `${todos.length} items` : undefined;

  return (
    <Panel
      title="To-Dos"
      icon={CheckSquare}
      badge={badge}
      badgeVariant={criticalCount > 0 ? "default" : "green"}
      onRefresh={() => queryClient.invalidateQueries()}
    >
      <button className={styles.addBtn} onClick={() => setShowCreate(true)}>
        <Plus size={14} />
        Add To-Do
      </button>

      {todos.length === 0 && (
        <div className={styles.emptyState}>
          No action items right now
        </div>
      )}
      <div className={styles.list}>
        {todos.map((item) => (
          <TodoItemCard key={item.id} item={item} />
        ))}
      </div>

      {showCreate && (
        <CreateTodoModal
          preset={{ source: "manual" }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </Panel>
  );
}
