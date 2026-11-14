import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { useTreasuryAccounts } from "@/hooks/use-treasury-accounts";
import { accountsForMethod, defaultAccountFor, KIND_LABEL, kindForMethod } from "@/lib/treasury-accounts";

/*
 * Compte de trésorerie d'un règlement (V70) : les comptes actifs du type du mode de paiement, le
 * compte par défaut présélectionné. Sans compte de ce type, rien à choisir : la base passe l'écriture
 * sur le rôle du paramétrage comptable (Banque, Caisse ou Monnaie électronique).
 */
export function TreasuryAccountSelect({ id, method, value, onChange }: { id: string; method: string; value: string; onChange: (v: string) => void }) {
  const { data: accounts = [] } = useTreasuryAccounts();
  const list = accountsForMethod(accounts, method);
  const fallback = defaultAccountFor(accounts, method);
  // Changement de mode : le compte par défaut du nouveau type.
  useEffect(() => {
    if (!list.some((a) => a.id === value)) onChange(fallback);
  }, [method, fallback]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-1.5">
      <Label className="text-xs" htmlFor={id}>Compte de trésorerie</Label>
      {list.length === 0 ? (
        <p id={id} className="h-8 flex items-center text-[11px] text-muted-foreground">Aucun compte {KIND_LABEL[kindForMethod(method)].toLowerCase()} : compte du paramétrage comptable</p>
      ) : (
        <select id={id} className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
          {list.map((a) => <option key={a.id} value={a.id}>{a.name}{a.is_default ? " (par défaut)" : ""}</option>)}
        </select>
      )}
    </div>
  );
}
