import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import {
  Banknote,
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
  Briefcase,
  Receipt,
  Lock,
  RefreshCw,
} from "lucide-react";
import { useCfoCockpit } from "@/hooks/use-cfo-cockpit";
import { AgingDrilldownDialog, type AgingKind } from "@/components/AgingDrilldownDialog";

const fmt = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) + " XOF";

function Kpi({
  label,
  value,
  icon: Icon,
  to,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  to?: string;
  tone?: "default" | "positive" | "negative" | "warning";
  hint?: string;
}) {
  const toneCls =
    tone === "positive"
      ? "text-success"
      : tone === "negative"
        ? "text-rose-600"
        : tone === "warning"
          ? "text-amber-600"
          : "text-foreground";
  const inner = (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${toneCls}`}>{value}</div>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export default function CfoCockpit() {
  const { data, isLoading, refetch, isFetching } = useCfoCockpit();
  const [drill, setDrill] = useState<AgingKind | null>(null);

  return (
    <PageShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CFO Cockpit</h1>
          <p className="text-sm text-muted-foreground">
            Vue consolidée temps réel — Trésorerie, AR/AP, Risques, Projets, Paie.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Rafraîchir
        </button>
      </div>

      {isLoading || !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Liquidité
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi
                label="Trésorerie disponible"
                value={fmt(data.cashOnHand)}
                icon={Wallet}
                tone="positive"
                to="/treasury"
              />
              <Kpi
                label="Fonds de roulement"
                value={fmt(data.workingCapital)}
                icon={Banknote}
                tone={data.workingCapital >= 0 ? "positive" : "negative"}
                hint="Cash + Créances − Dettes"
              />
              <Kpi
                label="Cash flow net (mois)"
                value={fmt(data.netBurnMtd)}
                icon={data.netBurnMtd >= 0 ? TrendingUp : TrendingDown}
                tone={data.netBurnMtd >= 0 ? "positive" : "negative"}
                hint="Encaissements − Décaissements − Paie"
              />
              <Kpi
                label="Rapprochements ouverts"
                value={String(data.unmatchedReconCount)}
                icon={AlertTriangle}
                tone={data.unmatchedReconCount > 0 ? "warning" : "default"}
                to="/treasury/control"
              />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Cycle client / fournisseur
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi
                label="Créances clients"
                value={fmt(data.arOutstanding)}
                icon={Receipt}
                to="/receivables"
              />
              <Kpi
                label="Dettes fournisseurs"
                value={fmt(data.apOutstanding)}
                icon={Receipt}
                to="/payables"
              />
              <Kpi
                label="DSO (jours)"
                value={String(data.dso)}
                icon={TrendingUp}
                tone={data.dso > 60 ? "warning" : "default"}
                hint="Délai moyen d'encaissement"
              />
              <Kpi
                label="DPO (jours)"
                value={String(data.dpo)}
                icon={TrendingDown}
                hint="Délai moyen de paiement"
              />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Échus / Aging
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <button
                type="button"
                onClick={() => setDrill("ar")}
                data-testid="aging-ar-card"
                className="text-left"
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Créances en retard
                    </CardTitle>
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-2xl font-semibold ${data.arOverdue > 0 ? "text-amber-600" : "text-foreground"}`}
                      >
                        {fmt(data.arOverdue)}
                      </span>
                      <Badge variant="outline" data-testid="aging-ar-count">
                        {data.arOverdueCount} fact.
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Cliquer pour le détail
                    </p>
                  </CardContent>
                </Card>
              </button>
              <button
                type="button"
                onClick={() => setDrill("ap")}
                data-testid="aging-ap-card"
                className="text-left"
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Dettes en retard
                    </CardTitle>
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-2xl font-semibold ${data.apOverdue > 0 ? "text-rose-600" : "text-foreground"}`}
                      >
                        {fmt(data.apOverdue)}
                      </span>
                      <Badge variant="outline" data-testid="aging-ap-count">
                        {data.apOverdueCount} fact.
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Cliquer pour le détail
                    </p>
                  </CardContent>
                </Card>
              </button>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Opérations & risques
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi
                label="Projets actifs"
                value={String(data.openProjects)}
                icon={Briefcase}
                to="/projects"
              />
              <Kpi
                label="Risques élevés ouverts"
                value={String(data.openRisksHigh)}
                icon={AlertTriangle}
                tone={data.openRisksHigh > 0 ? "negative" : "default"}
                to="/risk"
              />
              <Kpi
                label="Paie postée (mois)"
                value={fmt(data.payrollPostedMtd)}
                icon={Banknote}
                to="/hr/payroll"
              />
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Dernière clôture
                  </CardTitle>
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Trésorerie</span>
                    <Badge variant={data.treasuryClosedPeriod ? "default" : "outline"}>
                      {data.treasuryClosedPeriod ?? "—"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Stock</span>
                    <Badge variant={data.inventoryClosedPeriod ? "default" : "outline"}>
                      {data.inventoryClosedPeriod ?? "—"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </>
      )}

      <AgingDrilldownDialog
        open={drill !== null}
        onOpenChange={(o) => !o && setDrill(null)}
        kind={drill ?? "ar"}
      />
    </PageShell>
  );
}
