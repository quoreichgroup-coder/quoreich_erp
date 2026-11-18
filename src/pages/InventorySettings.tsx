import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, ClipboardList, FileText, Settings, ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { InventoryRolesPanel } from "@/components/InventoryRolesPanel";
import { InventoryCampaignPolicyCard } from "@/components/InventoryCampaignPolicyCard";
import { InventoryCampaignNumberingCard } from "@/components/InventoryCampaignNumberingCard";
import { InventoryCyclePolicyCard } from "@/components/InventoryCyclePolicyCard";
import { PostingAccountsPanel } from "@/components/PostingAccountsPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenantId } from "@/hooks/use-tenant";
import { useInventorySettings, useUpdateInventorySettings, useWarehouses, useMyInventoryRoles } from "@/hooks/use-inventory-data";
import { CAMPAIGN_SCOPE_LABEL, type CampaignSettingsItemScope } from "@/lib/inventory-campaign";

const sections = [
  { id: "traitement", label: "Traitement", icon: Settings },
  { id: "inventaires", label: "Inventaires", icon: ClipboardList },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "comptabilite", label: "Comptabilité", icon: BookOpen },
  { id: "droits", label: "Droits", icon: ShieldCheck },
];

function InventorySettingsSections({ tenantId }: { tenantId?: string }) {
  const [params, setParams] = useSearchParams();
  const section = sections.find((item) => item.id === params.get("tab"))?.id ?? sections[0].id;
  const settings = useInventorySettings();
  const warehouses = useWarehouses();
  const update = useUpdateInventorySettings();
  const { data: perms } = useMyInventoryRoles();
  const canEdit = Boolean(perms?.canSettings);
  const [processing, setProcessing] = useState<{ negative_stock_allowed?: boolean; adjustment_reason_required?: boolean }>({});
  const [depot, setDepot] = useState<string>();
  const [scope, setScope] = useState<CampaignSettingsItemScope>();
  const [permanent, setPermanent] = useState<boolean>();
  const formsDisabled = !canEdit || !settings.isSuccess || update.isPending;
  const negative = processing.negative_stock_allowed ?? Boolean(settings.data?.negative_stock_allowed ?? false);
  const reasonRequired = processing.adjustment_reason_required ?? Boolean(settings.data?.adjustment_reason_required ?? true);
  const defaultDepot = depot ?? String(settings.data?.default_warehouse_id ?? "");
  const itemScope = scope ?? (settings.data?.campaign_item_scope as CampaignSettingsItemScope | undefined) ?? "warehouse";
  const autoGl = permanent ?? Boolean(settings.data?.auto_je_on_movement ?? true);

  const readOnly = !canEdit && <p className="text-sm text-muted-foreground">
    Le droit « Modifier les paramètres de stock » est requis pour modifier les réglages.
  </p>;

  return <Tabs value={section} onValueChange={(tab) => setParams({ tab }, { replace: true })} className="space-y-4">
    <TabsList aria-label="Sections des paramètres Stock"
      className="h-auto w-full flex-wrap justify-start rounded-none border-b bg-transparent p-0 sm:flex-nowrap sm:overflow-x-auto">
      {sections.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id}
        className="shrink-0 gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
      </TabsTrigger>)}
    </TabsList>

    {tenantId && settings.isPending && <p role="status" className="text-sm">Chargement des paramètres de cette société…</p>}
    {settings.isError && <div role="alert" className="text-sm text-destructive">{settings.error.message}{" "}
      <Button size="sm" variant="outline" onClick={() => void settings.refetch()}>Réessayer</Button></div>}

    <TabsContent value="traitement">
      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="text-sm">Règles des mouvements</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="inventory-negative">Stock négatif autorisé</Label>
            <div className="flex items-center gap-2">
              <Switch id="inventory-negative" checked={negative} disabled={formsDisabled}
                onCheckedChange={(value) => setProcessing({ ...processing, negative_stock_allowed: value })} />
              <span className="text-sm text-muted-foreground">{negative ? "Autorisé" : "Bloqué"}</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="inventory-reason-required">Motif obligatoire sur les ajustements manuels</Label>
            <div className="flex items-center gap-2">
              <Switch id="inventory-reason-required" checked={reasonRequired} disabled={formsDisabled}
                onCheckedChange={(value) => setProcessing({ ...processing, adjustment_reason_required: value })} />
              <span className="text-sm text-muted-foreground">{reasonRequired ? "Obligatoire" : "Facultatif"}</span>
            </div>
          </div>
          {readOnly}
          <Button size="sm" disabled={formsDisabled || !Object.keys(processing).length}
            onClick={() => update.mutate(processing, { onSuccess: () => setProcessing({}) })}>Enregistrer le traitement</Button>
        </CardContent>
      </Card>
    </TabsContent>

    <TabsContent value="inventaires" className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-sm">Préparation des campagnes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="inventory-default-depot">Dépôt proposé par défaut</Label>
          <select id="inventory-default-depot" className="block h-9 w-full rounded-md border border-input bg-background px-2"
            value={defaultDepot} disabled={formsDisabled || !warehouses.isSuccess} onChange={(event) => setDepot(event.target.value)}>
            <option value="">Aucun dépôt par défaut</option>
            {(warehouses.data ?? []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>
              {warehouse.code} — {warehouse.name}
            </option>)}
          </select>
          {warehouses.isError && <p role="alert">Impossible de charger les dépôts de la société.</p>}
          <Label htmlFor="inventory-default-scope">Articles proposés à l’ouverture</Label>
          <select id="inventory-default-scope" className="block h-9 w-full rounded-md border border-input bg-background px-2"
            value={itemScope} disabled={formsDisabled} onChange={(event) => setScope(event.target.value as CampaignSettingsItemScope)}>
            {Object.entries(CAMPAIGN_SCOPE_LABEL).filter(([value]) => value !== "cycle")
              .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <p className="text-sm text-muted-foreground">
            La liste et le périmètre sont figés à l’ouverture. Les articles affectés sans mouvement peuvent être inclus pour compter les excédents.
          </p>
          {readOnly}
          <Button size="sm" disabled={formsDisabled || (depot !== undefined && !warehouses.isSuccess) || (depot === undefined && scope === undefined)}
            onClick={() => update.mutate({
              ...(depot !== undefined ? { default_warehouse_id: defaultDepot || null } : {}),
              ...(scope !== undefined ? { campaign_item_scope: itemScope } : {}),
            }, { onSuccess: () => { setDepot(undefined); setScope(undefined); } })}>
            Enregistrer la préparation
          </Button>
          <p className="text-sm"><Link className="text-primary underline" to="/inventory/transactions?tab=campaign-catalog">Ouvrir le catalogue des campagnes</Link></p>
        </CardContent>
      </Card>
      {canEdit && tenantId && <InventoryCampaignPolicyCard tenantId={tenantId} />}
      {canEdit && tenantId && <InventoryCyclePolicyCard tenantId={tenantId} />}
    </TabsContent>

    <TabsContent value="documents" className="max-w-2xl">
      {canEdit && tenantId ? <InventoryCampaignNumberingCard tenantId={tenantId} /> : readOnly}
    </TabsContent>

    <TabsContent value="comptabilite" className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-sm">Suivi comptable des stocks</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="inventory-permanent">Inventaire permanent</Label>
          <div className="flex items-center gap-2">
            <Switch id="inventory-permanent" checked={autoGl} disabled={formsDisabled} onCheckedChange={setPermanent} />
            <span className="text-sm text-muted-foreground">{autoGl ? "Écriture à chaque mouvement valorisé" : "Inventaire intermittent"}</span>
          </div>
          <p className="text-sm text-muted-foreground">Les ajustements de campagne utilisent le coût moyen de l’article et les comptes configurés par rôle.</p>
          {readOnly}
          <Button size="sm" disabled={formsDisabled || permanent === undefined}
            onClick={() => update.mutate({ auto_je_on_movement: autoGl }, { onSuccess: () => setPermanent(undefined) })}>
            Enregistrer la comptabilité
          </Button>
        </CardContent>
      </Card>
      <PostingAccountsPanel modules={["STK"]} />
    </TabsContent>

    <TabsContent value="droits"><InventoryRolesPanel /></TabsContent>
  </Tabs>;
}

export default function InventorySettings() {
  const { data: tenantId } = useTenantId();
  return <PageShell>
    <Breadcrumb items={[{ label: "Stocks" }, { label: "Gestion des stocks", href: "/inventory" }, { label: "Paramètres" }]} />
    <GuidanceBanner title="Paramètres Stock"
      description="Configurez par société les règles de traitement, les inventaires, les références de campagne, les comptes et les droits." />
    <h1 className="text-lg font-semibold text-foreground">Paramètres Stock</h1>
    <InventorySettingsSections key={tenantId ?? ""} tenantId={tenantId} />
  </PageShell>;
}
