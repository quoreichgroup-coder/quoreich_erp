import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { isApiEnabled } from "@/api/client";

/*
 * Identité légale de la société (V47), imprimée en tête de chaque pièce : raison sociale, adresse,
 * RCCM, IFU / NIF, régime d'imposition, service des impôts, coordonnées bancaires (Burkina Faso :
 * CGI art. 562 et 564 ; équivalents par pays à valider avec l'expert-comptable). Modifiable par
 * l'administrateur de la société.
 */
const FIELDS: { key: string; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "legal_name", label: "Raison sociale", placeholder: "Dénomination complète et forme juridique", wide: true },
  { key: "address", label: "Adresse", placeholder: "Siège social, ville, pays", wide: true },
  { key: "phone", label: "Téléphone" },
  { key: "email", label: "Adresse électronique" },
  { key: "rccm", label: "RCCM", placeholder: "BF-OUA-2026-B-0000" },
  { key: "tax_id", label: "IFU / NIF", placeholder: "Identifiant fiscal unique" },
  { key: "tax_regime", label: "Régime d'imposition", placeholder: "RNI, RSI, CME…" },
  { key: "tax_office", label: "Service des impôts de rattachement", placeholder: "DGE, DME Centre…" },
  { key: "bank_details", label: "Coordonnées bancaires", placeholder: "Banque, IBAN / RIB, code SWIFT", wide: true },
];

export function CompanyIdentityPanel() {
  const { data: tenantId } = useTenantId();
  const { data: access } = useMyAccess();
  const isAdmin = (access?.roles ?? []).includes("admin");
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["company-identity", tenantId],
    enabled: !!tenantId && !isApiEnabled(),
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tenants")
        .select("name, legal_name, address, phone, email, rccm, tax_id, tax_regime, tax_office, bank_details").eq("id", tenantId).single();
      if (error) throw error;
      return data as Record<string, string | null>;
    },
  });
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setForm(Object.fromEntries(FIELDS.map((f) => [f.key, data[f.key] ?? ""])));
  }, [data]);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("set_company_identity", { _identity: form });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["company-identity"] }); toast.success("Identité de la société enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isApiEnabled()) return <p className="text-sm text-muted-foreground">Sur site, l'identité de la société se renseigne dans la base locale (API à venir).</p>;
  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin" />;
  return (
    <div className="space-y-4 max-w-3xl" data-testid="company-identity">
      <div>
        <h2 className="text-sm font-semibold">Identité légale de {data?.name}</h2>
        <p className="text-xs text-muted-foreground">
          Imprimée en tête des devis, commandes, livraisons, factures, avoirs et relevés. Une mention vide s'imprime « à renseigner ».
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? "col-span-2 space-y-1.5" : "space-y-1.5"}>
            <Label className="text-xs" htmlFor={`company-${f.key}`}>{f.label}</Label>
            <Input id={`company-${f.key}`} className="h-8 text-xs" placeholder={f.placeholder} disabled={!isAdmin}
              value={form[f.key] ?? ""} onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))} />
          </div>
        ))}
      </div>
      {isAdmin ? (
        <Button size="sm" className="text-xs" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enregistrer"}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Seul l'administrateur de la société modifie ces informations.</p>
      )}
    </div>
  );
}
