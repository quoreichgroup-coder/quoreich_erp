import { test, expect, ALL_PERMISSIONS } from "./fixtures/test";
import { E2E_USER_ID } from "./fixtures/session";

test.beforeEach(async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", route => route.fulfill({ json: {
    roles: ["admin"], permissions: [...ALL_PERMISSIONS, "procurement.requisition", "procurement.order", "procurement.receive"],
  } }));
  await page.route("**/rest/v1/tenants?*", route => route.fulfill({ json: { name: "Société de démonstration", currency: "XOF" } }));
  await page.route("**/rest/v1/purchase_requisitions?*", route => route.fulfill({ json: [{
    id: "brand-pr-1", pr_number: "DA-2026-001", description: "Équipement et maintenance du service comptable",
    estimated_total: 225000, request_date: new Date().toISOString().slice(0, 10), requested_by: E2E_USER_ID,
    status: "approved", po_id: null, lines: [],
  }] }));
});

test("la page applique la palette et la typographie de la charte sur mobile et bureau", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/procurement/transactions");
  await expect(page).toHaveTitle("QERP — ERP financier OHADA");
  const heading = page.getByRole("heading", { name: "Transactions d'achat", exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("tabpanel").locator("tbody")).toContainText("DA-2026-001");
  await page.evaluate(() => document.fonts.ready);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: info.outputPath(`application-${width}.png`), fullPage: true });
  }
  const font = await heading.evaluate(element => getComputedStyle(element).fontFamily);
  expect(font).toContain("Playfair Display");
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  expect(await sidebar.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(0, 98, 219)");
  const accent = page.locator('[data-brand-accent="heading"]');
  await expect(accent).toBeVisible();
  expect(await accent.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 138, 81)");
});

test("les vraies polices sont disponibles sans Google Fonts et les deux thèmes restent contenus", async ({ page }, info) => {
  const fonts: string[] = [];
  page.on("response", response => { if (response.request().resourceType() === "font") fonts.push(response.url()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto("/login");
  const loaded = await page.evaluate(async () => {
    const body = await document.fonts.load('400 16px "Montserrat"', 'Équipement français œ');
    const title = await document.fonts.load('600 24px "Playfair Display"', 'Connexion française œ');
    return { body: body.length > 0 && body.every(font => font.status === "loaded"), title: title.length > 0 && title.every(font => font.status === "loaded") };
  });
  expect(loaded).toEqual({ body: true, title: true });
  expect(fonts.some(url => url.includes("/fonts/montserrat-"))).toBe(true);
  expect(fonts.some(url => url.includes("/fonts/playfair-display-"))).toBe(true);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`connexion-${theme}-${width}.png`), fullPage: true });
    }
  }
});

test("la navigation garde son contraste, le clavier et la société active sur téléphone", async ({ page }, info) => {
  await page.goto("/procurement/transactions");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    const active = sidebar.locator('a[aria-current="page"]').first();
    await expect(active).toBeVisible();
    for (const target of [active, sidebar.locator('button[aria-expanded]').first()]) {
      for (const state of ["idle", "hover", "focus"] as const) {
        if (state === "hover") await target.hover();
        if (state === "focus") {
          await page.mouse.move(1400, 999);
          await target.focus();
        }
        const contrast = await target.evaluate(element => {
          const ctx = new OffscreenCanvas(1, 1).getContext("2d")!;
          const color = (value: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
          const over = (a: number[], b: number[]) => a.slice(0, 3).map((v, i) => v * a[3] / 255 + b[i] * (1 - a[3] / 255));
          const ancestors: Element[] = []; for (let p: Element | null = element; p; p = p.parentElement) ancestors.unshift(p);
          let bg = [255, 255, 255]; for (const node of ancestors) bg = over(color(getComputedStyle(node).backgroundColor), bg);
          const fg = over(color(getComputedStyle(element).color), bg);
          const l = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
          const values = [l(fg), l(bg)].sort((a, b) => b - a);
          return { ratio: (values[0] + .05) / (values[1] + .05), fg, bg,
            label: element.textContent?.trim(), transition: getComputedStyle(element).transition };
        });
        expect(contrast.ratio, `${theme}/${state}: ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByText("Société de démonstration", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "QERP", exact: true })).toHaveCount(1);
  const trigger = page.getByRole("button", { name: "Afficher ou masquer le menu", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: info.outputPath("navigation-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
