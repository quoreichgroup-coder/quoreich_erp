import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DollarSign, Users, Package, Loader2 } from "lucide-react";
import { useCustomers, useARPaymentTerms } from "@/hooks/use-ar-data";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR");

function useSellableItems() {
  return useQuery({
    queryKey: ["sellable-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, code, name, category, selling_price, unit, status")
        .eq("status", "active")
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useCustomerOutstanding() {
  return useQuery({
    queryKey: ["customer-outstanding"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ar_invoices")
        .select("customer_id, total, amount_paid, status")
        .neq("status", "cancelled");
      if (error) throw error;
      const map = new Map<string, number>();
      (data ?? []).forEach((inv) => {
        if (inv.status === "paid") return;
        const due = Number(inv.total || 0) - Number(inv.amount_paid || 0);
        map.set(inv.customer_id, (map.get(inv.customer_id) ?? 0) + due);
      });
      return map;
    },
  });
}

export default function SalesMasterData() {
  const { data: customers = [], isLoading: lc } = useCustomers();
  const { data: outstanding } = useCustomerOutstanding();
  const { data: items = [], isLoading: li } = useSellableItems();
  const { data: terms = [], isLoading: lt } = useARPaymentTerms();

  return (
    <PageShell>
      <Breadcrumb
        items={[
          { label: "Finance" },
          { label: "Sales", href: "/sales" },
          { label: "Master Data" },
        ]}
      />
      <GuidanceBanner
        title="Sales Master Data"
        description="Clients, catalogue vendable et conditions de paiement — données live."
      />

      <h1 className="text-lg font-semibold text-foreground">Sales Master Data</h1>

      <Tabs defaultValue="customers">
        <TabsList className="mb-4">
          <TabsTrigger value="customers" className="gap-1.5">
            <Users className="w-3.5 h-3.5" />
            Clients ({customers.length})
          </TabsTrigger>
          <TabsTrigger value="catalog" className="gap-1.5">
            <Package className="w-3.5 h-3.5" />
            Catalogue ({items.length})
          </TabsTrigger>
          <TabsTrigger value="terms" className="gap-1.5">
            <DollarSign className="w-3.5 h-3.5" />
            Conditions de paiement ({terms.length})
          </TabsTrigger>
        </TabsList>

        {/* CUSTOMERS — credit limit live */}
        <TabsContent value="customers">
          <Card className="border-border">
            <CardContent className="p-0">
              {lc ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : customers.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  Aucun client enregistré
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Client
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Email
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground text-right">
                        Limite crédit
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground text-right">
                        Encours
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground text-right">
                        % utilisé
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Statut
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((c) => {
                      const limit = Number(c.credit_limit || 0);
                      const used = outstanding?.get(c.id) ?? 0;
                      const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
                      const risk =
                        limit === 0
                          ? { label: "—", cls: "bg-muted text-muted-foreground" }
                          : pct >= 90
                          ? {
                              label: "Critique",
                              cls: "bg-destructive/15 text-destructive border-destructive/20",
                            }
                          : pct >= 70
                          ? {
                              label: "Surveiller",
                              cls: "bg-amber-500/15 text-amber-700 border-amber-500/20",
                            }
                          : {
                              label: "OK",
                              cls: "bg-success/15 text-success border-success/20",
                            };
                      return (
                        <TableRow key={c.id} className="text-xs">
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {c.email || "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {limit > 0 ? fmt(limit) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono">{fmt(used)}</TableCell>
                          <TableCell className="text-right font-mono">
                            {limit > 0 ? `${pct}%` : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${risk.cls}`}>
                              {risk.label}
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

        {/* CATALOG — sellable items live */}
        <TabsContent value="catalog">
          <Card className="border-border">
            <CardContent className="p-0">
              {li ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  Aucun article actif — créez-les dans Inventory
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Code
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Article
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Catégorie
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground text-right">
                        Prix vente
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Unité
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it) => (
                      <TableRow key={it.id} className="text-xs">
                        <TableCell className="font-mono text-primary">{it.code}</TableCell>
                        <TableCell className="font-medium">{it.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {it.category || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fmt(Number(it.selling_price || 0))}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {it.unit || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* PAYMENT TERMS — live AR terms */}
        <TabsContent value="terms">
          <Card className="border-border">
            <CardContent className="p-0">
              {lt ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : terms.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  Aucune condition de paiement configurée
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Code
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Libellé
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground text-right">
                        Jours
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground text-right">
                        Escompte %
                      </TableCell>
                      <TableCell className="text-[11px] font-medium text-muted-foreground">
                        Actif
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {terms.map((t) => (
                      <TableRow key={t.id} className="text-xs">
                        <TableCell className="font-mono text-primary">{t.code}</TableCell>
                        <TableCell className="font-medium">{t.label}</TableCell>
                        <TableCell className="text-right font-mono">{t.days}</TableCell>
                        <TableCell className="text-right font-mono">
                          {t.discount_percent ?? 0}%
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              t.is_active
                                ? "bg-success/15 text-success border-success/20"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {t.is_active ? "Actif" : "Inactif"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
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
