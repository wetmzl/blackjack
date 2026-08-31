import fs from "node:fs";
import { chromium } from "playwright";

const [input, topOutput, bottomOutput] = process.argv.slice(2);
if (!input || !topOutput || !bottomOutput) {
  throw new Error("Usage: node tools/art/split-stacked-trophy-sheet.mjs <input.png> <top.png> <bottom.png>");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const source = `data:image/png;base64,${fs.readFileSync(input).toString("base64")}`;
  const panels = await page.evaluate(async (imageSource) => {
    const image = new Image();
    image.src = imageSource;
    await image.decode();

    const outputWidth = 1600;
    const outputHeight = 450;
    const sourceHeight = Math.floor(image.height / 2);
    const sourceRows = [0, image.height - sourceHeight];

    return sourceRows.map((sourceY) => {
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context unavailable");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.clearRect(0, 0, outputWidth, outputHeight);
      context.drawImage(image, 0, sourceY, image.width, sourceHeight, 0, 0, outputWidth, outputHeight);
      return canvas.toDataURL("image/png");
    });
  }, source);

  fs.writeFileSync(topOutput, Buffer.from(panels[0].split(",")[1], "base64"));
  fs.writeFileSync(bottomOutput, Buffer.from(panels[1].split(",")[1], "base64"));
  process.stdout.write(`${topOutput}: 1600x450\n${bottomOutput}: 1600x450\n`);
} finally {
  await browser.close();
}
