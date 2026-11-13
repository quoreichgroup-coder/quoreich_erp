import { readFileSync, existsSync } from "node:fs";
import { expect, type Page, type TestInfo } from "@playwright/test";

/** Identifiants du compte de test : variables d'environnement, sinon fichier hors dépôt. */
export function identifiants(): { email: string; password: string } | null {
  let email = process.env.E2E_EMAIL;
  let password = process.env.E2E_PASSWORD;
  const fichier = process.env.E2E_CREDENTIALS_FILE ?? "C:/Users/Abdouramane/QERP-backups/e2e-credentials.txt";
  if ((!email || !password) && existsSync(fichier)) {
    for (const ligne of readFileSync(fichier, "utf8").split(/\r?\n/)) {
      const [k, ...v] = ligne.split("=");
      if (k === "E2E_EMAIL") email ??= v.join("=").trim();
      if (k === "E2E_PASSWORD") password ??= v.join("=").trim();
    }
  }
  return email && password ? { email, password } : null;
}

/** Préfixe unique par exécution : les données d'un passage se reconnaissent et ne se mélangent pas. */
export const RUN = process.env.E2E_RUN_ID ?? `E2E-${Date.now().toString(36).toUpperCase()}`;

export type Incident = { quand: string; type: "refus-serveur" | "erreur-console" | "erreur-page"; detail: string };

/**
 * Observe la page : refus du serveur (réponses ≥ 400 de Supabase, avec le message renvoyé),
 * erreurs de console et exceptions non rattrapées. Joint le tout au rapport en fin de test.
 */
export function surveiller(page: Page) {
  const incidents: Incident[] = [];
  let etape = "début";
  page.on("response", async (r) => {
    if (r.status() < 400 || !/supabase\.co|:8090\//.test(r.url())) return;
    let corps = "";
    try { corps = (await r.text()).slice(0, 400); } catch { /* corps indisponible */ }
    const u = new URL(r.url());
    incidents.push({ quand: etape, type: "refus-serveur", detail: `${r.request().method()} ${u.pathname}${u.search.slice(0, 120)} → ${r.status()} ${corps}` });
  });
  page.on("console", (m) => {
    if (m.type() === "error") incidents.push({ quand: etape, type: "erreur-console", detail: m.text().slice(0, 400) });
  });
  page.on("pageerror", (e) => incidents.push({ quand: etape, type: "erreur-page", detail: String(e).slice(0, 400) }));
  return {
    incidents,
    etape(nom: string) { etape = nom; },
    async joindre(testInfo: TestInfo) {
      await testInfo.attach("incidents.json", { body: JSON.stringify(incidents, null, 2), contentType: "application/json" });
    },
  };
}

/** Attend un toast (sonner) contenant le texte, et le renvoie pour inspection. */
export async function toast(page: Page, texte: string | RegExp) {
  const t = page.locator("[data-sonner-toast]").filter({ hasText: texte }).first();
  await expect(t).toBeVisible();
  return t;
}

/** Texte du dernier toast affiché (succès ou erreur), utile pour rapporter un refus. */
export async function dernierToast(page: Page, attente = 8_000): Promise<string> {
  const t = page.locator("[data-sonner-toast]").last();
  try {
    await t.waitFor({ state: "visible", timeout: attente });
    return (await t.innerText()).replace(/\s+/g, " ").trim();
  } catch {
    return "(aucun message)";
  }
}

export const aujourdhui = () => new Date().toISOString().slice(0, 10);
