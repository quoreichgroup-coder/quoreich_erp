/*
 * Demandes de prix (V139) : logique pure du comparatif, identique aux règles de award_rfq — attribution proposée au
 * moins-disant (prix converti au cours du jour, offres expirées écartées), motif exigé quand l'offre retenue ne l'est pas.
 */
export type RfqOffer = { rfq_line_id: string; line_no: number; supplier_id: string; supplier_name: string; unit_price: number; currency: string | null;
  unit_price_base: number; amount_base: number; lead_time_days: number | null; expired: boolean };
export type RfqChoice = { line_id: string; supplier_id: string; reason: string };

export const RFQ_STATUS: Record<string, string> = { draft: "Brouillon", sent: "Envoyée", awarded: "Attribuée", cancelled: "Annulée" };

/** Meilleur prix (converti) parmi les offres valables d'une ligne. */
export function bestPrice(offers: RfqOffer[], lineId: string): number | null {
  const valid = offers.filter((o) => o.rfq_line_id === lineId && !o.expired).map((o) => Number(o.unit_price_base));
  return valid.length ? Math.min(...valid) : null;
}

/** Choix proposés : le moins-disant valable de chaque ligne (à délai égal, le plus court ; puis l'ordre alphabétique). */
export function defaultChoices(offers: RfqOffer[], lineIds: string[]): Record<string, RfqChoice> {
  const out: Record<string, RfqChoice> = {};
  for (const id of lineIds) {
    const best = offers.filter((o) => o.rfq_line_id === id && !o.expired)
      .sort((a, b) => Number(a.unit_price_base) - Number(b.unit_price_base) || (a.lead_time_days ?? 1e9) - (b.lead_time_days ?? 1e9) || a.supplier_name.localeCompare(b.supplier_name))[0];
    if (best) out[id] = { line_id: id, supplier_id: best.supplier_id, reason: "" };
  }
  return out;
}

/** Vrai si l'offre choisie n'est pas au meilleur prix de la ligne (motif obligatoire). */
export function needsReason(offers: RfqOffer[], choice: RfqChoice): boolean {
  const mine = offers.find((o) => o.rfq_line_id === choice.line_id && o.supplier_id === choice.supplier_id);
  const best = bestPrice(offers, choice.line_id);
  return !!mine && best != null && Number(mine.unit_price_base) > best;
}

/** Problèmes empêchant l'attribution (ligne sans choix, motif manquant, offre expirée). */
export function awardIssues(offers: RfqOffer[], lineIds: string[], choices: Record<string, RfqChoice>): string[] {
  const issues: string[] = [];
  for (const id of lineIds) {
    const c = choices[id];
    const no = offers.find((o) => o.rfq_line_id === id)?.line_no;
    if (!c) { issues.push(`Ligne ${no ?? "?"} : aucune offre retenue`); continue; }
    const mine = offers.find((o) => o.rfq_line_id === id && o.supplier_id === c.supplier_id);
    if (mine?.expired) issues.push(`Ligne ${mine.line_no} : l'offre retenue a expiré`);
    if (needsReason(offers, c) && !c.reason.trim()) issues.push(`Ligne ${mine?.line_no ?? no} : motif requis (offre hors moins-disant)`);
  }
  return issues;
}
