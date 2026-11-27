import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// The SVG is the source of truth; Chromium rasterizes it without external assets.
const source = new URL("../../public/branding/qerp-favicon.svg", import.meta.url);
const svg = await readFile(source, "utf8");
const browser = await chromium.launch({ channel: "chromium", headless: true });

try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
  const sizes = [16, 32, 48, 64];
  const images = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    images.push(await page.locator("svg").screenshot({ omitBackground: true }));
  }

  // ICO directory with PNG frames, supported by current desktop browsers.
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size;
    directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  await writeFile(new URL("../../public/favicon.ico", import.meta.url), Buffer.concat([directory, ...images]));

  await page.setViewportSize({ width: 180, height: 180 });
  await page.evaluate(() => { document.body.style.background = "#ffffff"; });
  await writeFile(new URL("../../public/branding/qerp-touch-icon.png", import.meta.url), await page.screenshot());
  process.stdout.write("Generated QERP favicon.ico (16/32/48/64 px) and touch icon (180 px).\n");
} finally {
  await browser.close();
}
