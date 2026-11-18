import { expect, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { identifiants, verifierIdentiteE2E, verifierSocieteE2E } from "../parcours/outils";

export const lectureSeule = process.env.E2E_TREASURY_READONLY === "1";
export const auteurLecture = lectureSeule ? identifiants("auteur") : null;
export const approbateurLecture = lectureSeule ? identifiants("approbateur") : null;

export async function loginLecture(page: Page, base: string, email: string, password: string) {
  verifierIdentiteE2E(email);
  await page.goto(`${base}/login`);
  await page.getByPlaceholder("vous@entreprise.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await verifierSocieteE2E(page, 75_000);
}

export async function lireEcran(page: Page, url: string, role?: "auteur" | "approbateur") {
  if (!lectureSeule) { await page.goto(url); return; }
  const [access] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/rpc/my_access"), { timeout: 70_000 }),
    page.goto(url),
  ]);
  await verifierSocieteE2E(page, 60_000);
  expect(access.ok(), "Le navigateur doit récupérer les droits de la société de recette").toBe(true);
  const { permissions } = await access.json() as { permissions: string[] };
  if (role) {
    const attendu = role === "auteur";
    expect(permissions.includes("treasury.view_sensitive"), "Droit de voir les montants").toBe(attendu);
    expect(permissions.includes("treasury.export"), "Droit d'exporter").toBe(attendu);
  }
}

export async function ouvrirAudit(page: Page, base: string, role: "auteur" | "approbateur") {
  await lireEcran(page, `${base}/treasury/settings`, role);
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/rest/v1/treasury_role_audit")),
    page.getByRole("button", { name: "Rôles RBAC", exact: true }).click(),
  ]);
  expect(response.ok(), "Lecture de l'audit Trésorerie").toBe(true);
  const actions = await response.json() as unknown[];
  const bouton = page.getByRole("button", { name: /^Audit \(/ });
  await expect(bouton).toHaveText(`Audit (${actions.length})`);
  await bouton.click();
  const dialog = page.getByRole("dialog", { name: "Audit — Rôles Trésorerie" });
  await expect(dialog).toBeVisible();
  return { dialog, total: actions.length };
}

export const EXPORT_AUDIT = "Exporter l'audit CSV";
export const EXPORT_MOUVEMENTS = "Exporter les mouvements (CSV)";
export const AUDIT_HEADER = "\uFEFFDate;Action;Rôle;Utilisateur cible;Commentaire";

export async function lireCsv(download: Download) {
  const raw = await readFile(await download.path(), "utf8");
  const cells: string[][] = [];
  const csv = raw.replace(/^\uFEFF/, "");
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ";" || char === "\n")) {
      row.push(field);
      field = "";
      if (char === "\n") { cells.push(row); row = []; }
    } else if (quoted || char !== "\r") field += char;
  }
  if (row.length || field) cells.push([...row, field]);
  const [headers = [], ...rows] = cells;
  return { raw, headers, rows };
}
