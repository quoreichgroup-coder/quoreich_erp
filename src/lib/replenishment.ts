/**
 * Réapprovisionnement (V54) : mêmes règles que replenishment_quantity côté base, pour l'aperçu à
 * l'écran et les contrôles de saisie. Point de commande → quantité fixe ; min / max → remonter au
 * maximum ; puis minimum de commande, puis arrondi au multiple du fournisseur.
 */

export type RuleMethod = "reorder_point" | "min_max";

export const METHOD_LABELS: Record<RuleMethod, string> = {
  reorder_point: "Point de commande (quantité fixe)",
  min_max: "Min / max (remonter au maximum)",
};

export function replenishmentQuantity(r: {
  method: RuleMethod; projected: number; reorderPoint: number; orderQty: number; maxQty: number;
  minOrder?: number; multiple?: number;
}): number {
  if (r.projected > r.reorderPoint) return 0;
  const brut = Math.max(r.method === "min_max" ? r.maxQty - r.projected : r.orderQty, r.minOrder ?? 0);
  return r.multiple && r.multiple > 0 ? Math.ceil(brut / r.multiple) * r.multiple : brut;
}

/** Contrôle d'une règle : message en français, ou null. */
export function validateRule(r: { itemId: string; method: RuleMethod; reorderPoint: number; safetyStock: number; orderQty: number; maxQty: number }): string | null {
  if (!r.itemId) return "Choisissez l'article.";
  if ([r.reorderPoint, r.safetyStock, r.orderQty, r.maxQty].some((n) => !Number.isFinite(n) || n < 0)) return "Les quantités doivent être positives.";
  if (r.safetyStock > r.reorderPoint) return "Le stock de sécurité ne peut pas dépasser le point de commande.";
  if (r.method === "reorder_point" && !(r.orderQty > 0)) return "Indiquez la quantité à commander.";
  if (r.method === "min_max" && !(r.maxQty > r.reorderPoint)) return "Le maximum doit dépasser le point de commande.";
  return null;
}
