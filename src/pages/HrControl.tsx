import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Lock as LockIcon, ShieldCheck, ArrowRight } from "lucide-react";
import { usePayrollRuns, useMyHrRoles } from "@/hooks/use-hr-data";
import { canDo, maskAmount } from "@/lib/hr-roles";
import { buildJournalPreview, type PayrollComputation } from "@/lib/payroll-engine";

export default function HrControl() {
  const perms = useMyHrRoles();
  const canAudit = canDo(perms, "audit_payroll");
  const { data: runs = [], isLoading } = usePayrollRuns();

  const posted = runs.filter((r) => r.status === "posted");
  const approved = runs.filter((r) => r.status === "approved");
  const draft = runs.filter((r) => r.status === "draft");

  // Estimation d'équilibre DR=CR à partir des totaux du run (vue résumée).
  const balanceChecks = useMemo(
    () =>
      runs.slice(0, 12).map((r) => {
        const single: PayrollComputation = {
          gross: Number(r.gross_total || 0),
          deductions: Number(r.gross_total || 0) - Number(r.net_total || 0),
          taxes: 0,
          net: Number(r.net_total || 0),
        };
        const je = buildJournalPreview([single]);
        return { run: r, balanced: je.balanced, dr: je.totalDebit, cr: je.totalCredit };
      }),
    [runs],
  );
  const unbalanced = balanceChecks.filter((b) => !b.balanced);

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "RH / Paie", href: "/hr" }, { label: "Contrôle" }]} />
        <GuidanceBanner
          title="Contrôle & clôture paie"
          description="Vérification de l'équilibre DR=CR des écritures, verrou des périodes, audit des cycles comptabilisés."
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Kpi icon={CheckCircle2} label="Comptabilisés" value={String(posted.length)} cls="text-success" />
          <Kpi icon={ShieldCheck} label="Approuvés" value={String(approved.length)} cls="text-blue-600" />
          <Kpi icon={LockIcon} label="Brouillons" value={String(draft.length)} cls="text-muted-foreground" />
          <Kpi icon={AlertTriangle} label="Écart DR/CR" value={String(unbalanced.length)} cls={unbalanced.length ? "text-amber-600" : "text-muted-foreground"} />
        </div>

        {unbalanced.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
            <CardContent className="py-2 text-xs flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              {unbalanced.length} cycle(s) avec un déséquilibre estimé. Inspectez le détail.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="py-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs">Contrôle d'équilibre — cycles récents</CardTitle>
            <Button asChild size="sm" variant="ghost" className="h-6 text-[11px]">
              <Link to="/audit/hr">Audit RBAC <ArrowRight className="w-3 h-3 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {isLoading ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Chargement…</p>
            ) : balanceChecks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Aucun cycle.</p>
            ) : balanceChecks.map(({ run, balanced, dr, cr }) => (
              <div key={run.id} className="flex items-center gap-2 px-2 py-1.5 border rounded text-xs">
                <span className="font-mono">{run.period}</span>
                <Badge variant="outline" className="text-[10px]">{run.status}</Badge>
                <span className="ml-auto text-muted-foreground">DR {maskAmount(perms, dr)}</span>
                <span className="text-muted-foreground">CR {maskAmount(perms, cr)}</span>
                {balanced ? (
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
