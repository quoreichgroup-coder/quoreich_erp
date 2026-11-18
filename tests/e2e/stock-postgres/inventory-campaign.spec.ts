import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { buildXlsx, unzip } from "../../../src/lib/xlsx";

const app = "http://127.0.0.1:18102";
const rest = "http://127.0.0.1:18101";
const depot = "10000000-0000-4000-8000-000000000001";
const article = "30000000-0000-4000-8000-000000000001";
const reference = "E2E-INV-0001";
const alpha = "Société Alpha (recette)";
const beta = "Société Beta (recette)";
const users = {
  reviewer: "aaaaaaaa-0000-0000-0000-000000000001",
  first: "aaaaaaaa-0000-0000-0000-000000009101",
  second: "aaaaaaaa-0000-0000-0000-000000009102",
  other: "bbbbbbbb-0000-0000-0000-000000000002",
  otherCounter: "bbbbbbbb-0000-0000-0000-000000009101",
};

async function newSession(browser: Browser, actor: keyof typeof users) {
  const secret = process.env.QERP_STOCK_TEST_JWT_SECRET;
  if (!secret) throw new Error("Aucune base de test isolée configurée.");
  const email = `${actor}@stock-test.invalid`;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const id = users[actor];
  const base64 = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  const payload = `${base64({ alg: "HS256", typ: "JWT" })}.${base64({ sub: id, role: "authenticated", aud: "authenticated", exp })}`;
  const jwt = `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
  const user = { id, email, role: "authenticated", aud: "authenticated", app_metadata: {}, user_metadata: {} };
  const session = { access_token: jwt, token_type: "bearer", refresh_token: "local-test", expires_at: exp, expires_in: 3600, user };
  const key = `sb-${new URL(rest).hostname.split(".")[0]}-auth-token`;
  const context = await browser.newContext({
    baseURL: app,
    locale: "fr-FR",
    storageState: { cookies: [], origins: [{ origin: app, localStorage: [{ name: key, value: JSON.stringify(session) }] }] },
  });
  // Only local requests are possible. Adapt the Supabase URL prefix, leaving PostgREST to enforce SQL rights and execute every RPC.
  await context.route("**/*", (route) => [app, rest].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await context.route(`${rest}/rest/v1/**`, (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.slice("/rest/v1".length);
    return route.continue({ url: url.toString() });
  });
  await context.route(`${rest}/auth/v1/user`, (route) => route.fulfill({ json: user }));
  await context.routeWebSocket(`${rest.replace("http:", "ws:")}/realtime/**`, () => { /* no Realtime service in this fixture */ });
  return context;
}

async function ouvrir(page: Page, route: string, company = alpha) {
  await page.goto(route);
  await expect(page.locator("header").getByText(company, { exact: true })).toBeVisible();
}

test("S3 PostgreSQL : rapport ABC et tournant concordent avant le premier comptage", async ({ browser }) => {
  const context = await newSession(browser, "reviewer");
  try {
    const page = await context.newPage();
    await ouvrir(page, "/inventory/reporting?tab=abc");
    await page.getByLabel("Dépôt de l’analyse").selectOption(depot);
    await expect(page.getByText(/Valeur en stock au dépôt.*1 article\(s\) analysé\(s\), 1 à échéance/)).toBeVisible();
    await expect(page.getByRole("row", { name: /E2E-ARTICLE/ }).getByRole("cell", { name: "Classe A", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Préparer le tournant" }).click();
    await expect(page.getByLabel("Dépôt du tournant")).toHaveValue(depot);
    await expect(page.getByText("1 article(s) à échéance, 1 dans la proposition. Base : Valeur en stock au dépôt.")).toBeVisible();
    await expect(page.getByRole("row", { name: /E2E-ARTICLE/ }).getByRole("cell", { name: "A", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("S3 PostgreSQL : import, recomptage, validation, isolation et export", async ({ browser }) => {
  const contexts = await Promise.all((["first", "second", "reviewer", "other"] as const).map((actor) => newSession(browser, actor)));
  try {
    const [first, second, reviewer, other] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    const transactions = `/inventory/transactions?tab=campaigns&depot=${depot}`;
    await ouvrir(first, transactions);
    await expect(first.getByText(/:\s*1 article\(s\)\./)).toBeVisible();
    const [started] = await Promise.all([
      first.waitForResponse((res) => new URL(res.url()).pathname.endsWith("/rpc/inventory_campaign")
        && res.request().postDataJSON()?._action === "open"),
      first.getByRole("button", { name: "Ouvrir et geler le dépôt" }).click(),
    ]);
    expect(started.ok(), `Ouverture de la campagne (HTTP ${started.status()})`).toBe(true);
    const campaign = await started.json() as { id: string; reference: string; lines: Record<string, unknown>[] };
    expect(campaign.reference).toBe(reference);
    expect(campaign.lines[0]).not.toHaveProperty("expected");
    const sheet = buildXlsx([{ campaign: campaign.id, stage: "Comptage initial", article, code: "E2E-ARTICLE", unit: "pièce", quantity: 3 }], [
      { key: "campaign", header: "Identifiant campagne" }, { key: "stage", header: "Étape" },
      { key: "article", header: "Identifiant article" }, { key: "code", header: "Code article" },
      { key: "unit", header: "Unité" }, { key: "quantity", header: "Quantité comptée" },
    ]);
    await first.getByLabel("Importer la feuille remplie (.xlsx)").setInputFiles({
      name: "comptage.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(sheet),
    });
    await first.getByRole("button", { name: "Confirmer l’import" }).click();
    await first.getByRole("button", { name: "Soumettre le comptage" }).click();
    await expect(first.getByText("Comptage soumis · dépôt gelé")).toBeVisible();

    const catalog = "/inventory/transactions?tab=campaign-catalog";
    await ouvrir(other, catalog, beta);
    await expect(other.getByText("Aucune campagne ne correspond aux filtres.")).toBeVisible();
    await expect(other.getByText(reference, { exact: true })).toHaveCount(0);

    await ouvrir(reviewer, catalog);
    await reviewer.getByRole("row", { name: new RegExp(reference) }).getByRole("link", { name: "Contrôler" }).click();
    await reviewer.getByRole("button", { name: "Consulter les écarts" }).click();
    await expect(reviewer.getByText("Recomptage requis", { exact: true })).toBeVisible();
    await expect(reviewer.getByRole("button", { name: "Valider et ajuster le stock" })).toBeDisabled();
    await reviewer.getByRole("button", { name: "Demander le recomptage" }).click();
    await expect(reviewer.getByText("Recomptage en attente", { exact: true })).toBeVisible();

    await ouvrir(first, transactions);
    await expect(first.getByText("Aucun article à recompter pour vous.")).toBeVisible();
    await ouvrir(second, transactions);
    await expect(second.getByPlaceholder("Déjà compté")).toBeDisabled();
    await expect(second.getByPlaceholder("Déjà compté")).toHaveValue("");
    const recount = second.getByRole("region", { name: "Recomptage à l’aveugle" });
    const input = recount.getByLabel(/E2E-ARTICLE/);
    await expect(input).toHaveValue("");
    await input.fill("5");
    await recount.getByRole("button", { name: "Enregistrer le recomptage" }).click();
    await expect(recount.getByText("Recomptage enregistré.")).toBeVisible();

    await reviewer.getByRole("button", { name: "Actualiser les écarts" }).click();
    await expect(reviewer.getByText("Recompté", { exact: true })).toBeVisible();
    await reviewer.getByRole("button", { name: "Valider et ajuster le stock" }).click();
    await reviewer.getByRole("button", { name: "Confirmer la validation" }).click();
    await expect(reviewer.getByText("Campagne validée · dépôt libéré")).toBeVisible();
    await reviewer.getByRole("link", { name: "Retour au catalogue" }).click();
    await reviewer.getByRole("button", { name: `Historique de ${reference}` }).click();
    const timeline = reviewer.getByRole("dialog", { name: "Historique de la campagne" });
    await expect(timeline.getByRole("listitem")).toHaveCount(3);
    await expect(timeline.getByText("Campagne validée", { exact: true })).toBeVisible();
    await reviewer.keyboard.press("Escape");
    const [download] = await Promise.all([
      reviewer.waitForEvent("download"), reviewer.getByRole("button", { name: "Exporter le catalogue (Excel)" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("catalogue-inventaires.xlsx");
    const xlsx = await unzip(Uint8Array.from(await readFile(await download.path())).buffer);
    const exportedSheet = new TextDecoder().decode(xlsx.get("xl/worksheets/sheet1.xml"));
    expect(exportedSheet).toContain(reference);
    expect(exportedSheet).not.toContain("Autre société");

    await ouvrir(reviewer, "/inventory/reporting?tab=abc");
    await reviewer.getByLabel("Dépôt de l’analyse").selectOption(depot);
    await expect(reviewer.getByText(/1 article\(s\) analysé\(s\), 0 à échéance/)).toBeVisible();
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});

test("S3 PostgreSQL : la validation refuse de doubler le stock global non affecté", async ({ browser }) => {
  const contexts = await Promise.all([newSession(browser, "otherCounter"), newSession(browser, "other")]);
  const otherDepot = "10000000-0000-4000-8000-000000000002";
  const otherReference = "E2E-B-INV-0001";
  try {
    const [counter, reviewer] = await Promise.all(contexts.map((context) => context.newPage()));
    await ouvrir(counter, `/inventory/transactions?tab=campaigns&depot=${otherDepot}`, beta);
    await counter.getByRole("button", { name: "Ouvrir et geler le dépôt" }).click();
    await expect(counter.getByText(otherReference, { exact: true })).toBeVisible();
    await counter.getByLabel(/E2E-SANS-DEPOT/).fill("1");
    await counter.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await counter.getByRole("button", { name: "Soumettre le comptage" }).click();
    await expect(counter.getByText("Comptage soumis · dépôt gelé")).toBeVisible();

    await ouvrir(reviewer, "/inventory/transactions?tab=campaign-catalog", beta);
    await reviewer.getByRole("row", { name: new RegExp(otherReference) }).getByRole("link", { name: "Contrôler" }).click();
    await reviewer.getByRole("button", { name: "Consulter les écarts" }).click();
    await expect(reviewer.getByText("Dans la tolérance", { exact: true })).toBeVisible();
    await reviewer.getByRole("button", { name: "Valider et ajuster le stock" }).click();
    await reviewer.getByRole("button", { name: "Confirmer la validation" }).click();
    await expect(reviewer.getByRole("alert").filter({ hasText: /Le stock global de l’article E2E-SANS-DEPOT n’est pas entièrement affecté/ })).toBeVisible();
    await expect(reviewer.getByText("Campagne soumise · dépôt gelé", { exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
