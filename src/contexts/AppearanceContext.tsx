import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";

type AuthLayout = "essential" | "enterprise";
const layoutKey = "qerp-auth-layout";
const AppearanceContext = createContext<{
  authLayout: AuthLayout;
  setAuthLayout: (layout: AuthLayout) => void;
} | null>(null);

function readLayout(): AuthLayout {
  try { return localStorage.getItem(layoutKey) === "enterprise" ? "enterprise" : "essential"; }
  catch { return "essential"; }
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [authLayout, updateLayout] = useState<AuthLayout>(readLayout);
  const setAuthLayout = (layout: AuthLayout) => {
    updateLayout(layout);
    try { localStorage.setItem(layoutKey, layout); } catch { /* La préférence reste utilisable pour cette visite. */ }
  };
  useEffect(() => {
    const syncLayout = (event: StorageEvent) => {
      if (event.key === layoutKey || event.key === null) updateLayout(readLayout());
    };
    window.addEventListener("storage", syncLayout);
    return () => window.removeEventListener("storage", syncLayout);
  }, []);
  return <ThemeProvider attribute="class" storageKey="qerp-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
    <AppearanceContext.Provider value={{ authLayout, setAuthLayout }}>{children}</AppearanceContext.Provider>
  </ThemeProvider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance must be used within AppearanceProvider");
  return context;
}
