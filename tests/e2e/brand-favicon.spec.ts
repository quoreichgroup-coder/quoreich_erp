import { readFile } from "node:fs/promises";
import { test, expect } from "./fixtures/test";

test("les icônes QERP sont déclarées, décodées et lisibles aux tailles de l'onglet", async ({ page }, info) => {
  await page.goto("/login");
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute("href", "/branding/qerp-favicon.svg");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/branding/qerp-touch-icon.png");
  const paths = ["/branding/qerp-favicon.svg", "/favicon.ico?v=qerp-20261126", "/branding/qerp-touch-icon.png"];
  for (const path of paths) {
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true); expect(response.headers()["content-type"]).toContain("image/");
    // Vérifier aussi les octets réellement servis : un aperçu peut garder un ancien dist.
    expect(await response.body()).toEqual(await readFile(`public${new URL(path, page.url()).pathname}`));
    const decoded = await page.evaluate(async path => {
      const img = new Image(); img.src = path; await img.decode();
      const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0, 32, 32);
      const pixels = ctx.getImageData(0, 0, 32, 32).data;
      let blue = 0, orange = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 30 && pixels[i + 1] > 60 && pixels[i + 1] < 130 && pixels[i + 2] > 180) blue++;
        if (pixels[i] > 220 && pixels[i + 1] > 110 && pixels[i + 1] < 170 && pixels[i + 2] > 45 && pixels[i + 2] < 115) orange++;
      }
      return { width: img.naturalWidth, height: img.naturalHeight, blue, orange };
    }, path);
    expect(decoded.width).toBeGreaterThan(0); expect(decoded.width).toBe(decoded.height);
    expect(decoded.blue).toBeGreaterThan(0); expect(decoded.orange).toBeGreaterThan(0);
    if (path.endsWith(".png")) expect(decoded.width).toBe(180);
  }
  const origin = new URL(page.url()).origin;
  await page.setContent('<main style="display:flex;gap:24px;padding:24px;background:#f4f5f7">' + [16, 32, 48].map(size => `<figure style="margin:0"><img src="${origin}/branding/qerp-favicon.svg" width="${size}" height="${size}" alt="QERP ${size} px"><figcaption>${size} px</figcaption></figure>`).join("") + "</main>");
  await expect(page.getByRole("img")).toHaveCount(3);
  await page.getByRole("img").evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  await page.getByRole("main").screenshot({ path: info.outputPath("qerp-favicon-sizes.png") });
});
