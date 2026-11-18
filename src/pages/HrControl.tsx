import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Lock as LockIcon, ShieldCheck, ArrowRight } from "lucide-react";
import { usePayrollRuns, useMyHrRoles, usePayrollPostingAccounts } from "@/hooks/use-hr-data";
import { canDo, maskAmount } from "@/lib/hr-roles";
import { buildJournalPreview, type PayrollComputation } from "@/lib/payroll-engine";

export default function HrControl() {
  const perms = useMyHrRoles();
  const canAudit = canDo(perms, "audit_payroll");
  const runsQuery = usePayrollRuns();
  const accountsQuery = usePayrollPostingAccounts();
  const { data: runs = [], isLoading, isError: runsError, error: runsErrorInfo, refetch: refetchRuns } = runsQuery;
  const { data: postingAccounts = {}, isLoading: accountsLoading, isError: accountsError, error: accountsErrorInfo, refetch: refetchAccounts } = accountsQuery;

  const posted = runs.filter((r) => r.status === "posted");
  const approved = runs.filter((r) => r.status === "approved");
  const draft = runs.filter((r) => r.status === "draft");

  // Les cycles antérieurs à V80 n'ont pas la photographie détaillée nécessaire :
  // ils restent à contrôler, aucun taux historique n'est reconstitué.
  const balanceChecks = useMemo(
    () =>
      accountsLoading || accountsError ? [] : runs.map((r) => {
        if (!r.payroll_rules_snapshot) return { run: r, available: false, balanced: false, dr: 0, cr: 0 };
        const single: PayrollComputation = {
          gross: Number(r.gross_total || 0),
          deductions: Number(r.deductions_total || 0),
          taxes: Number(r.taxes_total || 0),
          net: Number(r.net_total || 0),
          employerCharges: Number(r.employer_charges_total || 0),
        };
        const je = buildJournalPreview([single], { accounts: postingAccounts });
        return { run: r, available: true, balanced: je.balanced, dr: je.totalDebit, cr: je.totalCredit };
      }),
    [runs, postingAccounts, accountsLoading, accountsError],
  );
  const unbalanced = balanceChecks.filter((b) => b.available && !b.balanced);
  const unverifiable = balanceChecks.filter((b) => !b.available);

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "RH / Paie", href: "/hr" }, { label: "Contrôle" }]} />
        <GuidanceBanner
          title="Contrôle & clôture paie"
          description="Vérification de l'équilibre DR=CR des écritures, verrou des périodes, audit des cycles comptabilisés."
        />

        {(runsError || accountsError) && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <span className="text-destructive">Le contrôle ne peut pas confirmer l’état des cycles ou des comptes de paie{runsErrorInfo instanceof Error ? ` : ${runsErrorInfo.message}` : accountsErrorInfo instanceof Error ? ` : ${accountsErrorInfo.message}` : "."}</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { void refetchRuns(); void refetchAccounts(); }}>Réessayer</Button>
        </div>}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <Kpi icon={CheckCircle2} label="Comptabilisés" value={runsError ? "—" : String(posted.length)} cls="text-success" />
          <Kpi icon={ShieldCheck} label="Approuvés" value={runsError ? "—" : String(approved.length)} cls="text-blue-600" />
          <Kpi icon={LockIcon} label="Brouillons" value={runsError ? "—" : String(draft.length)} cls="text-muted-foreground" />
          <Kpi icon={AlertTriangle} label="Écart DR/CR" value={runsError || accountsLoading || accountsError ? "—" : String(unbalanced.length)} cls={unbalanced.length ? "text-amber-600" : "text-muted-foreground"} />
          <Kpi icon={LockIcon} label="Historiques à vérifier" value={runsError || accountsLoading || accountsError ? "—" : String(unverifiable.length)} cls={unverifiable.length ? "text-amber-600" : "text-muted-foreground"} />
        </div>

        {unbalanced.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
            <CardContent className="py-2 text-xs flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              {unbalanced.length} cycle(s) avec un déséquilibre estimé. Inspectez le détail.
            </CardContent>
          </Card>
        )}
        {unverifiable.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
            <CardContent className="py-2 text-xs flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              {unverifiable.length} cycle(s) antérieur(s) ne possède(nt) pas de photographie des barèmes : leur équilibre ne peut pas être reconstitué de façon fiable.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="py-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs">Contrôle d'équilibre — tous les cycles chargés</CardTitle>
            <Button asChild size="sm" variant="ghost" className="h-6 text-[11px]">
              <Link to="/settings?tab=roles">Rôles et autorisations <ArrowRight className="w-3 h-3 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {isLoading || accountsLoading ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Chargement…</p>
            ) : runsError || accountsError ? (
              <p className="text-xs text-destructive py-4 text-center">Contrôle indisponible tant que les données des cycles et comptes ne sont pas chargées.</p>
            ) : balanceChecks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Aucun cycle.</p>
            ) : balanceChecks.map(({ run, available, balanced, dr, cr }) => (
              <div key={run.id} className="flex items-center gap-2 px-2 py-1.5 border rounded text-xs">
                <span className="font-mono">{run.period}</span>
                <Badge variant="outline" className="text-[10px]">{run.status}</Badge>
                {available && <><span className="ml-auto text-muted-foreground">DR {maskAmount(perms, dr)}</span>
                <span className="text-muted-foreground">CR {maskAmount(perms, cr)}</span></>}
                {!available ? (
                  <Badge variant="outline" className="text-[10px]">À vérifier</Badge>
                ) : balanced ? (
                  <Badge className="bg-success/10 text-success text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />OK</Badge>
                ) : (
                  <Badge className="bg-amber-500/10 text-amber-700 text-[10px]"><AlertTriangle className="w-3 h-3 mr-1" />Écart</Badge>
                )}
              </div>
            ))}
            {!canAudit && (
              <p className="text-[11px] text-muted-foreground pt-2">
                Vue limitée : le rôle hr_auditor donne accès au détail complet de l'audit.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function Kpi({ icon: Icon, label, value, cls }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; cls?: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className={`w-3 h-3 ${cls || ""}`} /> {label}
        </div>
        <div className={`text-lg font-semibold mt-1 ${cls || ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
