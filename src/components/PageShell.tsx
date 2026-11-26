import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { TopNav } from "@/components/TopNav";
import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { SOURCE_LANGUAGE } from "@/i18n";
import { isI18nReady } from "@/i18n/ready-routes";

/** Écran pas encore traduit dans la langue choisie : on le dit, au lieu de mélanger les langues en silence. */
function UntranslatedNotice() {
  const { t, i18n } = useTranslation();
  const { pathname, search } = useLocation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  if (!language || language === SOURCE_LANGUAGE || isI18nReady(pathname, search)) return null;
  return (
    <p role="note" data-testid="untranslated-notice"
      className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
      <Languages aria-hidden="true" className="size-3.5 shrink-0" />
      {t("untranslated.notice", { language: t(`language.${language}`) })}
    </p>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full min-w-0">
        <DashboardSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopNav />
          <main className="min-w-0 max-w-full flex-1 space-y-5 overflow-auto p-4 lg:p-6">
            <UntranslatedNotice />
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
