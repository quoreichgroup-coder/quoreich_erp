// Centralized mapping: Sales action -> required roles + human hint.
// Used by SalesTransactions, SalesReporting (and any future Sales screen)
// to keep tooltips / aria-describedby messages consistent.

export type SalesAction =
  | "create"
  | "confirm"
  | "deliver"
  | "invoice"
  | "export"
  | "view";

export const SALES_ACTION_ROLES: Record<SalesAction, readonly string[]> = {
  create: ["sales_rep", "sales_manager", "admin"],
  confirm: ["sales_manager", "sales_controller", "admin"],
  deliver: ["sales_rep", "sales_manager", "sales_controller", "admin"],
  invoice: ["sales_manager", "sales_controller", "admin"],
  export: ["sales_manager", "sales_controller", "admin"],
  view: ["sales_rep", "sales_manager", "sales_controller", "admin"],
} as const;

const ACTION_LABEL: Record<SalesAction, string> = {
  create: "Créer un document Sales",
  confirm: "Confirmer / convertir",
  deliver: "Enregistrer une livraison",
  invoice: "Générer une facture",
  export: "Exporter en CSV",
  view: "Consulter le module Sales",
};

export function salesRoleHint(action: SalesAction): string {
  const roles = SALES_ACTION_ROLES[action].join(", ");
  return `${ACTION_LABEL[action]} — rôle requis : ${roles}`;
}

export const SALES_ROLE_HINTS: Record<SalesAction, string> = {
  create: salesRoleHint("create"),
  confirm: salesRoleHint("confirm"),
  deliver: salesRoleHint("deliver"),
  invoice: salesRoleHint("invoice"),
  export: salesRoleHint("export"),
  view: salesRoleHint("view"),
};
