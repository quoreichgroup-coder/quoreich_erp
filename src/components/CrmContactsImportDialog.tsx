import { useMemo, useState } from "react";
import Papa from "papaparse";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { useBulkInsertContacts } from "@/hooks/use-crm-data";
import { markDuplicateContactEmails, normalizeContactRow, type ParsedContactRow } from "@/lib/crm-contact-import";

type Props = { open: boolean; onClose: () => void; canCreate: boolean };

export default function CrmContactsImportDialog({ open, onClose, canCreate }: Props) {
  const [rows, setRows] = useState<ParsedContactRow[]>([]);
  const [filename, setFilename] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const bulk = useBulkInsertContacts();

  const valid = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);
  const invalid = useMemo(() => rows.filter((r) => r.errors.length > 0), [rows]);

  function handleFile(file: File) {
    setFilename(file.name);
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim().toLowerCase(),
      complete: (res) => {
        if (!res.meta.fields?.length || !res.meta.fields.some((field) => ["full_name", "nom", "name"].includes(field))) {
          setParseError("En-tête CSV invalide : ajoutez la colonne obligatoire full_name (ou nom/name).");
          setRows([]);
          return;
        }
        setParseError(res.errors.length ? res.errors.map((error) => `Ligne ${error.row ?? "?"} : ${error.message}`).join(" · ") : null);
        setRows(markDuplicateContactEmails(res.data.map((r, i) => normalizeContactRow(r, i + 2))));
      },
    });
  }

  function handleImport() {
    if (!canCreate || valid.length === 0 || parseError) return;
    bulk.mutate(valid.map((r) => r.row), {
      onSuccess: () => {
        setRows([]);
        setFilename("");
        onClose();
      },
    });
  }

  function reset() {
    setRows([]);
    setFilename("");
    setParseError(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Upload className="w-4 h-4" /> Importer des contacts (CSV)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <Alert>
            <FileText className="w-4 h-4" />
            <AlertDescription className="text-xs">
              Colonnes acceptées : <code>full_name</code> (requis), <code>email</code>, <code>phone</code>,
              <code> company</code>, <code>position</code>, <code>source</code>, <code>status</code>
              (active / inactive / archived). Encodage UTF-8, séparateur virgule.
            </AlertDescription>
          </Alert>

          {parseError && <Alert variant="destructive"><AlertTriangle className="w-4 h-4" /><AlertDescription className="text-xs">{parseError}</AlertDescription></Alert>}

          {rows.length === 0 ? (
            <label className="border-2 border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/40">
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span>Cliquez pour sélectionner un fichier CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); e.currentTarget.value = ""; }}
              />
            </label>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[11px]">{filename}</Badge>
                <Badge className="text-[11px] bg-success">
                  <CheckCircle2 className="w-3 h-3 mr-1" />{valid.length} valides
                </Badge>
                {invalid.length > 0 && (
                  <Badge variant="destructive" className="text-[11px]">
                    <AlertTriangle className="w-3 h-3 mr-1" />{invalid.length} en erreur
                  </Badge>
                )}
                <Button size="sm" variant="ghost" className="h-7 text-[11px] ml-auto" onClick={reset}>
                  Changer de fichier
                </Button>
              </div>

              {invalid.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription className="text-xs">
                    {invalid.length} ligne(s) ne seront pas importées. Corrigez le fichier et réessayez.
                  </AlertDescription>
                </Alert>
              )}

              <ScrollArea className="h-72 border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] w-12">Ligne</TableHead>
                      <TableHead className="text-[10px]">Nom</TableHead>
                      <TableHead className="text-[10px]">Email</TableHead>
                      <TableHead className="text-[10px]">Société</TableHead>
                      <TableHead className="text-[10px]">Statut</TableHead>
                      <TableHead className="text-[10px]">Erreurs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.line} className={r.errors.length ? "bg-destructive/5" : ""}>
                        <TableCell className="text-[10px] font-mono">{r.line}</TableCell>
                        <TableCell className="text-[10px]">{r.row.full_name || <span className="text-destructive">—</span>}</TableCell>
                        <TableCell className="text-[10px]">{r.row.email ?? "—"}</TableCell>
                        <TableCell className="text-[10px]">{r.row.company ?? "—"}</TableCell>
                        <TableCell className="text-[10px]">{r.row.status}</TableCell>
                        <TableCell className="text-[10px] text-destructive">
                          {r.errors.length ? r.errors.join(", ") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </>
          )}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => { reset(); onClose(); }}>Annuler</Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={!canCreate || valid.length === 0 || !!parseError || bulk.isPending}
            title={!canCreate ? "Action verrouillée — rôle requis pour créer." : ""}
          >
            Importer {valid.length} contact(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
