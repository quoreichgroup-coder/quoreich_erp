import { Link, useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SupplierCatalogPanel } from "@/components/Replenishment";

/*
 * Approvisionnement → Données de base : catalogue fournisseur réel (V54) et accès aux fiches
 * fournisseurs. Les contrats-cadres et l'évaluation des fournisseurs (anciennement des données
 * fictives sur cet écran) sont le lot A3 de l'audit (docs/audit-erp/11).
 */
export default function ProcurementMasterData() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "suppliers" ? "suppliers" : "catalog";
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs" }, { label: "Approvisionnement", href: "/procurement" }, { label: "Données de base" }]} />
      <GuidanceBanner title="Catalogue fournisseurs"
        description="Quel fournisseur livre quel article, à quel prix, dans quel délai, avec quel minimum et quel multiple de commande. Le réapprovisionnement s'en sert pour proposer les commandes." />
      <h1 className="text-lg font-semibold text-foreground mb-4">Approvisionnement — Données de base</h1>
      <Tabs value={tab} onValueChange={(v) => setSearchParams((sp) => { sp.set("tab", v); return sp; }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="catalog">Catalogue fournisseurs</TabsTrigger>
          <TabsTrigger value="suppliers">Fournisseurs</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog"><Card className="border-border"><CardContent className="p-4"><SupplierCatalogPanel /></CardContent></Card></TabsContent>
        <TabsContent value="suppliers">
          <Card className="border-border"><CardContent className="p-4 text-xs space-y-2">
            <p>Les fiches fournisseurs (coordonnées, identifiant fiscal, conditions de paiement) se gèrent dans le référentiel des tiers.</p>
            <Link to="/suppliers" className="text-primary underline">Ouvrir les fiches fournisseurs</Link>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
