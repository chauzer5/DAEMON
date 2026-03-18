import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import "./theme/globals.css";
import { ThemeProvider } from "./themes";
import { TitleBar } from "./components/layout/TitleBar";
import { StatusBar } from "./components/layout/StatusBar";
import { AppShell } from "./components/layout/AppShell";
import { LavaBackground } from "./components/layout/LavaBackground";
import { ScanlineOverlay } from "./components/layout/ScanlineOverlay";
import { HudDecorations } from "./components/ui/HudDecorations";
import { BootSequence } from "./components/ui/BootSequence";
import { SettingsModal } from "./components/ui/SettingsModal";
import { TerminalDrawer } from "./components/ai/TerminalDrawer";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [bootKey, setBootKey] = useState(0);

  useEffect(() => {
    const unlistenSettings = listen("open-settings", () => {
      setShowSettings(true);
    });
    const unlistenBoot = listen("replay-boot", () => {
      setBootKey((k) => k + 1);
    });
    return () => {
      unlistenSettings.then((fn) => fn());
      unlistenBoot.then((fn) => fn());
    };
  }, []);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <LavaBackground />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            position: "relative",
            zIndex: 1,
          }}
        >
          <TitleBar />
          <AppShell />
          <StatusBar onOpenSettings={() => setShowSettings(true)} />
          <TerminalDrawer />
          <ScanlineOverlay />
          <HudDecorations />
          <BootSequence key={bootKey} forcePlay={bootKey > 0} />
          <AnimatePresence>
            {showSettings && (
              <SettingsModal onClose={() => setShowSettings(false)} />
            )}
          </AnimatePresence>
        </div>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
