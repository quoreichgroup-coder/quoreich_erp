import type { ReactNode } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ExportFormat } from "@/lib/table-export";

/**
 * Bouton d'export d'une liste : le bouton principal garde son libellé et exporte en CSV ; à côté,
 * « Excel » et « PDF » exportent les mêmes lignes. `onPick` reçoit le format choisi.
 */
export function ExportMenu({ onPick, children, disabled, className, ...rest }: Omit<ButtonProps, "onClick"> & {
  onPick: (format: ExportFormat) => void; children: ReactNode;
}) {
  return (
    <span className="inline-flex" role="group">
      <Button {...rest} className={`${className ?? ""} rounded-r-none`} disabled={disabled} onClick={() => onPick("csv")}>{children}</Button>
      <Button type="button" size={rest.size} variant="outline" className={`${className ?? ""} rounded-none border-l-0 gap-1`} disabled={disabled}
        data-testid={rest["data-testid" as keyof typeof rest] ? `${String(rest["data-testid" as keyof typeof rest])}-xlsx` : undefined}
        onClick={() => onPick("xlsx")}><FileSpreadsheet className="w-3 h-3" /> Excel</Button>
      <Button type="button" size={rest.size} variant="outline" className={`${className ?? ""} rounded-l-none border-l-0 gap-1`} disabled={disabled}
        data-testid={rest["data-testid" as keyof typeof rest] ? `${String(rest["data-testid" as keyof typeof rest])}-pdf` : undefined}
        onClick={() => onPick("pdf")}><FileText className="w-3 h-3" /> PDF</Button>
    </span>
  );
}
