import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Download, Lock, XCircle } from "lucide-react";
import { canDo, maskAmount, type HrPerms } from "@/lib/hr-roles";

export type PreviewColumn = { key: string; header: string };
export type PreviewRow = Record<string, string | number>;

export function PayrollExportPreviewDialog({
  open,
  onOpenChange,
  format,
  currency,
  title,
  perms,
  columns,
  rows,
  balanced,
  totalDebit,
  totalCredit,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  format: "CSV" | "Excel" | "PDF";
  currency?: string | null;
  title: string;
  perms: HrPerms;
  columns: PreviewColumn[];
  rows: PreviewRow[];
  balanced?: boolean;
  totalDebit?: number;
  totalCredit?: number;
  onConfirm: () => void;
}) {
  const allowed = canDo(perms, "export");
  const preview = rows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            Aperçu export {format} — {title}
            <Badge variant="outline" className="text-[10px]">
              {rows.length} ligne(s) · {columns.length} colonne(s)
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {!allowed && (
          <Alert variant="destructive">
            <Lock className="w-4 h-4" />
            <AlertTitle className="text-xs">Export verrouillé</AlertTitle>
            <AlertDescription className="text-[11px]">
              Le droit « Exporter » doit être attribué à votre rôle dans Paramètres → Administration → Rôles et autorisations.
            </AlertDescription>
          </Alert>
        )}

        {balanced === false && (
          <Alert variant="destructive">
            <XCircle className="w-4 h-4" />
            <AlertTitle className="text-xs">Écriture SYSCOHADA déséquilibrée</AlertTitle>
            <AlertDescription className="text-[11px] font-mono">
              D {maskAmount(perms, totalDebit ?? 0)} / C {maskAmount(perms, totalCredit ?? 0)} {currency?.trim() || "Devise non enregistrée"} — l'export reflète l'état actuel ; la comptabilisation sera refusée.
            </AlertDescription>
          </Alert>
        )}
        {balanced === true && (
          <Alert>
            <CheckCircle2 className="w-4 h-4" />
            <AlertTitle className="text-xs">Écriture équilibrée</AlertTitle>
            <AlertDescription className="text-[11px] font-mono">
              D {maskAmount(perms, totalDebit ?? 0)} = C {maskAmount(perms, totalCredit ?? 0)} {currency?.trim() || "Devise non enregistrée"}
            </AlertDescription>
          </Alert>
        )}

        <div className="border border-border rounded-md overflow-auto max-h-[40vh]">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr className="border-b border-border">
                {columns.map((c) => (
                  <th key={c.key} className="text-left px-3 py-2 text-muted-foreground uppercase tracking-wider text-[10px]">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.length === 0 ? (
                <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">Aucune ligne à exporter.</td></tr>
              ) : preview.map((r, i) => (
                <tr key={i} className="border-b border-border/50">
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-1.5 font-mono">{String(r[c.key] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > preview.length && (
          <p className="text-[11px] text-muted-foreground">
            Aperçu des 5 premières lignes — le fichier en contiendra {rows.length}.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button
            size="sm" className="gap-1"
            disabled={!allowed || rows.length === 0}
            onClick={() => { onConfirm(); onOpenChange(false); }}
          >
            <Download className="w-3 h-3" /> Télécharger {format}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
