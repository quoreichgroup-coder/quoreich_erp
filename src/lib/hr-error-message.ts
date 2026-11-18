export function hrErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object") return null;
  const detail = error as { message?: unknown; code?: unknown; hint?: unknown };
  if (typeof detail.message !== "string" || !detail.message.trim()) return null;
  if (detail.code === "PGRST202") {
    const target = /list_hr_payroll_components/.test(detail.message)
      ? "V84 (rubriques de paie)"
      : /employee_number|movement_references/.test(detail.message)
        ? "V95 (matricules et référentiels de mouvements)"
        : "la migration RH/Paie correspondante";
    return `RPC non trouvée par Supabase Data API : vérifier que ${target} et les migrations RH/Paie dépendantes sont appliquées, puis recharger son schéma si nécessaire.`;
  }
  if (detail.code === "42501") return "Accès refusé par PostgreSQL : attribuer le droit RH requis au rôle central de l’utilisateur";
  const code = typeof detail.code === "string" && detail.code ? ` (${detail.code})` : "";
  const hint = typeof detail.hint === "string" && detail.hint.trim() ? ` — ${detail.hint}` : "";
  return `${detail.message}${code}${hint}`;
}
