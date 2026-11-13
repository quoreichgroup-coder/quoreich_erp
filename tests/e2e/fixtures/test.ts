/**
 * `test` des specs simulées : celui de Playwright, plus un fond de backend simulé posé
 * automatiquement sur le contexte avant chaque test.
 *
 * Pourquoi : sous Lovable, les specs tournaient avec une vraie session et une vraie société ;
 * elles ne simulaient que ce qu'elles vérifiaient. En local, le profil, les droits (my_access,
 * V27) et chaque requête annexe de l'écran restaient sans réponse ou partaient vers la
 * production avec un jeton factice. Ce fond fournit :
 *   - profiles      → l'utilisateur E2E dans la société « t-1 » ;
 *   - my_access     → administrateur, les 45 droits du catalogue (V23, V33) ;
 *   - auth/v1/user  → l'utilisateur E2E ;
 *   - toute autre lecture REST → aucune ligne ; toute autre RPC → null ;
 *   - le canal temps réel → une connexion simulée muette, sans serveur.
 * Rien ne sort donc vers Supabase.
 *
 * Priorité : Playwright essaie d'abord les routes de la page, puis celles du contexte dans
 * l'ordre inverse de leur déclaration. Toute simulation déclarée par une spec (page.route ou
 * context.route) l'emporte donc sur ce fond — une spec qui veut un autre profil ou d'autres
 * droits n'a qu'à les simuler.
 *
 * Les specs connectées (treasury-rbac-*, treasury-realtime) importent @playwright/test : elles
 * parlent à un vrai Supabase et ne doivent pas recevoir ce fond.
 */
import { test as base, type BrowserContext, type Route } from "@playwright/test";
import { E2E_USER_ID } from "./session";

export * from "@playwright/test";

export const E2E_TENANT_ID = "t-1";

export const ALL_PERMISSIONS = [
  "crm.approve_discount", "crm.audit", "crm.convert", "crm.create", "crm.delete", "crm.edit", "crm.export", "crm.view",
  "crm.view_sensitive", "hr.approve_payroll_run", "hr.audit_payroll", "hr.create_payroll_run", "hr.execute_payroll",
  "hr.export", "hr.manage_employees", "hr.run_payroll", "hr.view_payroll", "hr.view_sensitive", "inventory.adjust",
  "inventory.close", "inventory.count", "inventory.move", "inventory.post_count", "inventory.transfer", "periods.close", "periods.reopen", "procurement.3wm",
  "procurement.approve_l1", "procurement.approve_l2", "procurement.approve_l3", "procurement.convert", "sales.confirm",
  "sales.create", "sales.deliver", "sales.invoice", "treasury.audit", "treasury.close_period", "treasury.create_txn",
  "treasury.edit_forecast", "treasury.export", "treasury.import_statement", "treasury.manage_accounts", "treasury.match",
  "treasury.validate_recon", "treasury.view_sensitive",
];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** `.single()` demande un objet (Accept vnd.pgrst.object) ; sinon PostgREST renvoie un tableau. */
const wantsObject = (route: Route) => (route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object");

export async function installBackendBaseline(context: BrowserContext) {
  // Déclaré en premier = essayé en dernier : le filet pour tout ce que rien d'autre ne simule.
  await context.route(/\/rest\/v1\/rpc\//, (r) => json(r, null));
  await context.route(/\/rest\/v1\/(?!rpc\/)/, (r) => {
    if (r.request().method() !== "GET") return json(r, wantsObject(r) ? {} : []);
    return wantsObject(r)
      ? json(r, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null }, 406)
      : json(r, []);
  });
  await context.route(/\/functions\/v1\//, (r) => json(r, {}));
  await context.route(/\/auth\/v1\//, (r) => json(r, {}));
  await context.routeWebSocket(/\/realtime\/v1\//, () => { /* connexion acceptée, aucun message */ });

  await context.route(/\/auth\/v1\/user/, (r) => json(r, {
    id: E2E_USER_ID, aud: "authenticated", role: "authenticated", email: "e2e@example.test",
    app_metadata: { provider: "email" }, user_metadata: { full_name: "Utilisateur E2E" },
  }));
  await context.route(/\/rest\/v1\/profiles/, (r) => {
    const profile = { id: E2E_USER_ID, tenant_id: E2E_TENANT_ID, full_name: "Utilisateur E2E" };
    return json(r, wantsObject(r) ? profile : [profile]);
  });
  await context.route(/\/rest\/v1\/rpc\/get_user_tenant_id/, (r) => json(r, E2E_TENANT_ID));
  await context.route(/\/rest\/v1\/rpc\/my_access/, (r) => json(r, { roles: ["admin"], permissions: ALL_PERMISSIONS }));
}

export const test = base.extend<{ backendBaseline: void }>({
  backendBaseline: [async ({ context }, use) => {
    await installBackendBaseline(context);
    await use();
  }, { auto: true }],
});
