import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, Clock, History, Download, Loader2 } from "lucide-react";
import {
  useSalesPipeline,
  useSalesSLA,
  useSalesAudit,
  useSalesSettings,
} from "@/hooks/use-sales-data";

const fmt = (n: number | string | null | undefined) => Number(n || 0).toLocaleString("fr-FR");

function csvDownload(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SalesControl() {
  const { data: pipeline = [], isLoading: lp } = useSalesPipeline();
  const { data: sla = [], isLoading: ls } = useSalesSLA();
  const { data: audit = [], isLoading: la } = useSalesAudit();
  const { data: settings } = useSalesSettings();

  const SLA_Q_HOURS = Number(settings?.sla_quote_hours ?? 48);
  const SLA_Q2SO_HOURS = Number(settings?.sla_quote_to_so_hours ?? 72);
  const SLA_SO2DN_DAYS = Number(settings?.sla_so_to_dn_days ?? 7);
  const SLA_DN2INV_DAYS = Number(settings?.sla_dn_to_invoice_days ?? 2);
  const WARN = Number(settings?.sla_warning_pct ?? 75) / 100;

  const slaColor = (actual: number | null | undefined, threshold: number) => {
    if (actual == null) return "text-muted-foreground";
    if (actual <= threshold * WARN) return "text-success";
    if (actual <= threshold) return "text-amber-600";
    return "text-destructive";
  };

  const exportSLA = () => {
    const header = [
      "SO #",
      "Date commande",
      "Quote→SO (h)",
      "SO→DN (j)",
      "DN→Facture (j)",
      "Statut",
    ];
    const rows: (string | number | null | undefined)[][] = [
      header,
      ...sla.map((s) => [
        (s as { so_number: string | null }).so_number,
        (s as { order_date: string | null }).order_date,
        (s as { quote_to_so_hours: number | null }).quote_to_so_hours,
        (s as { so_to_dn_days: number | null }).so_to_dn_days,
        (s as { dn_to_invoice_days: number | null }).dn_to_invoice_days,
        (s as { status: string | null }).status,
      ]),
      [],
      [
        `Seuils — Quote: ${SLA_Q_HOURS}h · Quote→SO: ${SLA_Q2SO_HOURS}h · SO→DN: ${SLA_SO2DN_DAYS}j · DN→Facture: ${SLA_DN2INV_DAYS}j`,
      ],
    ];
    csvDownload(`sales_sla_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Sales", href: "/sales" }, { label: "Control" }]} />
      <GuidanceBanner
        title="Sales Control"
        description="Pipeline temps réel, SLA cycle Quote → SO → DN → Facture, et journal d'audit des changements de rôles."
      />

      <h1 className="text-lg font-semibold text-foreground">Sales Control</h1>

      <Tabs defaultValue="pipeline">
        <TabsList className="mb-3">
          <TabsTrigger value="pipeline" className="gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="sla" className="gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            SLA Cycle
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <History className="w-3.5 h-3.5" />
            Audit
          </TabsTrigger>
        </TabsList>

        {/* PIPELINE */}
        <TabsContent value="pipeline">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {lp ? (
              <div className="col-span-4 flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              ["quote", "sales_order", "delivered", "invoiced"].map((stage) => {
                const row = pipeline.find(
                  (p) => (p as { stage: string }).stage === stage
                ) as { docs?: number; amount?: number } | undefined;
                return (
                  <Card key={stage} className="border-border">
                    <CardContent className="p-3.5">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {stage.replace("_", " ")}
                      </div>
                      <div className="text-2xl font-semibold tabular-nums mt-1">{fmt(row?.docs)}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {fmt(row?.amount)} XOF
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </TabsContent>

        {/* SLA */}
        <TabsContent value="sla">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-sm">Cycle time Quote → SO → DN → Facture</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  Seuils : Quote→SO {SLA_Q2SO_HOURS}h · SO→DN {SLA_SO2DN_DAYS}j · DN→Facture{" "}
                  {SLA_DN2INV_DAYS}j
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="ghost" className="h-7 text-[11px]">
                  <a href="/sales/settings">Configurer SLA…</a>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={exportSLA}
                  disabled={!sla || sla.length === 0}
                >
                  <Download className="w-3 h-3 mr-1" />
                  Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {ls ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : sla.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  Aucune donnée SLA
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 text-[11px]">
                      <TableHead>SO #</TableHead>
                      <TableHead>Date commande</TableHead>
                      <TableHead className="text-right">Quote→SO (h)</TableHead>
                      <TableHead className="text-right">SO→DN (j)</TableHead>
                      <TableHead className="text-right">DN→Facture (j)</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sla.map((s, i) => {
                      const row = s as {
                        so_id: string;
                        so_number: string | null;
                        order_date: string | null;
                        quote_to_so_hours: number | null;
                        so_to_dn_days: number | null;
                        dn_to_invoice_days: number | null;
                        status: string | null;
                      };
                      return (
                        <TableRow key={row.so_id || i} className="text-xs">
                          <TableCell className="font-mono text-primary">
                            {row.so_number}
                          </TableCell>
                          <TableCell>{row.order_date}</TableCell>
                          <TableCell
                            className={`text-right font-mono ${slaColor(
                              row.quote_to_so_hours,
                              SLA_Q2SO_HOURS
                            )}`}
                          >
                            {row.quote_to_so_hours == null
                              ? "—"
                              : Number(row.quote_to_so_hours).toFixed(1)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${slaColor(
                              row.so_to_dn_days,
                              SLA_SO2DN_DAYS
                            )}`}
                          >
                            {row.so_to_dn_days ?? "—"}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${slaColor(
                              row.dn_to_invoice_days,
                              SLA_DN2INV_DAYS
                            )}`}
                          >
                            {row.dn_to_invoice_days ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {row.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* AUDIT */}
        <TabsContent value="audit">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">Audit trail Sales</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {la ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : audit.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  Aucune action enregistrée
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 text-[11px]">
                      <TableHead>Date</TableHead>
                      <TableHead>Événement</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Détail</TableHead>
                      <TableHead>Cible</TableHead>
                      <TableHead>Commentaire</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((a, i) => {
                      const row = a as {
                        created_at: string;
                        event_type: string;
                        action: string;
                        detail: string;
                        target: string;
                        comment: string | null;
                      };
                      return (
                        <TableRow key={i} className="text-xs">
                          <TableCell className="font-mono text-muted-foreground">
                            {new Date(row.created_at).toLocaleString("fr-FR")}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {row.event_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{row.action}</TableCell>
                          <TableCell className="font-mono">{row.detail}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {row.target?.slice(0, 8)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.comment || "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
