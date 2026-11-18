import { useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type CampaignCountEntry, type CampaignStage, type InventoryCampaignItem } from "@/lib/inventory-campaign";
import { countSheetColumns, countSheetRows, parseCampaignCountWorkbook } from "@/lib/inventory-campaign-workbook";
import { exportToXLSX } from "@/lib/xlsx";

export function InventoryCampaignSheet({ campaignId, reference, stage, items, disabled, onImport }: {
  campaignId: string; reference: string | null; stage: CampaignStage; items: InventoryCampaignItem[];
  disabled: boolean; onImport: (entries: CampaignCountEntry[]) => Promise<void>;
}) {
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState<CampaignCountEntry[]>([]);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(0);
  const blocked = disabled || reading;
  const inputId = `inventaire-excel-${stage}-${campaignId}`;
  const sheetName = stage === "first" ? "Comptage initial" : "Recomptage";
  const itemNames = new Map(items.map((item) => [item.item_id, `${item.code} — ${item.name}`]));

  const read = async (file: File) => {
    setPending([]);
    setImported(0);
    setError("");
    setReading(true);
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
        throw new Error("Choisissez un classeur .xlsx de 10 Mo au maximum.");
      }
      setPending(await parseCampaignCountWorkbook(await file.arrayBuffer(), campaignId, stage, items));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Le classeur n’a pas pu être ouvert.");
    } finally { setReading(false); }
  };

  const save = async () => {
    setError("");
    try {
      await onImport(pending);
      setImported(pending.length);
      setPending([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Les quantités n’ont pas pu être enregistrées.");
    }
  };

  return <div className="space-y-2 rounded-md border bg-muted/20 p-3">
    <p className="text-sm font-medium">Saisie groupée avec Excel</p>
    <p className="text-sm text-muted-foreground">
      Complétez la colonne « Quantité comptée », puis réimportez la feuille. Une cellule vide est ignorée ; un zéro est enregistré.
    </p>
    <div className="flex flex-wrap items-end gap-3">
      <Button size="sm" variant="outline" disabled={blocked || !items.length}
        onClick={() => exportToXLSX(countSheetRows(campaignId, reference, stage, items), countSheetColumns,
          `feuille-${stage === "first" ? "comptage" : "recomptage"}-${reference ?? campaignId}`, sheetName)}>
        <FileSpreadsheet className="mr-1 h-4 w-4" />Télécharger la feuille Excel
      </Button>
      <div className="space-y-1">
        <Label htmlFor={inputId}>Importer la feuille remplie (.xlsx)</Label>
        <Input id={inputId} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={blocked || !items.length} onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void read(file);
          }} />
      </div>
    </div>
    {reading && <p role="status">Lecture du classeur…</p>}
    {error && <p role="alert" className="whitespace-pre-line text-sm text-destructive">{error}</p>}
    {!!pending.length && <div className="space-y-2">
      <p className="text-sm">{pending.length} quantité(s) prête(s) à enregistrer. Les autres lignes restent inchangées.</p>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Vérifier les premières lignes</summary>
        <ul className="my-1 list-disc pl-5">{pending.slice(0, 10).map((entry) =>
          <li key={entry.item_id}>{itemNames.get(entry.item_id)} : {entry.quantity.toLocaleString("fr-FR")}</li>)}</ul>
        {pending.length > 10 && <p>{pending.length - 10} autre(s) ligne(s) dans le lot.</p>}
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void save()} disabled={blocked}><Upload className="mr-1 h-4 w-4" />Confirmer l’import</Button>
        <Button size="sm" variant="ghost" onClick={() => setPending([])} disabled={blocked}>Écarter le fichier</Button>
      </div>
    </div>}
    {!!imported && <p role="status" className="text-sm">{imported} quantité(s) importée(s).</p>}
  </div>;
}
