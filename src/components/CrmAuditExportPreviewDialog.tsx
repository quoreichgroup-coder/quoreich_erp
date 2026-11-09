import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileDown, AlertTriangle, ShieldAlert } from "lucide-react";
import type { AuditPreview } from "@/lib/crm-audit-export";

type Props = {
  open: boolean;
  onClose: () => void;
  preview: AuditPreview | null;
  onConfirmCsv: () => void;
  onConfirmPdf: () => void;
};

export default function CrmAuditExportPreviewDialog({
  open, onClose, preview, onConfirmCsv, onConfirmPdf,
}: Props) {
  if (!preview) return null;
  const limited = preview.rows.slice(0, 20);
  const title = preview.kind === "roles"
    ? "Prévisualisation export — Audit des rôles CRM"
    : "Prévisualisation export — Étapes & assignations CRM";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[11px]">
              {preview.totalCount} ligne(s)
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {preview.columns.length} colonne(s)
            </Badge>
            {preview.maskedFields.length > 0 && (
              <Badge variant="destructive" className="text-[11px]">
                <ShieldAlert className="w-3 h-3 mr-1" /> {preview.maskedFields.length} champ(s) masqué(s)
              </Badge>
            )}
            {preview.totalCount > limited.length && (
              <Badge variant="secondary" className="text-[11px]">
                Aperçu : {limited.length}/{preview.totalCount}
              </Badge>
            )}
          </div>

          {preview.warning && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertTitle className="text-xs">Données sensibles masquées</AlertTitle>
              <AlertDescription className="text-xs">
                {preview.warning} Demandez le rôle « Auditeur CRM » ou « Manager » pour exporter les valeurs en clair.
              </AlertDescription>
            </Alert>
          )}

          {preview.blockedReason && (
            <Alert variant="destructive">
              <ShieldAlert className="w-4 h-4" />
              <AlertTitle className="text-xs">Export indisponible</AlertTitle>
              <AlertDescription className="text-xs">{preview.blockedReason}</AlertDescription>
            </Alert>
          )}

          {preview.totalCount === 0 ? (
            <Alert>
              <AlertDescription className="text-xs">
                Aucune ligne à exporter pour les filtres et permissions actuels.
              </AlertDescription>
            </Alert>
          ) : (
            <ScrollArea className="h-72 border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    {preview.columns.map((c) => (
                      <TableHead key={c.key} className="text-[10px]">{c.header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {limited.map((row, i) => (
                    <TableRow key={i}>
                      {preview.columns.map((c) => (
                        <TableCell key={c.key} className="text-[10px] font-mono">
                          {row[c.key] ?? "—"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>Annuler</Button>
          <Button
            size="sm" variant="outline"
            disabled={!preview.canExport || preview.totalCount === 0}
            onClick={onConfirmCsv}
          >
            <Download className="w-3 h-3 mr-1" /> Télécharger CSV
          </Button>
          <Button
            size="sm"
            disabled={!preview.canExport || preview.totalCount === 0}
            onClick={onConfirmPdf}
          >
            <FileDown className="w-3 h-3 mr-1" /> Télécharger PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
