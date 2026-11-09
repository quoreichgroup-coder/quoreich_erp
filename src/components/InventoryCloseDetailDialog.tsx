import { useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileDown } from "lucide-react";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import { SNAPSHOT_EXPORT_COLUMNS } from "@/lib/inventory-close-history";
import type { InventoryPeriodClose } from "@/hooks/use-inventory-data";


const fmt = (n: number | null | undefined) =>
  Math.round(Number(n || 0)).toLocaleString("fr-FR");

type SnapshotLine = {
  item_id: string;
  code: string;
  name: string;
  category: string | null;
  qty: number;
  unit_cost: number;
  value: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  row: InventoryPeriodClose | null;
  canExport: boolean;
};

export default function InventoryCloseDetailDialog({ open, onClose, row, canExport }: Props) {
  const lines = useMemo<SnapshotLine[]>(() => {
    const snap = row?.snapshot;
    return Array.isArray(snap) ? (snap as SnapshotLine[]) : [];
  }, [row]);

  if (!row) return null;
  const fileBase = `cloture-stock-${row.period}`;

  const csvCols = SNAPSHOT_EXPORT_COLUMNS.map((c) => ({ key: c.key, header: c.header }));

  const onCsv = () =>
    exportToCSV(lines as unknown as Record<string, unknown>[], csvCols, fileBase);

  const onPdf = () =>
    exportToPDF<SnapshotLine>({
      filename: fileBase,
      title: `Snapshot de clôture — Période ${row.period}`,
      subtitle: `Articles : ${row.items_count} · Qté : ${fmt(row.total_qty)} · Valeur : ${fmt(row.total_value)} XOF`,
      columns: csvCols.map((c) => ({ key: c.key as string, header: c.header })),
      rows: lines,
      orientation: "landscape",
    });


  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-5xl focus:outline-none"
        onEscapeKeyDown={(e) => { e.preventDefault(); onClose(); }}
        aria-modal="true"
        role="dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-sm">
            Détail clôture — Période {row.period}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[11px]">{row.items_count} article(s)</Badge>
            <Badge variant="outline" className="text-[11px]">Qté {fmt(row.total_qty)}</Badge>
            <Badge variant="outline" className="text-[11px]">Valeur {fmt(row.total_value)} XOF</Badge>
            <Badge variant="outline" className="text-[11px]">
              Clôturée le {new Date(row.closed_at).toLocaleString("fr-FR")}
            </Badge>
          </div>

          {lines.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground border rounded">
              Snapshot vide — aucun article au moment de la clôture.
            </div>
          ) : (
            <ScrollArea className="h-96 border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    {csvCols.map((c) => (
                      <TableHead key={c.key} className="text-[10px]">{c.header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.item_id}>
                      <TableCell className="font-mono text-[10px] text-primary">{l.code}</TableCell>
                      <TableCell className="text-[10px]">{l.name}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{l.category ?? "—"}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{fmt(l.qty)}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{fmt(l.unit_cost)}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono font-medium">{fmt(l.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            autoFocus
            className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            Fermer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canExport || lines.length === 0}
            onClick={onCsv}
            className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <Download className="w-3 h-3 mr-1" /> CSV
          </Button>
          <Button
            size="sm"
            disabled={!canExport || lines.length === 0}
            onClick={onPdf}
            className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <FileDown className="w-3 h-3 mr-1" /> PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
