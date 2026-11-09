import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Lock, PlayCircle } from "lucide-react";
import { usePayrollRuns, useCreatePayrollRun, useMyHrRoles, type PayrollRun } from "@/hooks/use-hr-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/hr-roles";
import { PayrollRunDialog } from "@/components/PayrollRunDialog";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Brouillon",   cls: "bg-muted text-muted-foreground" },
  approved:  { label: "Approuvé",    cls: "bg-blue-500/10 text-blue-700" },
  posted:    { label: "Comptabilisé",cls: "bg-success/10 text-success" },
};

export default function HrTransactions() {
  const perms = useMyHrRoles();
  const canCreate = canDo(perms, "create_payroll_run");
  const createTip = actionTooltip(perms, "create_payroll_run", "Créer un cycle de paie");

  const { data: runs = [], isLoading } = usePayrollRuns();
  const create = useCreatePayrollRun();

  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  const [selected, setSelected] = useState<PayrollRun | null>(null);

  const drafts = runs.filter((r) => r.status === "draft");
  const approved = runs.filter((r) => r.status === "approved");

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "RH / Paie", href: "/hr" }, { label: "Saisie paie" }]} />
        <GuidanceBanner
          title="Saisie de la paie"
          description="Créer un cycle mensuel, générer les lignes par employé, soumettre à approbation puis à comptabilisation."
        />

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {drafts.length} brouillon(s) · {approved.length} en attente d'exécution
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={!canCreate} title={createTip} className="h-8 text-xs gap-1.5">
                {canCreate ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                Nouveau cycle
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle className="text-sm">Créer un cycle de paie</DialogTitle></DialogHeader>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Période (YYYY-MM)</Label>
                  <Input value={period} onChange={(e) => setPeriod(e.target.value)} className="h-8 text-xs" placeholder="2026-06" />
                </div>
                <div>
                  <Label className="text-xs">Date de paie</Label>
                  <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              <DialogFooter>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
                <Button
                  size="sm"
                  disabled={create.isPending}
                  onClick={async () => {
                    await create.mutateAsync({ period, pay_date: payDate });
                    setOpen(false);
                  }}
                >Créer</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Cycles en cours</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {isLoading ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Chargement…</p>
            ) : runs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Aucun cycle. Créez-en un.</p>
            ) : runs.slice(0, 20).map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.draft;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-muted/50 rounded border border-border text-xs"
                >
                  <span className="font-mono">{r.period}</span>
                  <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
                  <span className="text-muted-foreground">{r.employee_count} empl.</span>
                  <span className="font-mono ml-auto">{maskAmount(perms, r.gross_total)}</span>
                  <PlayCircle className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </CardContent>
        </Card>

        <PayrollRunDialog
          run={selected}
          open={!!selected}
          onOpenChange={(v) => !v && setSelected(null)}
        />
      </div>
    </PageShell>
  );
}
