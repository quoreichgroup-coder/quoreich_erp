/**
 * Fiche fournisseur (V56) : Incoterms 2020, contrôles de saisie (mêmes contraintes que la base),
 * état des coordonnées bancaires (double contrôle) et libellés du journal des changements.
 */

export const INCOTERMS = [
  { code: "EXW", label: "À l'usine" }, { code: "FCA", label: "Franco transporteur" }, { code: "FAS", label: "Franco le long du navire" },
  { code: "FOB", label: "Franco à bord" }, { code: "CFR", label: "Coût et fret" }, { code: "CIF", label: "Coût, assurance et fret" },
  { code: "CPT", label: "Port payé jusqu'à" }, { code: "CIP", label: "Port payé, assurance comprise" }, { code: "DAP", label: "Rendu au lieu de destination" },
  { code: "DPU", label: "Rendu au lieu de destination déchargé" }, { code: "DDP", label: "Rendu droits acquittés" },
] as const;

export const SUPPLIER_FIELD_LABELS: Record<string, string> = {
  name: "Nom", legal_name: "Raison sociale", tax_id: "IFU / NIF", rccm: "RCCM", bank_name: "Banque",
  bank_account: "Compte bancaire", bank_swift: "BIC / SWIFT", bank_verified: "Coordonnées bancaires validées",
};

export type BankStatus = "none" | "pending" | "verified";

export function bankStatus(s: { bank_account?: string | null; bank_verified?: boolean }): BankStatus {
  if (!s.bank_account) return "none";
  return s.bank_verified ? "verified" : "pending";
}

/** Message d'erreur en français, ou null. */
export function validateSupplier(r: {
  name: string; country: string | null; currency: string; bank_swift: string | null; lead_time_days: number; payment_terms: number; email: string | null;
}): string | null {
  if (!r.name) return "Le nom du fournisseur est obligatoire.";
  if (r.country && !/^[A-Z]{2}$/.test(r.country)) return "Pays : code ISO à deux lettres (BF, CI, FR…).";
  if (!/^[A-Z]{3}$/.test(r.currency)) return "Devise : code à trois lettres (XOF, EUR, USD…).";
  if (r.bank_swift && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(r.bank_swift)) return "BIC / SWIFT : 8 ou 11 caractères.";
  if (!Number.isFinite(r.lead_time_days) || r.lead_time_days < 0) return "Le délai de livraison doit être positif.";
  if (!Number.isFinite(r.payment_terms) || r.payment_terms < 0) return "Le délai de paiement doit être positif.";
  if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) return "Adresse e-mail invalide.";
  return null;
}
