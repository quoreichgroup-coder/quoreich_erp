/**
 * Mouvements de stock : libellés français et classement par onglet de « Transactions » (Stocks).
 * Les mouvements naissent des pièces (réception, livraison, retours, transfert, ajustement,
 * inventaire) ; l'écran ne fait que les lire et lancer les fonctions habilitées (V53).
 */

export const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Réception fournisseur",
  delivery: "Livraison client",
  customer_return: "Retour client",
  supplier_return: "Retour fournisseur",
  transfer_in: "Transfert (entrée)",
  transfer_out: "Transfert (sortie)",
  adjustment: "Ajustement",
  issue: "Sortie",
  sale: "Vente",
};

export type MovementTab = "movements" | "transfers" | "adjustments";

export function movementLabel(type: string, referenceType?: string | null): string {
  if (type === "adjustment" && referenceType === "inventory_count") return "Écart d'inventaire";
  return MOVEMENT_LABELS[type] ?? type;
}

export function isTransfer(type: string): boolean {
  return type.startsWith("transfer");
}

/** Mouvements d'un onglet : tout, transferts, ou ajustements (y compris écarts d'inventaire). */
export function movementsOfTab<T extends { movement_type: string }>(rows: T[], tab: MovementTab): T[] {
  if (tab === "transfers") return rows.filter((r) => isTransfer(r.movement_type));
  if (tab === "adjustments") return rows.filter((r) => r.movement_type === "adjustment");
  return rows;
}

/** Contrôle de saisie d'un ajustement : message en français, ou null. */
export function validateAdjustment(a: { itemId: string; quantity: number; reason: string }, onHand: number): string | null {
  if (!a.itemId) return "Choisissez l'article.";
  if (!Number.isFinite(a.quantity) || a.quantity === 0) return "Saisissez une quantité (positive pour un excédent, négative pour un manquant).";
  if (!a.reason.trim()) return "Le motif de l'ajustement est obligatoire.";
  if (a.quantity < 0 && -a.quantity > onHand) return `Manquant supérieur au stock (${onHand}).`;
  return null;
}
