import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportToCSV } from "@/lib/csv-export";
import { TrendingUp, Download, Scale, Layers, Loader2, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGLAccounts, useAccountBalances, useGLSig } from "@/hooks/use-gl-data";

const tabs = [
  { id: "trial", label: "Balance de Vérification", icon: Scale },
  { id: "pnl", label: "Compte de Résultat", icon: TrendingUp },
  { id: "balance", label: "Bilan", icon: Layers },
  { id: "sig", label: "SIG (SYSCOHADA)", icon: Activity },
];

const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR");

type AccountRow = { code: string; name: string; type: string; debit: number; credit: number; balance: number };

export default function GLReporting() {
  const { data: accounts = [], isLoading: loadingAccounts } = useGLAccounts();
  const { data: balances = {}, isLoading: loadingBalances } = useAccountBalances();
  const [activeTab, setActiveTab] = useState("trial");

  // Period filter (YYYY-MM)
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [fromPeriod, setFromPeriod] = useState<string>("");
  const [toPeriod, setToPeriod] = useState<string>(currentMonth);
  const { data: sigRows = [], isLoading: loadingSig } = useGLSig(fromPeriod || undefined, toPeriod || undefined);

  const rows: AccountRow[] = useMemo(() => {
    return accounts.map(a => {
      const b = balances[a.id] || { debit: 0, credit: 0 };
      return { code: a.code, name: a.name, type: a.account_type, debit: b.debit, credit: b.credit, balance: b.debit - b.credit };
    }).sort((a, b) => a.code.localeCompare(b.code));
  }, [accounts, balances]);

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  // P&L: revenue & expense accounts
  const revenueRows = rows.filter(r => r.type.toLowerCase().includes("revenue"));
  const expenseRows = rows.filter(r => r.type.toLowerCase().includes("expense"));
  const totalRevenue = revenueRows.reduce((s, r) => s + r.credit - r.debit, 0);
  const totalExpenses = expenseRows.reduce((s, r) => s + r.debit - r.credit, 0);
  const netIncome = totalRevenue - totalExpenses;

  // Balance Sheet: asset, liability, equity accounts
  const assetRows = rows.filter(r => r.type.toLowerCase().includes("asset"));
  const liabilityRows = rows.filter(r => r.type.toLowerCase().includes("liability"));
  const equityRows = rows.filter(r => r.type.toLowerCase() === "equity");
  const totalAssets = assetRows.reduce((s, r) => s + r.debit - r.credit, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.credit - r.debit, 0);
  const totalEquity = equityRows.reduce((s, r) => s + r.credit - r.debit, 0);

  const isLoading = loadingAccounts || loadingBalances;

  if (isLoading) return <PageShell><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></PageShell>;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "General Ledger", href: "/journal" }, { label: "Reporting" }]} />
      <GuidanceBanner title="GL Reporting" description="États financiers calculés à partir des écritures postées : Balance, Compte de Résultat, Bilan et SIG (SYSCOHADA). Filtrez par période (YYYY-MM) pour le SIG." />

      <div className="flex flex-wrap items-end gap-3 bg-card border border-border rounded-lg p-3">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Période début</Label>
          <Input type="month" value={fromPeriod} onChange={(e) => setFromPeriod(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Période fin</Label>
          <Input type="month" value={toPeriod} onChange={(e) => setToPeriod(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setFromPeriod(""); setToPeriod(""); }}>Réinitialiser</Button>
        <span className="text-[10px] text-muted-foreground ml-auto">Filtre actif uniquement sur l'onglet SIG</span>
      </div>

      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ═══ TRIAL BALANCE ═══ */}
      {activeTab === "trial" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Balance de Vérification</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="btn-export-gl-0" onClick={() => exportToCSV(rows.filter(r => r.debit > 0 || r.credit > 0).map(r => ({ ...r })), [{ key: "code", header: "Compte" }, { key: "name", header: "Nom" }, { key: "debit", header: "Débit (XOF)" }, { key: "credit", header: "Crédit (XOF)" }], "balance-de-verification")}><Download className="w-3 h-3" />Export</Button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Compte", "Nom", "Débit (XOF)", "Crédit (XOF)"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.filter(r => r.debit > 0 || r.credit > 0).map(r => (
                <tr key={r.code} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono font-medium">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.debit ? fmt(r.debit) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.credit ? fmt(r.credit) : "—"}</td>
                </tr>
              ))}
              {rows.filter(r => r.debit > 0 || r.credit > 0).length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Aucune écriture validée</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-muted/30 font-semibold">
                <td className="px-3 py-2" colSpan={2}>Total</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(totalDebit)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(totalCredit)}</td>
              </tr>
              <tr className={cn("font-semibold", totalDebit === totalCredit ? "text-success" : "text-destructive")}>
                <td className="px-3 py-2" colSpan={4}>{totalDebit === totalCredit ? "✓ Équilibrée" : `✗ Déséquilibrée — Écart : ${fmt(Math.abs(totalDebit - totalCredit))}`}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ═══ P&L ═══ */}
      {activeTab === "pnl" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: "Total Produits", value: totalRevenue, positive: true },
              { label: "Total Charges", value: totalExpenses, positive: false },
              { label: "Résultat Net", value: netIncome, positive: netIncome >= 0 },
            ].map(k => (
              <div key={k.label} className="bg-card border border-border rounded-lg p-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</div>
                <div className={cn("text-lg font-semibold tabular-nums mt-1", k.positive ? "text-success" : "text-foreground")}>{fmt(k.value)} <span className="text-xs font-normal text-muted-foreground">XOF</span></div>
              </div>
            ))}
          </div>
          <div className="bg-card border border-border rounded-lg">
            <div className="p-3 border-b border-border flex justify-between">
              <h3 className="text-sm font-semibold text-foreground">Compte de Résultat</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="btn-export-gl-1" onClick={() => exportToCSV([...revenueRows.filter(r => r.credit - r.debit !== 0).map(r => ({ section: "Produits", code: r.code, name: r.name, montant: r.credit - r.debit })), ...expenseRows.filter(r => r.debit - r.credit !== 0).map(r => ({ section: "Charges", code: r.code, name: r.name, montant: r.debit - r.credit })), { section: "Résultat net", code: "", name: "", montant: netIncome }], [{ key: "section", header: "Rubrique" }, { key: "code", header: "Compte" }, { key: "name", header: "Libellé" }, { key: "montant", header: "Montant (XOF)" }], "compte-de-resultat")}><Download className="w-3 h-3" />Export</Button>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Compte", "Libellé", "Montant (XOF)"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {revenueRows.length > 0 && (
                  <>
                    <tr className="bg-muted/20"><td className="px-3 py-2 font-semibold" colSpan={3}>Produits</td></tr>
                    {revenueRows.filter(r => r.credit - r.debit !== 0).map(r => (
                      <tr key={r.code} className="border-b border-border hover:bg-muted/10">
                        <td className="px-3 py-2 pl-6 font-mono">{r.code}</td>
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2 text-right font-mono text-success">{fmt(r.credit - r.debit)}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30 font-semibold"><td className="px-3 py-2" colSpan={2}>Total Produits</td><td className="px-3 py-2 text-right font-mono text-success">{fmt(totalRevenue)}</td></tr>
                  </>
                )}
                {expenseRows.length > 0 && (
                  <>
                    <tr className="bg-muted/20"><td className="px-3 py-2 font-semibold" colSpan={3}>Charges</td></tr>
                    {expenseRows.filter(r => r.debit - r.credit !== 0).map(r => (
                      <tr key={r.code} className="border-b border-border hover:bg-muted/10">
                        <td className="px-3 py-2 pl-6 font-mono">{r.code}</td>
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmt(r.debit - r.credit)}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30 font-semibold"><td className="px-3 py-2" colSpan={2}>Total Charges</td><td className="px-3 py-2 text-right font-mono">{fmt(totalExpenses)}</td></tr>
                  </>
                )}
                <tr className="bg-primary/5 font-bold border-t-2 border-primary/20">
                  <td className="px-3 py-2.5" colSpan={2}>Résultat Net</td>
                  <td className={cn("px-3 py-2.5 text-right font-mono", netIncome >= 0 ? "text-success" : "text-destructive")}>{fmt(netIncome)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ BALANCE SHEET ═══ */}
      {activeTab === "balance" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Actif", value: totalAssets },
              { label: "Total Passif", value: totalLiabilities },
              { label: "Capitaux Propres", value: totalEquity },
            ].map(k => (
              <div key={k.label} className="bg-card border border-border rounded-lg p-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</div>
                <div className="text-lg font-semibold tabular-nums mt-1">{fmt(k.value)} <span className="text-xs font-normal text-muted-foreground">XOF</span></div>
              </div>
            ))}
          </div>
          <div className="bg-card border border-border rounded-lg">
            <div className="p-3 border-b border-border flex justify-between">
              <h3 className="text-sm font-semibold text-foreground">Bilan</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="btn-export-gl-2" onClick={() => exportToCSV([...assetRows.filter(r => r.balance !== 0).map(r => ({ section: "Actif", code: r.code, name: r.name, solde: r.debit - r.credit })), ...liabilityRows.filter(r => r.balance !== 0).map(r => ({ section: "Passif", code: r.code, name: r.name, solde: r.credit - r.debit })), ...equityRows.filter(r => r.balance !== 0).map(r => ({ section: "Capitaux propres", code: r.code, name: r.name, solde: r.credit - r.debit }))], [{ key: "section", header: "Rubrique" }, { key: "code", header: "Compte" }, { key: "name", header: "Libellé" }, { key: "solde", header: "Solde (XOF)" }], "bilan")}><Download className="w-3 h-3" />Export</Button>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Compte", "Libellé", "Solde (XOF)"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                <tr className="bg-muted/20"><td className="px-3 py-2 font-semibold" colSpan={3}>Actif</td></tr>
                {assetRows.filter(r => r.balance !== 0).map(a => (
                  <tr key={a.code} className="border-b border-border hover:bg-muted/10">
                    <td className="px-3 py-2 pl-6 font-mono">{a.code}</td>
                    <td className="px-3 py-2">{a.name}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(a.debit - a.credit)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-semibold"><td className="px-3 py-2" colSpan={2}>Total Actif</td><td className="px-3 py-2 text-right font-mono">{fmt(totalAssets)}</td></tr>

                <tr className="bg-muted/20"><td className="px-3 py-2 font-semibold" colSpan={3}>Passif</td></tr>
                {liabilityRows.filter(r => r.balance !== 0).map(l => (
                  <tr key={l.code} className="border-b border-border hover:bg-muted/10">
                    <td className="px-3 py-2 pl-6 font-mono">{l.code}</td>
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(l.credit - l.debit)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-semibold"><td className="px-3 py-2" colSpan={2}>Total Passif</td><td className="px-3 py-2 text-right font-mono">{fmt(totalLiabilities)}</td></tr>

                <tr className="bg-muted/20"><td className="px-3 py-2 font-semibold" colSpan={3}>Capitaux Propres</td></tr>
                {equityRows.filter(r => r.balance !== 0).map(e => (
                  <tr key={e.code} className="border-b border-border hover:bg-muted/10">
                    <td className="px-3 py-2 pl-6 font-mono">{e.code}</td>
                    <td className="px-3 py-2">{e.name}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(e.credit - e.debit)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-semibold"><td className="px-3 py-2" colSpan={2}>Total Capitaux Propres</td><td className="px-3 py-2 text-right font-mono">{fmt(totalEquity)}</td></tr>

                <tr className={cn("font-semibold border-t-2", totalAssets === totalLiabilities + totalEquity + netIncome ? "text-success bg-success/5" : "text-destructive bg-destructive/5")}>
                  <td className="px-3 py-2.5" colSpan={3}>
                    {totalAssets === totalLiabilities + totalEquity + netIncome
                      ? "✓ Équilibré — Actif = Passif + Capitaux Propres + Résultat"
                      : `Actif: ${fmt(totalAssets)} | Passif + CP + Résultat: ${fmt(totalLiabilities + totalEquity + netIncome)}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ SIG (SYSCOHADA) ═══ */}
      {activeTab === "sig" && (
        <div className="space-y-4">
          {loadingSig ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : (() => {
            const totals = sigRows.reduce((acc, r) => ({
              ventes: acc.ventes + Number(r.ventes || 0),
              chiffre_affaires: acc.chiffre_affaires + Number(r.chiffre_affaires || 0),
              marge_commerciale: acc.marge_commerciale + Number(r.marge_commerciale || 0),
              valeur_ajoutee: acc.valeur_ajoutee + Number(r.valeur_ajoutee || 0),
              ebe: acc.ebe + Number(r.ebe || 0),
              resultat_exploitation: acc.resultat_exploitation + Number(r.resultat_exploitation || 0),
              resultat_net: acc.resultat_net + Number(r.resultat_net || 0),
              achats_consommes: acc.achats_consommes + Number(r.achats_consommes || 0),
              services_ext: acc.services_ext + Number(r.services_ext || 0),
              impots_taxes: acc.impots_taxes + Number(r.impots_taxes || 0),
              charges_personnel: acc.charges_personnel + Number(r.charges_personnel || 0),
              dotations: acc.dotations + Number(r.dotations || 0),
            }), {
              ventes: 0, chiffre_affaires: 0, marge_commerciale: 0, valeur_ajoutee: 0, ebe: 0,
              resultat_exploitation: 0, resultat_net: 0, achats_consommes: 0, services_ext: 0,
              impots_taxes: 0, charges_personnel: 0, dotations: 0,
            });

            const sigLines = [
              { label: "Chiffre d'Affaires", value: totals.chiffre_affaires, highlight: true },
              { label: "− Achats consommés", value: -totals.achats_consommes },
              { label: "= Marge commerciale / brute", value: totals.marge_commerciale, sub: true },
              { label: "− Services extérieurs", value: -totals.services_ext },
              { label: "= Valeur Ajoutée", value: totals.valeur_ajoutee, sub: true },
              { label: "− Impôts & taxes", value: -totals.impots_taxes },
              { label: "− Charges de personnel", value: -totals.charges_personnel },
              { label: "= Excédent Brut d'Exploitation (EBE)", value: totals.ebe, sub: true },
              { label: "− Dotations aux amortissements", value: -totals.dotations },
              { label: "= Résultat d'Exploitation", value: totals.resultat_exploitation, sub: true },
              { label: "= Résultat Net de l'exercice", value: totals.resultat_net, highlight: true },
            ];

            return (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: "Chiffre d'Affaires", v: totals.chiffre_affaires },
                    { label: "Valeur Ajoutée", v: totals.valeur_ajoutee },
                    { label: "EBE", v: totals.ebe },
                    { label: "Résultat Net", v: totals.resultat_net, pos: totals.resultat_net >= 0 },
                  ].map(k => (
                    <div key={k.label} className="bg-card border border-border rounded-lg p-3">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</div>
                      <div className={cn("text-lg font-semibold tabular-nums mt-1", k.pos === false && "text-destructive", k.pos === true && "text-success")}>
                        {fmt(k.v)} <span className="text-xs font-normal text-muted-foreground">XOF</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-card border border-border rounded-lg">
                  <div className="p-3 border-b border-border flex justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      Soldes Intermédiaires de Gestion {fromPeriod || toPeriod ? `(${fromPeriod || "—"} → ${toPeriod || "—"})` : "(toutes périodes)"}
                    </h3>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="btn-export-gl-3" onClick={() => exportToCSV(sigRows.map(r => ({ ...r })), [{ key: "period", header: "Période" }, { key: "chiffre_affaires", header: "CA" }, { key: "marge_commerciale", header: "Marge" }, { key: "valeur_ajoutee", header: "VA" }, { key: "ebe", header: "EBE" }, { key: "resultat_exploitation", header: "Résultat Expl." }, { key: "resultat_net", header: "Résultat Net" }], "soldes-intermediaires-de-gestion")}><Download className="w-3 h-3" />Export</Button>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {sigLines.map((row, i) => (
                        <tr key={i} className={cn("border-b border-border", row.highlight && "bg-primary/5 font-bold", row.sub && "bg-muted/30 font-semibold")}>
                          <td className="px-3 py-2">{row.label}</td>
                          <td className={cn("px-3 py-2 text-right font-mono tabular-nums",
                            row.value < 0 && !row.label.startsWith("−") ? "text-destructive" : "")}>
                            {fmt(row.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {sigRows.length > 1 && (
                  <div className="bg-card border border-border rounded-lg">
                    <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Détail mensuel</h3></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-border bg-muted/30">
                          {["Période", "CA", "Marge", "VA", "EBE", "Résultat Expl.", "Résultat Net"].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {sigRows.map(r => (
                            <tr key={r.period} className="border-b border-border hover:bg-muted/20">
                              <td className="px-3 py-2 font-mono font-medium">{r.period}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(r.chiffre_affaires)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(r.marge_commerciale)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(r.valeur_ajoutee)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(r.ebe)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(r.resultat_exploitation)}</td>
                              <td className={cn("px-3 py-2 text-right font-mono", r.resultat_net >= 0 ? "text-success" : "text-destructive")}>{fmt(r.resultat_net)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {sigRows.length === 0 && (
                  <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-xs">
                    Aucune donnée SIG pour la période sélectionnée
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </PageShell>
  );
}
