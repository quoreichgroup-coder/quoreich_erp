import { useState, useMemo, useCallback } from "react";
import Papa from "papaparse";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { IMPORT_TEMPLATES, buildCsvTemplate, type ImportEntity } from "@/lib/import-templates";
import { Upload, Download, CheckCircle2, AlertTriangle, FileSpreadsheet, ArrowRight, ArrowLeft } from "lucide-react";

type Step = 1 | 2 | 3;
type Row = Record<string, string>;

interface ImportResult {
  success: boolean;
  total: number;
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export default function DataImport() {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [entity, setEntity] = useState<ImportEntity>("customers");
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const template = IMPORT_TEMPLATES[entity];
  const targetFields = useMemo(() => [...template.required, ...template.optional], [template]);

  const handleDownloadTemplate = () => {
    const csv = buildCsvTemplate(entity);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `template-${entity}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      Papa.parse<Row>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const data = results.data.filter((r) => Object.values(r).some((v) => v !== ""));
          const detectedHeaders = results.meta.fields ?? [];
          setHeaders(detectedHeaders);
          setRows(data);
          // Auto-map: same name match
          const auto: Record<string, string> = {};
          targetFields.forEach((tf) => {
            const match = detectedHeaders.find((h) => h.trim().toLowerCase() === tf.toLowerCase());
            if (match) auto[tf] = match;
          });
          setMapping(auto);
          setStep(2);
        },
        error: (err) => {
          toast({
            title: "Erreur de lecture du fichier",
            description: err.message,
            variant: "destructive",
          });
        },
      });
    },
    [targetFields, toast],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const previewMapped = useMemo(() => {
    return rows.slice(0, 5).map((r) => {
      const out: Row = {};
      targetFields.forEach((tf) => {
        const src = mapping[tf];
        out[tf] = src ? (r[src] ?? "") : "";
      });
      return out;
    });
  }, [rows, mapping, targetFields]);

  const missingRequired = template.required.filter((f) => !mapping[f]);

  const handleImport = async () => {
    if (missingRequired.length) {
      toast({
        title: "Mapping incomplet",
        description: `Champs requis manquants: ${missingRequired.join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    setImporting(true);
    try {
      const payloadRows = rows.map((r) => {
        const out: Record<string, string> = {};
        targetFields.forEach((tf) => {
          const src = mapping[tf];
          if (src && r[src] !== undefined && r[src] !== "") out[tf] = r[src];
        });
        return out;
      });

      const { data, error } = await supabase.functions.invoke("import-data", {
        body: { entity, rows: payloadRows },
      });
      if (error) throw error;
      setResult(data as ImportResult);
      setStep(3);
      toast({
        title: "Import terminé",
        description: `${(data as ImportResult).inserted} ligne(s) insérée(s)`,
      });
    } catch (e) {
      toast({
        title: "Erreur d'import",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep(1);
    setFileName("");
    setRows([]);
    setHeaders([]);
    setMapping({});
    setResult(null);
  };

  return (
    <PageShell>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Import de données</h1>
        <p className="text-sm text-muted-foreground">
          Migrez vos données depuis Excel/CSV en 3 étapes simples.
        </p>
      </div>
      {/* Stepper */}
      <div className="flex items-center justify-center gap-4 mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                step >= s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {step > s ? <CheckCircle2 className="w-4 h-4" /> : s}
            </div>
            <span className={`text-sm ${step >= s ? "font-medium" : "text-muted-foreground"}`}>
              {s === 1 ? "Upload" : s === 2 ? "Mapping" : "Résultat"}
            </span>
            {s < 3 && <ArrowRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Étape 1 — Sélection et upload</CardTitle>
            <CardDescription>
              Choisissez le type de données puis téléchargez le modèle ou déposez votre fichier CSV.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 max-w-sm">
              <label className="text-sm font-medium">Type de données</label>
              <Select value={entity} onValueChange={(v) => setEntity(v as ImportEntity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(IMPORT_TEMPLATES).map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{template.description}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleDownloadTemplate}>
                <Download className="w-4 h-4 mr-2" />
                Télécharger le modèle CSV
              </Button>
              <div className="flex flex-wrap gap-1">
                {template.required.map((f) => (
                  <Badge key={f} variant="secondary">
                    {f} *
                  </Badge>
                ))}
              </div>
            </div>

            <div
              onDrop={onDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-border rounded-lg p-10 text-center hover:border-primary transition-colors cursor-pointer"
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium mb-1">Glissez-déposez votre fichier CSV ici</p>
              <p className="text-sm text-muted-foreground">ou cliquez pour parcourir</p>
              <input
                id="file-input"
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Étape 2 — Mapping des colonnes</CardTitle>
            <CardDescription>
              Fichier <span className="font-medium">{fileName}</span> — {rows.length} ligne(s) détectée(s).
              Faites correspondre vos colonnes aux champs cibles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {missingRequired.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>Mapping incomplet</AlertTitle>
                <AlertDescription>
                  Champs requis non mappés : {missingRequired.join(", ")}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              {targetFields.map((tf) => {
                const isRequired = template.required.includes(tf);
                return (
                  <div key={tf} className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-sm font-medium">
                        {tf}
                        {isRequired && <span className="text-destructive ml-1">*</span>}
                      </label>
                    </div>
                    <Select
                      value={mapping[tf] ?? "__none__"}
                      onValueChange={(v) =>
                        setMapping((prev) => {
                          const next = { ...prev };
                          if (v === "__none__") delete next[tf];
                          else next[tf] = v;
                          return next;
                        })
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="— Ignorer —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Ignorer —</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Aperçu (5 premières lignes)</h4>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {targetFields.map((tf) => (
                        <TableHead key={tf}>{tf}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewMapped.map((r, i) => (
                      <TableRow key={i}>
                        {targetFields.map((tf) => (
                          <TableCell key={tf} className="text-xs">
                            {r[tf] || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={reset}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Recommencer
              </Button>
              <Button onClick={handleImport} disabled={importing || missingRequired.length > 0}>
                <Upload className="w-4 h-4 mr-2" />
                {importing ? "Import en cours..." : `Importer ${rows.length} ligne(s)`}
              </Button>
            </div>
            {importing && <Progress value={60} />}
          </CardContent>
        </Card>
      )}

      {/* STEP 3 */}
      {step === 3 && result && (
        <Card>
          <CardHeader>
            <CardTitle>Étape 3 — Résultat de l'import</CardTitle>
            <CardDescription>Récapitulatif de l'opération</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold">{result.total}</div>
                <div className="text-xs text-muted-foreground mt-1">Lignes traitées</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-success">{result.inserted}</div>
                <div className="text-xs text-muted-foreground mt-1">Insérées avec succès</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-destructive">{result.skipped}</div>
                <div className="text-xs text-muted-foreground mt-1">Ignorées</div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Erreurs détaillées</h4>
                <div className="border rounded-lg max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Ligne</TableHead>
                        <TableHead>Erreur</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell>{e.row}</TableCell>
                          <TableCell className="text-xs">{e.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={reset}>Nouvel import</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
