import { readFileSync, existsSync } from "node:fs";
import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Identifiants d'un compte de test : variables d'environnement, sinon fichier hors dépôt.
 * « auteur » saisit les pièces (administrateur de la société de test) ; « approbateur » les
 * approuve (séparation des tâches : l'auteur n'approuve jamais ses propres pièces).
 */
export function identifiants(qui: "auteur" | "approbateur" = "auteur"): { email: string; password: string } | null {
  const prefixe = qui === "auteur" ? "E2E" : "E2E_APPROVER";
  let email = process.env[`${prefixe}_EMAIL`];
  let password = process.env[`${prefixe}_PASSWORD`];
  const fichier = process.env.E2E_CREDENTIALS_FILE ?? "C:/Users/Abdouramane/QERP-backups/e2e-credentials.txt";
  if ((!email || !password) && existsSync(fichier)) {
    for (const ligne of readFileSync(fichier, "utf8").split(/\r?\n/)) {
      const i = ligne.indexOf("=");
      if (i < 0) continue;
      const cle = ligne.slice(0, i), valeur = ligne.slice(i + 1).trim();
      if (cle === `${prefixe}_EMAIL`) email ??= valeur;
      if (cle === `${prefixe}_PASSWORD`) password ??= valeur;
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
  const attendus: { etape: string; motif: RegExp }[] = [];
  return {
    incidents,
    etape(nom: string) { etape = nom; },
    /**
     * Refus métier ANNONCÉ dans l'étape courante (ex. un paramètre de la société qui interdit
     * l'action) : le refus du serveur qui porte ce motif, et la ligne de console que le navigateur
     * écrit pour toute réponse 400, ne comptent pas comme incidents. Tout autre refus, oui.
     */
    refusAttendu(motif: RegExp) { attendus.push({ etape, motif }); },
    /** Incidents hors refus annoncés : c'est ce qu'un parcours exige vide. */
    inattendus(): Incident[] {
      const etapesTolerees = new Set(
        incidents.filter((i) => i.type === "refus-serveur" && attendus.some((a) => a.etape === i.quand && a.motif.test(i.detail)))
          .map((i) => i.quand));
      return incidents.filter((i) => {
        if (i.type === "refus-serveur") return !attendus.some((a) => a.etape === i.quand && a.motif.test(i.detail));
        if (i.type === "erreur-console" && etapesTolerees.has(i.quand) && /status of 400/.test(i.detail)) return false;
        return true;
      });
    },
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
