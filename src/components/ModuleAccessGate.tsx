import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useMyAccess } from "@/hooks/use-my-access";
import { canAccessPage } from "@/lib/module-access";
import { NAV_SECTIONS } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Check access before mounting a business page, so its data queries never run on a refused URL. */
export function ModuleAccessGate({ children }: { children: ReactNode }) {
  const access = useMyAccess();
  const location = useLocation();
  if (access.isPending) return <p role="status" className="p-6">Vérification de vos accès…</p>;
  if (!access.isSuccess) {
    return <main className="p-6"><Alert variant="destructive">
      <AlertTitle>Impossible de vérifier vos accès</AlertTitle>
      <AlertDescription>Réessayez pour ouvrir votre espace de travail.</AlertDescription>
      <Button variant="outline" onClick={() => void access.refetch()}>Réessayer</Button>
    </Alert></main>;
  }
  if (canAccessPage(`${location.pathname}${location.search}`, access.data)) return <>{children}</>;
  if (location.pathname === "/") {
    const first = NAV_SECTIONS.flatMap((s) => s.modules ?? []).find((m) => canAccessPage(m.basePath, access.data));
    if (first) return <Navigate to={first.basePath} replace />;
  }
  return <main className="mx-auto flex max-w-xl flex-col gap-4 p-6">
    <Alert variant="destructive">
      <AlertTitle>Accès refusé</AlertTitle>
      <AlertDescription>Vos rôles dans cette entreprise ne donnent pas accès à cette page. Contactez l’administrateur si cet accès est nécessaire.</AlertDescription>
    </Alert>
    <Button asChild variant="outline"><Link to={canAccessPage("/", access.data) ? "/" : "/docs"}>Retour à mon espace</Link></Button>
  </main>;
}
