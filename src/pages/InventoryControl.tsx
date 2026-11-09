import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ClipboardCheck, Lock, CheckCircle2, CalendarClock, Loader2 } from "lucide-react";
import {
  useMyInventoryRoles,
  useLowStockAlerts,
  useInventoryVariance,
  useInventoryPeriodCloses,
  useCloseInventoryPeriod,
} from "@/hooks/use-inventory-data";
import { actionTooltip, canDo } from "@/lib/inventory-roles";
import { isValidPeriod, closeMessage } from "@/lib/inventory-close";
import { toast } from "sonner";

const fmt = (n: number | null | undefined) => Math.round(Number(n || 0)).toLocaleString("fr-FR");
const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function InventoryControl() {
  const { data: perms } = useMyInventoryRoles();
  const canClose = canDo(perms, "close");
  const canMove = canDo(perms, "move");

  const { data: lowStock = [], isLoading: lsLoading } = useLowStockAlerts();
  const { data: variances = [], isLoading: vLoading } = useInventoryVariance();
  const { data: closes = [], isLoading: cLoading } = useInventoryPeriodCloses();
  const closeMut = useCloseInventoryPeriod();

  const [period, setPeriod] = useState(currentPeriod());
  const alreadyClosed = useMemo(() => closes.some((c) => c.period === period), [closes, period]);
  const periodValid = isValidPeriod(period);

  const onClose = () => {
    if (!canClose) { toast.error(closeMessage("forbidden", period)); return; }
    if (!periodValid) { toast.error(closeMessage("invalid_period", period)); return; }
    if (alreadyClosed) { toast.info(closeMessage("idempotent", period)); return; }
    closeMut.mutate(period);
  };

  const status: "closed" | "running" | "pending" | "invalid" =
    !periodValid ? "invalid"
    : closeMut.isPending ? "running"
    : alreadyClosed ? "closed"
    : "pending";
  const statusBadge =
    status === "closed"  ? <Badge variant="outline" className="bg-success/15 text-success text-[10px]">Terminée</Badge> :
    status === "running" ? <Badge variant="outline" className="bg-amber-500/15 text-amber-700 text-[10px] gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />En cours</Badge> :
    status === "invalid" ? <Badge variant="destructive" className="text-[10px]">Format invalide</Badge> :
                           <Badge variant="outline" className="text-[10px]">À clôturer</Badge>;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Stock", href: "/inventory" }, { label: "Contrôle" }]} />
      <GuidanceBanner
        title="Contrôle Stock"
        description="Alertes seuil, écarts d'inventaire physiques vs système, et clôture mensuelle avec snapshot de valorisation."
      />

      <h1 className="text-lg font-semibold text-foreground">Contrôle & Clôture</h1>

      {/* Period close */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" />Clôture mensuelle du stock
            <span className="ml-auto">{statusBadge}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Période (AAAA-MM)</Label>
              <Input
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2026-06"
                className="h-8 w-40 text-xs font-mono"
                pattern="\d{4}-(0[1-9]|1[0-2])"
                aria-invalid={!periodValid}
              />
            </div>
            <Button
              size="sm" onClick={onClose}
              disabled={!canClose || !periodValid || closeMut.isPending || alreadyClosed}
              className="h-8 text-xs gap-1.5"
              title={
                !canClose ? closeMessage("forbidden", period) :
                !periodValid ? closeMessage("invalid_period", period) :
                alreadyClosed ? closeMessage("idempotent", period) :
                "Clôturer la période (idempotent, verrouille le module)"
              }
            >
              {!canClose && <Lock className="w-3 h-3" />}
              {alreadyClosed ? <CheckCircle2 className="w-3 h-3" /> : null}
              {closeMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {closeMut.isPending ? "Clôture…" : alreadyClosed ? "Déjà clôturée" : "Clôturer la période"}
            </Button>
            <div className="text-[11px] text-muted-foreground flex flex-col gap-0.5">
              {!canClose && <span>{closeMessage("forbidden", period)}</span>}
              {canClose && !periodValid && <span className="text-destructive">{closeMessage("invalid_period", period)}</span>}
              {canClose && periodValid && alreadyClosed && <span>{closeMessage("idempotent", period)}</span>}
              {closeMut.isError && <span className="text-destructive">Erreur backend : {closeMut.error?.message}</span>}
            </div>
          </div>

          <div className="mt-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Historique des clôtures</h3>
            {cLoading ? (
              <div className="text-xs text-muted-foreground py-4">Chargement…</div>
            ) : closes.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4">Aucune période clôturée</div>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border bg-muted/30">
                  {["Période", "Clôturée le", "Par", "Statut", "Articles", "Qté totale", "Valeur (XOF)"].map((h) =>
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
                </tr></thead>
                <tbody>{closes.map((c) => (
                  <tr key={c.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono font-medium">{c.period}</td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(c.closed_at).toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{c.closed_by?.slice(0, 8) ?? "—"}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="bg-success/15 text-success text-[10px]">Terminée</Badge></td>
                    <td className="px-3 py-2 text-right font-mono">{c.items_count}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(c.total_qty)}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{fmt(c.total_value)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Low stock alerts */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />Alertes stock bas
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lsLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Chargement…</div>
          ) : lowStock.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Aucun article sous seuil</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Code", "Article", "Disponible", "Seuil", "Écart", "Sévérité", "Action"].map((h) =>
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
              </tr></thead>
              <tbody>{lowStock.slice(0, 25).map((a) => {
                const isOut = Number(a.quantity_on_hand) === 0;
                return (
                  <tr key={a.item_id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-primary">{a.code}</td>
                    <td className="px-3 py-2 font-medium">{a.name}</td>
                    <td className={`px-3 py-2 text-right font-mono ${isOut ? "text-destructive font-medium" : ""}`}>{fmt(a.quantity_on_hand)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(a.threshold)}</td>
                    <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(a.gap)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={isOut ? "destructive" : "secondary"} className="text-[10px]">
                        {isOut ? "Rupture" : "Bas"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
                        disabled={!canMove}
                        title={canMove ? "Générer une demande d'achat (PR)" : actionTooltip(perms, "move")}
                      >
                        {!canMove && <Lock className="w-2.5 h-2.5" />} Générer PR
                      </Button>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Variance from real inventory counts */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-primary" />Écarts physique vs système (inventaires)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {vLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Chargement…</div>
          ) : variances.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Aucun inventaire enregistré</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["N°", "Date", "Entrepôt", "Statut", "Comptés", "Conformes", "Écarts", "Δ Valeur (XOF)"].map((h) =>
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
              </tr></thead>
              <tbody>{variances.map((v) => (
                <tr key={v.count_id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-primary">{v.count_number}</td>
                  <td className="px-3 py-2">{v.count_date}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{v.warehouse_code ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px]">{v.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{v.items_checked}</td>
                  <td className="px-3 py-2 text-right font-mono text-success">{v.items_matched}</td>
                  <td className="px-3 py-2 text-right font-mono text-destructive font-medium">{v.items_variance}</td>
                  <td className={`px-3 py-2 text-right font-mono ${Number(v.total_value_diff) < 0 ? "text-destructive" : "text-success"}`}>
                    {fmt(v.total_value_diff)}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
