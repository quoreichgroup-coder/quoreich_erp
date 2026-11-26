import type { ReactNode } from "react";
import { Building2, FileText, Wallet } from "lucide-react";
import { useAppearance } from "@/contexts/AppearanceContext";
import { AppLogo } from "@/components/AppLogo";
import { AppearanceButton } from "@/components/AppearanceSettings";
import { cn } from "@/lib/utils";

export function AuthShell({ children }: { children: ReactNode }) {
  const { authLayout } = useAppearance();
  return <div className="flex min-h-dvh min-w-0 flex-col bg-background">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 sm:px-8">
      <AppLogo className="w-28 dark:brightness-0 dark:invert sm:w-32" />
      <AppearanceButton />
    </header>
    <main className={cn("mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-4 py-8 sm:px-8 sm:py-12",
      authLayout === "enterprise" && "lg:grid-cols-2 lg:gap-16")}
      data-auth-layout={authLayout}>
      {authLayout === "enterprise" && <aside aria-label="Présentation de QERP"
        className="hidden self-stretch rounded-xl border border-sidebar-border bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col lg:justify-center">
        <div aria-hidden="true" className="mb-8 h-1 w-12 rounded-full bg-brand-accent" />
        <p className="text-sm font-medium tracking-wide">QERP · Gestion d’entreprise</p>
        <h2 className="mt-4 max-w-md font-display text-3xl font-semibold leading-tight text-sidebar-primary">Votre activité,<br />une vue d’ensemble.</h2>
        <p className="mt-5 max-w-md text-sm leading-7">Retrouvez vos finances, vos achats et vos ventes dans un même espace de travail.</p>
        <ul className="mt-10 grid gap-5 text-sm">
          {[
            { Icon: Wallet, label: "Comptabilité et trésorerie" },
            { Icon: FileText, label: "Achats, ventes et documents" },
            { Icon: Building2, label: "Gestion de plusieurs sociétés" },
          ].map(({ Icon, label }) => <li key={label} className="flex items-center gap-3"><Icon aria-hidden="true" className="size-5 shrink-0" />{label}</li>)}
        </ul>
      </aside>}
      <div className="mx-auto w-full min-w-0 max-w-md">{children}</div>
    </main>
    <footer className="px-4 pb-6 text-center text-xs leading-relaxed text-muted-foreground">© {new Date().getFullYear()} QUOREICH · QERP</footer>
  </div>;
}
