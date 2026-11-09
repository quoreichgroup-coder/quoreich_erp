import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { ConsolidatedKpiRow } from "@/hooks/use-consolidated-cfo";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kpiKey: keyof ConsolidatedKpiRow | null;
  kpiLabel: string;
  isMoney: boolean;
  rows: ConsolidatedKpiRow[];
  source: string;
  onCloseAutoFocus?: (event: Event) => void;
};

const fmt = (v: number, ccy: string, money: boolean) =>
  money
    ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} ${ccy}`
    : new Intl.NumberFormat("fr-FR").format(v);

export function KpiDrilldownDialog({
  open, onOpenChange, kpiKey, kpiLabel, isMoney, rows, source, onCloseAutoFocus,
}: Props) {
  const total = kpiKey ? rows.reduce((s, r) => s + Number(r[kpiKey] ?? 0), 0) : 0;
  const currencies = Array.from(new Set(rows.map((r) => r.currency)));
  const ccy = currencies.length === 1 ? currencies[0] : "MIX";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="kpi-drilldown" aria-modal="true" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Décomposition — {kpiLabel}</DialogTitle>
          <DialogDescription>
            Source de données&nbsp;: <span className="font-mono text-xs">{source}</span>
          </DialogDescription>
        </DialogHeader>
        {kpiKey && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Société</TableHead>
                  <TableHead>Devise</TableHead>
                  <TableHead className="text-right">{kpiLabel}</TableHead>
                  <TableHead className="text-right">Part</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const v = Number(r[kpiKey] ?? 0);
                  const pct = total !== 0 ? (v / total) * 100 : 0;
                  return (
                    <TableRow key={r.tenant_id}>
                      <TableCell className="font-medium">{r.tenant_name}</TableCell>
                      <TableCell>{r.currency}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(v, r.currency, isMoney)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={2}>Total consolidé</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(total, ccy, isMoney)}</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
