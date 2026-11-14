import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { GLPostingConfigPanel, defaultGLPostingSettings } from "@/components/GLPostingConfig";
import { InventoryRolesPanel } from "@/components/InventoryRolesPanel";
import { PostingAccountsPanel } from "@/components/PostingAccountsPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import {
  useInventorySettings,
  useUpdateInventorySettings,
  useWarehouses,
} from "@/hooks/use-inventory-data";

export default function InventorySettings() {
  const { data: settings } = useInventorySettings();
  const { data: warehouses = [] } = useWarehouses();
  const update = useUpdateInventorySettings();

  const [autoGL, setAutoGL] = useState(true);
  const [negative, setNegative] = useState(false);
  const [valuation, setValuation] = useState<string>("average");
  const [defaultWH, setDefaultWH] = useState<string>("");

  useEffect(() => {
    if (settings) {
      setAutoGL(Boolean(settings.auto_je_on_movement ?? true));
      setNegative(Boolean(settings.negative_stock_allowed ?? false));
      setValuation((settings.valuation_method as string) ?? "average");
      setDefaultWH((settings.default_warehouse_id as string) ?? "");
    }
  }, [settings]);

  const save = () => {
    update.mutate({
      auto_je_on_movement: autoGL,
      negative_stock_allowed: negative,
      valuation_method: valuation,
      default_warehouse_id: defaultWH || null,
    });
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Stocks" }, { label: "Gestion des stocks", href: "/inventory" }, { label: "Paramètres" }]} />
      <GuidanceBanner title="Paramètres Stock" description="Entrepôt par défaut, méthode de valorisation (CMP/FIFO), comptabilisation automatique, rôles RBAC." />

      <h1 className="text-lg font-semibold text-foreground">Paramètres Stock</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm flex items-center gap-2"><Settings className="w-4 h-4 text-primary" />Configuration générale</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Entrepôt par défaut</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs" value={defaultWH} onChange={e => setDefaultWH(e.target.value)}>
                <option value="">— Aucun —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Méthode de valorisation</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs" value={valuation} onChange={e => setValuation(e.target.value)}>
                <option value="average">CMP — Coût Moyen Pondéré</option>
                <option value="fifo">FIFO — Premier entré, premier sorti</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="inventory-permanent">Suivi comptable des stocks</Label>
              <div className="flex items-center gap-2 h-9">
                <Switch id="inventory-permanent" checked={autoGL} onCheckedChange={setAutoGL} />
                <span className="text-xs text-muted-foreground">{autoGL
                  ? "Inventaire permanent : écriture Stocks / Variation des stocks à chaque mouvement"
                  : "Inventaire intermittent : variation constatée à l'inventaire de clôture"}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                En inventaire permanent, une entrée débite le compte de stock et crédite la variation des stocks (une sortie, l'inverse) ;
                les factures fournisseurs restent en achats. Sans les deux comptes ci-contre, les mouvements valorisés sont refusés.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Stock négatif autorisé</Label>
              <div className="flex items-center gap-2 h-9">
                <Switch checked={negative} onCheckedChange={setNegative} />
                <span className="text-xs text-muted-foreground">{negative ? "Autorisé" : "Bloqué (recommandé)"}</span>
              </div>
            </div>
            <Button size="sm" className="text-xs" onClick={save} disabled={update.isPending}>Enregistrer</Button>
          </CardContent>
        </Card>

        <div>
          <PostingAccountsPanel modules={["STK"]} />
        </div>
      </div>

      <InventoryRolesPanel />

      <GLPostingConfigPanel config={defaultGLPostingSettings.Inventory || {
        module: "Inventory",
        batchMode: "individual",
        frequency: "immediate",
        targetJournal: "GJ",
        approvalWorkflow: true,
        autoPost: true,
        approvalLevels: [
          { level: "L1", role: "Warehouse Manager", threshold: "All movements" },
          { level: "L2", role: "Finance Controller", threshold: "Adjustments > 5M XOF" },
        ],
        alertThresholds: [
          { rule: "Adjustment value > 10M XOF", threshold: "10,000,000", action: "Require L2 approval", severity: "Warning" },
          { rule: "Negative stock detected", threshold: "0", action: "Block and alert", severity: "Critical" },
        ],
      }} />
    </PageShell>
  );
}

