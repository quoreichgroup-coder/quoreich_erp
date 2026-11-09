/**
 * Types de l'API QUOREICH, dérivés du contrat OpenAPI du backend Java.
 *
 * <h2>Ce qui est généré, ce qui est écrit à la main</h2>
 * `qerp-schema.ts` est **généré** depuis `services/api/openapi/qerp-api.json` :
 * ne pas l'éditer. Le contrat lui-même est produit par les tests du module Java
 * (`OpenApiContractIT`), qui échouent dès qu'un point d'entrée change sans que
 * le contrat ait été régénéré. La chaîne complète est donc :
 *
 *     contrôleurs Java → contrat versionné → types TypeScript
 *
 * Le présent fichier, lui, est écrit à la main : il ne contient que des alias,
 * pour que les appelants écrivent `Customer` et non
 * `components["schemas"]["CustomerView"]`.
 *
 * <h2>Régénérer</h2>
 * ```bash
 * npm run api:types   # réécrit src/api/qerp-schema.ts
 * npm run api:check   # échoue si le fichier versionné a divergé du contrat
 * ```
 *
 * <h2>Ces types ne remplacent pas Supabase</h2>
 * La migration du front vers l'API Java se fait tranche verticale par tranche
 * verticale (lots 2 à 4). Tant qu'un domaine n'est pas migré, ses hooks
 * continuent d'interroger Supabase et ses types restent ceux de
 * `src/integrations/supabase/types.ts`. Les deux sources coexistent
 * volontairement : une bascule en bloc n'est pas recettable.
 */
import type { components, operations, paths } from "./qerp-schema";

/** Chemins de l'API, tels que déclarés au contrat. */
export type ApiPaths = paths;

/** Opérations de l'API, indexées par `operationId`. */
export type ApiOperations = operations;

/** Schémas de l'API, indexés par nom de type Java. */
export type ApiSchemas = components["schemas"];

/** Client exposé par `GET /api/v1/customers`. */
export type Customer = ApiSchemas["CustomerView"];

/** Réponse de `GET /api/v1/customers`. */
export type CustomerList = operations["listCustomers"]["responses"][200]["content"]["application/json"];

/**
 * Corps des réponses d'erreur 401 et 403.
 *
 * L'API ne renvoie jamais de trace de pile ni de message interne : le corps se
 * limite à un code générique, et le détail vit dans les journaux du serveur,
 * retrouvables par l'identifiant de corrélation.
 */
export interface ApiError {
  error: string;
}
