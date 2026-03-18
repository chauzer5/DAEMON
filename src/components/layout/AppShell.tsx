import { type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MainContent } from "./MainContent";
import styles from "./AppShell.module.css";

interface AppShellProps {
  children?: ReactNode;
}

export function AppShell(_props: AppShellProps) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <MainContent />
    </div>
  );
}
