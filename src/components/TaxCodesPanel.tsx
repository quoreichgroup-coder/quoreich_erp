import { useState } from "react";
import { Loader2, Plus, Receipt, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { useCreateTaxCode, useTaxCodes, useUpdateTaxCode } from "@/hooks/use-tax-codes";
import { useAccountingSetup } from "@/hooks/use-accounting-setup";

const CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Codes TVA de la société. Aucun code n'est créé d'office : un taux légal dépend du pays et se
 * valide localement. Le taux est figé après création ; un nouveau taux = un nouveau code.
 */
export function TaxCodesPanel() {
  const codes = useTaxCodes();
  const setup = useAccountingSetup();
  const update = useUpdateTaxCode();
  const canEdit = Boolean(setup.data?.canEdit);

  if (codes.isLoading) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Chargement des codes TVA…</p>;
  }
  if (codes.isError) {
    return (
      <div className="bg-card border border-destructive/40 rounded-lg p-4 space-y-2" role="alert">
        <p className="text-sm text-destructive">Codes TVA illisibles : {(codes.error as Error)?.message}</p>
        <Button size="sm" variant="outline" onClick={() => codes.refetch()}>Réessayer</Button>
      </div>
    );
  }
  const list = codes.data ?? [];

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-4" data-testid="tax-codes-panel">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Receipt className="w-4 h-4" /> Codes TVA</h3>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Chaque ligne de facture porte un code TVA. Le montant de TVA est calculé à la ligne et comptabilisé sur le compte
          du code, ou à défaut sur le compte du rôle « TVA collectée ».
        </p>
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Les taux légaux dépendent du pays et de l'activité : faites-les valider par votre expert-comptable. Un taux ne se
          modifie pas après création ; pour un nouveau taux, créez un nouveau code et désactivez l'ancien.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Code</th>
              <th className="py-2 pr-3 font-medium">Libellé</th>
              <th className="py-2 pr-3 font-medium text-right">Taux</th>
              <th className="py-2 pr-3 font-medium">Compte</th>
              <th className="py-2 pr-3 font-medium">État</th>
              <th className="py-2"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={6} className="py-3 text-muted-foreground" data-testid="tax-codes-empty">
                Aucun code TVA : les factures ne peuvent porter que des lignes sans TVA.
              </td></tr>
            )}
            {list.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0" data-testid={`tax-code-${t.code}`}>
                <td className="py-2 pr-3 font-mono">{t.code}</td>
                <td className="py-2 pr-3 text-foreground">{t.name}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{t.rate.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} %</td>
                <td className="py-2 pr-3 text-muted-foreground">{t.accountCode ?? "Rôle TVA collectée"}</td>
                <td className="py-2 pr-3"><StatusBadge status={t.active ? "success" : "info"} label={t.active ? "Actif" : "Inactif"} /></td>
                <td className="py-2 text-right">
                  {canEdit && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={update.isPending}
                      onClick={() => update.mutate({ id: t.id, name: t.name, active: !t.active, glAccountId: t.glAccountId })}>
                      {t.active ? "Désactiver" : "Réactiver"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit ? <NewTaxCodeForm existing={list.map((t) => t.code)} /> : (
        <p className="text-xs text-muted-foreground" data-testid="tax-codes-readonly">Seul l'administrateur de la société gère les codes TVA.</p>
      )}
    </div>
  );
}

function NewTaxCodeForm({ existing }: { existing: string[] }) {
  const create = useCreateTaxCode();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const rateNum = Number(rate.replace(",", "."));
  const rateOk = rate !== "" && Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100 && /^\d+([.,]\d{1,2})?$/.test(rate);
  const codeOk = CODE.test(code) && !existing.includes(code);
  const ok = codeOk && name.trim() && rateOk;
  return (
    <form className="flex flex-wrap items-end gap-2 border-t border-border pt-3" data-testid="new-tax-code-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) create.mutate({ code, name, rate: rateNum }, { onSuccess: () => { setCode(""); setName(""); setRate(""); } });
      }}>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Code</span>
        <Input id="new-tax-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="TVA18" className="h-8 w-28 font-mono text-xs" /></label>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Libellé</span>
        <Input id="new-tax-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="TVA 18 %" className="h-8 w-44 text-xs" /></label>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Taux (%)</span>
        <Input id="new-tax-rate" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="18" inputMode="decimal" className="h-8 w-24 text-xs text-right" /></label>
      <Button type="submit" size="sm" className="text-xs gap-1" disabled={!ok || create.isPending} data-testid="btn-create-tax-code">
        <Plus className="w-3.5 h-3.5" /> Créer le code
      </Button>
      {code && existing.includes(code) && <p className="text-xs text-destructive w-full">Ce code existe déjà.</p>}
      {rate !== "" && !rateOk && <p className="text-xs text-destructive w-full">Taux entre 0 et 100, deux décimales au plus.</p>}
    </form>
  );
}
