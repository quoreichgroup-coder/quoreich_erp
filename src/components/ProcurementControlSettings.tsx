import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProcurementSettings, useUpdateProcurementSettings } from "@/hooks/use-procurement-data";
import { useMyAccess } from "@/hooks/use-my-access";

/*
 * Paramètres « Contrôles et suivi » des achats (V57) : aucune de ces règles n'est figée dans le
 * code ; la base les lit à chaque opération. Modifiables avec le droit procurement.settings.
 */
const METHODES: [string, string][] = [["bank_transfer", "Virement"], ["check", "Chèque"], ["cash", "Espèces"], ["mobile_money", "Mobile money"]];

export function ProcurementControlSettings() {
  const { data: s } = useProcurementSettings();
  const update = useUpdateProcurementSettings();
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("procurement.settings");
  const [dual, setDual] = useState(true);
  const [methods, setMethods] = useState<string[]>(["bank_transfer"]);
  const [grace, setGrace] = useState("0");
  const [lead, setLead] = useState("0");
  const [inclReq, setInclReq] = useState(true);
  const [inclRes, setInclRes] = useState(true);

  useEffect(() => {
    if (!s) return;
    setDual(s.bank_dual_control ?? true);
    setMethods(s.bank_control_methods ?? ["bank_transfer"]);
    setGrace(String(s.followup_grace_days ?? 0));
    setLead(String(s.default_lead_time_days ?? 0));
    setInclReq(s.replenishment_include_requisitions ?? true);
    setInclRes(s.replenishment_include_reservations ?? true);
  }, [s]);

  const g = Number(grace), l = Number(lead);
  const error = !Number.isInteger(g) || g < 0 || g > 365 ? "Tolérance : de 0 à 365 jours."
    : !Number.isInteger(l) || l < 0 || l > 3650 ? "Délai par défaut : de 0 à 3 650 jours."
    : dual && methods.length === 0 ? "Choisissez au moins un mode de paiement contrôlé, ou désactivez le double contrôle." : null;

  const row = (id: string, label: string, help: string, checked: boolean, set: (v: boolean) => void) => (
    <div className="flex items-center justify-between gap-3 p-3 border border-border rounded">
      <div><Label htmlFor={id} className="text-xs font-medium">{label}</Label><p className="text-[11px] text-muted-foreground">{help}</p></div>
      <Switch id={id} checked={checked} onCheckedChange={set} disabled={!canEdit} aria-label={label} />
    </div>
  );

  return (
    <Card className="border-border max-w-2xl">
      <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Contrôles et suivi</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {!canEdit && <p className="text-xs text-muted-foreground">Lecture seule : le droit « Modifier les paramètres des achats » est requis.</p>}
        {row("set-dual", "Double contrôle des coordonnées bancaires",
          "Un compte ou un BIC modifié doit être validé par une autre personne avant tout paiement contrôlé.", dual, setDual)}
        <fieldset className="p-3 border border-border rounded space-y-2" disabled={!canEdit || !dual}>
          <legend className="text-xs font-medium px-1">Modes de paiement soumis au double contrôle</legend>
          <div className="flex flex-wrap gap-4">
            {METHODES.map(([v, lbl]) => (
              <label key={v} className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={methods.includes(v)}
                  onChange={(e) => setMethods(e.target.checked ? [...methods, v] : methods.filter((m) => m !== v))} />{lbl}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="set-grace" className="text-xs">Tolérance avant « en retard » (jours)</Label>
            <Input id="set-grace" type="number" min={0} className="h-8 text-xs" value={grace} disabled={!canEdit} onChange={(e) => setGrace(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="set-lead" className="text-xs">Délai de livraison par défaut (jours)</Label>
            <Input id="set-lead" type="number" min={0} className="h-8 text-xs" value={lead} disabled={!canEdit} onChange={(e) => setLead(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">Utilisé quand la fiche fournisseur n'a pas de délai.</p></div>
        </div>
        {row("set-req", "Stock prévisionnel : compter les demandes d'achat ouvertes",
          "Une demande non convertie évite de proposer deux fois le même besoin.", inclReq, setInclReq)}
        {row("set-res", "Stock prévisionnel : déduire les commandes clients non livrées",
          "Réserve le stock promis aux clients avant de calculer le besoin.", inclRes, setInclRes)}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        {canEdit && (
          <Button size="sm" disabled={!!error || update.isPending || !s?.id} onClick={() => update.mutate({
            id: s.id, bank_dual_control: dual, bank_control_methods: methods, followup_grace_days: g, default_lead_time_days: l,
            replenishment_include_requisitions: inclReq, replenishment_include_reservations: inclRes,
          })}>Enregistrer</Button>
        )}
      </CardContent>
    </Card>
  );
}
